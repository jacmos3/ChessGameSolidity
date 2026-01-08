pragma solidity ^0.8.24;


interface IAccessControl {
    /**
     * @dev The `account` is missing a role.
     */
    error AccessControlUnauthorizedAccount(address account, bytes32 neededRole);

    /**
     * @dev The caller of a function is not the expected one.
     *
     * NOTE: Don't confuse with {AccessControlUnauthorizedAccount}.
     */
    error AccessControlBadConfirmation();

    /**
     * @dev Emitted when `newAdminRole` is set as ``role``'s admin role, replacing `previousAdminRole`
     *
     * `DEFAULT_ADMIN_ROLE` is the starting admin for all roles, despite
     * {RoleAdminChanged} not being emitted to signal this.
     */
    event RoleAdminChanged(bytes32 indexed role, bytes32 indexed previousAdminRole, bytes32 indexed newAdminRole);

    /**
     * @dev Emitted when `account` is granted `role`.
     *
     * `sender` is the account that originated the contract call. This account bears the admin role (for the granted role).
     * Expected in cases where the role was granted using the internal {AccessControl-_grantRole}.
     */
    event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender);

    /**
     * @dev Emitted when `account` is revoked `role`.
     *
     * `sender` is the account that originated the contract call:
     *   - if using `revokeRole`, it is the admin role bearer
     *   - if using `renounceRole`, it is the role bearer (i.e. `account`)
     */
    event RoleRevoked(bytes32 indexed role, address indexed account, address indexed sender);

    /**
     * @dev Returns `true` if `account` has been granted `role`.
     */
    function hasRole(bytes32 role, address account) external view returns (bool);

    /**
     * @dev Returns the admin role that controls `role`. See {grantRole} and
     * {revokeRole}.
     *
     * To change a role's admin, use {AccessControl-_setRoleAdmin}.
     */
    function getRoleAdmin(bytes32 role) external view returns (bytes32);

    /**
     * @dev Grants `role` to `account`.
     *
     * If `account` had not been already granted `role`, emits a {RoleGranted}
     * event.
     *
     * Requirements:
     *
     * - the caller must have ``role``'s admin role.
     */
    function grantRole(bytes32 role, address account) external;

    /**
     * @dev Revokes `role` from `account`.
     *
     * If `account` had been granted `role`, emits a {RoleRevoked} event.
     *
     * Requirements:
     *
     * - the caller must have ``role``'s admin role.
     */
    function revokeRole(bytes32 role, address account) external;

    /**
     * @dev Revokes `role` from the calling account.
     *
     * Roles are often managed via {grantRole} and {revokeRole}: this function's
     * purpose is to provide a mechanism for accounts to lose their privileges
     * if they are compromised (such as when a trusted device is misplaced).
     *
     * If the calling account had been granted `role`, emits a {RoleRevoked}
     * event.
     *
     * Requirements:
     *
     * - the caller must be `callerConfirmation`.
     */
    function renounceRole(bytes32 role, address callerConfirmation) external;
}

abstract contract Context {
    function _msgSender() internal view virtual returns (address) {
        return msg.sender;
    }

    function _msgData() internal view virtual returns (bytes calldata) {
        return msg.data;
    }

    function _contextSuffixLength() internal view virtual returns (uint256) {
        return 0;
    }
}

interface IERC165 {
    /**
     * @dev Returns true if this contract implements the interface defined by
     * `interfaceId`. See the corresponding
     * https://eips.ethereum.org/EIPS/eip-165#how-interfaces-are-identified[ERC section]
     * to learn more about how these ids are created.
     *
     * This function call must use less than 30 000 gas.
     */
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}

abstract contract ERC165 is IERC165 {
    /// @inheritdoc IERC165
    function supportsInterface(bytes4 interfaceId) public view virtual returns (bool) {
        return interfaceId == type(IERC165).interfaceId;
    }
}

