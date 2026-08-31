// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import "../Rating/PlayerRating.sol";

interface IRewardCanonicalFactory {
    function isDeployedGame(address game) external view returns (bool);
}

/// @title RewardPool - Play-to-Earn reward system for Chess
/// @notice Manages faucet and game rewards with anti-abuse mechanisms
/// @dev Uses separate pools for faucet and rewards, with decay and behavior factors
contract RewardPool is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ========== CONSTANTS ==========
    uint256 public constant FAUCET_AMOUNT = 5 * 10**18;  // 5 CHESS per new user
    uint256 public constant BASE_WIN_REWARD = 3 * 10**18;   // 3 CHESS
    uint256 public constant BASE_LOSE_REWARD = 1 * 10**18;  // 1 CHESS
    uint256 public constant BASE_DRAW_REWARD = 2 * 10**18;  // 2 CHESS
    uint256 public constant CHECKMATE_BONUS = 1 * 10**18;   // +1 CHESS
    uint256 public constant LONG_GAME_BONUS = 5 * 10**17;   // +0.5 CHESS (for > 30 moves)

    uint256 public constant MIN_MOVES_FOR_REWARD = 10;  // Minimum moves per player
    uint256 public constant LONG_GAME_THRESHOLD = 30;   // Moves for long game bonus
    uint256 public constant DAILY_GAME_LIMIT = 5;       // Max rewarded games per day
    uint256 public constant OPPONENT_COOLDOWN = 7 days; // Cooldown for same opponent
    uint256 public constant BEHAVIOR_HISTORY = 20;      // Games to track for behavior

    // A signer-backed identity gate makes creating fresh wallets insufficient to
    // farm rewards. The immutable ceiling also bounds losses if that signer or
    // its off-chain eligibility process is compromised.
    bytes32 public constant REWARD_ELIGIBILITY_DOMAIN =
        keccak256("RewardPool.rewardEligibility.v2");
    bytes32 public constant FAUCET_AUTHORIZATION_DOMAIN =
        keccak256("RewardPool.faucet.v2");
    uint256 public constant MAX_GLOBAL_DAILY_REWARD = 1_000 * 10**18;
    uint256 public constant MAX_GLOBAL_DAILY_FAUCET = 1_000 * 10**18;

    // Legacy rating constants retained for ABI compatibility. Ratings are a
    // permissionless reputation signal and are no longer an economic multiplier.
    uint256 public constant RATING_FACTOR_FLOOR = 200;  // 0.2 in fixed point (1000 = 1.0)
    uint256 public constant RATING_REFERENCE = 2000;    // Rating where factor = floor

    // Behavior factor: floor at 50% (500/1000)
    uint256 public constant BEHAVIOR_FACTOR_FLOOR = 500;

    // ========== STATE ==========
    IERC20 public chessToken;
    PlayerRating public playerRating;
    address public chessFactory;
    address public faucetSigner;

    // Pool balances
    uint256 public faucetPool;
    uint256 public rewardPool;
    uint256 public rewardPoolCapacity;  // Used for decay calculation
    uint256 public globalDailyRewardCap;
    uint256 public globalDailyFaucetCap;

    // Valid game contracts (prevents DOS from iterating all games)
    mapping(address => bool) public validGameContracts;

    // Faucet tracking
    mapping(address => bool) public hasClaimed;
    mapping(address => uint256) public faucetNonces;
    mapping(uint256 => uint256) public globalDailyFaucetClaims;

    // Reward eligibility is explicitly attested by faucetSigner. Epoch binding
    // lets a signer rotation atomically invalidate every authorization and every
    // eligibility granted by a compromised key.
    uint256 public rewardEligibilityEpoch = 1;
    mapping(address => uint256) private rewardEligibleAtEpoch;
    mapping(address => uint256) public rewardEligibilityNonces;

    // Day index => total CHESS rewards actually paid that day.
    mapping(uint256 => uint256) public globalDailyRewards;

    // Daily game tracking (player => day => count)
    mapping(address => mapping(uint256 => uint256)) public dailyGames;

    // Anti-collusion (player => opponent => last rewarded timestamp)
    mapping(address => mapping(address => uint256)) public lastOpponentGame;

    // Behavior tracking
    struct BehaviorRecord {
        uint8 totalGames;      // Count of last N games (max 20)
        uint8 resignCount;     // Resignations in last N games
        uint8 timeoutCount;    // Timeout losses in last N games
        uint8 currentIndex;    // Circular buffer index
        uint8[20] history;     // 0=normal, 1=resign, 2=timeout
    }
    mapping(address => BehaviorRecord) public behaviorRecords;

    struct RewardQuote {
        uint256 amount;
        uint256 poolFactor;
        uint256 ratingFactor;
        uint256 behaviorFactor;
    }

    // ========== EVENTS ==========
    event FaucetClaimed(address indexed player, uint256 amount);
    event RewardDistributed(
        address indexed player,
        uint256 baseReward,
        uint256 finalReward,
        uint256 poolFactor,
        uint256 ratingFactor,
        uint256 behaviorFactor
    );
    event FaucetPoolDeposited(uint256 amount);
    event FaucetPoolWithdrawn(uint256 amount);
    event RewardPoolDeposited(uint256 amount);
    event RewardPoolWithdrawn(uint256 amount);
    event RewardPoolCapacitySet(uint256 newCapacity);
    event PoolLow(string poolType, uint256 remaining, uint256 threshold);
    event BehaviorRecorded(address indexed player, uint8 gameType);
    event FaucetSignerUpdated(address indexed previousSigner, address indexed newSigner);
    event RewardEligibilityRegistered(address indexed player);
    event RewardEligibilityRevoked(address indexed player);
    event RewardEligibilityEpochAdvanced(uint256 previousEpoch, uint256 newEpoch);
    event GlobalDailyRewardCapSet(uint256 previousCap, uint256 newCap);
    event GlobalDailyRewardCapReached(
        uint256 indexed day,
        uint256 emitted,
        uint256 attemptedReward
    );
    event GlobalDailyFaucetCapSet(uint256 previousCap, uint256 newCap);

    // ========== CONSTRUCTOR ==========
    constructor(
        address _chessToken,
        address _playerRating
    ) Ownable(msg.sender) {
        require(_chessToken.code.length > 0, "Token must be contract");
        require(_playerRating.code.length > 0, "Rating must be contract");

        chessToken = IERC20(_chessToken);
        playerRating = PlayerRating(_playerRating);
        faucetSigner = msg.sender;
        globalDailyRewardCap = MAX_GLOBAL_DAILY_REWARD;
        globalDailyFaucetCap = MAX_GLOBAL_DAILY_FAUCET;
    }

    // ========== ADMIN FUNCTIONS ==========

    /// @notice Set the ChessFactory address (for game validation)
    function setChessFactory(address _chessFactory) external onlyOwner {
        require(_chessFactory.code.length > 0, "Factory must be contract");
        chessFactory = _chessFactory;
    }

    /// @notice Rotate the service key and atomically invalidate all reward eligibility
    /// @dev Previously eligible users must obtain a fresh v2 attestation. This is
    ///      intentionally fail-closed so a compromised signer cannot leave a
    ///      permanent population of reward-enabled Sybil wallets behind.
    function setFaucetSigner(address newSigner) external onlyOwner {
        require(newSigner != address(0), "Invalid signer");
        emit FaucetSignerUpdated(faucetSigner, newSigner);
        faucetSigner = newSigner;
        uint256 previousEpoch = rewardEligibilityEpoch;
        rewardEligibilityEpoch = previousEpoch + 1;
        emit RewardEligibilityEpochAdvanced(previousEpoch, rewardEligibilityEpoch);
    }

    /// @notice Revoke one wallet and consume its current authorization nonce
    function revokeRewardEligibility(address player) external onlyOwner {
        require(player != address(0), "Invalid player");
        // This is deliberately valid even before an authorization is consumed:
        // incident response must be able to invalidate one leaked, pre-signed
        // attestation without rotating the signer for every user.
        rewardEligibleAtEpoch[player] = 0;
        rewardEligibilityNonces[player]++;
        faucetNonces[player]++;
        emit RewardEligibilityRevoked(player);
    }

    /// @notice Set the operational daily cap without being able to exceed the
    /// immutable protocol maximum or invalidate rewards already paid today.
    function setGlobalDailyRewardCap(uint256 newCap) external onlyOwner {
        require(newCap > 0 && newCap <= MAX_GLOBAL_DAILY_REWARD, "Invalid daily cap");
        uint256 today = block.timestamp / 1 days;
        require(newCap >= globalDailyRewards[today], "Cap below emitted rewards");

        emit GlobalDailyRewardCapSet(globalDailyRewardCap, newCap);
        globalDailyRewardCap = newCap;
    }

    /// @notice Bound faucet loss during signer compromise or issuer malfunction
    function setGlobalDailyFaucetCap(uint256 newCap) external onlyOwner {
        require(newCap > 0 && newCap <= MAX_GLOBAL_DAILY_FAUCET, "Invalid faucet cap");
        uint256 today = block.timestamp / 1 days;
        require(newCap >= globalDailyFaucetClaims[today], "Cap below faucet emissions");

        emit GlobalDailyFaucetCapSet(globalDailyFaucetCap, newCap);
        globalDailyFaucetCap = newCap;
    }

    /// @notice Deposit CHESS to faucet pool
    function depositFaucetPool(uint256 amount) external onlyOwner {
        require(amount > 0, "Zero amount");
        chessToken.safeTransferFrom(msg.sender, address(this), amount);
        faucetPool += amount;
        emit FaucetPoolDeposited(amount);
    }

    /// @notice Withdraw CHESS from faucet pool
    function withdrawFaucetPool(uint256 amount) external onlyOwner {
        require(amount <= faucetPool, "Insufficient faucet pool");
        faucetPool -= amount;
        chessToken.safeTransfer(msg.sender, amount);
        emit FaucetPoolWithdrawn(amount);
    }

    /// @notice Deposit CHESS to reward pool
    function depositRewardPool(uint256 amount) external onlyOwner {
        require(amount > 0, "Zero amount");
        chessToken.safeTransferFrom(msg.sender, address(this), amount);
        rewardPool += amount;

        // Update capacity if new deposit exceeds it
        if (rewardPool > rewardPoolCapacity) {
            rewardPoolCapacity = rewardPool;
            emit RewardPoolCapacitySet(rewardPoolCapacity);
        }

        emit RewardPoolDeposited(amount);
    }

    /// @notice Withdraw CHESS from reward pool
    function withdrawRewardPool(uint256 amount) external onlyOwner {
        require(amount <= rewardPool, "Insufficient reward pool");
        rewardPool -= amount;
        chessToken.safeTransfer(msg.sender, amount);
        emit RewardPoolWithdrawn(amount);
    }

    /// @notice Manually set reward pool capacity (for decay calculation)
    function setRewardPoolCapacity(uint256 capacity) external onlyOwner {
        require(capacity >= rewardPool, "Capacity below current pool");
        rewardPoolCapacity = capacity;
        emit RewardPoolCapacitySet(capacity);
    }

    // ========== FAUCET ==========

    /// @notice Claim faucet tokens once with an expiring, epoch-bound authorization
    /// @param deadline Last timestamp at which the authorization may be consumed
    /// @param authorization Signature over purpose, pool, chain, beneficiary,
    ///        signer epoch, per-wallet nonce and deadline
    function claimFaucet(
        uint256 deadline,
        bytes calldata authorization
    ) external nonReentrant {
        require(!hasClaimed[msg.sender], "Already claimed");
        require(chessToken.balanceOf(msg.sender) == 0, "Already has CHESS");
        require(faucetPool >= FAUCET_AMOUNT, "Faucet pool empty");
        require(block.timestamp <= deadline, "Faucet authorization expired");

        uint256 today = block.timestamp / 1 days;
        uint256 emittedToday = globalDailyFaucetClaims[today];
        require(
            emittedToday + FAUCET_AMOUNT <= globalDailyFaucetCap,
            "Faucet daily cap reached"
        );

        uint256 nonce = faucetNonces[msg.sender];
        bytes32 digest = keccak256(
            abi.encode(
                FAUCET_AUTHORIZATION_DOMAIN,
                address(this),
                block.chainid,
                msg.sender,
                rewardEligibilityEpoch,
                nonce,
                deadline
            )
        );
        bytes32 signedDigest = MessageHashUtils.toEthSignedMessageHash(digest);
        require(
            SignatureChecker.isValidSignatureNow(faucetSigner, signedDigest, authorization),
            "Invalid faucet authorization"
        );

        hasClaimed[msg.sender] = true;
        faucetNonces[msg.sender] = nonce + 1;
        _markRewardEligible(msg.sender);
        faucetPool -= FAUCET_AMOUNT;
        globalDailyFaucetClaims[today] = emittedToday + FAUCET_AMOUNT;
        chessToken.safeTransfer(msg.sender, FAUCET_AMOUNT);

        emit FaucetClaimed(msg.sender, FAUCET_AMOUNT);

        // Emit warning if pool is low (< 10%)
        if (faucetPool < FAUCET_AMOUNT * 100) {
            emit PoolLow("faucet", faucetPool, FAUCET_AMOUNT * 100);
        }
    }

    /// @notice Register for game rewards using a dedicated off-chain eligibility
    /// attestation. This is separate from the faucet authorization so signatures
    /// cannot be replayed across purposes.
    /// @param deadline Last timestamp at which the attestation may be consumed
    /// @param authorization Signature over domain, pool, chain, beneficiary,
    ///        eligibility epoch, per-wallet nonce, and deadline
    function registerRewardEligibility(
        uint256 deadline,
        bytes calldata authorization
    ) external nonReentrant {
        require(!rewardEligible(msg.sender), "Already reward eligible");
        require(block.timestamp <= deadline, "Reward authorization expired");

        uint256 nonce = rewardEligibilityNonces[msg.sender];

        bytes32 digest = keccak256(
            abi.encode(
                REWARD_ELIGIBILITY_DOMAIN,
                address(this),
                block.chainid,
                msg.sender,
                rewardEligibilityEpoch,
                nonce,
                deadline
            )
        );
        bytes32 signedDigest = MessageHashUtils.toEthSignedMessageHash(digest);
        require(
            SignatureChecker.isValidSignatureNow(faucetSigner, signedDigest, authorization),
            "Invalid reward authorization"
        );

        rewardEligibilityNonces[msg.sender] = nonce + 1;
        _markRewardEligible(msg.sender);
    }

    // ========== GAME REWARDS ==========

    /// @notice Atomically distribute both sides of one completed-game reward
    /// @dev Atomic budgeting prevents fixed call ordering from paying only one side
    ///      when the pool or global daily budget is nearly exhausted.
    /// @param result 0=draw, 1=White wins, 2=Black wins
    /// @param disqualifiedPlayer Optional side barred from rewards by adjudication
    function distributeGameRewards(
        address white,
        address black,
        uint8 result,
        bool isCheckmate,
        uint256 moveCount,
        bool whiteWasResign,
        bool whiteWasTimeout,
        bool blackWasResign,
        bool blackWasTimeout,
        address disqualifiedPlayer
    ) external nonReentrant {
        require(_isValidGameContract(msg.sender), "Not authorized");
        require(white != address(0) && black != address(0), "Invalid addresses");
        require(white != black, "Same player");
        require(result <= 2, "Invalid result");
        require(
            disqualifiedPlayer == address(0) ||
            disqualifiedPlayer == white ||
            disqualifiedPlayer == black,
            "Invalid disqualified player"
        );

        bool isDraw = result == 0;
        bool whiteWins = result == 1;
        bool blackWins = result == 2;
        RewardQuote memory whiteQuote;
        RewardQuote memory blackQuote;
        if (
            disqualifiedPlayer != white &&
            _canReceiveReward(white, black, moveCount)
        ) {
            whiteQuote = _quoteReward(
                white,
                whiteWins,
                isDraw,
                isCheckmate && whiteWins,
                moveCount
            );
        }
        if (
            disqualifiedPlayer != black &&
            _canReceiveReward(black, white, moveCount)
        ) {
            blackQuote = _quoteReward(
                black,
                blackWins,
                isDraw,
                isCheckmate && blackWins,
                moveCount
            );
        }

        // Negative behavior belongs to the canonical game record, not to the
        // availability of today's incentive budget. Record a qualifying
        // resignation/timeout exactly once even when a side hit its daily limit,
        // the pair is cooling down, or the pool/cap is exhausted. Normal results
        // remain payout-gated so zero-value games cannot wash this history.
        bool recordWhitePenalty =
            (whiteWasResign || whiteWasTimeout) &&
            disqualifiedPlayer != white &&
            rewardEligible(white) &&
            rewardEligible(black) &&
            moveCount / 2 >= MIN_MOVES_FOR_REWARD;
        bool recordBlackPenalty =
            (blackWasResign || blackWasTimeout) &&
            disqualifiedPlayer != black &&
            rewardEligible(white) &&
            rewardEligible(black) &&
            moveCount / 2 >= MIN_MOVES_FOR_REWARD;
        if (recordWhitePenalty) {
            _recordBehavior(white, whiteWasResign, whiteWasTimeout);
        }
        if (recordBlackPenalty) {
            _recordBehavior(black, blackWasResign, blackWasTimeout);
        }

        uint256 totalReward = whiteQuote.amount + blackQuote.amount;
        if (totalReward == 0 || totalReward > rewardPool) return;

        uint256 today = block.timestamp / 1 days;
        uint256 emittedToday = globalDailyRewards[today];
        uint256 remainingDailyBudget = globalDailyRewardCap - emittedToday;
        if (totalReward > remainingDailyBudget) {
            emit GlobalDailyRewardCapReached(today, emittedToday, totalReward);
            return;
        }

        // A rewarded encounter consumes the pair cooldown in both directions,
        // even when one side has already exhausted its own daily allowance. A
        // directional update lets the unpaid side collect against the same
        // opponent on the next day before the seven-day cooldown expires.
        lastOpponentGame[white][black] = block.timestamp;
        lastOpponentGame[black][white] = block.timestamp;

        if (whiteQuote.amount > 0) {
            dailyGames[white][today]++;
            if (!recordWhitePenalty) {
                _recordBehavior(white, false, false);
            }
        }
        if (blackQuote.amount > 0) {
            dailyGames[black][today]++;
            if (!recordBlackPenalty) {
                _recordBehavior(black, false, false);
            }
        }

        uint256 newDailyTotal = emittedToday + totalReward;
        globalDailyRewards[today] = newDailyTotal;
        if (newDailyTotal == globalDailyRewardCap) {
            emit GlobalDailyRewardCapReached(today, newDailyTotal, totalReward);
        }

        rewardPool -= totalReward;
        if (whiteQuote.amount > 0) {
            chessToken.safeTransfer(white, whiteQuote.amount);
            _emitRewardDistributed(white, whiteWins, isDraw, whiteQuote);
        }
        if (blackQuote.amount > 0) {
            chessToken.safeTransfer(black, blackQuote.amount);
            _emitRewardDistributed(black, blackWins, isDraw, blackQuote);
        }

        if (rewardPoolCapacity > 0 && rewardPool < rewardPoolCapacity / 10) {
            emit PoolLow("reward", rewardPool, rewardPoolCapacity / 10);
        }
    }

    // ========== INTERNAL FUNCTIONS ==========

    /// @notice Check if caller is a valid game contract
    /// @dev The local registration alone is insufficient: a game must remain a
    ///      member of the currently configured canonical factory. This makes
    ///      authorizations left by a prior or temporary factory inert.
    function _isValidGameContract(address caller) internal view returns (bool) {
        return
            chessFactory != address(0) &&
            validGameContracts[caller] &&
            IRewardCanonicalFactory(chessFactory).isDeployedGame(caller);
    }

    function _markRewardEligible(address player) internal {
        if (!rewardEligible(player)) {
            rewardEligibleAtEpoch[player] = rewardEligibilityEpoch;
            emit RewardEligibilityRegistered(player);
        }
    }

    /// @notice Whether a wallet is eligible in the currently active signer epoch
    function rewardEligible(address player) public view returns (bool) {
        return rewardEligibleAtEpoch[player] == rewardEligibilityEpoch;
    }

    function _emitRewardDistributed(
        address player,
        bool isWinner,
        bool isDraw,
        RewardQuote memory quote
    ) internal {
        emit RewardDistributed(
            player,
            _getBaseReward(isWinner, isDraw),
            quote.amount,
            quote.poolFactor,
            quote.ratingFactor,
            quote.behaviorFactor
        );
    }

    /// @notice Register a game contract as valid (called by ChessFactory)
    /// @param gameContract Address of the deployed game contract
    function registerGameContract(address gameContract) external {
        require(msg.sender == chessFactory, "Only factory");
        require(gameContract.code.length > 0, "Game must be contract");
        require(
            IRewardCanonicalFactory(chessFactory).isDeployedGame(gameContract),
            "Game not canonical"
        );
        validGameContracts[gameContract] = true;
    }

    /// @notice Check if player can receive reward
    function _canReceiveReward(
        address player,
        address opponent,
        uint256 moveCount
    ) internal view returns (bool) {
        // Both sides must have passed the signer-backed eligibility process.
        if (!rewardEligible(player) || !rewardEligible(opponent)) {
            return false;
        }

        // Check minimum moves (per side, so divide by 2)
        if (moveCount / 2 < MIN_MOVES_FOR_REWARD) {
            return false;
        }

        // Check daily limit
        uint256 today = block.timestamp / 1 days;
        if (dailyGames[player][today] >= DAILY_GAME_LIMIT) {
            return false;
        }

        // Check opponent cooldown
        if (lastOpponentGame[player][opponent] > 0 &&
            block.timestamp - lastOpponentGame[player][opponent] < OPPONENT_COOLDOWN) {
            return false;
        }

        // Check pool not empty
        if (rewardPool == 0) {
            return false;
        }

        // The exact reward is checked against the remaining budget before any
        // accounting state changes. This quick check avoids needless work after
        // the cap is fully consumed.
        if (globalDailyRewards[today] >= globalDailyRewardCap) {
            return false;
        }

        return true;
    }

    /// @notice Get base reward amount
    function _getBaseReward(bool isWinner, bool isDraw) internal pure returns (uint256) {
        if (isDraw) return BASE_DRAW_REWARD;
        if (isWinner) return BASE_WIN_REWARD;
        return BASE_LOSE_REWARD;
    }

    /// @notice Calculate final reward with all factors
    function _calculateReward(
        address player,
        bool isWinner,
        bool isDraw,
        bool isCheckmate,
        uint256 moveCount
    ) internal view returns (uint256) {
        return _quoteReward(player, isWinner, isDraw, isCheckmate, moveCount).amount;
    }

    function _quoteReward(
        address player,
        bool isWinner,
        bool isDraw,
        bool isCheckmate,
        uint256 moveCount
    ) internal view returns (RewardQuote memory quote) {
        (quote.poolFactor, quote.ratingFactor, quote.behaviorFactor) = getPlayerFactors(player);
        uint256 baseReward = _getBaseReward(isWinner, isDraw);

        // Calculate: base * poolFactor * ratingFactor * behaviorFactor / 1000^3
        quote.amount = baseReward * quote.poolFactor * quote.ratingFactor *
            quote.behaviorFactor / (1000 * 1000 * 1000);

        // Add bonuses (also affected by pool factor only, not rating/behavior)
        uint256 bonus = 0;
        if (isWinner && isCheckmate) {
            bonus += CHECKMATE_BONUS * quote.poolFactor / 1000;
        }
        if (moveCount >= LONG_GAME_THRESHOLD * 2) {  // Total moves, so *2
            bonus += LONG_GAME_BONUS * quote.poolFactor / 1000;
        }

        quote.amount += bonus;
    }

    /// @notice Record player behavior
    function _recordBehavior(address player, bool wasResign, bool wasTimeout) internal {
        BehaviorRecord storage record = behaviorRecords[player];

        // Determine game type: 0=normal, 1=resign, 2=timeout
        uint8 gameType = 0;
        if (wasResign) gameType = 1;
        else if (wasTimeout) gameType = 2;

        // If we have history, remove the old value from counts
        if (record.totalGames >= BEHAVIOR_HISTORY) {
            uint8 oldType = record.history[record.currentIndex];
            if (oldType == 1) record.resignCount--;
            else if (oldType == 2) record.timeoutCount--;
        } else {
            record.totalGames++;
        }

        // Add new value
        record.history[record.currentIndex] = gameType;
        if (gameType == 1) record.resignCount++;
        else if (gameType == 2) record.timeoutCount++;

        // Move index
        record.currentIndex = (record.currentIndex + 1) % uint8(BEHAVIOR_HISTORY);

        emit BehaviorRecorded(player, gameType);
    }

    // ========== VIEW FUNCTIONS ==========

    /// @notice Get all factors for a player
    /// @return poolFactor Quadratic decay based on pool fullness (1000 = 1.0)
    /// @return ratingFactor Fixed at 1000; permissionless ELO is not an economic input
    /// @return behaviorFactor Based on resign/timeout history (1000 = 1.0)
    function getPlayerFactors(address player) public view returns (
        uint256 poolFactor,
        uint256 ratingFactor,
        uint256 behaviorFactor
    ) {
        // Pool factor: quadratic decay
        // poolFactor = (currentPool / capacity)^2
        if (rewardPoolCapacity == 0) {
            poolFactor = 0;
        } else {
            uint256 ratio = (rewardPool * 1000) / rewardPoolCapacity;
            poolFactor = (ratio * ratio) / 1000;  // Quadratic
        }

        // Wallet-based ELO is Sybil/collusion-sensitive. Using it to increase or
        // reduce token rewards turns leaderboard manipulation into direct economic
        // extraction, so the reward path deliberately treats it as neutral.
        ratingFactor = 1000;

        // Behavior factor: 1.0 - (resignRate * 0.5) - (timeoutRate * 0.5)
        BehaviorRecord storage record = behaviorRecords[player];
        if (record.totalGames == 0) {
            behaviorFactor = 1000;  // New player, full factor
        } else {
            uint256 resignPenalty = (uint256(record.resignCount) * 500) / record.totalGames;
            uint256 timeoutPenalty = (uint256(record.timeoutCount) * 500) / record.totalGames;
            uint256 totalPenalty = resignPenalty + timeoutPenalty;

            if (totalPenalty >= (1000 - BEHAVIOR_FACTOR_FLOOR)) {
                behaviorFactor = BEHAVIOR_FACTOR_FLOOR;
            } else {
                behaviorFactor = 1000 - totalPenalty;
            }
        }
    }

    /// @notice Check if address has claimed faucet
    function hasClaimedFaucet(address player) external view returns (bool) {
        return hasClaimed[player];
    }

    /// @notice Get remaining daily games for player
    function getRemainingDailyGames(address player) external view returns (uint256) {
        uint256 today = block.timestamp / 1 days;
        uint256 used = dailyGames[player][today];
        if (used >= DAILY_GAME_LIMIT) return 0;
        return DAILY_GAME_LIMIT - used;
    }

    /// @notice Check if player can earn from opponent
    function canEarnFromOpponent(address player, address opponent) external view returns (bool) {
        if (lastOpponentGame[player][opponent] == 0) return true;
        return block.timestamp - lastOpponentGame[player][opponent] >= OPPONENT_COOLDOWN;
    }

    /// @notice Get player behavior stats
    function getBehaviorStats(address player) external view returns (
        uint256 totalGames,
        uint256 resignCount,
        uint256 timeoutCount,
        uint256 resignRate,
        uint256 timeoutRate
    ) {
        BehaviorRecord storage record = behaviorRecords[player];
        totalGames = record.totalGames;
        resignCount = record.resignCount;
        timeoutCount = record.timeoutCount;

        if (totalGames > 0) {
            resignRate = (resignCount * 100) / totalGames;
            timeoutRate = (timeoutCount * 100) / totalGames;
        }
    }

    /// @notice Get pool statuses
    function getPoolStatus() external view returns (
        uint256 faucetBalance,
        uint256 rewardBalance,
        uint256 rewardCapacity,
        uint256 poolFactorPercent
    ) {
        faucetBalance = faucetPool;
        rewardBalance = rewardPool;
        rewardCapacity = rewardPoolCapacity;

        if (rewardPoolCapacity > 0) {
            uint256 ratio = (rewardPool * 100) / rewardPoolCapacity;
            poolFactorPercent = (ratio * ratio) / 100;  // Quadratic
        }
    }

    /// @notice Estimate reward for a potential game
    function estimateReward(
        address player,
        bool isWinner,
        bool isDraw,
        bool isCheckmate,
        uint256 moveCount
    ) external view returns (uint256) {
        return _calculateReward(player, isWinner, isDraw, isCheckmate, moveCount);
    }
}
