// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title ChessToken
 * @notice ERC20 token for the Chess platform with controlled minting
 * @dev Uses AccessControl for role-based minting permissions
 *      Includes ERC20Votes for governance delegation
 *
 * Token Utility:
 * - BONDING: Deposit to play games (skin in the game)
 * - STAKING: Stake to become an arbitrator
 * - CHALLENGE: Deposit to open disputes
 * - GOVERNANCE: Vote on protocol parameters (via delegation)
 */
contract ChessToken is ERC20, ERC20Burnable, ERC20Votes, ERC20Permit, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    uint256 public constant MAX_SUPPLY = 100_000_000 * 10**18; // 100M tokens

    // Distribution tracking
    uint256 public playToEarnMinted;     // 40% = 40M
    uint256 public treasuryMinted;        // 25% = 25M
    uint256 public teamMinted;            // 15% = 15M
    uint256 public liquidityMinted;       // 10% = 10M
    uint256 public communityMinted;       // 10% = 10M

    uint256 public constant PLAY_TO_EARN_CAP = 40_000_000 * 10**18;
    uint256 public constant TREASURY_CAP = 25_000_000 * 10**18;
    uint256 public constant TEAM_CAP = 15_000_000 * 10**18;
    uint256 public constant LIQUIDITY_CAP = 10_000_000 * 10**18;
    uint256 public constant COMMUNITY_CAP = 10_000_000 * 10**18;

    // Team vesting
    uint256 public teamVestingStart;
    uint256 public constant TEAM_VESTING_DURATION = 730 days; // 2 years
    uint256 public teamVestingClaimed;
    address public teamWallet;

    // Team wallet change timelock (2-step process with 48h delay)
    address public pendingTeamWallet;
    uint256 public teamWalletChangeInitiated;
    uint256 public constant TEAM_WALLET_TIMELOCK = 48 hours;

    event PlayToEarnMinted(address indexed to, uint256 amount);
    event TreasuryMinted(address indexed to, uint256 amount);
    event TeamVestingClaimed(address indexed to, uint256 amount);
    event LiquidityMinted(address indexed to, uint256 amount);
    event CommunityMinted(address indexed to, uint256 amount);
    event TeamWalletChangeProposed(address indexed currentWallet, address indexed newWallet, uint256 effectiveTime);
    event TeamWalletChangeCancelled(address indexed cancelledWallet);
    event TeamWalletChanged(address indexed oldWallet, address indexed newWallet);

    constructor(address _teamWallet, address _treasury)
        ERC20("Chess Token", "CHESS")
        ERC20Permit("Chess Token")
    {
        require(_teamWallet != address(0), "Invalid team wallet");
        require(_treasury != address(0), "Invalid treasury");

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);

        teamWallet = _teamWallet;
        teamVestingStart = block.timestamp;

        // Initial mints for liquidity and community
        _mintLiquidity(_treasury, LIQUIDITY_CAP);
        _mintCommunity(_treasury, COMMUNITY_CAP);
    }

    /**
     * @notice Mint tokens for play-to-earn rewards
     * @param to Recipient address
     * @param amount Amount to mint
     */
    function mintPlayToEarn(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        require(playToEarnMinted + amount <= PLAY_TO_EARN_CAP, "Play-to-earn cap exceeded");
        playToEarnMinted += amount;
        _mint(to, amount);
        emit PlayToEarnMinted(to, amount);
    }

    /**
     * @notice Mint tokens to treasury
     * @param to Recipient address
     * @param amount Amount to mint
     */
    function mintTreasury(address to, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(treasuryMinted + amount <= TREASURY_CAP, "Treasury cap exceeded");
        treasuryMinted += amount;
        _mint(to, amount);
        emit TreasuryMinted(to, amount);
    }

    /**
     * @notice Claim vested team tokens
     * @dev Linear vesting over 2 years
     */
    function claimTeamVesting() external {
        require(msg.sender == teamWallet, "Only team wallet");

        uint256 elapsed = block.timestamp - teamVestingStart;
        if (elapsed > TEAM_VESTING_DURATION) {
            elapsed = TEAM_VESTING_DURATION;
        }

        uint256 totalVested = (TEAM_CAP * elapsed) / TEAM_VESTING_DURATION;
        uint256 claimable = totalVested - teamVestingClaimed;

        require(claimable > 0, "Nothing to claim");

        teamVestingClaimed += claimable;
        teamMinted += claimable;
        _mint(teamWallet, claimable);

        emit TeamVestingClaimed(teamWallet, claimable);
    }

    /**
     * @notice Get claimable team vesting amount
     */
    function getClaimableTeamVesting() external view returns (uint256) {
        uint256 elapsed = block.timestamp - teamVestingStart;
        if (elapsed > TEAM_VESTING_DURATION) {
            elapsed = TEAM_VESTING_DURATION;
        }

        uint256 totalVested = (TEAM_CAP * elapsed) / TEAM_VESTING_DURATION;
        return totalVested - teamVestingClaimed;
    }

    /**
     * @notice Propose a new team wallet address (starts 48h timelock)
     * @param newTeamWallet New team wallet address
     */
    function proposeTeamWallet(address newTeamWallet) external {
        require(msg.sender == teamWallet, "Only team wallet");
        require(newTeamWallet != address(0), "Invalid address");
        require(newTeamWallet != teamWallet, "Same as current");

        pendingTeamWallet = newTeamWallet;
        teamWalletChangeInitiated = block.timestamp;

        emit TeamWalletChangeProposed(teamWallet, newTeamWallet, block.timestamp + TEAM_WALLET_TIMELOCK);
    }

    /**
     * @notice Accept the pending team wallet change (after 48h timelock)
     * @dev Can be called by either current or pending team wallet
     */
    function acceptTeamWalletChange() external {
        require(pendingTeamWallet != address(0), "No pending change");
        require(
            msg.sender == teamWallet || msg.sender == pendingTeamWallet,
            "Not authorized"
        );
        require(
            block.timestamp >= teamWalletChangeInitiated + TEAM_WALLET_TIMELOCK,
            "Timelock not expired"
        );

        address oldWallet = teamWallet;
        teamWallet = pendingTeamWallet;
        pendingTeamWallet = address(0);
        teamWalletChangeInitiated = 0;

        emit TeamWalletChanged(oldWallet, teamWallet);
    }

    /**
     * @notice Cancel a pending team wallet change
     */
    function cancelTeamWalletChange() external {
        require(msg.sender == teamWallet, "Only team wallet");
        require(pendingTeamWallet != address(0), "No pending change");

        address cancelled = pendingTeamWallet;
        pendingTeamWallet = address(0);
        teamWalletChangeInitiated = 0;

        emit TeamWalletChangeCancelled(cancelled);
    }

    /**
     * @notice Get time remaining before team wallet change can be accepted
     * @return Seconds remaining (0 if no pending change or already acceptable)
     */
    function getTeamWalletTimelockRemaining() external view returns (uint256) {
        if (pendingTeamWallet == address(0)) return 0;

        uint256 unlockTime = teamWalletChangeInitiated + TEAM_WALLET_TIMELOCK;
        if (block.timestamp >= unlockTime) return 0;

        return unlockTime - block.timestamp;
    }

    /**
     * @notice Add minter role to an address (e.g., BondingManager)
     * @param minter Address to grant minter role
     */
    function addMinter(address minter) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _grantRole(MINTER_ROLE, minter);
    }

    /**
     * @notice Remove minter role from an address
     * @param minter Address to revoke minter role
     */
    function removeMinter(address minter) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(MINTER_ROLE, minter);
    }

    // Internal mint functions for initial distribution
    function _mintLiquidity(address to, uint256 amount) internal {
        liquidityMinted += amount;
        _mint(to, amount);
        emit LiquidityMinted(to, amount);
    }

    function _mintCommunity(address to, uint256 amount) internal {
        communityMinted += amount;
        _mint(to, amount);
        emit CommunityMinted(to, amount);
    }

    /**
     * @notice Get total minted across all categories
     */
    function totalMinted() external view returns (uint256) {
        return playToEarnMinted + treasuryMinted + teamMinted + liquidityMinted + communityMinted;
    }

    /**
     * @notice Check remaining mintable for each category
     */
    function remainingMintable() external view returns (
        uint256 playToEarn,
        uint256 treasury,
        uint256 team,
        uint256 liquidity,
        uint256 community
    ) {
        playToEarn = PLAY_TO_EARN_CAP - playToEarnMinted;
        treasury = TREASURY_CAP - treasuryMinted;
        team = TEAM_CAP - teamMinted;
        liquidity = LIQUIDITY_CAP - liquidityMinted;
        community = COMMUNITY_CAP - communityMinted;
    }

    // Required overrides for ERC20Votes

    function _update(address from, address to, uint256 value)
        internal
        override(ERC20, ERC20Votes)
    {
        super._update(from, to, value);
    }

    function nonces(address owner)
        public
        view
        override(ERC20Permit, Nonces)
        returns (uint256)
    {
        return super.nonces(owner);
    }
}