// SPDX-License-Identifier: MIT
// OpenZeppelin Contracts (last updated v5.4.0) (access/AccessControl.sol)
/**
 * @dev Contract module that allows children to implement role-based access
 * control mechanisms. This is a lightweight version that doesn't allow enumerating role
 * members except through off-chain means by accessing the contract event logs. Some
 * applications may benefit from on-chain enumerability, for those cases see
 * {AccessControlEnumerable}.
 *
 * Roles are referred to by their `bytes32` identifier. These should be exposed
 * in the external API and be unique. The best way to achieve this is by
 * using `public constant` hash digests:
 *
 * ```solidity
 * bytes32 public constant MY_ROLE = keccak256("MY_ROLE");
 * ```
 *
 * Roles can be used to represent a set of permissions. To restrict access to a
 * function call, use {hasRole}:
 *
 * ```solidity
 * function foo() public {
 *     require(hasRole(MY_ROLE, msg.sender));
 *     ...
 * }
 * ```
 *
 * Roles can be granted and revoked dynamically via the {grantRole} and
 * {revokeRole} functions. Each role has an associated admin role, and only
 * accounts that have a role's admin role can call {grantRole} and {revokeRole}.
 *
 * By default, the admin role for all roles is `DEFAULT_ADMIN_ROLE`, which means
 * that only accounts with this role will be able to grant or revoke other
 * roles. More complex role relationships can be created by using
 * {_setRoleAdmin}.
 *
 * WARNING: The `DEFAULT_ADMIN_ROLE` is also its own admin: it has permission to
 * grant and revoke this role. Extra precautions should be taken to secure
 * accounts that have been granted it. We recommend using {AccessControlDefaultAdminRules}
 * to enforce additional security measures for this role.
 */
abstract contract AccessControl is Context, IAccessControl, ERC165 {
    struct RoleData {
        mapping(address account => bool) hasRole;
        bytes32 adminRole;
    }

    mapping(bytes32 role => RoleData) private _roles;

    bytes32 public constant DEFAULT_ADMIN_ROLE = 0x00;

    /**
     * @dev Modifier that checks that an account has a specific role. Reverts
     * with an {AccessControlUnauthorizedAccount} error including the required role.
     */
    modifier onlyRole(bytes32 role) {
        _checkRole(role);
        _;
    }

    /// @inheritdoc IERC165
    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
        return interfaceId == type(IAccessControl).interfaceId || super.supportsInterface(interfaceId);
    }

    /**
     * @dev Returns `true` if `account` has been granted `role`.
     */
    function hasRole(bytes32 role, address account) public view virtual returns (bool) {
        return _roles[role].hasRole[account];
    }

    /**
     * @dev Reverts with an {AccessControlUnauthorizedAccount} error if `_msgSender()`
     * is missing `role`. Overriding this function changes the behavior of the {onlyRole} modifier.
     */
    function _checkRole(bytes32 role) internal view virtual {
        _checkRole(role, _msgSender());
    }

    /**
     * @dev Reverts with an {AccessControlUnauthorizedAccount} error if `account`
     * is missing `role`.
     */
    function _checkRole(bytes32 role, address account) internal view virtual {
        if (!hasRole(role, account)) {
            revert AccessControlUnauthorizedAccount(account, role);
        }
    }

    /**
     * @dev Returns the admin role that controls `role`. See {grantRole} and
     * {revokeRole}.
     *
     * To change a role's admin, use {_setRoleAdmin}.
     */
    function getRoleAdmin(bytes32 role) public view virtual returns (bytes32) {
        return _roles[role].adminRole;
    }

    /**
     * @dev Grants `role` to `account`.
     *
     * If `account` had not been already granted `role`, emits a {RoleGranted}
     * event.
     *
     * Requirements:
     *
     * - the caller must have ``role``'s admin role.
     *
     * May emit a {RoleGranted} event.
     */
    function grantRole(bytes32 role, address account) public virtual onlyRole(getRoleAdmin(role)) {
        _grantRole(role, account);
    }

    /**
     * @dev Revokes `role` from `account`.
     *
     * If `account` had been granted `role`, emits a {RoleRevoked} event.
     *
     * Requirements:
     *
     * - the caller must have ``role``'s admin role.
     *
     * May emit a {RoleRevoked} event.
     */
    function revokeRole(bytes32 role, address account) public virtual onlyRole(getRoleAdmin(role)) {
        _revokeRole(role, account);
    }

    /**
     * @dev Revokes `role` from the calling account.
     *
     * Roles are often managed via {grantRole} and {revokeRole}: this function's
     * purpose is to provide a mechanism for accounts to lose their privileges
     * if they are compromised (such as when a trusted device is misplaced).
     *
     * If the calling account had been revoked `role`, emits a {RoleRevoked}
     * event.
     *
     * Requirements:
     *
     * - the caller must be `callerConfirmation`.
     *
     * May emit a {RoleRevoked} event.
     */
    function renounceRole(bytes32 role, address callerConfirmation) public virtual {
        if (callerConfirmation != _msgSender()) {
            revert AccessControlBadConfirmation();
        }

        _revokeRole(role, callerConfirmation);
    }

    /**
     * @dev Sets `adminRole` as ``role``'s admin role.
     *
     * Emits a {RoleAdminChanged} event.
     */
    function _setRoleAdmin(bytes32 role, bytes32 adminRole) internal virtual {
        bytes32 previousAdminRole = getRoleAdmin(role);
        _roles[role].adminRole = adminRole;
        emit RoleAdminChanged(role, previousAdminRole, adminRole);
    }

    /**
     * @dev Attempts to grant `role` to `account` and returns a boolean indicating if `role` was granted.
     *
     * Internal function without access restriction.
     *
     * May emit a {RoleGranted} event.
     */
    function _grantRole(bytes32 role, address account) internal virtual returns (bool) {
        if (!hasRole(role, account)) {
            _roles[role].hasRole[account] = true;
            emit RoleGranted(role, account, _msgSender());
            return true;
        } else {
            return false;
        }
    }

    /**
     * @dev Attempts to revoke `role` from `account` and returns a boolean indicating if `role` was revoked.
     *
     * Internal function without access restriction.
     *
     * May emit a {RoleRevoked} event.
     */
    function _revokeRole(bytes32 role, address account) internal virtual returns (bool) {
        if (hasRole(role, account)) {
            _roles[role].hasRole[account] = false;
            emit RoleRevoked(role, account, _msgSender());
            return true;
        } else {
            return false;
        }
    }
}

