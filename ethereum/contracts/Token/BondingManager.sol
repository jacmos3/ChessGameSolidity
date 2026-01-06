// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./ChessToken.sol";

/**
 * @title BondingManager
 * @notice Manages hybrid bonds (CHESS + ETH) for chess games
 * @dev Implements TWAP oracle, circuit breaker, and slashing mechanism
 *
 * Key Features:
 * - Hybrid bond: Both CHESS tokens and ETH required
 * - TWAP pricing to prevent flash manipulation
 * - Circuit breaker for extreme price movements
 * - Slashing for cheaters (burned, not redistributed)
 */
contract BondingManager is AccessControl, ReentrancyGuard, Pausable {
    bytes32 public constant GAME_MANAGER_ROLE = keccak256("GAME_MANAGER_ROLE");
    bytes32 public constant DISPUTE_MANAGER_ROLE = keccak256("DISPUTE_MANAGER_ROLE");

    ChessToken public immutable chessToken;

    // Bond configuration
    uint256 public chessMultiplier = 3;  // 3x stake in CHESS
    uint256 public ethMultiplier = 2;    // 2x stake in ETH

    // TWAP Oracle (simplified - in production use Uniswap/Chainlink)
    uint256 public chessEthPrice;        // CHESS price in wei (per 1 CHESS)
    uint256 public priceLastUpdated;
    uint256 public constant TWAP_PERIOD = 7 days;

    // Circuit breaker
    uint256 public constant MAX_PRICE_CHANGE_PERCENT = 50;
    uint256 public lastKnownPrice;

    // Minimum bond floor in ETH terms
    uint256 public minBondEthValue = 0.01 ether;

    // Bond tracking per user
    struct UserBond {
        uint256 chessAmount;
        uint256 ethAmount;
        uint256 lockedChess;   // Currently locked in games
        uint256 lockedEth;     // Currently locked in games
    }

    mapping(address => UserBond) public bonds;

    // Game bond tracking
    struct GameBond {
        address player;
        uint256 chessAmount;
        uint256 ethAmount;
        bool released;
        bool slashed;
    }

    mapping(uint256 => mapping(address => GameBond)) public gameBonds; // gameId => player => bond

    // Stats
    uint256 public totalChessBonded;
    uint256 public totalEthBonded;
    uint256 public totalChessSlashed;
    uint256 public totalEthSlashed;

    // Events
    event BondDeposited(address indexed user, uint256 chessAmount, uint256 ethAmount);
    event BondWithdrawn(address indexed user, uint256 chessAmount, uint256 ethAmount);
    event BondLocked(uint256 indexed gameId, address indexed player, uint256 chessAmount, uint256 ethAmount);
    event BondReleased(uint256 indexed gameId, address indexed player);
    event BondSlashed(uint256 indexed gameId, address indexed player, uint256 chessAmount, uint256 ethAmount);
    event PriceUpdated(uint256 oldPrice, uint256 newPrice);
    event CircuitBreakerTriggered(uint256 oldPrice, uint256 newPrice);

    constructor(address _chessToken, uint256 _initialPrice) {
        require(_chessToken != address(0), "Invalid token address");
        require(_initialPrice > 0, "Invalid price");

        chessToken = ChessToken(_chessToken);
        chessEthPrice = _initialPrice;
        lastKnownPrice = _initialPrice;
        priceLastUpdated = block.timestamp;

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    /**
     * @notice Deposit bond (CHESS + ETH)
     * @param chessAmount Amount of CHESS to deposit
     */
    function depositBond(uint256 chessAmount) external payable nonReentrant whenNotPaused {
        require(chessAmount > 0 || msg.value > 0, "Must deposit something");

        if (chessAmount > 0) {
            require(chessToken.transferFrom(msg.sender, address(this), chessAmount), "CHESS transfer failed");
            bonds[msg.sender].chessAmount += chessAmount;
            totalChessBonded += chessAmount;
        }

        if (msg.value > 0) {
            bonds[msg.sender].ethAmount += msg.value;
            totalEthBonded += msg.value;
        }

        emit BondDeposited(msg.sender, chessAmount, msg.value);
    }

    /**
     * @notice Withdraw unlocked bond
     * @param chessAmount Amount of CHESS to withdraw
     * @param ethAmount Amount of ETH to withdraw
     */
    function withdrawBond(uint256 chessAmount, uint256 ethAmount) external nonReentrant {
        UserBond storage bond = bonds[msg.sender];

        uint256 availableChess = bond.chessAmount - bond.lockedChess;
        uint256 availableEth = bond.ethAmount - bond.lockedEth;

        require(chessAmount <= availableChess, "Insufficient unlocked CHESS");
        require(ethAmount <= availableEth, "Insufficient unlocked ETH");

        if (chessAmount > 0) {
            bond.chessAmount -= chessAmount;
            totalChessBonded -= chessAmount;
            require(chessToken.transfer(msg.sender, chessAmount), "CHESS transfer failed");
        }

        if (ethAmount > 0) {
            bond.ethAmount -= ethAmount;
            totalEthBonded -= ethAmount;
            (bool success, ) = msg.sender.call{value: ethAmount}("");
            require(success, "ETH transfer failed");
        }

        emit BondWithdrawn(msg.sender, chessAmount, ethAmount);
    }

    /**
     * @notice Calculate required bond for a game stake
     * @param stake Game stake amount in wei
     * @return chessRequired Amount of CHESS required
     * @return ethRequired Amount of ETH required
     */
    function calculateRequiredBond(uint256 stake) public view returns (uint256 chessRequired, uint256 ethRequired) {
        ethRequired = stake * ethMultiplier;

        // Calculate CHESS required based on TWAP price
        // chessRequired = (stake * chessMultiplier) / chessEthPrice
        // Ensure minimum floor
        uint256 chessValue = (stake * chessMultiplier * 1e18) / chessEthPrice;
        uint256 minChess = (minBondEthValue * 1e18) / chessEthPrice;

        chessRequired = chessValue > minChess ? chessValue : minChess;
    }

    /**
     * @notice Lock bond for a game
     * @param gameId Game identifier
     * @param player Player address
     * @param stake Game stake
     */
    function lockBondForGame(uint256 gameId, address player, uint256 stake)
        external
        onlyRole(GAME_MANAGER_ROLE)
        whenNotPaused
    {
        (uint256 chessRequired, uint256 ethRequired) = calculateRequiredBond(stake);

        UserBond storage bond = bonds[player];
        uint256 availableChess = bond.chessAmount - bond.lockedChess;
        uint256 availableEth = bond.ethAmount - bond.lockedEth;

        require(availableChess >= chessRequired, "Insufficient CHESS bond");
        require(availableEth >= ethRequired, "Insufficient ETH bond");

        bond.lockedChess += chessRequired;
        bond.lockedEth += ethRequired;

        gameBonds[gameId][player] = GameBond({
            player: player,
            chessAmount: chessRequired,
            ethAmount: ethRequired,
            released: false,
            slashed: false
        });

        emit BondLocked(gameId, player, chessRequired, ethRequired);
    }

    /**
     * @notice Release bond after game ends normally
     * @param gameId Game identifier
     * @param player Player address
     */
    function releaseBond(uint256 gameId, address player)
        external
        onlyRole(GAME_MANAGER_ROLE)
    {
        GameBond storage gameBond = gameBonds[gameId][player];
        require(!gameBond.released && !gameBond.slashed, "Bond already processed");

        UserBond storage bond = bonds[player];
        bond.lockedChess -= gameBond.chessAmount;
        bond.lockedEth -= gameBond.ethAmount;

        gameBond.released = true;

        emit BondReleased(gameId, player);
    }

    /**
     * @notice Slash bond for cheating (burn tokens, send ETH to treasury)
     * @param gameId Game identifier
     * @param cheater Cheater's address
     */
    function slashBond(uint256 gameId, address cheater)
        external
        onlyRole(DISPUTE_MANAGER_ROLE)
    {
        GameBond storage gameBond = gameBonds[gameId][cheater];
        require(!gameBond.released && !gameBond.slashed, "Bond already processed");

        UserBond storage bond = bonds[cheater];

        uint256 chessToSlash = gameBond.chessAmount;
        uint256 ethToSlash = gameBond.ethAmount;

        // Remove from user's bond
        bond.chessAmount -= chessToSlash;
        bond.ethAmount -= ethToSlash;
        bond.lockedChess -= chessToSlash;
        bond.lockedEth -= ethToSlash;

        // Update totals
        totalChessBonded -= chessToSlash;
        totalEthBonded -= ethToSlash;
        totalChessSlashed += chessToSlash;
        totalEthSlashed += ethToSlash;

        // Burn CHESS tokens (deflationary)
        chessToken.burn(chessToSlash);

        // ETH goes to contract (can be claimed by admin for treasury)
        // In production, send to DAO treasury

        gameBond.slashed = true;

        emit BondSlashed(gameId, cheater, chessToSlash, ethToSlash);
    }

    /**
     * @notice Update TWAP price (simplified - in production use oracle)
     * @param newPrice New CHESS/ETH price
     */
    function updatePrice(uint256 newPrice) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newPrice > 0, "Invalid price");

        // Circuit breaker check
        if (lastKnownPrice > 0) {
            uint256 priceDiff;
            if (newPrice > lastKnownPrice) {
                priceDiff = newPrice - lastKnownPrice;
            } else {
                priceDiff = lastKnownPrice - newPrice;
            }

            uint256 changePercent = (priceDiff * 100) / lastKnownPrice;

            if (changePercent > MAX_PRICE_CHANGE_PERCENT) {
                _pause();
                emit CircuitBreakerTriggered(lastKnownPrice, newPrice);
                return;
            }
        }

        uint256 oldPrice = chessEthPrice;
        chessEthPrice = newPrice;
        lastKnownPrice = newPrice;
        priceLastUpdated = block.timestamp;

        emit PriceUpdated(oldPrice, newPrice);
    }

    /**
     * @notice Get user's available (unlocked) bond
     */
    function getAvailableBond(address user) external view returns (uint256 chess, uint256 eth) {
        UserBond storage bond = bonds[user];
        chess = bond.chessAmount - bond.lockedChess;
        eth = bond.ethAmount - bond.lockedEth;
    }

    /**
     * @notice Check if user has sufficient bond for a stake
     */
    function hasSufficientBond(address user, uint256 stake) external view returns (bool) {
        (uint256 chessRequired, uint256 ethRequired) = calculateRequiredBond(stake);
        UserBond storage bond = bonds[user];

        uint256 availableChess = bond.chessAmount - bond.lockedChess;
        uint256 availableEth = bond.ethAmount - bond.lockedEth;

        return availableChess >= chessRequired && availableEth >= ethRequired;
    }

    // Admin functions

    function setMultipliers(uint256 _chessMultiplier, uint256 _ethMultiplier)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(_chessMultiplier > 0 && _ethMultiplier > 0, "Invalid multipliers");
        chessMultiplier = _chessMultiplier;
        ethMultiplier = _ethMultiplier;
    }

    function setMinBondEthValue(uint256 _minBondEthValue) external onlyRole(DEFAULT_ADMIN_ROLE) {
        minBondEthValue = _minBondEthValue;
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    /**
     * @notice Withdraw accumulated slashed ETH to treasury
     * @param treasury Treasury address
     */
    function withdrawSlashedEth(address treasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 slashedEth = address(this).balance - totalEthBonded;
        require(slashedEth > 0, "No slashed ETH");

        (bool success, ) = treasury.call{value: slashedEth}("");
        require(success, "Transfer failed");
    }

    // Receive ETH
    receive() external payable {}
}
