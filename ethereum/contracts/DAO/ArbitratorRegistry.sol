// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../Token/ChessToken.sol";

/**
 * @title ArbitratorRegistry
 * @notice Registry for arbitrators who vote on chess game disputes
 * @dev Implements multi-level pools, timelock, and reputation system
 *
 * Key Features:
 * - 7-day timelock before voting power activates (flash loan protection)
 * - Three-tier stake pools for decentralization
 * - Reputation system (vote with majority = +1, against = -1)
 * - Cooldown and a single active assignment per stake position
 * - Future-entropy, tier-stratified selection coordinated by DisputeDAO
 * - Economic penalties for failing to reveal an assigned vote
 */
contract ArbitratorRegistry is AccessControl, ReentrancyGuard {
    bytes32 public constant DISPUTE_MANAGER_ROLE = keccak256("DISPUTE_MANAGER_ROLE");

    ChessToken public immutable chessToken;

    // Timelock for voting power
    uint256 public constant VOTING_POWER_DELAY = 7 days;

    // Stake tiers for multi-level pools
    uint256 public constant TIER1_MIN = 1000 * 10**18;   // 1,000 - 5,000 CHESS
    uint256 public constant TIER1_MAX = 5000 * 10**18;
    uint256 public constant TIER2_MIN = 5000 * 10**18;   // 5,000 - 20,000 CHESS
    uint256 public constant TIER2_MAX = 20000 * 10**18;
    uint256 public constant TIER3_MIN = 20000 * 10**18;  // 20,000+ CHESS

    // Reputation thresholds
    uint256 public constant INITIAL_REPUTATION = 100;
    uint256 public constant MIN_REPUTATION = 50;  // Below this = removed

    // Cooldown after voting
    uint256 public constant VOTE_COOLDOWN = 48 hours;
    uint256 public constant MAX_DISPUTES_PER_WEEK = 5;
    uint256 public constant MAX_ARBITRATORS_PER_TIER_POOL = 128;
    uint256 public constant NON_REVEAL_SLASH_BPS = 500; // 5%
    uint256 public constant INCORRECT_VOTE_SLASH_BPS = 100; // 1%
    uint256 private constant BPS_DENOMINATOR = 10_000;
    bytes32 private constant SELECTION_SNAPSHOT_DOMAIN =
        keccak256("CHESS_ARBITRATOR_SELECTION_SNAPSHOT_V1");

    struct Arbitrator {
        uint256 stakedAmount;
        uint256 activatedStake;
        uint256 pendingStake;
        uint256 pendingStakeAvailableAt;
        uint256 stakedAt;
        uint256 votingPowerActiveAt;
        uint256 reputation;
        uint256 lastVoteTime;
        uint256 disputesThisWeek;
        uint256 weekStartTime;
        bool isActive;
    }

    struct SelectionRequest {
        uint256 disputeId;
        address player1;
        address player2;
        address extraExcluded;
        uint256 count;
        bytes32 entropy;
        uint256 snapshotRound;
        uint256 snapshotTimestamp;
        bytes32 expectedFingerprint;
        address snapshotManager;
    }

    struct SnapshotRequest {
        uint256 disputeId;
        address player1;
        address player2;
        address extraExcluded;
        uint256 snapshotRound;
        uint256 snapshotTimestamp;
        address snapshotManager;
    }

    struct SnapshotAccumulator {
        bytes32 fingerprint;
        uint256 eligibleCount;
        uint256 eligibleActiveStake;
    }

    mapping(address => Arbitrator) public arbitrators;
    mapping(address => uint256) public activeAssignments;
    mapping(uint256 => mapping(address => bool)) public disputeAssignments;
    mapping(uint256 => mapping(address => bool)) public nonRevealPenalized;
    mapping(uint256 => mapping(address => bool)) public incorrectVotePenalized;
    mapping(uint256 => mapping(address => bool)) public priorRoundExcluded;

    // Tier pools for random selection
    address[] public tier1Arbitrators;
    address[] public tier2Arbitrators;
    address[] public tier3Arbitrators;

    mapping(address => uint256) public tier1Index;
    mapping(address => uint256) public tier2Index;
    mapping(address => uint256) public tier3Index;

    // Recent opponents tracking (for exclusion)
    mapping(address => mapping(address => uint256)) public lastGameWith; // player => opponent => timestamp

    // Stats
    uint256 public totalStaked;
    uint256 public totalArbitrators;

    // Events
    event ArbitratorRegistered(address indexed arbitrator, uint256 amount, uint8 tier);
    event ArbitratorStakeIncreased(address indexed arbitrator, uint256 newAmount, uint8 newTier);
    event ArbitratorStakePending(address indexed arbitrator, uint256 amount, uint256 availableAt);
    event ArbitratorStakeActivated(address indexed arbitrator, uint256 amount, uint256 newActivatedStake, uint8 newTier);
    event ArbitratorUnstaked(address indexed arbitrator, uint256 amount);
    event ReputationUpdated(address indexed arbitrator, uint256 oldRep, uint256 newRep);
    event ArbitratorRemoved(address indexed arbitrator, string reason);
    event ArbitratorSelected(uint256 indexed disputeId, address indexed arbitrator);
    event ArbitratorAssignmentReleased(uint256 indexed disputeId, address indexed arbitrator);
    event AssignmentReserved(
        uint256 indexed disputeId,
        address indexed arbitrator,
        uint256 votingPower,
        uint256 weeklyAssignmentNumber
    );
    event NonRevealSlashed(
        uint256 indexed disputeId,
        address indexed arbitrator,
        uint256 amount
    );
    event IncorrectVoteSlashed(
        uint256 indexed disputeId,
        address indexed arbitrator,
        uint256 amount
    );
    event ArbitratorExcludedFromDispute(uint256 indexed disputeId, address indexed arbitrator);

    constructor(address _chessToken) {
        require(_chessToken.code.length > 0, "Token must be contract");
        chessToken = ChessToken(_chessToken);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    /**
     * @notice Stake CHESS to become an arbitrator
     * @param amount Amount of CHESS to stake
     */
    function stake(uint256 amount) external nonReentrant {
        Arbitrator storage arb = arbitrators[msg.sender];
        bool wasActive = arb.isActive;
        require(amount > 0, "Amount must be > 0");
        require(wasActive || arb.stakedAmount + amount >= TIER1_MIN, "Minimum stake not met");

        // Transfer tokens
        require(chessToken.transferFrom(msg.sender, address(this), amount), "Transfer failed");

        if (!wasActive) {
            // Keep a degraded score so removal cannot be undone with a 1-wei restake.
            require(arb.reputation == 0 || arb.reputation >= MIN_REPUTATION, "Reputation too low");
            if (arb.reputation == 0) {
                arb.reputation = INITIAL_REPUTATION;
            }

            uint256 oldActivatedStake = arb.activatedStake;
            arb.stakedAmount += amount;
            arb.activatedStake = arb.stakedAmount;
            arb.pendingStake = 0;
            arb.pendingStakeAvailableAt = 0;
            totalStaked += arb.activatedStake - oldActivatedStake;

            uint8 newTier = _getTier(arb.activatedStake);
            _requireTierCapacity(newTier);
            arb.stakedAt = block.timestamp;
            arb.votingPowerActiveAt = block.timestamp + VOTING_POWER_DELAY;
            arb.weekStartTime = block.timestamp;
            arb.isActive = true;
            totalArbitrators++;
            _addToTierPool(msg.sender, newTier);

            emit ArbitratorRegistered(msg.sender, arb.stakedAmount, newTier);
            return;
        }

        // Increasing an active position must not immediately change voting power,
        // tier membership, or inherit the position's staking age. Aggregate pending
        // top-ups share a fresh seven-day delay, so a last-minute addition cannot
        // hitchhike on an older pending tranche.
        arb.stakedAmount += amount;
        arb.pendingStake += amount;
        arb.pendingStakeAvailableAt = block.timestamp + VOTING_POWER_DELAY;

        emit ArbitratorStakePending(msg.sender, amount, arb.pendingStakeAvailableAt);
    }

    /**
     * @notice Activate a matured top-up
     * @dev Activation resets the aggregate age bonus. This is deliberately
     *      conservative: newly activated stake can never inherit historical age.
     */
    function activatePendingStake() external nonReentrant {
        Arbitrator storage arb = arbitrators[msg.sender];
        uint256 amount = arb.pendingStake;
        require(amount > 0, "No pending stake");
        require(block.timestamp >= arb.pendingStakeAvailableAt, "Stake activation pending");
        require(arb.reputation >= MIN_REPUTATION, "Reputation too low");
        require(activeAssignments[msg.sender] == 0, "Assigned to active dispute");

        bool wasActive = arb.isActive;
        uint8 oldTier = _getTier(arb.activatedStake);
        uint256 newActivatedStake = arb.activatedStake + amount;
        uint8 newTier = _getTier(newActivatedStake);
        require(newTier > 0, "Minimum stake not met");
        if (!wasActive || oldTier != newTier) {
            _requireTierCapacity(newTier);
        }

        arb.activatedStake = newActivatedStake;
        arb.pendingStake = 0;
        arb.pendingStakeAvailableAt = 0;
        arb.stakedAt = block.timestamp;
        totalStaked += amount;

        if (!wasActive) {
            arb.isActive = true;
            arb.votingPowerActiveAt = block.timestamp;
            arb.weekStartTime = block.timestamp;
            totalArbitrators++;
            _addToTierPool(msg.sender, newTier);
        } else if (oldTier != newTier) {
            _removeFromTierPool(msg.sender, oldTier);
            _addToTierPool(msg.sender, newTier);
        }

        emit ArbitratorStakeActivated(msg.sender, amount, newActivatedStake, newTier);
        emit ArbitratorStakeIncreased(msg.sender, arb.stakedAmount, newTier);
    }

    /**
     * @notice Unstake CHESS (partial or full)
     * @param amount Amount to unstake
     */
    function unstake(uint256 amount) external nonReentrant {
        Arbitrator storage arb = arbitrators[msg.sender];
        bool wasActive = arb.isActive;
        require(amount > 0, "Amount must be > 0");
        require(arb.stakedAmount > 0, "No stake");
        require(amount <= arb.stakedAmount, "Insufficient stake");
        require(activeAssignments[msg.sender] == 0, "Assigned to active dispute");

        // Check if in cooldown (can't unstake during active disputes)
        require(block.timestamp >= arb.lastVoteTime + VOTE_COOLDOWN, "In cooldown");

        uint8 oldTier = _getTier(arb.activatedStake);
        uint256 pendingReduction = amount < arb.pendingStake ? amount : arb.pendingStake;
        uint256 activatedReduction = amount - pendingReduction;

        arb.stakedAmount -= amount;
        if (pendingReduction > 0) {
            arb.pendingStake -= pendingReduction;
            if (arb.pendingStake == 0) arb.pendingStakeAvailableAt = 0;
        }
        if (activatedReduction > 0) {
            arb.activatedStake -= activatedReduction;
            totalStaked -= activatedReduction;
        }
        uint8 newTier = _getTier(arb.activatedStake);

        // Update tier pools
        if (wasActive && oldTier != newTier) {
            _removeFromTierPool(msg.sender, oldTier);
            if (newTier > 0 && _tierHasCapacity(newTier)) {
                _addToTierPool(msg.sender, newTier);
            } else {
                arb.isActive = false;
                totalArbitrators--;
                emit ArbitratorRemoved(
                    msg.sender,
                    newTier == 0 ? "Stake below minimum" : "Destination tier full"
                );
            }
        }

        // If stake falls below minimum, deactivate
        if (arb.isActive && arb.activatedStake < TIER1_MIN) {
            _removeFromTierPool(msg.sender, newTier);
            arb.isActive = false;
            totalArbitrators--;
            emit ArbitratorRemoved(msg.sender, "Stake below minimum");
        }

        require(chessToken.transfer(msg.sender, amount), "Transfer failed");

        emit ArbitratorUnstaked(msg.sender, amount);
    }

    /**
     * @notice Get voting power for an arbitrator
     * @dev Returns 0 if timelock not passed
     */
    function getVotingPower(address arbitrator) public view returns (uint256) {
        Arbitrator storage arb = arbitrators[arbitrator];

        return _getVotingPowerAt(arb, block.timestamp);
    }

    /**
     * @notice Return voting power at the immutable eligibility timestamp of a panel snapshot
     * @dev Stake-changing fields are fingerprinted before entropy is knowable and locked by
     *      the assignment after selection. This timestamp prevents waiting itself from
     *      activating stake or increasing the age bonus for an already scheduled panel.
     */
    function getVotingPowerAt(address arbitrator, uint256 snapshotTimestamp)
        external
        view
        returns (uint256)
    {
        return _getVotingPowerAt(arbitrators[arbitrator], snapshotTimestamp);
    }

    function _getVotingPowerAt(Arbitrator storage arb, uint256 timestamp)
        internal
        view
        returns (uint256)
    {
        if (timestamp < arb.stakedAt) return 0;

        if (!arb.isActive) return 0;
        if (timestamp < arb.votingPowerActiveAt) return 0;
        if (arb.reputation < MIN_REPUTATION) return 0;

        // Base voting power = stake
        // Time bonus: up to 2x after 1 year
        uint256 timeStaked = timestamp - arb.stakedAt;
        uint256 timeBonus = timeStaked > 365 days ? 100 : (timeStaked * 100) / 365 days;

        return arb.activatedStake * (100 + timeBonus) / 100;
    }

    /**
     * @notice Fingerprint the complete bounded tier population before future entropy exists
     * @dev The fingerprint commits to pool membership/order and every field that can alter
     *      eligibility, voting power, active stake, exclusions, cooldown, or assignment
     *      quota. Eligibility is evaluated at the returned timestamp, not at finalization.
     */
    function getSelectionSnapshot(
        uint256 disputeId,
        address player1,
        address player2,
        address extraExcluded,
        uint256 snapshotRound
    ) external view onlyRole(DISPUTE_MANAGER_ROLE) returns (
        bytes32 fingerprint,
        uint256 eligibleCount,
        uint256 eligibleActiveStake,
        uint256 snapshotTimestamp
    ) {
        snapshotTimestamp = block.timestamp;
        SnapshotRequest memory request = SnapshotRequest({
            disputeId: disputeId,
            player1: player1,
            player2: player2,
            extraExcluded: extraExcluded,
            snapshotRound: snapshotRound,
            snapshotTimestamp: snapshotTimestamp,
            snapshotManager: msg.sender
        });
        SnapshotAccumulator memory snapshot = _buildSelectionSnapshot(request);
        return (
            snapshot.fingerprint,
            snapshot.eligibleCount,
            snapshot.eligibleActiveStake,
            snapshotTimestamp
        );
    }

    /**
     * @notice Check whether a scheduled population snapshot still matches live state
     * @dev Used before an expired-blockhash refresh. A mismatch can only recover through
     *      the bounded timeout/backstop; it must never receive a new entropy draw.
     */
    function selectionSnapshotMatches(
        uint256 disputeId,
        address player1,
        address player2,
        address extraExcluded,
        uint256 snapshotRound,
        uint256 snapshotTimestamp,
        bytes32 expectedFingerprint
    ) external view onlyRole(DISPUTE_MANAGER_ROLE) returns (bool) {
        SnapshotRequest memory request = SnapshotRequest({
            disputeId: disputeId,
            player1: player1,
            player2: player2,
            extraExcluded: extraExcluded,
            snapshotRound: snapshotRound,
            snapshotTimestamp: snapshotTimestamp,
            snapshotManager: msg.sender
        });
        return _buildSelectionSnapshot(request).fingerprint == expectedFingerprint;
    }

    /**
     * @notice Select and reserve arbitrators using entropy captured by DisputeDAO
     * @dev The caller must supply entropy from a future block plus the population
     *      fingerprint captured before that block. Any membership, active stake, tier,
     *      cooldown, quota, reputation, exclusion, or assignment mutation fails closed.
     */
    function selectArbitrators(
        uint256 disputeId,
        address player1,
        address player2,
        address extraExcluded,
        uint256 count,
        bytes32 entropy,
        uint256 snapshotRound,
        uint256 snapshotTimestamp,
        bytes32 expectedFingerprint
    ) external onlyRole(DISPUTE_MANAGER_ROLE) returns (address[] memory selected) {
        SelectionRequest memory request;
        request.disputeId = disputeId;
        request.player1 = player1;
        request.player2 = player2;
        request.extraExcluded = extraExcluded;
        request.count = count;
        request.entropy = entropy;
        request.snapshotRound = snapshotRound;
        request.snapshotTimestamp = snapshotTimestamp;
        request.expectedFingerprint = expectedFingerprint;
        request.snapshotManager = msg.sender;
        return _selectArbitrators(request);
    }

    function _selectArbitrators(SelectionRequest memory request)
        internal
        returns (address[] memory selected)
    {
        require(request.count > 0, "Count must be > 0");
        require(request.entropy != bytes32(0), "Entropy required");
        require(request.expectedFingerprint != bytes32(0), "Snapshot required");

        SnapshotRequest memory snapshotRequest = _snapshotRequest(request);
        require(
            _buildSelectionSnapshot(snapshotRequest).fingerprint == request.expectedFingerprint,
            "Selection snapshot changed"
        );

        uint256 totalSelected = request.count * 3; // From all 3 tiers
        selected = new address[](totalSelected);
        uint256 selectedCount = 0;

        selectedCount = _selectFromTier(
            tier1Arbitrators, request, selected, selectedCount, 1
        );
        selectedCount = _selectFromTier(
            tier2Arbitrators, request, selected, selectedCount, 2
        );
        selectedCount = _selectFromTier(
            tier3Arbitrators, request, selected, selectedCount, 3
        );

        if (selectedCount < totalSelected) {
            address[] memory resized = new address[](selectedCount);
            for (uint256 i = 0; i < selectedCount; i++) {
                resized[i] = selected[i];
            }
            return resized;
        }
    }

    /**
     * @notice Release the stake lock for a dispute panel
     * @param disputeId Dispute identifier used when the panel was selected
     * @param panel Arbitrators whose assignment has ended
     */
    function releaseArbitrators(uint256 disputeId, address[] calldata panel)
        external
        onlyRole(DISPUTE_MANAGER_ROLE)
    {
        for (uint256 i = 0; i < panel.length;) {
            address arbitrator = panel[i];
            require(disputeAssignments[disputeId][arbitrator], "Assignment not found");

            delete disputeAssignments[disputeId][arbitrator];
            activeAssignments[arbitrator] = 0;
            emit ArbitratorAssignmentReleased(disputeId, arbitrator);

            unchecked { ++i; }
        }
    }

    /**
     * @notice Update reputation after dispute resolution
     * @param arbitrator Arbitrator address
     * @param votedWithMajority Whether they voted with majority
     */
    function updateReputation(address arbitrator, bool votedWithMajority)
        external
        onlyRole(DISPUTE_MANAGER_ROLE)
    {
        // An arbitrator can be deactivated by another dispute after having been
        // validly assigned here. Reputation settlement must never block fund release.
        _updateReputation(arbitrator, votedWithMajority);
    }

    /**
     * @notice Slash stake and reputation for an assigned arbitrator that did not reveal
     * @dev Idempotent for the current dispute assignment. The slash is burned so no
     *      resolver or challenger can profit from selectively declaring non-reveals.
     */
    function slashForNonReveal(uint256 disputeId, address arbitrator)
        external
        onlyRole(DISPUTE_MANAGER_ROLE)
        returns (uint256 slashAmount)
    {
        require(disputeAssignments[disputeId][arbitrator], "Assignment not found");
        if (nonRevealPenalized[disputeId][arbitrator]) return 0;

        nonRevealPenalized[disputeId][arbitrator] = true;
        slashAmount = _slashStake(arbitrator, NON_REVEAL_SLASH_BPS, "Non-reveal stake slash");
        _updateReputation(arbitrator, false);
        emit NonRevealSlashed(disputeId, arbitrator, slashAmount);
    }

    /**
     * @notice Economically penalize a revealed vote that disagreed with the decision
     */
    function slashForIncorrectVote(uint256 disputeId, address arbitrator)
        external
        onlyRole(DISPUTE_MANAGER_ROLE)
        returns (uint256 slashAmount)
    {
        require(disputeAssignments[disputeId][arbitrator], "Assignment not found");
        if (incorrectVotePenalized[disputeId][arbitrator]) return 0;

        incorrectVotePenalized[disputeId][arbitrator] = true;
        slashAmount = _slashStake(arbitrator, INCORRECT_VOTE_SLASH_BPS, "Incorrect vote stake slash");
        _updateReputation(arbitrator, false);
        emit IncorrectVoteSlashed(disputeId, arbitrator, slashAmount);
    }

    /**
     * @notice Exclude an inconclusive round's panel from later rounds
     */
    function excludeArbitratorsForDispute(uint256 disputeId, address[] calldata panel)
        external
        onlyRole(DISPUTE_MANAGER_ROLE)
    {
        for (uint256 i = 0; i < panel.length;) {
            priorRoundExcluded[disputeId][panel[i]] = true;
            emit ArbitratorExcludedFromDispute(disputeId, panel[i]);
            unchecked { ++i; }
        }
    }

    /**
     * @notice Check if arbitrator is eligible to vote
     */
    function canVote(address arbitrator) public view returns (bool) {
        return _canVoteAt(arbitrator, block.timestamp);
    }

    function _canVoteAt(address arbitrator, uint256 timestamp) internal view returns (bool) {
        Arbitrator storage arb = arbitrators[arbitrator];

        if (!arb.isActive) return false;
        if (timestamp < arb.votingPowerActiveAt) return false;
        if (arb.reputation < MIN_REPUTATION) return false;
        if (activeAssignments[arbitrator] != 0) return false;
        if (timestamp < arb.lastVoteTime + VOTE_COOLDOWN) return false;

        // Check weekly limit
        uint256 disputesThisWeek = arb.disputesThisWeek;
        if (timestamp >= arb.weekStartTime + 7 days) {
            disputesThisWeek = 0;
        }
        if (disputesThisWeek >= MAX_DISPUTES_PER_WEEK) return false;

        return true;
    }

    /**
     * @notice Record game between players (for future exclusion)
     */
    function recordGame(address player1, address player2) external onlyRole(DISPUTE_MANAGER_ROLE) {
        lastGameWith[player1][player2] = block.timestamp;
        lastGameWith[player2][player1] = block.timestamp;
    }

    /**
     * @notice Check if arbitrator should be excluded from a dispute
     */
    function shouldExclude(address arbitrator, address player1, address player2) public view returns (bool) {
        return _shouldExclude(arbitrator, player1, player2, address(0));
    }

    function shouldExclude(
        address arbitrator,
        address player1,
        address player2,
        address extra
    ) public view returns (bool) {
        return _shouldExclude(arbitrator, player1, player2, extra);
    }

    function _shouldExclude(
        address arbitrator,
        address player1,
        address player2,
        address extra
    ) internal view returns (bool) {
        return _shouldExcludeAt(arbitrator, player1, player2, extra, block.timestamp);
    }

    function _shouldExcludeAt(
        address arbitrator,
        address player1,
        address player2,
        address extra,
        uint256 timestamp
    ) internal view returns (bool) {
        if (arbitrator == player1 || arbitrator == player2) return true;
        if (extra != address(0) && arbitrator == extra) return true;

        uint256 thirtyDaysAgo = timestamp > 30 days ? timestamp - 30 days : 0;
        if (lastGameWith[arbitrator][player1] > thirtyDaysAgo) return true;
        if (lastGameWith[arbitrator][player2] > thirtyDaysAgo) return true;
        if (extra != address(0) && lastGameWith[arbitrator][extra] > thirtyDaysAgo) return true;

        return false;
    }

    // Internal functions

    function _snapshotRequest(SelectionRequest memory request)
        internal
        pure
        returns (SnapshotRequest memory)
    {
        return SnapshotRequest({
            disputeId: request.disputeId,
            player1: request.player1,
            player2: request.player2,
            extraExcluded: request.extraExcluded,
            snapshotRound: request.snapshotRound,
            snapshotTimestamp: request.snapshotTimestamp,
            snapshotManager: request.snapshotManager
        });
    }

    function _buildSelectionSnapshot(SnapshotRequest memory request)
        internal
        view
        returns (SnapshotAccumulator memory snapshot)
    {
        bytes32 disputeContext = keccak256(
            abi.encode(
                request.snapshotManager,
                request.disputeId,
                request.snapshotRound,
                request.player1,
                request.player2,
                request.extraExcluded,
                request.snapshotTimestamp
            )
        );
        snapshot.fingerprint = keccak256(
            abi.encode(
                SELECTION_SNAPSHOT_DOMAIN,
                block.chainid,
                address(this),
                disputeContext,
                tier1Arbitrators.length,
                tier2Arbitrators.length,
                tier3Arbitrators.length
            )
        );

        snapshot = _scanTierSnapshot(tier1Arbitrators, request, snapshot, 1);
        snapshot = _scanTierSnapshot(tier2Arbitrators, request, snapshot, 2);
        snapshot = _scanTierSnapshot(tier3Arbitrators, request, snapshot, 3);
    }

    function _scanTierSnapshot(
        address[] storage pool,
        SnapshotRequest memory request,
        SnapshotAccumulator memory snapshot,
        uint256 tier
    ) internal view returns (SnapshotAccumulator memory) {
        for (uint256 poolIndex = 0; poolIndex < pool.length;) {
            address candidate = pool[poolIndex];
            snapshot.fingerprint = keccak256(
                abi.encode(
                    snapshot.fingerprint,
                    tier,
                    poolIndex,
                    candidate,
                    _candidatePositionFingerprint(candidate),
                    _candidateEligibilityFingerprint(candidate, request)
                )
            );

            if (_isSnapshotEligible(candidate, request)) {
                snapshot.eligibleCount++;
                snapshot.eligibleActiveStake += arbitrators[candidate].activatedStake;
            }

            unchecked { ++poolIndex; }
        }
        return snapshot;
    }

    function _candidatePositionFingerprint(address candidate) internal view returns (bytes32) {
        Arbitrator storage arb = arbitrators[candidate];
        // Pending top-ups are deliberately omitted: until activation they cannot
        // affect tier, eligibility, voting power, or panel active stake. Activation
        // changes activatedStake/stakedAt and therefore still invalidates the round.
        bytes32 stakeState = keccak256(
            abi.encode(
                arb.activatedStake,
                arb.stakedAt,
                arb.votingPowerActiveAt
            )
        );
        bytes32 activityState = keccak256(
            abi.encode(
                arb.reputation,
                arb.lastVoteTime,
                arb.disputesThisWeek,
                arb.weekStartTime,
                arb.isActive
            )
        );
        return keccak256(
            abi.encode(stakeState, activityState)
        );
    }

    function _candidateEligibilityFingerprint(
        address candidate,
        SnapshotRequest memory request
    ) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                activeAssignments[candidate],
                disputeAssignments[request.disputeId][candidate],
                nonRevealPenalized[request.disputeId][candidate],
                priorRoundExcluded[request.disputeId][candidate],
                lastGameWith[candidate][request.player1],
                lastGameWith[candidate][request.player2],
                lastGameWith[candidate][request.extraExcluded]
            )
        );
    }

    function _isSnapshotEligible(address candidate, SnapshotRequest memory request)
        internal
        view
        returns (bool)
    {
        return
            !_shouldExcludeAt(
                candidate,
                request.player1,
                request.player2,
                request.extraExcluded,
                request.snapshotTimestamp
            ) &&
            _canVoteAt(candidate, request.snapshotTimestamp) &&
            !disputeAssignments[request.disputeId][candidate] &&
            !nonRevealPenalized[request.disputeId][candidate] &&
            !priorRoundExcluded[request.disputeId][candidate];
    }

    function _getTier(uint256 amount) internal pure returns (uint8) {
        if (amount >= TIER3_MIN) return 3;
        if (amount >= TIER2_MIN) return 2;
        if (amount >= TIER1_MIN) return 1;
        return 0;
    }

    function _addToTierPool(address arbitrator, uint8 tier) internal {
        _requireTierCapacity(tier);
        if (tier == 1) {
            tier1Index[arbitrator] = tier1Arbitrators.length;
            tier1Arbitrators.push(arbitrator);
        } else if (tier == 2) {
            tier2Index[arbitrator] = tier2Arbitrators.length;
            tier2Arbitrators.push(arbitrator);
        } else if (tier == 3) {
            tier3Index[arbitrator] = tier3Arbitrators.length;
            tier3Arbitrators.push(arbitrator);
        }
    }

    function _requireTierCapacity(uint8 tier) internal view {
        require(_tierHasCapacity(tier), "Tier pool full");
    }

    function _tierHasCapacity(uint8 tier) internal view returns (bool) {
        if (tier == 1) return tier1Arbitrators.length < MAX_ARBITRATORS_PER_TIER_POOL;
        if (tier == 2) return tier2Arbitrators.length < MAX_ARBITRATORS_PER_TIER_POOL;
        if (tier == 3) return tier3Arbitrators.length < MAX_ARBITRATORS_PER_TIER_POOL;
        return false;
    }

    function _removeFromTierPool(address arbitrator, uint8 tier) internal {
        if (tier == 1) {
            _removeFromTier1(arbitrator);
        } else if (tier == 2) {
            _removeFromTier2(arbitrator);
        } else if (tier == 3) {
            _removeFromTier3(arbitrator);
        }
    }

    function _removeFromTier1(address arbitrator) internal {
        uint256 index = tier1Index[arbitrator];
        if (index < tier1Arbitrators.length && tier1Arbitrators[index] == arbitrator) {
            address lastArb = tier1Arbitrators[tier1Arbitrators.length - 1];
            tier1Arbitrators[index] = lastArb;
            tier1Index[lastArb] = index;
            tier1Arbitrators.pop();
            delete tier1Index[arbitrator];
        }
    }

    function _removeFromTier2(address arbitrator) internal {
        uint256 index = tier2Index[arbitrator];
        if (index < tier2Arbitrators.length && tier2Arbitrators[index] == arbitrator) {
            address lastArb = tier2Arbitrators[tier2Arbitrators.length - 1];
            tier2Arbitrators[index] = lastArb;
            tier2Index[lastArb] = index;
            tier2Arbitrators.pop();
            delete tier2Index[arbitrator];
        }
    }

    function _removeFromTier3(address arbitrator) internal {
        uint256 index = tier3Index[arbitrator];
        if (index < tier3Arbitrators.length && tier3Arbitrators[index] == arbitrator) {
            address lastArb = tier3Arbitrators[tier3Arbitrators.length - 1];
            tier3Arbitrators[index] = lastArb;
            tier3Index[lastArb] = index;
            tier3Arbitrators.pop();
            delete tier3Index[arbitrator];
        }
    }

    function _selectFromTier(
        address[] storage pool,
        SelectionRequest memory request,
        address[] memory selected,
        uint256 startIndex,
        uint256 salt
    ) internal returns (uint256) {
        if (pool.length == 0) return startIndex;

        // Choose the lowest candidate scores. Unlike rotating from an array index,
        // the result is independent of pool ordering: removing an unselected Sybil
        // cannot reshuffle the honest candidates after entropy becomes knowable.
        uint256 selectedFromTier = 0;
        uint256[] memory selectedScores = new uint256[](request.count);

        for (uint256 poolIndex = 0; poolIndex < pool.length;) {
            address candidate = pool[poolIndex];

            if (
                !_shouldExcludeAt(
                    candidate,
                    request.player1,
                    request.player2,
                    request.extraExcluded,
                    request.snapshotTimestamp
                ) &&
                _canVoteAt(candidate, request.snapshotTimestamp) &&
                !disputeAssignments[request.disputeId][candidate] &&
                !nonRevealPenalized[request.disputeId][candidate] &&
                !priorRoundExcluded[request.disputeId][candidate] &&
                !_isAlreadySelected(selected, startIndex, candidate)
            ) {
                uint256 score = uint256(keccak256(abi.encode(request.entropy, salt, candidate)));
                uint256 insertAt;

                if (selectedFromTier < request.count) {
                    insertAt = selectedFromTier;
                    selectedFromTier++;
                } else if (score < selectedScores[request.count - 1]) {
                    insertAt = request.count - 1;
                } else {
                    unchecked { ++poolIndex; }
                    continue;
                }

                while (insertAt > 0 && score < selectedScores[insertAt - 1]) {
                    selectedScores[insertAt] = selectedScores[insertAt - 1];
                    selected[startIndex + insertAt] = selected[startIndex + insertAt - 1];
                    insertAt--;
                }

                selectedScores[insertAt] = score;
                selected[startIndex + insertAt] = candidate;
            }

            unchecked { ++poolIndex; }
        }

        for (uint256 i = 0; i < selectedFromTier;) {
            address arbitrator = selected[startIndex + i];
            disputeAssignments[request.disputeId][arbitrator] = true;
            _reserveAssignment(request.disputeId, arbitrator, request.snapshotTimestamp);
            emit ArbitratorSelected(request.disputeId, arbitrator);
            unchecked { ++i; }
        }

        return startIndex + selectedFromTier;
    }

    function _isAlreadySelected(
        address[] memory selected,
        uint256 selectedCount,
        address candidate
    ) internal pure returns (bool) {
        for (uint256 i = 0; i < selectedCount; i++) {
            if (selected[i] == candidate) {
                return true;
            }
        }
        return false;
    }

    function _reserveAssignment(
        uint256 disputeId,
        address arbitrator,
        uint256 snapshotTimestamp
    ) internal {
        Arbitrator storage arb = arbitrators[arbitrator];
        require(activeAssignments[arbitrator] == 0, "Already assigned");

        if (block.timestamp >= arb.weekStartTime + 7 days) {
            arb.disputesThisWeek = 0;
            arb.weekStartTime = block.timestamp;
        }

        require(arb.disputesThisWeek < MAX_DISPUTES_PER_WEEK, "Weekly dispute limit reached");

        activeAssignments[arbitrator] = 1;
        arb.disputesThisWeek++;
        arb.lastVoteTime = block.timestamp;

        emit AssignmentReserved(
            disputeId,
            arbitrator,
            _getVotingPowerAt(arb, snapshotTimestamp),
            arb.disputesThisWeek
        );
    }

    function _slashStake(
        address arbitrator,
        uint256 slashBps,
        string memory removalReason
    ) internal returns (uint256 slashAmount) {
        Arbitrator storage arb = arbitrators[arbitrator];
        uint8 oldTier = _getTier(arb.activatedStake);

        slashAmount = (arb.activatedStake * slashBps) / BPS_DENOMINATOR;
        if (slashAmount == 0 && arb.activatedStake > 0) slashAmount = 1;
        if (slashAmount > arb.activatedStake) slashAmount = arb.activatedStake;
        if (slashAmount == 0) return 0;

        arb.stakedAmount -= slashAmount;
        arb.activatedStake -= slashAmount;
        totalStaked -= slashAmount;

        uint8 newTier = _getTier(arb.activatedStake);
        if (arb.isActive && oldTier != newTier) {
            _removeFromTierPool(arbitrator, oldTier);
            if (newTier > 0 && _tierHasCapacity(newTier)) {
                _addToTierPool(arbitrator, newTier);
            } else {
                arb.isActive = false;
                totalArbitrators--;
                emit ArbitratorRemoved(
                    arbitrator,
                    newTier == 0 ? removalReason : "Destination tier full"
                );
            }
        }

        if (arb.isActive && newTier == 0) {
            arb.isActive = false;
            totalArbitrators--;
            emit ArbitratorRemoved(arbitrator, removalReason);
        }

        chessToken.burn(slashAmount);
    }

    function _updateReputation(address arbitrator, bool votedWithMajority) internal {
        Arbitrator storage arb = arbitrators[arbitrator];
        if (arb.reputation == 0) return;

        uint256 oldRep = arb.reputation;
        if (votedWithMajority) {
            if (arb.reputation < 200) arb.reputation++;
        } else if (arb.reputation > 1) {
            arb.reputation--;
        }

        if (arb.isActive && arb.reputation < MIN_REPUTATION) {
            uint8 tier = _getTier(arb.activatedStake);
            _removeFromTierPool(arbitrator, tier);
            arb.isActive = false;
            totalArbitrators--;
            emit ArbitratorRemoved(arbitrator, "Reputation too low");
        }

        emit ReputationUpdated(arbitrator, oldRep, arb.reputation);
    }

    // View functions

    function getArbitratorInfo(address arbitrator) external view returns (
        uint256 stakedAmount,
        uint256 votingPower,
        uint256 reputation,
        uint8 tier,
        bool isActive,
        bool canVoteNow
    ) {
        Arbitrator storage arb = arbitrators[arbitrator];
        stakedAmount = arb.stakedAmount;
        votingPower = getVotingPower(arbitrator);
        reputation = arb.reputation;
        tier = _getTier(arb.activatedStake);
        isActive = arb.isActive;
        canVoteNow = canVote(arbitrator);
    }

    /**
     * @notice Return active stake locked by an assignment
     * @dev Legacy ABI name. Only explicit penalty percentages are objectively slashable;
     *      a subjective majority verdict cannot be proven incorrect without appeal/oracle.
     */
    function getSlashableStake(address arbitrator)
        external
        view
        returns (uint256 panelActiveStake)
    {
        return arbitrators[arbitrator].activatedStake;
    }

    function getPendingStake(address arbitrator) external view returns (
        uint256 amount,
        uint256 availableAt
    ) {
        Arbitrator storage arb = arbitrators[arbitrator];
        return (arb.pendingStake, arb.pendingStakeAvailableAt);
    }

    function getTierCounts() external view returns (uint256 t1, uint256 t2, uint256 t3) {
        t1 = tier1Arbitrators.length;
        t2 = tier2Arbitrators.length;
        t3 = tier3Arbitrators.length;
    }
}
