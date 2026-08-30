// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./ChessToken.sol";

/**
 * @title BondingManager
 * @notice Manages hybrid bonds (CHESS + ETH) for chess games
 * @dev Uses a trusted price updater with freshness checks, a circuit breaker, and slashing
 *
 * Key Features:
 * - Hybrid bond: Both CHESS tokens and ETH required
 * - Dedicated oracle role with stale-price rejection
 * - Circuit breaker for extreme price movements
 * - Slashing for cheaters (burned, not redistributed)
 */
contract BondingManager is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for ChessToken;

    bytes32 public constant GAME_MANAGER_ROLE = keccak256("GAME_MANAGER_ROLE");
    bytes32 public constant DISPUTE_MANAGER_ROLE = keccak256("DISPUTE_MANAGER_ROLE");
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");

    ChessToken public immutable chessToken;

    // Bond configuration
    uint256 public chessMultiplier = 3;  // 3x stake in CHESS
    uint256 public ethMultiplier = 2;    // 2x stake in ETH

    // Trusted updater price feed. TWAP_PERIOD is retained as a legacy ABI name; no TWAP is calculated.
    uint256 public chessEthPrice;        // CHESS price in wei (per 1 CHESS)
    uint256 public priceLastUpdated;
    uint256 public constant TWAP_PERIOD = 7 days;

    // Circuit breaker
    uint256 public constant MAX_PRICE_CHANGE_PERCENT = 50;
    uint256 public constant MIN_PRICE = 1e12; // Minimum price floor (0.000001 ETH per CHESS)
    uint256 public constant PRICE_CHANGE_WINDOW = 1 days;
    uint256 public constant MIN_PRICE_UPDATE_INTERVAL = 15 minutes;
    uint256 public lastKnownPrice;
    uint256 public priceWindowAnchor;
    uint256 public priceWindowStartedAt;
    uint256 public lastMaterialPriceUpdateAt;
    bool public circuitBreakerTripped;

    // With a 15-minute minimum interval there can be at most 98 relevant
    // observations in 24 hours (initial price, an immediate first update, and
    // subsequent interval-spaced updates). The ring keeps enforcement bounded.
    struct PriceCheckpoint {
        uint256 observedUntil;
        uint256 price;
    }
    PriceCheckpoint[98] private priceCheckpoints;
    uint16 private priceCheckpointCount;
    uint16 private priceCheckpointCursor;

    // Minimum bond floor in ETH terms
    uint256 public minBondEthValue = 0.01 ether;
    address public chessFactory;

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
    event CircuitBreakerReset(uint256 oldPrice, uint256 newPrice);
    event ChessFactoryUpdated(address indexed previousFactory, address indexed newFactory);
    event GameContractAuthorized(address indexed gameContract);

    constructor(address _chessToken, uint256 _initialPrice) {
        require(_chessToken.code.length > 0, "Token must be contract");
        require(_initialPrice >= MIN_PRICE, "Price below minimum floor");

        chessToken = ChessToken(_chessToken);
        chessEthPrice = _initialPrice;
        lastKnownPrice = _initialPrice;
        priceWindowAnchor = _initialPrice;
        priceWindowStartedAt = block.timestamp;
        priceLastUpdated = block.timestamp;
        _resetPriceCheckpoints(_initialPrice);

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ORACLE_ROLE, msg.sender);
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
     * @notice Deposit bond (CHESS + ETH)
     * @param chessAmount Amount of CHESS to deposit
     */
    function depositBond(uint256 chessAmount) external payable nonReentrant whenNotPaused {
        require(chessAmount > 0 || msg.value > 0, "Must deposit something");

        if (chessAmount > 0) {
            chessToken.safeTransferFrom(msg.sender, address(this), chessAmount);
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
            chessToken.safeTransfer(msg.sender, chessAmount);
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
        // Ensure price is above minimum floor to prevent manipulation
        require(chessEthPrice >= MIN_PRICE, "Price below minimum floor");
        require(block.timestamp <= priceLastUpdated + TWAP_PERIOD, "Price is stale");

        ethRequired = stake * ethMultiplier;

        // Calculate CHESS required from the latest trusted updater price.
        // chessRequired = (stake * chessMultiplier) / chessEthPrice
        // Ensure minimum floor
        uint256 chessValue = (stake * chessMultiplier * 1e18) / chessEthPrice;
        uint256 minChess = (minBondEthValue * 1e18) / chessEthPrice;

        chessRequired = chessValue > minChess ? chessValue : minChess;
    }

    /**
     * @notice Lock bond for a game (single player)
     * @param gameId Game identifier
     * @param player Player address
     * @param stake Game stake
     */
    function lockBondForGame(uint256 gameId, address player, uint256 stake)
        external
        onlyRole(GAME_MANAGER_ROLE)
        whenNotPaused
    {
        _lockBondForPlayer(gameId, player, stake);
    }

    /**
     * @notice Lock bonds for both players in a game (gas optimized - single external call)
     * @param gameId Game identifier
     * @param player1 First player address
     * @param player2 Second player address
     * @param stake Game stake (same for both players)
     */
    function lockBondsForGame(uint256 gameId, address player1, address player2, uint256 stake)
        external
        onlyRole(GAME_MANAGER_ROLE)
        whenNotPaused
    {
        _lockBondForPlayer(gameId, player1, stake);
        _lockBondForPlayer(gameId, player2, stake);
    }

    /**
     * @notice Internal function to lock bond for a single player
     * @param gameId Game identifier
     * @param player Player address
     * @param stake Game stake
     */
    function _lockBondForPlayer(uint256 gameId, address player, uint256 stake) internal {
        require(player != address(0), "Invalid player");
        require(stake > 0, "Invalid stake");

        GameBond storage existingBond = gameBonds[gameId][player];
        require(existingBond.player == address(0), "Bond already locked");

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
        require(gameBond.player == player, "Bond not found");
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
        require(gameBond.player == cheater, "Bond not found");
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
     * @notice Update the trusted CHESS/ETH price used for bond calculations
     * @param newPrice New CHESS/ETH price
     */
    function updatePrice(uint256 newPrice) external onlyRole(ORACLE_ROLE) whenNotPaused {
        require(newPrice >= MIN_PRICE, "Price below minimum floor");

        if (block.timestamp >= priceWindowStartedAt + PRICE_CHANGE_WINDOW) {
            priceWindowAnchor = chessEthPrice;
            priceWindowStartedAt = block.timestamp;
        }

        if (newPrice != chessEthPrice && lastMaterialPriceUpdateAt != 0) {
            require(
                block.timestamp >= lastMaterialPriceUpdateAt + MIN_PRICE_UPDATE_INTERVAL,
                "Price update too frequent"
            );
        }

        uint256 priceDiff = newPrice > priceWindowAnchor
            ? newPrice - priceWindowAnchor
            : priceWindowAnchor - newPrice;

        // Compare against the window anchor, not the preceding update. This prevents
        // an updater from bypassing the breaker through a sequence of individually
        // acceptable changes inside the same window.
        uint256 maxWindowChange = Math.mulDiv(
            priceWindowAnchor,
            MAX_PRICE_CHANGE_PERCENT,
            100
        );
        bool exceedsAnchorLimit = priceDiff > maxWindowChange;
        uint256 rollingLimitReference = _rollingLimitReference(newPrice);
        if (exceedsAnchorLimit || rollingLimitReference != 0) {
            circuitBreakerTripped = true;
            _pause();
            emit CircuitBreakerTriggered(
                exceedsAnchorLimit ? priceWindowAnchor : rollingLimitReference,
                newPrice
            );
            return;
        }

        uint256 oldPrice = chessEthPrice;
        if (newPrice != oldPrice) {
            _recordPriceTransition(newPrice);
        }
        chessEthPrice = newPrice;
        lastKnownPrice = newPrice;
        priceLastUpdated = block.timestamp;
        if (newPrice != oldPrice) {
            lastMaterialPriceUpdateAt = block.timestamp;
        }

        emit PriceUpdated(oldPrice, newPrice);
    }

    function _rollingLimitReference(uint256 newPrice) internal view returns (uint256) {
        if (_priceChangeExceedsLimit(chessEthPrice, newPrice)) return chessEthPrice;

        for (uint256 i = 0; i < priceCheckpointCount; i++) {
            PriceCheckpoint storage checkpoint = priceCheckpoints[i];
            if (
                checkpoint.price != 0 &&
                block.timestamp <= checkpoint.observedUntil + PRICE_CHANGE_WINDOW &&
                _priceChangeExceedsLimit(checkpoint.price, newPrice)
            ) {
                return checkpoint.price;
            }
        }
        return 0;
    }

    function _priceChangeExceedsLimit(uint256 referencePrice, uint256 newPrice)
        internal
        pure
        returns (bool)
    {
        uint256 difference = newPrice > referencePrice
            ? newPrice - referencePrice
            : referencePrice - newPrice;
        return difference > Math.mulDiv(referencePrice, MAX_PRICE_CHANGE_PERCENT, 100);
    }

    function _recordPriceTransition(uint256 newPrice) internal {
        // The previous price remained effective until this transition. Refresh
        // its endpoint so a window boundary cannot erase a recent price move.
        if (priceCheckpointCount > 0) {
            uint256 latestIndex = priceCheckpointCursor == 0
                ? priceCheckpoints.length - 1
                : priceCheckpointCursor - 1;
            priceCheckpoints[latestIndex].observedUntil = block.timestamp;
        }

        priceCheckpoints[priceCheckpointCursor] = PriceCheckpoint({
            observedUntil: block.timestamp,
            price: newPrice
        });
        priceCheckpointCursor = uint16((priceCheckpointCursor + 1) % priceCheckpoints.length);
        if (priceCheckpointCount < priceCheckpoints.length) {
            priceCheckpointCount++;
        }
    }

    function _resetPriceCheckpoints(uint256 price) internal {
        priceCheckpoints[0] = PriceCheckpoint({
            observedUntil: block.timestamp,
            price: price
        });
        priceCheckpointCount = 1;
        priceCheckpointCursor = 1;
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
        require(!circuitBreakerTripped, "Reset circuit breaker first");
        _unpause();
    }

    /**
     * @notice Recover from a price circuit-breaker trip using an admin-reviewed price
     * @dev Resets the cumulative-change window and unpauses atomically.
     */
    function resetCircuitBreaker(uint256 trustedPrice) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(paused() && circuitBreakerTripped, "Circuit breaker not tripped");
        require(trustedPrice >= MIN_PRICE, "Price below minimum floor");

        uint256 oldPrice = chessEthPrice;
        chessEthPrice = trustedPrice;
        lastKnownPrice = trustedPrice;
        priceWindowAnchor = trustedPrice;
        priceWindowStartedAt = block.timestamp;
        lastMaterialPriceUpdateAt = block.timestamp;
        priceLastUpdated = block.timestamp;
        circuitBreakerTripped = false;
        _resetPriceCheckpoints(trustedPrice);
        _unpause();

        emit PriceUpdated(oldPrice, trustedPrice);
        emit CircuitBreakerReset(oldPrice, trustedPrice);
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    /**
     * @notice Withdraw accumulated slashed ETH to treasury
     * @param treasury Treasury address
     */
    function withdrawSlashedEth(address treasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(treasury != address(0), "Invalid treasury");
        uint256 slashedEth = address(this).balance - totalEthBonded;
        require(slashedEth > 0, "No slashed ETH");

        (bool success, ) = treasury.call{value: slashedEth}("");
        require(success, "Transfer failed");
    }

    // Receive ETH
    receive() external payable {}
}
