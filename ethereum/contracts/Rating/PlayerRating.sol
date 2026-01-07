// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";

/// @title PlayerRating - ELO Rating System for Chess Players
/// @notice Manages player ratings using the ELO rating system
/// @dev Uses fixed-point math for ELO calculations (multiply by 100 for precision)
contract PlayerRating is AccessControl {
    bytes32 public constant GAME_REPORTER_ROLE = keccak256("GAME_REPORTER_ROLE");

    // ChessFactory address for validating game contracts
    address public chessFactory;

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
    function _isValidGameContract(address caller) internal view returns (bool) {
        if (chessFactory == address(0)) return false;

        // Check if caller is in the deployedChessGames array
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

            if (!isRanked[player]) {
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

            if (!isRanked[player]) {
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
