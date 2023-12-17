// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;
import "./ChessCore.sol";
contract ChessFactory {
    address[] public deployedChessGames;

    function createChessGame() public payable {
        // Ensure the player is betting something
        require(msg.value > 0, "Send an amount greater than zero");
        
        // Deploy a new Chess contract
        ChessCore newChessGame = new ChessCore{value: msg.value}(msg.sender, msg.value); 

        // Store the address of the new contract
        deployedChessGames.push(address(newChessGame));
    }

    function getDeployedChessGames() public view returns (address[] memory) {
        return deployedChessGames;
    }
}
