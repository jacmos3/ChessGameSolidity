// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../Token/ChessToken.sol";
import "../Token/BondingManager.sol";
import "./ArbitratorRegistry.sol";

/**
 * @title DisputeDAO
 * @notice Decentralized dispute resolution for chess games
 * @dev Implements commit-reveal voting with Schelling Point mechanism
 *
 * Key Features:
 * - Challenge window after each game (48h)
 * - Commit-reveal voting to prevent coordination
 * - Multi-level escalation for contested disputes
 * - Slashing for cheaters, rewards for honest challengers
 */
contract DisputeDAO is AccessControl, ReentrancyGuard {
    using SafeERC20 for ChessToken;

    bytes32 public constant GAME_MANAGER_ROLE = keccak256("GAME_MANAGER_ROLE");

    ChessToken public immutable chessToken;
    BondingManager public immutable bondingManager;
    ArbitratorRegistry public immutable arbitratorRegistry;

    // Timing parameters
    uint256 public challengeWindow = 48 hours;
    uint256 public commitPeriod = 24 hours;
    uint256 public revealPeriod = 24 hours;

    // Voting parameters
    uint256 public quorumPercentage = 66; // Revealed panel voting power required
    uint256 public supermajority = 66;    // 66% for decision
    uint256 public challengeDeposit = 50 * 10**18; // Minimum 50 CHESS
    uint256 public challengeDepositBps = 500; // 5% of both players' locked CHESS bonds
    uint256 public minimumPanelSize = 3;
    // Legacy ABI name: this is a minimum panel active-stake floor, not fully
    // slashable collateral for a subjective majority verdict.
    uint256 public minimumPanelCollateral = 3_000 * 10**18;
    uint256 public arbitrationCoverageBps = 10_000; // 100% of both players' CHESS game bonds

    // Vote options
    enum Vote { None, Legit, WhiteCheat, BlackCheat, Abstain }

    // Dispute states
    enum DisputeState {
        None,
        Pending,        // Challenge window open
        Challenged,     // In commit phase
        Revealing,      // In reveal phase
        Resolved,       // Decision made
        Escalated,      // Needs higher-level review (legacy state value)
        Selecting,      // Deposit locked; future entropy/panel pending
        Unresolved      // Bounded arbitration exhausted; governance backstop required
    }

    struct Dispute {
        uint256 gameId;
        address challenger;
        uint256 gameStake;

        DisputeState state;

        uint256 registeredAt;      // When game was registered (start of challenge window)
        uint256 challengedAt;
        uint256 commitDeadline;
        uint256 revealDeadline;
        uint256 requiredArbitratorCount;

        uint256 legitVotes;
        uint256 whiteCheatVotes;
        uint256 blackCheatVotes;
        uint256 abstainVotes;

        Vote finalDecision;
        bool resolved;

        address[] selectedArbitrators;
        uint256 escalationLevel;
    }

    struct VoteCommit {
        bytes32 commitHash;
        bool revealed;
        Vote vote;
    }

    struct DisputeEconomics {
        uint256 minimumPanelCollateral;
        uint256 arbitrationCoverageBps;
        uint256 challengeDeposit;
        uint256 challengeDepositBps;
    }

    struct GameArbitrationPolicy {
        uint256 challengeWindow;
        uint256 minimumPanelSize;
        uint256 quorumPercentage;
        uint256 supermajority;
        uint256 commitPeriod;
        uint256 revealPeriod;
        DisputeEconomics economics;
    }

    // Storage
    mapping(uint256 => Dispute) public disputes;      // disputeId => Dispute
    mapping(uint256 => mapping(address => VoteCommit)) public votes; // disputeId => arbitrator => vote
    mapping(uint256 => uint256) public gameToDispute; // gameId => disputeId
    mapping(uint256 => address) public gameWhitePlayer; // gameId => white player
    mapping(uint256 => address) public gameBlackPlayer; // gameId => black player
    mapping(address => uint256) public activeChallenges; // challenger => count
    mapping(uint256 => uint256) public disputeDeposits; // disputeId => reserved challenge deposit
    mapping(uint256 => uint256) public panelSelectionBlock;
    mapping(uint256 => bytes32) public panelEntropy;
    mapping(uint256 => mapping(address => uint256)) public votingPowerSnapshot;
    mapping(uint256 => uint256) public totalPanelVotingPower;
    mapping(uint256 => uint256) public totalPanelCollateral; // Legacy ABI name: panel active stake
    mapping(uint256 => uint256) public requiredVotingPower;
    mapping(uint256 => uint256) public revealedVotingPower;
    mapping(uint256 => uint256) public revealedCount;
    mapping(uint256 => uint256) public disputeRequiredPanelCollateral; // Legacy ABI name
    mapping(uint256 => uint256) public disputeMinimumPanelSize;
    mapping(uint256 => uint256) public disputeQuorumPercentage;
    mapping(uint256 => uint256) public disputeSupermajority;
    // Per-dispute timing getters are intentional ABI additions. The protocol has
    // no proxy/storage migration path, so this policy snapshot ships by redeploy.
    mapping(uint256 => uint256) public disputeCommitPeriod;
    mapping(uint256 => uint256) public disputeRevealPeriod;
    mapping(uint256 => uint256) public challengeDeadline;
    mapping(uint256 => DisputeEconomics) private disputeEconomics;
    mapping(uint256 => bool) public gamePolicyPrepared;
    mapping(uint256 => bytes32) private gamePolicyPlayers;
    mapping(uint256 => GameArbitrationPolicy) private gameArbitrationPolicies;
    mapping(uint256 => uint256) public panelSelectionScheduledAt;
    mapping(uint256 => bytes32) public panelPopulationFingerprint;
    mapping(uint256 => uint256) public panelSnapshotTimestamp;
    mapping(uint256 => uint256) public panelSnapshotEligibleCount;
    mapping(uint256 => uint256) public panelSnapshotEligibleActiveStake;
    mapping(uint256 => uint256) public panelSnapshotGameRecordSequence;
    mapping(uint256 => uint256) public panelSelectionSequence;
    mapping(uint256 => uint256) public selectionSequenceDispute;

    uint256 public disputeCounter;
    uint256 public selectionSequenceCounter;
    uint256 public nextSelectionSequence = 1;
    uint256 public totalEscrowedDeposits;
    uint256 public constant MAX_DISPUTE_DURATION = 30 days;
    uint256 public constant PANEL_SELECTION_DELAY_BLOCKS = 2;
    uint256 public constant BLOCKHASH_WINDOW = 256;
    uint256 public constant MAX_ARBITRATORS_PER_TIER = 9;
    uint256 public constant INITIAL_ARBITRATORS_PER_TIER = 5;
    uint256 public constant MAX_INITIAL_PANEL_SIZE = INITIAL_ARBITRATORS_PER_TIER * 3;
    uint256 public constant MAX_ESCALATION_LEVEL = 3;
    uint256 public constant PANEL_SELECTION_TIMEOUT = 7 days;
    uint256 private constant PERCENTAGE_BASE = 100;
    uint256 private constant BPS_DENOMINATOR = 10_000;
    uint256 private constant MIN_EFFECTIVE_QUORUM = 2;
    address public chessFactory;

    // Events
    event GameRegistered(uint256 indexed gameId, address white, address black, uint256 stake);
    event DisputeCreated(uint256 indexed disputeId, uint256 indexed gameId, address challenger);
    event VoteCommitted(uint256 indexed disputeId, address indexed arbitrator);
    event VoteRevealed(uint256 indexed disputeId, address indexed arbitrator, Vote vote);
    event DisputeResolved(
        uint256 indexed disputeId,
        Vote decision,
        uint256 legitVotes,
        uint256 whiteCheatVotes,
        uint256 blackCheatVotes
    );
    event DisputeEscalated(uint256 indexed disputeId, uint256 newLevel);
    event ChallengeWindowClosed(uint256 indexed gameId);
    event RewardDistributed(uint256 indexed disputeId, address indexed recipient, uint256 amount);
    event ChessFactoryUpdated(address indexed previousFactory, address indexed newFactory);
    event GameContractAuthorized(address indexed gameContract);
    event ChallengeDepositReserved(uint256 indexed disputeId, uint256 amount);
    event ChallengeDepositReleased(uint256 indexed disputeId, uint256 amount);
    event PanelSelectionScheduled(uint256 indexed disputeId, uint256 indexed escalationLevel, uint256 selectionBlock);
    event PanelPopulationSnapshotted(
        uint256 indexed disputeId,
        uint256 indexed escalationLevel,
        bytes32 fingerprint,
        uint256 eligibilityTimestamp,
        uint256 eligibleArbitratorCount,
        uint256 eligibleActiveStake
    );
    event PanelEntropyCaptured(uint256 indexed disputeId, uint256 indexed escalationLevel, bytes32 entropy);
    event PanelSelectionRefreshed(uint256 indexed disputeId, uint256 previousSelectionBlock, uint256 newSelectionBlock);
    event PanelSelected(
        uint256 indexed disputeId,
        uint256 indexed escalationLevel,
        uint256 arbitratorCount,
        uint256 totalVotingPower,
        uint256 panelActiveStake,
        uint256 requiredPanelActiveStake
    );
    event ArbitrationSecurityParametersUpdated(
        uint256 quorumPercentage,
        uint256 minimumPanelSize,
        uint256 minimumPanelActiveStake,
        uint256 arbitrationCoverageBps
    );
    event DisputeRequiresBackstop(uint256 indexed disputeId, uint256 escalationLevel);
    event BackstopDecision(uint256 indexed disputeId, Vote decision);
    event PanelSelectionQueued(uint256 indexed disputeId, uint256 indexed sequence);
    event ChallengeEconomicsUpdated(uint256 minimumDeposit, uint256 exposureBps);
    event StructuralPanelUnavailable(
        uint256 indexed disputeId,
        uint256 availableCount,
        uint256 availableActiveStake,
        uint256 requiredCount,
        uint256 requiredActiveStake
    );
    event GameArbitrationPrepared(
        uint256 indexed gameId,
        address indexed white,
        address indexed black,
        uint256 requiredPanelActiveStake
    );

    constructor(
        address _chessToken,
        address _bondingManager,
        address _arbitratorRegistry
    ) {
        require(_chessToken.code.length > 0, "Token must be contract");
        require(_bondingManager.code.length > 0, "Bonding manager must be contract");
        require(_arbitratorRegistry.code.length > 0, "Registry must be contract");

        chessToken = ChessToken(_chessToken);
        bondingManager = BondingManager(payable(_bondingManager));
        arbitratorRegistry = ArbitratorRegistry(_arbitratorRegistry);

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    /**
     * @notice Set the ChessFactory allowed to authorize game clone contracts
     * @param _chessFactory Address of the ChessFactory
     */
    function setChessFactory(address _chessFactory) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_chessFactory == address(0) || _chessFactory.code.length > 0, "Factory must be contract");
        emit ChessFactoryUpdated(chessFactory, _chessFactory);
        chessFactory = _chessFactory;
    }

    /**
     * @notice Authorize a ChessCore clone created by ChessFactory
     * @param gameContract Address of the cloned ChessCore contract
     */
    function authorizeGameContract(address gameContract) external {
        require(msg.sender == chessFactory, "Only factory");
        require(gameContract.code.length > 0, "Game must be contract");

        _grantRole(GAME_MANAGER_ROLE, gameContract);
        emit GameContractAuthorized(gameContract);
    }

    /**
     * @notice Register a completed game (starts challenge window)
     * @param gameId Game identifier
     * @param white White player address
     * @param black Black player address
     * @param stake Game stake amount
     */
    function registerGame(
        uint256 gameId,
        address white,
        address black,
        uint256 stake
    ) external onlyRole(GAME_MANAGER_ROLE) {
        require(gameToDispute[gameId] == 0, "Game already registered");
        require(white != address(0) && black != address(0), "Invalid players");
        require(white != black, "Same player");

        disputeCounter++;
        uint256 disputeId = disputeCounter;

        disputes[disputeId] = Dispute({
            gameId: gameId,
            challenger: address(0),
            gameStake: stake,
            state: DisputeState.Pending,
            registeredAt: block.timestamp,  // Track when challenge window opens
            challengedAt: 0,
            commitDeadline: 0,
            revealDeadline: 0,
            requiredArbitratorCount: 0,
            legitVotes: 0,
            whiteCheatVotes: 0,
            blackCheatVotes: 0,
            abstainVotes: 0,
            finalDecision: Vote.None,
            resolved: false,
            selectedArbitrators: new address[](0),
            escalationLevel: 0
        });

        gameToDispute[gameId] = disputeId;
        gameWhitePlayer[gameId] = white;
        gameBlackPlayer[gameId] = black;

        // Production games snapshot every mutable arbitration rule atomically
        // with their bond locks at Black's join. This prevents governance from
        // changing the challenge window, deposit or required panel while a
        // funded game is in progress. Direct unit/legacy managers can only use
        // the registration-time fallback when no factory is configured.
        if (gamePolicyPrepared[gameId]) {
            require(
                gamePolicyPlayers[gameId] == keccak256(abi.encode(white, black)),
                "Prepared game players mismatch"
            );
            GameArbitrationPolicy storage policy = gameArbitrationPolicies[gameId];
            challengeDeadline[disputeId] = block.timestamp + policy.challengeWindow;
            disputeMinimumPanelSize[disputeId] = policy.minimumPanelSize;
            disputeQuorumPercentage[disputeId] = policy.quorumPercentage;
            disputeSupermajority[disputeId] = policy.supermajority;
            disputeCommitPeriod[disputeId] = policy.commitPeriod;
            disputeRevealPeriod[disputeId] = policy.revealPeriod;
            disputeEconomics[disputeId] = policy.economics;
        } else {
            require(chessFactory == address(0), "Game policy not prepared");
            challengeDeadline[disputeId] = block.timestamp + challengeWindow;
            disputeMinimumPanelSize[disputeId] = minimumPanelSize;
            disputeQuorumPercentage[disputeId] = quorumPercentage;
            disputeSupermajority[disputeId] = supermajority;
            disputeCommitPeriod[disputeId] = commitPeriod;
            disputeRevealPeriod[disputeId] = revealPeriod;
            disputeEconomics[disputeId] = DisputeEconomics({
                minimumPanelCollateral: minimumPanelCollateral,
                arbitrationCoverageBps: arbitrationCoverageBps,
                challengeDeposit: challengeDeposit,
                challengeDepositBps: challengeDepositBps
            });
        }

        // Record game in arbitrator registry for exclusion tracking
        arbitratorRegistry.recordGame(white, black);

        emit GameRegistered(gameId, white, black, stake);
    }

    /**
     * @notice Ask the panel to adjudicate the complete game record
     * @dev Only a participant may challenge. The challenger cannot choose who the
     *      panel is allowed to punish: arbitrators independently decide whether the
     *      game is legitimate, White cheated, or Black cheated.
     * @param gameId Game to challenge
     */
    function challenge(uint256 gameId) external nonReentrant {
        uint256 disputeId = gameToDispute[gameId];
        require(disputeId != 0, "Game not registered");

        Dispute storage dispute = disputes[disputeId];
        address white = gameWhitePlayer[gameId];
        address black = gameBlackPlayer[gameId];
        require(dispute.state == DisputeState.Pending, "Not in challenge window");
        require(msg.sender == white || msg.sender == black, "Only game participant");

        uint256 gameBondExposure = _gameBondExposure(gameId, white, black);
        uint256 disputeRequiredPower =
            _requiredPanelPowerForDispute(disputeId, gameBondExposure);
        disputeRequiredPanelCollateral[disputeId] = disputeRequiredPower;

        // The deadline is snapshotted at registration. Governance changes apply
        // only to future games and cannot shorten a participant's live window.
        require(block.timestamp <= challengeDeadline[disputeId], "Challenge window expired");

        dispute.challenger = msg.sender;
        dispute.state = DisputeState.Selecting;
        dispute.challengedAt = block.timestamp;

        // A participant's valid challenge is never rejected merely because the
        // arbitration pool deteriorated after the game began. Structurally
        // unavailable cases reserve the same deposit and go directly to the
        // timelocked backstop without blocking the global selection FIFO.
        (uint256 potentialCount, uint256 potentialActiveStake) =
            _potentialPanelCapacity(disputeId, white, black, msg.sender, 0);
        bool structurallyAvailable =
            potentialCount >= disputeMinimumPanelSize[disputeId] &&
            potentialActiveStake >= disputeRequiredPanelCollateral[disputeId];

        uint256 depositAmount =
            _requiredChallengeDepositForDispute(disputeId, gameBondExposure);
        chessToken.safeTransferFrom(msg.sender, address(this), depositAmount);
        disputeDeposits[disputeId] = depositAmount;
        totalEscrowedDeposits += depositAmount;
        activeChallenges[msg.sender]++;
        emit ChallengeDepositReserved(disputeId, depositAmount);

        if (structurallyAvailable) {
            // A structurally viable but currently assigned/cooling-down pool is
            // a transient condition and remains protected by FIFO + timeout.
            _schedulePanelSelection(disputeId);
        } else {
            _enterUnresolved(disputeId);
            emit StructuralPanelUnavailable(
                disputeId,
                potentialCount,
                potentialActiveStake,
                disputeMinimumPanelSize[disputeId],
                disputeRequiredPanelCollateral[disputeId]
            );
        }

        emit DisputeCreated(disputeId, gameId, msg.sender);
    }

    /**
     * @notice Revert unless the just-locked game exposure has a structurally viable panel
     * @dev Called atomically by an authorized ChessCore clone during Black's join.
     *      Transient assignments and cooldowns are ignored; maturity, reputation,
     *      relationship exclusions and guaranteed selectable stake are enforced.
     */
    function prepareGameArbitration(
        uint256 gameId,
        address white,
        address black
    ) external onlyRole(GAME_MANAGER_ROLE) {
        require(!gamePolicyPrepared[gameId], "Game policy already prepared");
        require(white != address(0) && black != address(0) && white != black, "Invalid players");
        uint256 gameBondExposure = _gameBondExposure(gameId, white, black);
        uint256 requiredActiveStake = _requiredPanelPower(gameBondExposure);
        (uint256 potentialCount, uint256 potentialActiveStake) =
            _potentialPanelCapacity(0, white, black, address(0), 0);

        require(potentialCount >= minimumPanelSize, "Eligible arbitrator pool too small");
        require(potentialActiveStake >= requiredActiveStake, "Eligible arbitrator stake too low");

        gamePolicyPrepared[gameId] = true;
        gamePolicyPlayers[gameId] = keccak256(abi.encode(white, black));
        GameArbitrationPolicy storage policy = gameArbitrationPolicies[gameId];
        policy.challengeWindow = challengeWindow;
        policy.minimumPanelSize = minimumPanelSize;
        policy.quorumPercentage = quorumPercentage;
        policy.supermajority = supermajority;
        policy.commitPeriod = commitPeriod;
        policy.revealPeriod = revealPeriod;
        policy.economics = DisputeEconomics({
            minimumPanelCollateral: minimumPanelCollateral,
            arbitrationCoverageBps: arbitrationCoverageBps,
            challengeDeposit: challengeDeposit,
            challengeDepositBps: challengeDepositBps
        });
        emit GameArbitrationPrepared(gameId, white, black, requiredActiveStake);
    }

    /**
     * @notice Schedule another future block if the committed hash was not captured
     * @dev The challenge and deposit remain irrevocably open. Refresh cannot occur
     *      while the original hash is available or after entropy has been pinned.
     */
    function refreshPanelSelection(uint256 disputeId) external {
        Dispute storage dispute = disputes[disputeId];
        require(dispute.state == DisputeState.Selecting, "Panel not pending");
        require(_isSelectionHead(disputeId), "Selection is queued");
        require(panelSelectionBlock[disputeId] != 0, "Selection not activated");
        require(panelEntropy[disputeId] == bytes32(0), "Entropy already captured");
        require(
            block.timestamp <= panelSelectionScheduledAt[disputeId] + PANEL_SELECTION_TIMEOUT,
            "Selection timed out"
        );

        uint256 previousTarget = panelSelectionBlock[disputeId];
        require(block.number > previousTarget + BLOCKHASH_WINDOW, "Blockhash still available");
        require(
            arbitratorRegistry.selectionSnapshotMatches(
                disputeId,
                gameWhitePlayer[dispute.gameId],
                gameBlackPlayer[dispute.gameId],
                dispute.challenger,
                _requestedArbitratorsPerTier(dispute.escalationLevel),
                dispute.escalationLevel,
                panelSnapshotTimestamp[disputeId],
                panelSnapshotGameRecordSequence[disputeId],
                panelPopulationFingerprint[disputeId]
            ),
            "Selection snapshot changed"
        );

        uint256 cycle = BLOCKHASH_WINDOW + 1;
        uint256 elapsedCycles = ((block.number - previousTarget) / cycle) + 1;
        uint256 nextTarget = previousTarget + (elapsedCycles * cycle);
        panelSelectionBlock[disputeId] = nextTarget;

        emit PanelSelectionRefreshed(disputeId, previousTarget, nextTarget);
        emit PanelSelectionScheduled(disputeId, dispute.escalationLevel, nextTarget);
    }

    /**
     * @notice Activate the FIFO head once enough unassigned arbitrators are available
     * @dev A queued dispute has no entropy target. Snapshotting only at the head keeps
     *      concurrent disputes from invalidating one another or selecting around a
     *      seed that is already public.
     */
    function activatePanelSelection(uint256 disputeId) external {
        Dispute storage dispute = disputes[disputeId];
        require(dispute.state == DisputeState.Selecting, "Panel not pending");
        require(_isSelectionHead(disputeId), "Selection is queued");
        require(panelSelectionBlock[disputeId] == 0, "Selection already activated");
        require(
            block.timestamp <= panelSelectionScheduledAt[disputeId] + PANEL_SELECTION_TIMEOUT,
            "Selection timed out"
        );
        if (_activatePanelSelection(disputeId)) return;

        // The current selectable set may be temporarily depleted by assignments
        // or cooldowns, in which case the bounded recovery timeout remains useful.
        // If the potential population itself has fallen below the snapshotted
        // requirements, waiting cannot repair this entry: move it to the same
        // timelocked backstop immediately and let the next FIFO item progress.
        (uint256 potentialCount, uint256 potentialActiveStake) =
            _potentialPanelCapacity(
                disputeId,
                gameWhitePlayer[dispute.gameId],
                gameBlackPlayer[dispute.gameId],
                dispute.challenger,
                dispute.escalationLevel
            );
        if (
            potentialCount < disputeMinimumPanelSize[disputeId] ||
            potentialActiveStake < disputeRequiredPanelCollateral[disputeId]
        ) {
            _enterUnresolved(disputeId);
            emit StructuralPanelUnavailable(
                disputeId,
                potentialCount,
                potentialActiveStake,
                disputeMinimumPanelSize[disputeId],
                disputeRequiredPanelCollateral[disputeId]
            );
            _advanceSelectionQueue(disputeId);
            return;
        }

        revert("Available panel pending");
    }

    /**
     * @notice Move a selection that could not form a viable panel to governance backstop
     * @dev This never fabricates Vote.None and never releases the challenge deposit.
     *      Anyone can trigger the timeout; only the timelocked admin can decide the case.
     *      The FIFO head holds a short registry mutation lock, so an arbitrator cannot
     *      invalidate the population with a last-look stake change. The bounded timeout
     *      releases that lock and advances the queue if entropy is never consumed.
     */
    function markPanelUnavailable(uint256 disputeId) external {
        Dispute storage dispute = disputes[disputeId];
        require(dispute.state == DisputeState.Selecting, "Panel not pending");
        require(_isSelectionHead(disputeId), "Selection is queued");
        require(
            block.timestamp > panelSelectionScheduledAt[disputeId] + PANEL_SELECTION_TIMEOUT,
            "Selection recovery active"
        );
        uint256 targetBlock = panelSelectionBlock[disputeId];
        require(
            targetBlock == 0 || block.number > targetBlock + BLOCKHASH_WINDOW,
            "Selection entropy recoverable"
        );
        _releaseSelectionLock(disputeId);
        _enterUnresolved(disputeId);
        _advanceSelectionQueue(disputeId);
    }

    /**
     * @notice Atomically capture future entropy and reserve its deterministic panel
     * @dev Selection is performed in the same transaction that first exposes the seed.
     *      The registry ranks candidate-address hashes rather than depending on mutable
     *      pool ordering. A reverted retry therefore has the same result while candidate
     *      eligibility is unchanged, and never cancels the underlying challenge.
     */
    function finalizePanel(uint256 disputeId) external nonReentrant {
        Dispute storage dispute = disputes[disputeId];
        require(dispute.state == DisputeState.Selecting, "Panel not pending");
        require(_isSelectionHead(disputeId), "Selection is queued");
        require(panelSelectionBlock[disputeId] != 0, "Selection not activated");
        require(panelEntropy[disputeId] == bytes32(0), "Entropy already captured");
        require(dispute.selectedArbitrators.length == 0, "Panel already selected");

        uint256 targetBlock = panelSelectionBlock[disputeId];
        require(block.number > targetBlock, "Selection block not mined");
        require(block.number <= targetBlock + BLOCKHASH_WINDOW, "Selection blockhash expired");
        bytes32 futureBlockHash = blockhash(targetBlock);
        require(futureBlockHash != bytes32(0), "Blockhash unavailable");
        bytes32 entropy = keccak256(
            abi.encode(
                futureBlockHash,
                block.chainid,
                address(this),
                disputeId,
                dispute.escalationLevel
            )
        );

        uint256 requestedPerTier =
            _requestedArbitratorsPerTier(dispute.escalationLevel);

        address[] memory arbitrators = _selectScheduledPanel(
            disputeId,
            dispute,
            requestedPerTier,
            entropy
        );
        require(
            arbitrators.length >= disputeMinimumPanelSize[disputeId],
            "Viable panel unavailable"
        );

        (uint256 totalPower, uint256 panelActiveStake) = _snapshotPanelPower(
            disputeId,
            arbitrators
        );
        require(
            panelActiveStake >= disputeRequiredPanelCollateral[disputeId],
            "Panel active stake too low"
        );

        panelEntropy[disputeId] = entropy;
        dispute.selectedArbitrators = arbitrators;
        dispute.requiredArbitratorCount = _calculateRequiredArbitratorCount(
            disputeId,
            arbitrators.length
        );
        totalPanelVotingPower[disputeId] = totalPower;
        totalPanelCollateral[disputeId] = panelActiveStake;
        requiredVotingPower[disputeId] = _percentageCeil(
            totalPower,
            disputeQuorumPercentage[disputeId]
        );
        // Every escalation finalizes through this same path, so governance
        // changes cannot shorten or extend a dispute after its deposit is locked.
        dispute.commitDeadline = block.timestamp + disputeCommitPeriod[disputeId];
        dispute.revealDeadline =
            dispute.commitDeadline + disputeRevealPeriod[disputeId];
        dispute.state = DisputeState.Challenged;

        _releaseSelectionLock(disputeId);
        _advanceSelectionQueue(disputeId);

        emit PanelEntropyCaptured(disputeId, dispute.escalationLevel, entropy);
        emit PanelSelected(
            disputeId,
            dispute.escalationLevel,
            arbitrators.length,
            totalPower,
            panelActiveStake,
            disputeRequiredPanelCollateral[disputeId]
        );
    }

    function _selectScheduledPanel(
        uint256 disputeId,
        Dispute storage dispute,
        uint256 requestedPerTier,
        bytes32 entropy
    ) internal returns (address[] memory) {
        return arbitratorRegistry.selectArbitrators(
            disputeId,
            gameWhitePlayer[dispute.gameId],
            gameBlackPlayer[dispute.gameId],
            dispute.challenger,
            requestedPerTier,
            entropy,
            dispute.escalationLevel,
            panelSnapshotTimestamp[disputeId],
            panelSnapshotGameRecordSequence[disputeId],
            panelPopulationFingerprint[disputeId]
        );
    }

    function _snapshotPanelPower(uint256 disputeId, address[] memory arbitrators)
        internal
        returns (uint256 totalPower, uint256 panelActiveStake)
    {
        uint256 eligibilityTimestamp = panelSnapshotTimestamp[disputeId];
        for (uint256 i = 0; i < arbitrators.length;) {
            address arbitrator = arbitrators[i];
            uint256 power = arbitratorRegistry.getVotingPowerAt(
                arbitrator,
                eligibilityTimestamp
            );
            uint256 activeStake = arbitratorRegistry.getSlashableStake(arbitrator);
            require(power > 0, "Invalid voting power");
            require(activeStake > 0, "Invalid active stake");
            votingPowerSnapshot[disputeId][arbitrator] = power;
            totalPower += power;
            panelActiveStake += activeStake;
            unchecked { ++i; }
        }
    }

    /**
     * @notice Commit a vote (hash of vote + salt)
     * @param disputeId Dispute identifier
     * @param commitHash Domain-separated vote commitment
     */
    function commitVote(uint256 disputeId, bytes32 commitHash) external {
        Dispute storage dispute = disputes[disputeId];
        require(dispute.state == DisputeState.Challenged, "Not in commit phase");
        require(block.timestamp <= dispute.commitDeadline, "Commit period ended");
        require(_isSelectedArbitrator(disputeId, msg.sender), "Not selected arbitrator");
        require(commitHash != bytes32(0), "Invalid commit");
        require(votes[disputeId][msg.sender].commitHash == bytes32(0), "Already committed");

        votes[disputeId][msg.sender].commitHash = commitHash;

        emit VoteCommitted(disputeId, msg.sender);
    }

    /**
     * @notice Reveal a previously committed vote
     * @param disputeId Dispute identifier
     * @param vote The vote (1=Legit, 2=WhiteCheat, 3=BlackCheat, 4=Abstain)
     * @param salt The salt used in commit
     */
    function revealVote(uint256 disputeId, Vote vote, bytes32 salt) external {
        Dispute storage dispute = disputes[disputeId];

        // Transition to revealing if commit period ended
        if (dispute.state == DisputeState.Challenged && block.timestamp > dispute.commitDeadline) {
            dispute.state = DisputeState.Revealing;
        }

        require(dispute.state == DisputeState.Revealing, "Not in reveal phase");
        require(block.timestamp <= dispute.revealDeadline, "Reveal period ended");

        VoteCommit storage voteCommit = votes[disputeId][msg.sender];
        require(voteCommit.commitHash != bytes32(0), "No commit found");
        require(!voteCommit.revealed, "Already revealed");
        require(vote != Vote.None, "Invalid vote");

        // Verify commit hash
        bytes32 expectedHash = computeVoteCommitment(disputeId, vote, salt, msg.sender);
        require(expectedHash == voteCommit.commitHash, "Hash mismatch");

        voteCommit.revealed = true;
        voteCommit.vote = vote;

        uint256 power = votingPowerSnapshot[disputeId][msg.sender];
        require(power > 0, "Voting power not snapshotted");

        // Count the stake/time-weight snapshot, not one address as one vote.
        if (vote == Vote.Legit) {
            dispute.legitVotes += power;
        } else if (vote == Vote.WhiteCheat) {
            dispute.whiteCheatVotes += power;
        } else if (vote == Vote.BlackCheat) {
            dispute.blackCheatVotes += power;
        } else if (vote == Vote.Abstain) {
            dispute.abstainVotes += power;
        }
        revealedVotingPower[disputeId] += power;
        revealedCount[disputeId]++;

        emit VoteRevealed(disputeId, msg.sender, vote);
    }

    /**
     * @notice Resolve dispute after reveal period
     * @param disputeId Dispute identifier
     */
    function resolveDispute(uint256 disputeId) external nonReentrant {
        require(disputeId > 0 && disputeId <= disputeCounter, "Dispute not found");
        Dispute storage dispute = disputes[disputeId];
        require(!dispute.resolved, "Already resolved");

        // A stale, unchallenged registration can be cleaned up. A challenged dispute
        // is never closed as Vote.None: that would silently confirm the original result.
        if (
            dispute.state == DisputeState.Pending &&
            block.timestamp > dispute.registeredAt + MAX_DISPUTE_DURATION
        ) {
            dispute.resolved = true;
            dispute.state = DisputeState.Resolved;
            emit DisputeResolved(disputeId, Vote.None, 0, 0, 0);
            return;
        }

        require(
            dispute.state == DisputeState.Revealing ||
            (dispute.state == DisputeState.Challenged && block.timestamp > dispute.commitDeadline),
            "Cannot resolve yet"
        );
        require(block.timestamp > dispute.revealDeadline, "Reveal period not ended");

        uint256 totalVotes = revealedVotingPower[disputeId];
        uint256 requiredArbitratorCount = dispute.requiredArbitratorCount;

        // Require the snapshotted minimum address diversity and the configured
        // percentage of panel voting power. Raw address percentage is deliberately
        // not used: permissionless low-stake Sybils must not veto high-power revealers.
        if (
            requiredArbitratorCount == 0 ||
            revealedCount[disputeId] < requiredArbitratorCount ||
            totalVotes < requiredVotingPower[disputeId]
        ) {
            _escalate(disputeId);
            return;
        }

        // Check for supermajority
        uint256 legitPercent = (dispute.legitVotes * PERCENTAGE_BASE) / totalVotes;
        uint256 whiteCheatPercent =
            (dispute.whiteCheatVotes * PERCENTAGE_BASE) / totalVotes;
        uint256 blackCheatPercent =
            (dispute.blackCheatVotes * PERCENTAGE_BASE) / totalVotes;

        uint256 resolutionSupermajority = disputeSupermajority[disputeId];
        if (whiteCheatPercent >= resolutionSupermajority) {
            dispute.finalDecision = Vote.WhiteCheat;
            _handleCheatDecision(disputeId, gameWhitePlayer[dispute.gameId]);
        } else if (blackCheatPercent >= resolutionSupermajority) {
            dispute.finalDecision = Vote.BlackCheat;
            _handleCheatDecision(disputeId, gameBlackPlayer[dispute.gameId]);
        } else if (legitPercent >= resolutionSupermajority) {
            dispute.finalDecision = Vote.Legit;
            _handleLegitDecision(disputeId);
        } else {
            // No clear majority - escalate
            _escalate(disputeId);
            return;
        }

        dispute.resolved = true;
        dispute.state = DisputeState.Resolved;
        activeChallenges[dispute.challenger]--;

        // Update arbitrator reputations
        _updateArbitratorReputations(disputeId);
        _releaseRoundPanel(disputeId);

        emit DisputeResolved(
            disputeId,
            dispute.finalDecision,
            dispute.legitVotes,
            dispute.whiteCheatVotes,
            dispute.blackCheatVotes
        );
    }

    /**
     * @notice Close challenge window if no challenge was made
     * @param gameId Game identifier
     */
    function closeChallengeWindow(uint256 gameId) external {
        uint256 disputeId = gameToDispute[gameId];
        require(disputeId != 0, "Game not registered");

        Dispute storage dispute = disputes[disputeId];
        require(dispute.state == DisputeState.Pending, "Not pending");

        // Enforce that challenge window has actually expired
        require(
            block.timestamp > challengeDeadline[disputeId],
            "Challenge window still open"
        );

        dispute.state = DisputeState.Resolved;
        dispute.resolved = true;

        emit ChallengeWindowClosed(gameId);
    }

    /**
     * @notice Check if challenge window is still open for a game
     * @param gameId Game identifier
     * @return True if window is still open
     */
    function isChallengeWindowOpen(uint256 gameId) external view returns (bool) {
        uint256 disputeId = gameToDispute[gameId];
        if (disputeId == 0) return false;

        Dispute storage dispute = disputes[disputeId];
        if (dispute.state != DisputeState.Pending) return false;

        return block.timestamp <= challengeDeadline[disputeId];
    }

    /**
     * @notice Get time remaining in challenge window
     * @param gameId Game identifier
     * @return Seconds remaining (0 if expired or not registered)
     */
    function getChallengeWindowRemaining(uint256 gameId) external view returns (uint256) {
        uint256 disputeId = gameToDispute[gameId];
        if (disputeId == 0) return 0;

        Dispute storage dispute = disputes[disputeId];
        if (dispute.state != DisputeState.Pending) return 0;

        uint256 deadline = challengeDeadline[disputeId];
        if (block.timestamp >= deadline) return 0;

        return deadline - block.timestamp;
    }

    // Internal functions

    function _handleCheatDecision(uint256 disputeId, address cheater) internal {
        Dispute storage dispute = disputes[disputeId];

        // Slash cheater's bond (burned)
        bondingManager.slashBond(dispute.gameId, cheater);

        // A participant who asks for adjudication and is then identified as the
        // cheater must not recover or profit from the challenge deposit.
        if (cheater == dispute.challenger) {
            _forfeitDepositToOpponent(disputeId);
            return;
        }

        uint256 depositAmount = _consumeChallengeDeposit(disputeId);
        uint256 balance = chessToken.balanceOf(address(this));
        uint256 unreservedBalance = balance - totalEscrowedDeposits;
        require(unreservedBalance >= depositAmount, "Escrow invariant violated");

        // The deposit is always returned. The optional 50% bonus can only use
        // explicitly pre-funded, unreserved tokens.
        uint256 availableBonus = unreservedBalance - depositAmount;
        uint256 maxBonus = depositAmount / 2;
        uint256 bonus = availableBonus < maxBonus ? availableBonus : maxBonus;
        uint256 challengerReward = depositAmount + bonus;

        chessToken.safeTransfer(dispute.challenger, challengerReward);
        emit RewardDistributed(disputeId, dispute.challenger, challengerReward);
    }

    function _handleLegitDecision(uint256 disputeId) internal {
        _forfeitDepositToOpponent(disputeId);
    }

    function _forfeitDepositToOpponent(uint256 disputeId) internal {
        Dispute storage dispute = disputes[disputeId];
        uint256 depositAmount = _consumeChallengeDeposit(disputeId);
        address white = gameWhitePlayer[dispute.gameId];
        address black = gameBlackPlayer[dispute.gameId];
        address innocent = dispute.challenger == white ? black : white;

        uint256 compensation = depositAmount / 2;
        chessToken.safeTransfer(innocent, compensation);
        emit RewardDistributed(disputeId, innocent, compensation);

        chessToken.burn(depositAmount - compensation);
    }

    function _escalate(uint256 disputeId) internal {
        Dispute storage dispute = disputes[disputeId];
        _penalizeNonReveals(disputeId);
        arbitratorRegistry.excludeArbitratorsForDispute(
            disputeId,
            dispute.selectedArbitrators
        );
        _clearRoundVotes(disputeId);
        _releaseRoundPanel(disputeId);
        delete dispute.selectedArbitrators;
        dispute.escalationLevel++;

        // There is deliberately no "max rounds => Vote.None" fallback. A bounded
        // number of inconclusive panels may be retried; exhaustion keeps all funds
        // reserved and moves the dispute to the timelocked governance backstop.
        dispute.legitVotes = 0;
        dispute.whiteCheatVotes = 0;
        dispute.blackCheatVotes = 0;
        dispute.abstainVotes = 0;
        dispute.commitDeadline = 0;
        dispute.revealDeadline = 0;
        dispute.requiredArbitratorCount = 0;

        if (dispute.escalationLevel >= MAX_ESCALATION_LEVEL) {
            _enterUnresolved(disputeId);
            emit DisputeEscalated(disputeId, dispute.escalationLevel);
            return;
        }

        // Excluding the prior panel can make a later round structurally
        // impossible even though the initial challenge was viable. Do not occupy
        // the FIFO head for the full recovery timeout when no selectable subset
        // can ever satisfy the snapshotted policy.
        (uint256 potentialCount, uint256 potentialActiveStake) =
            _potentialPanelCapacity(
                disputeId,
                gameWhitePlayer[dispute.gameId],
                gameBlackPlayer[dispute.gameId],
                dispute.challenger,
                dispute.escalationLevel
            );
        if (
            potentialCount < disputeMinimumPanelSize[disputeId] ||
            potentialActiveStake < disputeRequiredPanelCollateral[disputeId]
        ) {
            _enterUnresolved(disputeId);
            emit StructuralPanelUnavailable(
                disputeId,
                potentialCount,
                potentialActiveStake,
                disputeMinimumPanelSize[disputeId],
                disputeRequiredPanelCollateral[disputeId]
            );
            emit DisputeEscalated(disputeId, dispute.escalationLevel);
            return;
        }

        _schedulePanelSelection(disputeId);

        emit DisputeEscalated(disputeId, dispute.escalationLevel);
    }

    function _schedulePanelSelection(uint256 disputeId) internal returns (bool activated) {
        Dispute storage dispute = disputes[disputeId];
        dispute.state = DisputeState.Selecting;
        panelEntropy[disputeId] = bytes32(0);

        selectionSequenceCounter++;
        uint256 sequence = selectionSequenceCounter;
        panelSelectionSequence[disputeId] = sequence;
        selectionSequenceDispute[sequence] = disputeId;
        panelSelectionScheduledAt[disputeId] = block.timestamp;
        panelSelectionBlock[disputeId] = 0;
        emit PanelSelectionQueued(disputeId, sequence);

        // The first item can commit its population and future entropy target now.
        // Later items remain inert until they become the FIFO head.
        if (sequence == nextSelectionSequence) {
            return _activatePanelSelection(disputeId);
        }
        return false;
    }

    function _activatePanelSelection(uint256 disputeId) internal returns (bool activated) {
        Dispute storage dispute = disputes[disputeId];
        require(_isSelectionHead(disputeId), "Selection is queued");
        require(panelSelectionBlock[disputeId] == 0, "Selection already activated");

        arbitratorRegistry.lockPanelSelection(disputeId);

        (
            bytes32 populationFingerprint,
            uint256 eligibleCount,
            uint256 eligibleActiveStake,
            uint256 eligibilityTimestamp,
            uint256 snapshotGameRecordSequence
        ) = arbitratorRegistry.getSelectionSnapshot(
            disputeId,
            gameWhitePlayer[dispute.gameId],
            gameBlackPlayer[dispute.gameId],
            dispute.challenger,
            _requestedArbitratorsPerTier(dispute.escalationLevel),
            dispute.escalationLevel
        );
        panelPopulationFingerprint[disputeId] = populationFingerprint;
        panelSnapshotTimestamp[disputeId] = eligibilityTimestamp;
        panelSnapshotEligibleCount[disputeId] = eligibleCount;
        panelSnapshotEligibleActiveStake[disputeId] = eligibleActiveStake;
        panelSnapshotGameRecordSequence[disputeId] = snapshotGameRecordSequence;

        if (
            eligibleCount < disputeMinimumPanelSize[disputeId] ||
            eligibleActiveStake < disputeRequiredPanelCollateral[disputeId]
        ) {
            arbitratorRegistry.unlockPanelSelection(disputeId);
            delete panelPopulationFingerprint[disputeId];
            delete panelSnapshotTimestamp[disputeId];
            delete panelSnapshotEligibleCount[disputeId];
            delete panelSnapshotEligibleActiveStake[disputeId];
            delete panelSnapshotGameRecordSequence[disputeId];
            return false;
        }

        uint256 targetBlock = block.number + PANEL_SELECTION_DELAY_BLOCKS;
        panelSelectionBlock[disputeId] = targetBlock;
        emit PanelPopulationSnapshotted(
            disputeId,
            dispute.escalationLevel,
            populationFingerprint,
            eligibilityTimestamp,
            eligibleCount,
            eligibleActiveStake
        );
        emit PanelSelectionScheduled(disputeId, dispute.escalationLevel, targetBlock);
        return true;
    }

    function _isSelectionHead(uint256 disputeId) internal view returns (bool) {
        uint256 sequence = panelSelectionSequence[disputeId];
        return sequence != 0 && sequence == nextSelectionSequence;
    }

    function _releaseSelectionLock(uint256 disputeId) internal {
        if (panelSelectionBlock[disputeId] != 0) {
            arbitratorRegistry.unlockPanelSelection(disputeId);
        }
    }

    function _advanceSelectionQueue(uint256 disputeId) internal {
        require(_isSelectionHead(disputeId), "Selection is queued");
        delete selectionSequenceDispute[nextSelectionSequence];
        nextSelectionSequence++;

        uint256 promotedDisputeId = selectionSequenceDispute[nextSelectionSequence];
        if (promotedDisputeId != 0) {
            // Waiting behind another dispute never consumes this entry's bounded
            // recovery window. Every promoted head receives a full opportunity to
            // activate/finalize before governance backstop becomes available.
            panelSelectionScheduledAt[promotedDisputeId] = block.timestamp;
        }
    }

    function _enterUnresolved(uint256 disputeId) internal {
        Dispute storage dispute = disputes[disputeId];
        dispute.state = DisputeState.Unresolved;
        dispute.commitDeadline = 0;
        dispute.revealDeadline = 0;
        dispute.requiredArbitratorCount = 0;
        emit DisputeRequiresBackstop(disputeId, dispute.escalationLevel);
    }

    function _percentageCeil(uint256 value, uint256 percentage) internal pure returns (uint256) {
        if (value == 0) return 0;
        return ((value * percentage) + (PERCENTAGE_BASE - 1)) / PERCENTAGE_BASE;
    }

    function _gameBondExposure(
        uint256 gameId,
        address white,
        address black
    ) internal view returns (uint256 gameBondExposure) {
        (, uint256 whiteChess, , bool whiteReleased, bool whiteSlashed) =
            bondingManager.gameBonds(gameId, white);
        (, uint256 blackChess, , bool blackReleased, bool blackSlashed) =
            bondingManager.gameBonds(gameId, black);

        require(whiteChess > 0 && !whiteReleased && !whiteSlashed, "White game bond unavailable");
        require(blackChess > 0 && !blackReleased && !blackSlashed, "Black game bond unavailable");
        return whiteChess + blackChess;
    }

    function _requiredPanelPower(uint256 gameBondExposure) internal view returns (uint256) {
        uint256 proportionalFloor =
            ((gameBondExposure * arbitrationCoverageBps) + (BPS_DENOMINATOR - 1)) /
            BPS_DENOMINATOR;
        return proportionalFloor > minimumPanelCollateral
            ? proportionalFloor
            : minimumPanelCollateral;
    }

    function _requiredPanelPowerForDispute(
        uint256 disputeId,
        uint256 gameBondExposure
    ) internal view returns (uint256) {
        DisputeEconomics storage policy = disputeEconomics[disputeId];
        uint256 proportionalFloor =
            ((gameBondExposure * policy.arbitrationCoverageBps) + (BPS_DENOMINATOR - 1)) /
            BPS_DENOMINATOR;
        return proportionalFloor > policy.minimumPanelCollateral
            ? proportionalFloor
            : policy.minimumPanelCollateral;
    }

    function _requiredChallengeDeposit(uint256 gameBondExposure)
        internal
        view
        returns (uint256)
    {
        uint256 proportionalDeposit =
            ((gameBondExposure * challengeDepositBps) + (BPS_DENOMINATOR - 1)) /
            BPS_DENOMINATOR;
        return proportionalDeposit > challengeDeposit
            ? proportionalDeposit
            : challengeDeposit;
    }

    function _requiredChallengeDepositForDispute(
        uint256 disputeId,
        uint256 gameBondExposure
    ) internal view returns (uint256) {
        DisputeEconomics storage policy = disputeEconomics[disputeId];
        uint256 proportionalDeposit =
            ((gameBondExposure * policy.challengeDepositBps) + (BPS_DENOMINATOR - 1)) /
            BPS_DENOMINATOR;
        return proportionalDeposit > policy.challengeDeposit
            ? proportionalDeposit
            : policy.challengeDeposit;
    }

    function _potentialPanelCapacity(
        uint256 disputeId,
        address white,
        address black,
        address extraExcluded,
        uint256 escalationLevel
    ) internal view returns (uint256 eligibleCount, uint256 eligibleActiveStake) {
        return arbitratorRegistry.getPotentialSelectionCapacity(
            disputeId,
            white,
            black,
            extraExcluded,
            _requestedArbitratorsPerTier(escalationLevel),
            escalationLevel
        );
    }

    function _requestedArbitratorsPerTier(uint256 escalationLevel)
        internal
        pure
        returns (uint256 requestedPerTier)
    {
        requestedPerTier = INITIAL_ARBITRATORS_PER_TIER + (escalationLevel * 2);
        if (requestedPerTier > MAX_ARBITRATORS_PER_TIER) {
            return MAX_ARBITRATORS_PER_TIER;
        }
    }

    function _consumeChallengeDeposit(uint256 disputeId) internal returns (uint256 amount) {
        amount = disputeDeposits[disputeId];
        require(amount > 0, "No reserved deposit");

        delete disputeDeposits[disputeId];
        totalEscrowedDeposits -= amount;
        emit ChallengeDepositReleased(disputeId, amount);
    }

    function _clearRoundVotes(uint256 disputeId) internal {
        address[] storage selected = disputes[disputeId].selectedArbitrators;
        for (uint256 i = 0; i < selected.length;) {
            delete votes[disputeId][selected[i]];
            delete votingPowerSnapshot[disputeId][selected[i]];
            unchecked { ++i; }
        }
        totalPanelVotingPower[disputeId] = 0;
        totalPanelCollateral[disputeId] = 0;
        requiredVotingPower[disputeId] = 0;
        revealedVotingPower[disputeId] = 0;
        revealedCount[disputeId] = 0;
    }

    function _penalizeNonReveals(uint256 disputeId) internal {
        address[] storage selected = disputes[disputeId].selectedArbitrators;
        for (uint256 i = 0; i < selected.length;) {
            if (!votes[disputeId][selected[i]].revealed) {
                arbitratorRegistry.slashForNonReveal(disputeId, selected[i]);
            }
            unchecked { ++i; }
        }
    }

    function _releaseRoundPanel(uint256 disputeId) internal {
        address[] storage selected = disputes[disputeId].selectedArbitrators;
        if (selected.length > 0) {
            arbitratorRegistry.releaseArbitrators(disputeId, selected);
        }
    }

    // Address diversity is the snapshotted minimum viable panel (normally three),
    // capped by the panel actually formed. The 66% policy is enforced separately
    // against voting power and must never be reinterpreted as an address percentage.
    function _calculateRequiredArbitratorCount(uint256 disputeId, uint256 selectedCount)
        internal
        view
        returns (uint256)
    {
        if (selectedCount < MIN_EFFECTIVE_QUORUM) {
            return 0;
        }
        uint256 minimumDiversity = disputeMinimumPanelSize[disputeId];
        return selectedCount < minimumDiversity ? selectedCount : minimumDiversity;
    }

    function _updateArbitratorReputations(uint256 disputeId) internal {
        Dispute storage dispute = disputes[disputeId];

        for (uint256 i = 0; i < dispute.selectedArbitrators.length;) {
            address arbitrator = dispute.selectedArbitrators[i];
            VoteCommit storage voteCommit = votes[disputeId][arbitrator];

            if (!voteCommit.revealed) {
                arbitratorRegistry.slashForNonReveal(disputeId, arbitrator);
                unchecked { ++i; }
                continue;
            }

            // Check if voted with majority
            bool votedWithMajority = voteCommit.vote == dispute.finalDecision;

            if (votedWithMajority) {
                arbitratorRegistry.updateReputation(arbitrator, true);
            } else {
                arbitratorRegistry.slashForIncorrectVote(disputeId, arbitrator);
            }
            unchecked { ++i; }
        }
    }

    function _isSelectedArbitrator(uint256 disputeId, address arbitrator) internal view returns (bool) {
        address[] storage selected = disputes[disputeId].selectedArbitrators;
        for (uint256 i = 0; i < selected.length;) {
            if (selected[i] == arbitrator) return true;
            unchecked { ++i; }
        }
        return false;
    }

    // View functions

    function getDispute(uint256 disputeId) external view returns (
        uint256 gameId,
        address challenger,
        DisputeState state,
        uint256 legitVotes,
        uint256 whiteCheatVotes,
        uint256 blackCheatVotes,
        Vote finalDecision,
        uint256 escalationLevel
    ) {
        Dispute storage d = disputes[disputeId];
        return (
            d.gameId,
            d.challenger,
            d.state,
            d.legitVotes,
            d.whiteCheatVotes,
            d.blackCheatVotes,
            d.finalDecision,
            d.escalationLevel
        );
    }

    function getSelectedArbitrators(uint256 disputeId) external view returns (address[] memory) {
        return disputes[disputeId].selectedArbitrators;
    }

    function getEffectiveQuorum(uint256 disputeId)
        external
        view
        returns (uint256 minimumRevealedArbitrators)
    {
        return disputes[disputeId].requiredArbitratorCount;
    }

    function getPanelSecurity(uint256 disputeId) external view returns (
        uint256 totalVotingPower,
        uint256 minimumRevealedVotingPower,
        uint256 revealedPower,
        uint256 minimumRevealedArbitrators,
        uint256 revealedArbitrators,
        uint256 panelActiveStake,
        uint256 requiredPanelActiveStake
    ) {
        return (
            totalPanelVotingPower[disputeId],
            requiredVotingPower[disputeId],
            revealedVotingPower[disputeId],
            disputes[disputeId].requiredArbitratorCount,
            revealedCount[disputeId],
            totalPanelCollateral[disputeId],
            disputeRequiredPanelCollateral[disputeId]
        );
    }

    function getRequiredPanelCollateralForGame(uint256 gameId)
        external
        view
        returns (uint256 requiredPanelActiveStake)
    {
        uint256 disputeId = gameToDispute[gameId];
        require(disputeId != 0, "Game not registered");
        return _requiredPanelPowerForDispute(disputeId, _gameBondExposure(
            gameId,
            gameWhitePlayer[gameId],
            gameBlackPlayer[gameId]
        ));
    }

    function getRequiredChallengeDepositForGame(uint256 gameId)
        external
        view
        returns (uint256 requiredDeposit)
    {
        uint256 disputeId = gameToDispute[gameId];
        require(disputeId != 0, "Game not registered");
        return _requiredChallengeDepositForDispute(disputeId, _gameBondExposure(
            gameId,
            gameWhitePlayer[gameId],
            gameBlackPlayer[gameId]
        ));
    }

    /**
     * @notice Resolve a dispute only after bounded arbitration exhausted its panels
     * @dev DEFAULT_ADMIN_ROLE is handed to ChessTimelock in supported deployments.
     *      Vote.None and Abstain are deliberately forbidden, so this path cannot
     *      silently confirm the provisional game result.
     */
    function resolveByBackstop(uint256 disputeId, Vote decision)
        external
        nonReentrant
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(disputeId > 0 && disputeId <= disputeCounter, "Dispute not found");
        Dispute storage dispute = disputes[disputeId];
        require(dispute.state == DisputeState.Unresolved, "Backstop not required");
        require(
            decision == Vote.Legit ||
            decision == Vote.WhiteCheat ||
            decision == Vote.BlackCheat,
            "Invalid backstop decision"
        );

        dispute.finalDecision = decision;
        if (decision == Vote.WhiteCheat) {
            _handleCheatDecision(disputeId, gameWhitePlayer[dispute.gameId]);
        } else if (decision == Vote.BlackCheat) {
            _handleCheatDecision(disputeId, gameBlackPlayer[dispute.gameId]);
        } else {
            _handleLegitDecision(disputeId);
        }

        dispute.resolved = true;
        dispute.state = DisputeState.Resolved;
        activeChallenges[dispute.challenger]--;

        emit BackstopDecision(disputeId, decision);
        emit DisputeResolved(
            disputeId,
            decision,
            dispute.legitVotes,
            dispute.whiteCheatVotes,
            dispute.blackCheatVotes
        );
    }

    /**
     * @notice Return the exact domain-separated commitment expected by revealVote
     */
    function computeVoteCommitment(
        uint256 disputeId,
        Vote vote,
        bytes32 salt,
        address arbitrator
    ) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                block.chainid,
                address(this),
                disputeId,
                uint8(vote),
                salt,
                arbitrator
            )
        );
    }

    function getVoteStatus(uint256 disputeId, address arbitrator) external view returns (
        bool hasCommitted,
        bool hasRevealed,
        Vote revealedVote
    ) {
        VoteCommit storage v = votes[disputeId][arbitrator];
        hasCommitted = v.commitHash != bytes32(0);
        hasRevealed = v.revealed;
        revealedVote = v.vote;
    }

    // Admin functions

    function setParameters(
        uint256 _challengeWindow,
        uint256 _commitPeriod,
        uint256 _revealPeriod,
        uint256 _quorumPercentage,
        uint256 _supermajority,
        uint256 _challengeDeposit
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_challengeWindow >= 1 hours && _challengeWindow <= 7 days, "Invalid challenge window");
        require(_commitPeriod >= 1 hours && _commitPeriod <= 7 days, "Invalid commit period");
        require(_revealPeriod >= 1 hours && _revealPeriod <= 7 days, "Invalid reveal period");
        require(_quorumPercentage >= 51 && _quorumPercentage <= 100, "Invalid quorum percentage");
        require(_supermajority >= 51 && _supermajority <= 100, "Invalid supermajority");
        require(_challengeDeposit >= 1 * 10**18, "Challenge deposit too low");

        challengeWindow = _challengeWindow;
        commitPeriod = _commitPeriod;
        revealPeriod = _revealPeriod;
        quorumPercentage = _quorumPercentage;
        supermajority = _supermajority;
        challengeDeposit = _challengeDeposit;
        emit ChallengeEconomicsUpdated(_challengeDeposit, challengeDepositBps);
        emit ArbitrationSecurityParametersUpdated(
            _quorumPercentage,
            minimumPanelSize,
            minimumPanelCollateral,
            arbitrationCoverageBps
        );
    }

    function setChallengeDepositBps(uint256 _challengeDepositBps)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(
            _challengeDepositBps >= 100 && _challengeDepositBps <= BPS_DENOMINATOR,
            "Invalid challenge deposit rate"
        );
        challengeDepositBps = _challengeDepositBps;
        emit ChallengeEconomicsUpdated(challengeDeposit, _challengeDepositBps);
    }

    /**
     * @notice Configure the explicit minimum viable arbitration panel
     * @dev Panel active stake is denominated in CHESS and scaled from the locked game
     *      bonds. It is not objectively slashable collateral for a majority verdict:
     *      without an appeal layer or truth oracle, only the explicit 5% non-reveal
     *      and 1% minority-vote penalties are enforceable on-chain.
     */
    function setArbitrationSecurityParameters(
        uint256 _minimumPanelSize,
        uint256 _minimumPanelActiveStake,
        uint256 _arbitrationCoverageBps
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_minimumPanelSize >= MIN_EFFECTIVE_QUORUM, "Panel too small");
        require(_minimumPanelSize <= MAX_INITIAL_PANEL_SIZE, "Initial panel too large");
        require(_minimumPanelActiveStake >= 1_000 * 10**18, "Panel active stake too low");
        require(
            _arbitrationCoverageBps >= BPS_DENOMINATOR &&
            _arbitrationCoverageBps <= 10 * BPS_DENOMINATOR,
            "Invalid coverage"
        );

        minimumPanelSize = _minimumPanelSize;
        minimumPanelCollateral = _minimumPanelActiveStake;
        arbitrationCoverageBps = _arbitrationCoverageBps;
        emit ArbitrationSecurityParametersUpdated(
            quorumPercentage,
            _minimumPanelSize,
            _minimumPanelActiveStake,
            _arbitrationCoverageBps
        );
    }
}
