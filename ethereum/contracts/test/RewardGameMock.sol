// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../Token/RewardPool.sol";

contract RewardGameMock {
    function distribute(
        RewardPool pool,
        address white,
        address black,
        uint8 result,
        bool isCheckmate,
        uint256 moveCount,
        bool whiteWasResign,
        bool whiteWasTimeout,
        bool blackWasResign,
        bool blackWasTimeout,
        address disqualifiedPlayer
    ) external {
        pool.distributeGameRewards(
            white,
            black,
            result,
            isCheckmate,
            moveCount,
            whiteWasResign,
            whiteWasTimeout,
            blackWasResign,
            blackWasTimeout,
            disqualifiedPlayer
        );
    }
}

contract RewardFactoryMock {
    mapping(address => bool) public isDeployedGame;

    function register(RewardPool pool, address game) external {
        isDeployedGame[game] = true;
        pool.registerGameContract(game);
    }

    function registerUnlisted(RewardPool pool, address game) external {
        pool.registerGameContract(game);
    }
}
