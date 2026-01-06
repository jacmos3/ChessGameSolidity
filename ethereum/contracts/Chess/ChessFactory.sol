// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./ChessCore.sol";
import "./ChessNFT.sol";

contract ChessFactory {
    address[] public deployedChessGames;
    address public addressNFT;
    uint256 public totalChessGames;

    // Bet limits (can be adjusted for different networks)
    uint256 public constant MIN_BET = 0.001 ether;
    uint256 public constant MAX_BET = 100 ether;

    event GameCreated(
        uint256 indexed gameId,
        address indexed gameAddress,
        address indexed whitePlayer,
        uint256 betAmount,
        ChessCore.TimeoutPreset timeoutPreset,
        ChessCore.GameMode gameMode
    );

    constructor(){
        ChessNFT newChessNFT = new ChessNFT(msg.sender);
        addressNFT = address(newChessNFT);
    }

    function createChessGame(ChessCore.TimeoutPreset _timeoutPreset, ChessCore.GameMode _gameMode) public payable returns (address) {
        require(msg.value >= MIN_BET, "Bet amount too low");
        require(msg.value <= MAX_BET, "Bet amount too high");

        ChessCore newChessGame = new ChessCore{value: msg.value}(msg.sender, msg.value, _timeoutPreset, _gameMode);
        address toRet = address(newChessGame);
        deployedChessGames.push(toRet);

        uint256 gameId = totalChessGames;
        totalChessGames++;

        ChessNFT(addressNFT).createGameNFT(gameId, toRet, msg.sender);

        emit GameCreated(gameId, toRet, msg.sender, msg.value, _timeoutPreset, _gameMode);
        return toRet;
    }
 
    function getDeployedChessGames() public view returns (address[] memory) {
        return deployedChessGames;
    }

}