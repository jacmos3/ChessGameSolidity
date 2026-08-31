// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../Rating/PlayerRating.sol";

contract RatingGameMock {
    uint256 public immutable gameId;
    PlayerRating public immutable rating;

    constructor(PlayerRating _rating, uint256 _gameId) {
        rating = _rating;
        gameId = _gameId;
    }

    function report(
        address white,
        address black,
        uint8 result,
        uint256 plyCount,
        uint8 mode
    ) external returns (bool) {
        return rating.reportCanonicalGame(white, black, result, plyCount, mode);
    }
}

contract RatingFactoryMock {
    mapping(address => bool) public isDeployedGame;

    function register(PlayerRating rating, address game) external {
        isDeployedGame[game] = true;
        rating.registerGameContract(game);
    }

    function registerUnlisted(PlayerRating rating, address game) external {
        rating.registerGameContract(game);
    }
}

contract RatingEligibilityMock {
    mapping(address => bool) public rewardEligible;

    function setEligible(address player, bool eligible) external {
        rewardEligible[player] = eligible;
    }
}
