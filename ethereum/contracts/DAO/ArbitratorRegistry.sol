// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

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
 * - Cooldown after voting to prevent collusion
 * - Random selection weighted by stake
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

    struct Arbitrator {
        uint256 stakedAmount;
        uint256 stakedAt;
        uint256 votingPowerActiveAt;
        uint256 reputation;
        uint256 lastVoteTime;
        uint256 disputesThisWeek;
        uint256 weekStartTime;
        bool isActive;
    }

    mapping(address => Arbitrator) public arbitrators;

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
    event ArbitratorUnstaked(address indexed arbitrator, uint256 amount);
    event ReputationUpdated(address indexed arbitrator, uint256 oldRep, uint256 newRep);
    event ArbitratorRemoved(address indexed arbitrator, string reason);
    event ArbitratorSelected(uint256 indexed disputeId, address indexed arbitrator);

    constructor(address _chessToken) {
        require(_chessToken != address(0), "Invalid token");
        chessToken = ChessToken(_chessToken);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    /**
     * @notice Stake CHESS to become an arbitrator
     * @param amount Amount of CHESS to stake
     */
    function stake(uint256 amount) external nonReentrant {
        require(amount >= TIER1_MIN, "Minimum stake not met");

        Arbitrator storage arb = arbitrators[msg.sender];

        // Transfer tokens
        require(chessToken.transferFrom(msg.sender, address(this), amount), "Transfer failed");

        if (!arb.isActive) {
            // New arbitrator
            arb.stakedAt = block.timestamp;
            arb.votingPowerActiveAt = block.timestamp + VOTING_POWER_DELAY;
            arb.reputation = INITIAL_REPUTATION;
            arb.weekStartTime = block.timestamp;
            arb.isActive = true;
            totalArbitrators++;
        }

        uint8 oldTier = _getTier(arb.stakedAmount);
        arb.stakedAmount += amount;
        totalStaked += amount;
        uint8 newTier = _getTier(arb.stakedAmount);

        // Update tier pools
        if (oldTier != newTier) {
            _removeFromTierPool(msg.sender, oldTier);
            _addToTierPool(msg.sender, newTier);
        } else if (oldTier == 0 && newTier > 0) {
            _addToTierPool(msg.sender, newTier);
        }

        emit ArbitratorRegistered(msg.sender, arb.stakedAmount, newTier);
    }

    /**
     * @notice Unstake CHESS (partial or full)
     * @param amount Amount to unstake
     */
    function unstake(uint256 amount) external nonReentrant {
        Arbitrator storage arb = arbitrators[msg.sender];
        require(arb.isActive, "Not an arbitrator");
        require(amount <= arb.stakedAmount, "Insufficient stake");

        // Check if in cooldown (can't unstake during active disputes)
        require(block.timestamp >= arb.lastVoteTime + VOTE_COOLDOWN, "In cooldown");

        uint8 oldTier = _getTier(arb.stakedAmount);
        arb.stakedAmount -= amount;
        totalStaked -= amount;
        uint8 newTier = _getTier(arb.stakedAmount);

        // Update tier pools
        if (oldTier != newTier) {
            _removeFromTierPool(msg.sender, oldTier);
            if (newTier > 0) {
                _addToTierPool(msg.sender, newTier);
            }
        }

        // If stake falls below minimum, deactivate
        if (arb.stakedAmount < TIER1_MIN) {
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

        if (!arb.isActive) return 0;
        if (block.timestamp < arb.votingPowerActiveAt) return 0;
        if (arb.reputation < MIN_REPUTATION) return 0;

        // Base voting power = stake
        // Time bonus: up to 2x after 1 year
        uint256 timeStaked = block.timestamp - arb.stakedAt;
        uint256 timeBonus = timeStaked > 365 days ? 100 : (timeStaked * 100) / 365 days;

        return arb.stakedAmount * (100 + timeBonus) / 100;
    }

    /**
     * @notice Select arbitrators for a dispute
     * @param disputeId Dispute identifier
     * @param player1 First player (to exclude)
     * @param player2 Second player (to exclude)
     * @param count Number of arbitrators per tier
     * @return selected Array of selected arbitrator addresses
     */
    function selectArbitrators(
        uint256 disputeId,
        address player1,
        address player2,
        uint256 count
    ) external onlyRole(DISPUTE_MANAGER_ROLE) returns (address[] memory selected) {
        require(count > 0, "Count must be > 0");

        uint256 totalSelected = count * 3; // From all 3 tiers
        selected = new address[](totalSelected);
        uint256 selectedCount = 0;

        // Select from each tier
        selectedCount = _selectFromTier(
            tier1Arbitrators, disputeId, player1, player2, count, selected, selectedCount
        );
        selectedCount = _selectFromTier(
            tier2Arbitrators, disputeId, player1, player2, count, selected, selectedCount
        );
        selectedCount = _selectFromTier(
            tier3Arbitrators, disputeId, player1, player2, count, selected, selectedCount
        );

        // Resize array if we couldn't fill all slots
        if (selectedCount < totalSelected) {
            address[] memory resized = new address[](selectedCount);
            for (uint256 i = 0; i < selectedCount; i++) {
                resized[i] = selected[i];
            }
            return resized;
        }

        return selected;
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
        Arbitrator storage arb = arbitrators[arbitrator];
        require(arb.isActive, "Not active");

        uint256 oldRep = arb.reputation;

        if (votedWithMajority) {
            arb.reputation += 1;
            if (arb.reputation > 200) arb.reputation = 200; // Cap
        } else {
            if (arb.reputation > 1) {
                arb.reputation -= 1;
            }
        }

        // Remove if reputation too low
        if (arb.reputation < MIN_REPUTATION) {
            uint8 tier = _getTier(arb.stakedAmount);
            _removeFromTierPool(arbitrator, tier);
            arb.isActive = false;
            totalArbitrators--;
            emit ArbitratorRemoved(arbitrator, "Reputation too low");
        }

        emit ReputationUpdated(arbitrator, oldRep, arb.reputation);
    }

    /**
     * @notice Record that arbitrator voted (for cooldown)
     */
    function recordVote(address arbitrator) external onlyRole(DISPUTE_MANAGER_ROLE) {
        Arbitrator storage arb = arbitrators[arbitrator];

        // Reset weekly counter if new week
        if (block.timestamp >= arb.weekStartTime + 7 days) {
            arb.disputesThisWeek = 0;
            arb.weekStartTime = block.timestamp;
        }

        arb.lastVoteTime = block.timestamp;
        arb.disputesThisWeek++;
    }

    /**
     * @notice Check if arbitrator is eligible to vote
     */
    function canVote(address arbitrator) public view returns (bool) {
        Arbitrator storage arb = arbitrators[arbitrator];

        if (!arb.isActive) return false;
        if (block.timestamp < arb.votingPowerActiveAt) return false;
        if (arb.reputation < MIN_REPUTATION) return false;
        if (block.timestamp < arb.lastVoteTime + VOTE_COOLDOWN) return false;

        // Check weekly limit
        uint256 disputesThisWeek = arb.disputesThisWeek;
        if (block.timestamp >= arb.weekStartTime + 7 days) {
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
        // Exclude if arbitrator is one of the players
        if (arbitrator == player1 || arbitrator == player2) return true;

        // Exclude if played against either player in last 30 days
        uint256 thirtyDaysAgo = block.timestamp - 30 days;
        if (lastGameWith[arbitrator][player1] > thirtyDaysAgo) return true;
        if (lastGameWith[arbitrator][player2] > thirtyDaysAgo) return true;

        return false;
    }

    // Internal functions

    function _getTier(uint256 amount) internal pure returns (uint8) {
        if (amount >= TIER3_MIN) return 3;
        if (amount >= TIER2_MIN) return 2;
        if (amount >= TIER1_MIN) return 1;
        return 0;
    }

    function _addToTierPool(address arbitrator, uint8 tier) internal {
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
        uint256 disputeId,
        address player1,
        address player2,
        uint256 count,
        address[] memory selected,
        uint256 startIndex
    ) internal returns (uint256) {
        if (pool.length == 0) return startIndex;

        uint256 selectedFromTier = 0;
        uint256 attempts = 0;
        uint256 maxAttempts = pool.length * 2;

        while (selectedFromTier < count && attempts < maxAttempts) {
            // Pseudo-random selection (in production use VRF)
            uint256 randomIndex = uint256(keccak256(abi.encodePacked(
                disputeId, block.timestamp, attempts, pool.length
            ))) % pool.length;

            address candidate = pool[randomIndex];
            attempts++;

            // Check exclusions
            if (shouldExclude(candidate, player1, player2)) continue;
            if (!canVote(candidate)) continue;

            // Check not already selected
            bool alreadySelected = false;
            for (uint256 i = 0; i < startIndex + selectedFromTier; i++) {
                if (selected[i] == candidate) {
                    alreadySelected = true;
                    break;
                }
            }
            if (alreadySelected) continue;

            selected[startIndex + selectedFromTier] = candidate;
            selectedFromTier++;

            emit ArbitratorSelected(disputeId, candidate);
        }

        return startIndex + selectedFromTier;
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
        tier = _getTier(arb.stakedAmount);
        isActive = arb.isActive;
        canVoteNow = canVote(arbitrator);
    }

    function getTierCounts() external view returns (uint256 t1, uint256 t2, uint256 t3) {
        t1 = tier1Arbitrators.length;
        t2 = tier2Arbitrators.length;
        t3 = tier3Arbitrators.length;
    }
}
