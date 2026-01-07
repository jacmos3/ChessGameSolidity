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
    uint256 public quorum = 10;           // Minimum votes required
    uint256 public supermajority = 66;    // 66% for decision
    uint256 public challengeDeposit = 50 * 10**18; // 50 CHESS

    // Vote options
    enum Vote { None, Legit, Cheat, Abstain }

    // Dispute states
    enum DisputeState {
        None,
        Pending,        // Challenge window open
        Challenged,     // In commit phase
        Revealing,      // In reveal phase
        Resolved,       // Decision made
        Escalated       // Needs higher-level review
    }

    struct Dispute {
        uint256 gameId;
        address challenger;
        address accusedPlayer;
        address otherPlayer;
        uint256 gameStake;

        DisputeState state;

        uint256 registeredAt;      // When game was registered (start of challenge window)
        uint256 challengedAt;
        uint256 commitDeadline;
        uint256 revealDeadline;

        uint256 legitVotes;
        uint256 cheatVotes;
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

    // Storage
    mapping(uint256 => Dispute) public disputes;      // disputeId => Dispute
    mapping(uint256 => mapping(address => VoteCommit)) public votes; // disputeId => arbitrator => vote
    mapping(uint256 => uint256) public gameToDispute; // gameId => disputeId
    mapping(address => uint256) public activeChallenges; // challenger => count

    uint256 public disputeCounter;
    uint256 public constant MAX_ACTIVE_CHALLENGES = 3;

    // Events
    event GameRegistered(uint256 indexed gameId, address white, address black, uint256 stake);
    event DisputeCreated(uint256 indexed disputeId, uint256 indexed gameId, address challenger, address accused);
    event VoteCommitted(uint256 indexed disputeId, address indexed arbitrator);
    event VoteRevealed(uint256 indexed disputeId, address indexed arbitrator, Vote vote);
    event DisputeResolved(uint256 indexed disputeId, Vote decision, uint256 legitVotes, uint256 cheatVotes);
    event DisputeEscalated(uint256 indexed disputeId, uint256 newLevel);
    event ChallengeWindowClosed(uint256 indexed gameId);
    event RewardDistributed(uint256 indexed disputeId, address indexed recipient, uint256 amount);

    constructor(
        address _chessToken,
        address _bondingManager,
        address _arbitratorRegistry
    ) {
        require(_chessToken != address(0), "Invalid token");
        require(_bondingManager != address(0), "Invalid bonding manager");
        require(_arbitratorRegistry != address(0), "Invalid arbitrator registry");

        chessToken = ChessToken(_chessToken);
        bondingManager = BondingManager(payable(_bondingManager));
        arbitratorRegistry = ArbitratorRegistry(_arbitratorRegistry);

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
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

        disputeCounter++;
        uint256 disputeId = disputeCounter;

        disputes[disputeId] = Dispute({
            gameId: gameId,
            challenger: address(0),
            accusedPlayer: address(0),
            otherPlayer: address(0),
            gameStake: stake,
            state: DisputeState.Pending,
            registeredAt: block.timestamp,  // Track when challenge window opens
            challengedAt: 0,
            commitDeadline: 0,
            revealDeadline: 0,
            legitVotes: 0,
            cheatVotes: 0,
            abstainVotes: 0,
            finalDecision: Vote.None,
            resolved: false,
            selectedArbitrators: new address[](0),
            escalationLevel: 0
        });

        gameToDispute[gameId] = disputeId;

        // Record game in arbitrator registry for exclusion tracking
        arbitratorRegistry.recordGame(white, black);

        emit GameRegistered(gameId, white, black, stake);
    }

    /**
     * @notice Challenge a game (accuse player of cheating)
     * @param gameId Game to challenge
     * @param accusedPlayer Player being accused
     */
    function challenge(uint256 gameId, address accusedPlayer) external nonReentrant {
        uint256 disputeId = gameToDispute[gameId];
        require(disputeId != 0, "Game not registered");

        Dispute storage dispute = disputes[disputeId];
        require(dispute.state == DisputeState.Pending, "Not in challenge window");
        require(activeChallenges[msg.sender] < MAX_ACTIVE_CHALLENGES, "Too many active challenges");

        // Enforce challenge window (48 hours from registration)
        require(
            block.timestamp <= dispute.registeredAt + challengeWindow,
            "Challenge window expired"
        );

        // Transfer challenge deposit (using SafeERC20)
        chessToken.safeTransferFrom(msg.sender, address(this), challengeDeposit);

        dispute.challenger = msg.sender;
        dispute.accusedPlayer = accusedPlayer;
        dispute.state = DisputeState.Challenged;
        dispute.challengedAt = block.timestamp;
        dispute.commitDeadline = block.timestamp + commitPeriod;
        dispute.revealDeadline = block.timestamp + commitPeriod + revealPeriod;

        activeChallenges[msg.sender]++;

        // Select arbitrators (5 from each tier = 15 total)
        address[] memory arbitrators = arbitratorRegistry.selectArbitrators(
            disputeId,
            accusedPlayer,
            dispute.otherPlayer,
            5
        );
        dispute.selectedArbitrators = arbitrators;

        emit DisputeCreated(disputeId, gameId, msg.sender, accusedPlayer);
    }

    /**
     * @notice Commit a vote (hash of vote + salt)
     * @param disputeId Dispute identifier
     * @param commitHash keccak256(abi.encodePacked(vote, salt, msg.sender))
     */
    function commitVote(uint256 disputeId, bytes32 commitHash) external {
        Dispute storage dispute = disputes[disputeId];
        require(dispute.state == DisputeState.Challenged, "Not in commit phase");
        require(block.timestamp <= dispute.commitDeadline, "Commit period ended");
        require(_isSelectedArbitrator(disputeId, msg.sender), "Not selected arbitrator");
        require(votes[disputeId][msg.sender].commitHash == bytes32(0), "Already committed");

        votes[disputeId][msg.sender].commitHash = commitHash;

        emit VoteCommitted(disputeId, msg.sender);
    }

    /**
     * @notice Reveal a previously committed vote
     * @param disputeId Dispute identifier
     * @param vote The vote (1=Legit, 2=Cheat, 3=Abstain)
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
        bytes32 expectedHash = keccak256(abi.encodePacked(vote, salt, msg.sender));
        require(expectedHash == voteCommit.commitHash, "Hash mismatch");

        voteCommit.revealed = true;
        voteCommit.vote = vote;

        // Count vote
        if (vote == Vote.Legit) {
            dispute.legitVotes++;
        } else if (vote == Vote.Cheat) {
            dispute.cheatVotes++;
        } else if (vote == Vote.Abstain) {
            dispute.abstainVotes++;
        }

        // Record vote in registry (for cooldown)
        arbitratorRegistry.recordVote(msg.sender);

        emit VoteRevealed(disputeId, msg.sender, vote);
    }

    /**
     * @notice Resolve dispute after reveal period
     * @param disputeId Dispute identifier
     */
    function resolveDispute(uint256 disputeId) external nonReentrant {
        Dispute storage dispute = disputes[disputeId];
        require(
            dispute.state == DisputeState.Revealing ||
            (dispute.state == DisputeState.Challenged && block.timestamp > dispute.commitDeadline),
            "Cannot resolve yet"
        );
        require(block.timestamp > dispute.revealDeadline, "Reveal period not ended");
        require(!dispute.resolved, "Already resolved");

        uint256 totalVotes = dispute.legitVotes + dispute.cheatVotes;

        // Check quorum
        if (totalVotes < quorum) {
            // Not enough votes - escalate or return deposits
            _escalate(disputeId);
            return;
        }

        // Check for supermajority
        uint256 legitPercent = (dispute.legitVotes * 100) / totalVotes;
        uint256 cheatPercent = (dispute.cheatVotes * 100) / totalVotes;

        if (cheatPercent >= supermajority) {
            // CHEAT: Accused is guilty
            dispute.finalDecision = Vote.Cheat;
            _handleCheatDecision(disputeId);
        } else if (legitPercent >= supermajority) {
            // LEGIT: Accused is innocent
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

        emit DisputeResolved(disputeId, dispute.finalDecision, dispute.legitVotes, dispute.cheatVotes);
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
            block.timestamp > dispute.registeredAt + challengeWindow,
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

        return block.timestamp <= dispute.registeredAt + challengeWindow;
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

        uint256 deadline = dispute.registeredAt + challengeWindow;
        if (block.timestamp >= deadline) return 0;

        return deadline - block.timestamp;
    }

    // Internal functions

    function _handleCheatDecision(uint256 disputeId) internal {
        Dispute storage dispute = disputes[disputeId];

        // Slash cheater's bond (burned)
        bondingManager.slashBond(dispute.gameId, dispute.accusedPlayer);

        // Return challenge deposit + reward to challenger (using SafeERC20)
        uint256 challengerReward = challengeDeposit + (challengeDeposit / 2); // 150% back
        uint256 balance = chessToken.balanceOf(address(this));
        if (balance >= challengerReward) {
            chessToken.safeTransfer(dispute.challenger, challengerReward);
            emit RewardDistributed(disputeId, dispute.challenger, challengerReward);
        } else if (balance > 0) {
            // Transfer whatever is available
            chessToken.safeTransfer(dispute.challenger, balance);
            emit RewardDistributed(disputeId, dispute.challenger, balance);
        }
    }

    function _handleLegitDecision(uint256 disputeId) internal {
        Dispute storage dispute = disputes[disputeId];

        // Challenger loses deposit
        // 50% to accused (compensation) - using SafeERC20
        uint256 accusedCompensation = challengeDeposit / 2;
        chessToken.safeTransfer(dispute.accusedPlayer, accusedCompensation);
        emit RewardDistributed(disputeId, dispute.accusedPlayer, accusedCompensation);

        // 50% burned (deflationary)
        uint256 remaining = challengeDeposit - accusedCompensation;
        chessToken.burn(remaining);
    }

    function _escalate(uint256 disputeId) internal {
        Dispute storage dispute = disputes[disputeId];
        dispute.escalationLevel++;

        if (dispute.escalationLevel >= 3) {
            // Max escalation reached - return deposits, no penalty (using SafeERC20)
            dispute.resolved = true;
            dispute.state = DisputeState.Resolved;
            chessToken.safeTransfer(dispute.challenger, challengeDeposit);
            activeChallenges[dispute.challenger]--;
            return;
        }

        // Reset for new round with more arbitrators
        dispute.state = DisputeState.Challenged;
        dispute.legitVotes = 0;
        dispute.cheatVotes = 0;
        dispute.abstainVotes = 0;
        dispute.commitDeadline = block.timestamp + commitPeriod;
        dispute.revealDeadline = block.timestamp + commitPeriod + revealPeriod;

        // Select new arbitrators (more this time)
        uint256 newCount = 5 + (dispute.escalationLevel * 2); // 7, 9...
        address[] memory newArbitrators = arbitratorRegistry.selectArbitrators(
            disputeId,
            dispute.accusedPlayer,
            dispute.otherPlayer,
            newCount
        );
        dispute.selectedArbitrators = newArbitrators;

        emit DisputeEscalated(disputeId, dispute.escalationLevel);
    }

    function _updateArbitratorReputations(uint256 disputeId) internal {
        Dispute storage dispute = disputes[disputeId];

        for (uint256 i = 0; i < dispute.selectedArbitrators.length; i++) {
            address arbitrator = dispute.selectedArbitrators[i];
            VoteCommit storage voteCommit = votes[disputeId][arbitrator];

            if (!voteCommit.revealed) {
                // Didn't reveal - penalty
                arbitratorRegistry.updateReputation(arbitrator, false);
                continue;
            }

            // Check if voted with majority
            bool votedWithMajority = (
                (dispute.finalDecision == Vote.Cheat && voteCommit.vote == Vote.Cheat) ||
                (dispute.finalDecision == Vote.Legit && voteCommit.vote == Vote.Legit)
            );

            arbitratorRegistry.updateReputation(arbitrator, votedWithMajority);
        }
    }

    function _isSelectedArbitrator(uint256 disputeId, address arbitrator) internal view returns (bool) {
        address[] storage selected = disputes[disputeId].selectedArbitrators;
        for (uint256 i = 0; i < selected.length; i++) {
            if (selected[i] == arbitrator) return true;
        }
        return false;
    }

    // View functions

    function getDispute(uint256 disputeId) external view returns (
        uint256 gameId,
        address challenger,
        address accusedPlayer,
        DisputeState state,
        uint256 legitVotes,
        uint256 cheatVotes,
        Vote finalDecision,
        uint256 escalationLevel
    ) {
        Dispute storage d = disputes[disputeId];
        return (
            d.gameId,
            d.challenger,
            d.accusedPlayer,
            d.state,
            d.legitVotes,
            d.cheatVotes,
            d.finalDecision,
            d.escalationLevel
        );
    }

    function getSelectedArbitrators(uint256 disputeId) external view returns (address[] memory) {
        return disputes[disputeId].selectedArbitrators;
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
        uint256 _quorum,
        uint256 _supermajority,
        uint256 _challengeDeposit
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_challengeWindow >= 1 hours && _challengeWindow <= 7 days, "Invalid challenge window");
        require(_commitPeriod >= 1 hours && _commitPeriod <= 7 days, "Invalid commit period");
        require(_revealPeriod >= 1 hours && _revealPeriod <= 7 days, "Invalid reveal period");
        require(_quorum >= 3 && _quorum <= 100, "Invalid quorum");
        require(_supermajority >= 51 && _supermajority <= 100, "Invalid supermajority");
        require(_challengeDeposit >= 1 * 10**18, "Challenge deposit too low");

        challengeWindow = _challengeWindow;
        commitPeriod = _commitPeriod;
        revealPeriod = _revealPeriod;
        quorum = _quorum;
        supermajority = _supermajority;
        challengeDeposit = _challengeDeposit;
    }
}