// SPDX-License-Identifier: MIT
/// @title PlayerRating - ELO Rating System for Chess Players
/// @notice Manages player ratings using the ELO rating system
/// @dev Uses fixed-point math for ELO calculations (multiply by 100 for precision)
contract PlayerRating is AccessControl {
    bytes32 public constant GAME_REPORTER_ROLE = keccak256("GAME_REPORTER_ROLE");

    // ChessFactory address for validating game contracts
    address public chessFactory;

    // Valid game contracts mapping (prevents DOS from iterating all games)
    mapping(address => bool) public validGameContracts;

    // Default starting rating (1200 is standard for new players)
    uint256 public constant DEFAULT_RATING = 1200;

    // K-factor determines how much ratings change per game
    // Higher K = more volatile ratings
    uint256 public constant K_FACTOR_NEW = 40;      // First 30 games
    uint256 public constant K_FACTOR_NORMAL = 20;   // After 30 games
    uint256 public constant K_FACTOR_HIGH = 10;     // Rating > 2400

    // Minimum and maximum ratings
    uint256 public constant MIN_RATING = 100;
    uint256 public constant MAX_RATING = 3000;

    // Number of games before player is considered "established"
    uint256 public constant PROVISIONAL_GAMES = 30;

    // Maximum players in leaderboard (prevents unbounded array growth)
    uint256 public constant MAX_RANKED_PLAYERS = 100000;

    // Player stats
    struct PlayerStats {
        uint256 rating;
        uint256 gamesPlayed;
        uint256 wins;
        uint256 losses;
        uint256 draws;
        uint256 peakRating;
        uint256 lastGameTimestamp;
    }

    // Player address => stats
    mapping(address => PlayerStats) public players;

    // Leaderboard tracking
    address[] public rankedPlayers;
    mapping(address => bool) public isRanked;

    // Events
    event RatingUpdated(
        address indexed player,
        uint256 oldRating,
        uint256 newRating,
        int256 change
    );
    event GameRecorded(
        address indexed white,
        address indexed black,
        uint8 result, // 0 = draw, 1 = white wins, 2 = black wins
        uint256 whiteRatingChange,
        uint256 blackRatingChange
    );
    event PlayerRegistered(address indexed player, uint256 initialRating);

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    /// @notice Set the ChessFactory address (allows game contracts to report)
    function setChessFactory(address _chessFactory) external onlyRole(DEFAULT_ADMIN_ROLE) {
        chessFactory = _chessFactory;
    }

    /// @notice Check if caller is a valid game contract
    /// @dev Uses mapping for O(1) lookup instead of O(n) iteration
    function _isValidGameContract(address caller) internal view returns (bool) {
        return validGameContracts[caller];
    }

    /// @notice Register a game contract as valid (called by ChessFactory)
    /// @param gameContract Address of the deployed game contract
    function registerGameContract(address gameContract) external {
        require(msg.sender == chessFactory, "Only factory");
        require(gameContract != address(0), "Invalid address");
        validGameContracts[gameContract] = true;
    }

    /// @notice Register a new player with default rating
    /// @param player Address of the player
    function registerPlayer(address player) external {
        if (players[player].rating == 0) {
            players[player] = PlayerStats({
                rating: DEFAULT_RATING,
                gamesPlayed: 0,
                wins: 0,
                losses: 0,
                draws: 0,
                peakRating: DEFAULT_RATING,
                lastGameTimestamp: 0
            });

            // Only add to leaderboard if under cap (prevents unbounded array growth)
            if (!isRanked[player] && rankedPlayers.length < MAX_RANKED_PLAYERS) {
                rankedPlayers.push(player);
                isRanked[player] = true;
            }

            emit PlayerRegistered(player, DEFAULT_RATING);
        }
    }

    /// @notice Ensure player is registered (internal helper)
    function _ensureRegistered(address player) internal {
        if (players[player].rating == 0) {
            players[player] = PlayerStats({
                rating: DEFAULT_RATING,
                gamesPlayed: 0,
                wins: 0,
                losses: 0,
                draws: 0,
                peakRating: DEFAULT_RATING,
                lastGameTimestamp: 0
            });

            // Only add to leaderboard if under cap (prevents unbounded array growth)
            if (!isRanked[player] && rankedPlayers.length < MAX_RANKED_PLAYERS) {
                rankedPlayers.push(player);
                isRanked[player] = true;
            }

            emit PlayerRegistered(player, DEFAULT_RATING);
        }
    }

    /// @notice Report a game result and update ratings
    /// @param white Address of white player
    /// @param black Address of black player
    /// @param result 0 = draw, 1 = white wins, 2 = black wins
    function reportGame(
        address white,
        address black,
        uint8 result
    ) external {
        // Allow calls from valid game contracts OR accounts with GAME_REPORTER_ROLE
        require(
            _isValidGameContract(msg.sender) || hasRole(GAME_REPORTER_ROLE, msg.sender),
            "Not authorized"
        );
        require(white != black, "Same player");
        require(result <= 2, "Invalid result");

        // Ensure both players are registered
        _ensureRegistered(white);
        _ensureRegistered(black);

        uint256 whiteRating = players[white].rating;
        uint256 blackRating = players[black].rating;

        // Calculate expected scores (fixed-point, multiply by 1000)
        uint256 whiteExpected = _expectedScore(whiteRating, blackRating);
        uint256 blackExpected = 1000 - whiteExpected;

        // Actual scores (multiply by 1000 for comparison)
        uint256 whiteActual;
        uint256 blackActual;

        if (result == 0) {
            // Draw
            whiteActual = 500;
            blackActual = 500;
            players[white].draws++;
            players[black].draws++;
        } else if (result == 1) {
            // White wins
            whiteActual = 1000;
            blackActual = 0;
            players[white].wins++;
            players[black].losses++;
        } else {
            // Black wins
            whiteActual = 0;
            blackActual = 1000;
            players[white].losses++;
            players[black].wins++;
        }

        // Get K-factors
        uint256 whiteK = _getKFactor(white);
        uint256 blackK = _getKFactor(black);

        // Calculate new ratings
        uint256 newWhiteRating = _calculateNewRating(whiteRating, whiteK, whiteActual, whiteExpected);
        uint256 newBlackRating = _calculateNewRating(blackRating, blackK, blackActual, blackExpected);

        // Update player stats
        int256 whiteChange = int256(newWhiteRating) - int256(whiteRating);
        int256 blackChange = int256(newBlackRating) - int256(blackRating);

        players[white].rating = newWhiteRating;
        players[white].gamesPlayed++;
        players[white].lastGameTimestamp = block.timestamp;
        if (newWhiteRating > players[white].peakRating) {
            players[white].peakRating = newWhiteRating;
        }

        players[black].rating = newBlackRating;
        players[black].gamesPlayed++;
        players[black].lastGameTimestamp = block.timestamp;
        if (newBlackRating > players[black].peakRating) {
            players[black].peakRating = newBlackRating;
        }

        emit RatingUpdated(white, whiteRating, newWhiteRating, whiteChange);
        emit RatingUpdated(black, blackRating, newBlackRating, blackChange);
        emit GameRecorded(
            white,
            black,
            result,
            whiteChange >= 0 ? uint256(whiteChange) : uint256(-whiteChange),
            blackChange >= 0 ? uint256(blackChange) : uint256(-blackChange)
        );
    }

    /// @notice Calculate expected score (returns value * 1000)
    /// @dev Uses approximation of 1 / (1 + 10^((Rb-Ra)/400))
    function _expectedScore(uint256 ratingA, uint256 ratingB) internal pure returns (uint256) {
        int256 diff = int256(ratingB) - int256(ratingA);

        // Clamp difference to prevent overflow
        if (diff > 400) diff = 400;
        if (diff < -400) diff = -400;

        // Approximation using linear interpolation for the sigmoid
        // At diff = 0: expected = 500 (0.5)
        // At diff = 400: expected = 91 (0.091)
        // At diff = -400: expected = 909 (0.909)

        // Linear approximation: expected = 500 - (diff * 409) / 400
        int256 expected = 500 - (diff * 409) / 400;

        if (expected < 0) expected = 0;
        if (expected > 1000) expected = 1000;

        return uint256(expected);
    }

    /// @notice Calculate new rating
    function _calculateNewRating(
        uint256 currentRating,
        uint256 kFactor,
        uint256 actualScore,
        uint256 expectedScore
    ) internal pure returns (uint256) {
        int256 change = (int256(kFactor) * (int256(actualScore) - int256(expectedScore))) / 1000;

        int256 newRating = int256(currentRating) + change;

        // Clamp to min/max
        if (newRating < int256(MIN_RATING)) newRating = int256(MIN_RATING);
        if (newRating > int256(MAX_RATING)) newRating = int256(MAX_RATING);

        return uint256(newRating);
    }

    /// @notice Get K-factor for a player
    function _getKFactor(address player) internal view returns (uint256) {
        PlayerStats storage stats = players[player];

        // New players have higher K-factor (ratings change more)
        if (stats.gamesPlayed < PROVISIONAL_GAMES) {
            return K_FACTOR_NEW;
        }

        // High-rated players have lower K-factor (more stable ratings)
        if (stats.rating >= 2400) {
            return K_FACTOR_HIGH;
        }

        return K_FACTOR_NORMAL;
    }

    /// @notice Get player rating
    function getRating(address player) external view returns (uint256) {
        if (players[player].rating == 0) {
            return DEFAULT_RATING;
        }
        return players[player].rating;
    }

    /// @notice Get full player stats
    function getPlayerStats(address player) external view returns (
        uint256 rating,
        uint256 gamesPlayed,
        uint256 wins,
        uint256 losses,
        uint256 draws,
        uint256 peakRating,
        uint256 lastGameTimestamp
    ) {
        PlayerStats storage stats = players[player];

        if (stats.rating == 0) {
            return (DEFAULT_RATING, 0, 0, 0, 0, DEFAULT_RATING, 0);
        }

        return (
            stats.rating,
            stats.gamesPlayed,
            stats.wins,
            stats.losses,
            stats.draws,
            stats.peakRating,
            stats.lastGameTimestamp
        );
    }

    /// @notice Get win rate (returns percentage * 100, e.g., 5500 = 55.00%)
    function getWinRate(address player) external view returns (uint256) {
        PlayerStats storage stats = players[player];

        if (stats.gamesPlayed == 0) {
            return 0;
        }

        // Calculate win rate including draws as 0.5 wins
        uint256 points = (stats.wins * 2) + stats.draws; // Each win = 2 points, draw = 1 point
        uint256 maxPoints = stats.gamesPlayed * 2;

        return (points * 10000) / maxPoints; // Returns percentage * 100
    }

    /// @notice Check if player is still provisional (< 30 games)
    function isProvisional(address player) external view returns (bool) {
        return players[player].gamesPlayed < PROVISIONAL_GAMES;
    }

    /// @notice Get total number of ranked players
    function getRankedPlayerCount() external view returns (uint256) {
        return rankedPlayers.length;
    }

    /// @notice Get top players (paginated)
    /// @param offset Starting index
    /// @param limit Number of players to return
    function getTopPlayers(uint256 offset, uint256 limit) external view returns (
        address[] memory addresses,
        uint256[] memory ratings
    ) {
        // Simple implementation - in production you'd want a sorted data structure
        uint256 count = rankedPlayers.length;

        if (offset >= count) {
            return (new address[](0), new uint256[](0));
        }

        uint256 end = offset + limit;
        if (end > count) {
            end = count;
        }

        uint256 resultCount = end - offset;
        addresses = new address[](resultCount);
        ratings = new uint256[](resultCount);

        // Copy players (not sorted - would need off-chain sorting for large sets)
        for (uint256 i = 0; i < resultCount; i++) {
            addresses[i] = rankedPlayers[offset + i];
            ratings[i] = players[rankedPlayers[offset + i]].rating;
        }

        return (addresses, ratings);
    }
}