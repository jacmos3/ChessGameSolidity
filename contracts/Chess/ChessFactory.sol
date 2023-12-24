// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;
import "./ChessNFT.sol";
import "./ChessCore.sol";

contract ChessFactory {
    address[] public deployedChessGames;
    address public addressNFT;
    uint256 public totalChessGames;

    constructor(){
        
    }

    function deployNFT() public {
        ChessNFT newChessNFT = new ChessNFT(msg.sender);
        addressNFT = address(newChessNFT);
    }

    function createChessGame() public payable {
        //require(msg.value > 0, "Send an amount greater than zero");

        ChessCore newChessGame = new ChessCore{value: msg.value}(msg.sender, msg.value);
        deployedChessGames.push(address(newChessGame));
        totalChessGames++;

        ChessNFT(addressNFT).createGameNFT(totalChessGames - 1, address(newChessGame));
    }

    function getDeployedChessGames() public view returns (address[] memory) {
        return deployedChessGames;
    }

}