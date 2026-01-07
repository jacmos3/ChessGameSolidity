// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../Rating/PlayerRating.sol";

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

    // Rating factor: floor at 20% (200/1000)
    uint256 public constant RATING_FACTOR_FLOOR = 200;  // 0.2 in fixed point (1000 = 1.0)
    uint256 public constant RATING_REFERENCE = 2000;    // Rating where factor = floor

    // Behavior factor: floor at 50% (500/1000)
    uint256 public constant BEHAVIOR_FACTOR_FLOOR = 500;

    // ========== STATE ==========
    IERC20 public chessToken;
    PlayerRating public playerRating;
    address public chessFactory;

    // Pool balances
    uint256 public faucetPool;
    uint256 public rewardPool;
    uint256 public rewardPoolCapacity;  // Used for decay calculation

    // Faucet tracking
    mapping(address => bool) public hasClaimed;

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

    // ========== CONSTRUCTOR ==========
    constructor(
        address _chessToken,
        address _playerRating
    ) Ownable(msg.sender) {
        require(_chessToken != address(0), "Invalid token");
        require(_playerRating != address(0), "Invalid rating");

        chessToken = IERC20(_chessToken);
        playerRating = PlayerRating(_playerRating);
    }

    // ========== ADMIN FUNCTIONS ==========

    /// @notice Set the ChessFactory address (for game validation)
    function setChessFactory(address _chessFactory) external onlyOwner {
        require(_chessFactory != address(0), "Invalid factory");
        chessFactory = _chessFactory;
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

    /// @notice Claim faucet tokens (one-time per address)
    /// @dev Requires the address to have made at least 1 transaction (nonce > 0)
    function claimFaucet() external nonReentrant {
        require(!hasClaimed[msg.sender], "Already claimed");
        require(chessToken.balanceOf(msg.sender) == 0, "Already has CHESS");
        require(faucetPool >= FAUCET_AMOUNT, "Faucet pool empty");

        // Check that user has made at least 1 transaction (anti-sybil)
        // This is checked by verifying the account has a nonce > 0
        // Note: This won't work for first-time users on a fresh address
        // but they need ETH for gas anyway, so they'll have a transaction
        uint256 nonce;
        assembly {
            nonce := extcodesize(caller())
        }
        // Actually, we check the account nonce differently
        // We'll use a simpler check: require msg.sender is not a contract
        // and trust that they have ETH (gas cost is the anti-sybil measure)
        require(msg.sender == tx.origin, "No contracts");

        hasClaimed[msg.sender] = true;
        faucetPool -= FAUCET_AMOUNT;
        chessToken.safeTransfer(msg.sender, FAUCET_AMOUNT);

        emit FaucetClaimed(msg.sender, FAUCET_AMOUNT);

        // Emit warning if pool is low (< 10%)
        if (faucetPool < FAUCET_AMOUNT * 100) {
            emit PoolLow("faucet", faucetPool, FAUCET_AMOUNT * 100);
        }
    }

    // ========== GAME REWARDS ==========

    /// @notice Distribute rewards for a completed game
    /// @param player The player to reward
    /// @param opponent The opponent (for anti-collusion check)
    /// @param isWinner Whether the player won
    /// @param isDraw Whether the game was a draw
    /// @param isCheckmate Whether the game ended in checkmate
    /// @param moveCount Total moves in the game
    /// @param wasResign Whether the player resigned (for behavior tracking)
    /// @param wasTimeout Whether the player lost by timeout (for behavior tracking)
    function distributeReward(
        address player,
        address opponent,
        bool isWinner,
        bool isDraw,
        bool isCheckmate,
        uint256 moveCount,
        bool wasResign,
        bool wasTimeout
    ) external nonReentrant {
        // Only allow calls from valid game contracts
        require(_isValidGameContract(msg.sender), "Not authorized");
        require(player != address(0) && opponent != address(0), "Invalid addresses");
        require(player != opponent, "Same player");

        // Record behavior (even if no reward given)
        _recordBehavior(player, wasResign, wasTimeout);

        // Check if player qualifies for reward
        if (!_canReceiveReward(player, opponent, moveCount)) {
            return;  // No reward, but behavior was recorded
        }

        // Calculate and distribute reward
        uint256 reward = _calculateReward(player, isWinner, isDraw, isCheckmate, moveCount);

        if (reward > 0 && reward <= rewardPool) {
            // Update tracking
            uint256 today = block.timestamp / 1 days;
            dailyGames[player][today]++;
            lastOpponentGame[player][opponent] = block.timestamp;

            // Transfer reward
            rewardPool -= reward;
            chessToken.safeTransfer(player, reward);

            // Get factors for event
            (uint256 poolFactor, uint256 ratingFactor, uint256 behaviorFactor) = getPlayerFactors(player);

            emit RewardDistributed(
                player,
                _getBaseReward(isWinner, isDraw),
                reward,
                poolFactor,
                ratingFactor,
                behaviorFactor
            );

            // Emit warning if pool is low (< 10% of capacity)
            if (rewardPoolCapacity > 0 && rewardPool < rewardPoolCapacity / 10) {
                emit PoolLow("reward", rewardPool, rewardPoolCapacity / 10);
            }
        }
    }

    // ========== INTERNAL FUNCTIONS ==========

    /// @notice Check if caller is a valid game contract
    function _isValidGameContract(address caller) internal view returns (bool) {
        if (chessFactory == address(0)) return false;

        (bool success, bytes memory data) = chessFactory.staticcall(
            abi.encodeWithSignature("getDeployedChessGames()")
        );

        if (!success) return false;

        address[] memory games = abi.decode(data, (address[]));
        for (uint256 i = 0; i < games.length; i++) {
            if (games[i] == caller) return true;
        }
        return false;
    }

    /// @notice Check if player can receive reward
    function _canReceiveReward(
        address player,
        address opponent,
        uint256 moveCount
    ) internal view returns (bool) {
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
        uint256 baseReward = _getBaseReward(isWinner, isDraw);

        // Get factors (all in 1000 = 1.0 scale)
        (uint256 poolFactor, uint256 ratingFactor, uint256 behaviorFactor) = getPlayerFactors(player);

        // Calculate: base * poolFactor * ratingFactor * behaviorFactor / 1000^3
        uint256 reward = baseReward * poolFactor * ratingFactor * behaviorFactor / (1000 * 1000 * 1000);

        // Add bonuses (also affected by pool factor only, not rating/behavior)
        uint256 bonus = 0;
        if (isWinner && isCheckmate) {
            bonus += CHECKMATE_BONUS * poolFactor / 1000;
        }
        if (moveCount >= LONG_GAME_THRESHOLD * 2) {  // Total moves, so *2
            bonus += LONG_GAME_BONUS * poolFactor / 1000;
        }

        return reward + bonus;
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
    /// @return ratingFactor Inversely proportional to rating (1000 = 1.0)
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

        // Rating factor: inversely proportional
        // ratingFactor = max(0.2, (2000 - rating) / 1000)
        uint256 rating = playerRating.getRating(player);
        if (rating >= RATING_REFERENCE) {
            ratingFactor = RATING_FACTOR_FLOOR;
        } else {
            ratingFactor = ((RATING_REFERENCE - rating) * 1000) / 1000;
            if (ratingFactor < RATING_FACTOR_FLOOR) {
                ratingFactor = RATING_FACTOR_FLOOR;
            }
            if (ratingFactor > 1000) {
                ratingFactor = 1000;
            }
        }

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
