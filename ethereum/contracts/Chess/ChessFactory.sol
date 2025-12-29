// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./ChessCore.sol";
import "./ChessNFT.sol";

contract ChessFactory {
    address[] public deployedChessGames;
    address public addressNFT;
    uint256 public totalChessGames;

    constructor(){
        ChessNFT newChessNFT = new ChessNFT(msg.sender);
        addressNFT = address(newChessNFT);
    }

    /*function deployNFT() public {
        ChessNFT newChessNFT = new ChessNFT(msg.sender);
        addressNFT = address(newChessNFT);
    }*/

    function createChessGame() public payable returns (address) {
        //require(msg.value > 0, "Send an amount greater than zero");
        
        ChessCore newChessGame = new ChessCore{value: msg.value}(msg.sender, msg.value);
        address toRet = address(newChessGame);
        deployedChessGames.push(toRet);
        totalChessGames++;

        ChessNFT(addressNFT).createGameNFT(totalChessGames - 1, toRet);
        return toRet;
    }
 
    function getDeployedChessGames() public view returns (address[] memory) {
        return deployedChessGames;
    }

}