// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./ChessCore.sol";
import "./ChessNFT.sol";
import "../Token/BondingManager.sol";
import "../Rating/PlayerRating.sol";

contract ChessFactory {
    address[] public deployedChessGames;
    address public addressNFT;
    uint256 public totalChessGames;

    // Anti-cheating system contracts
    address public bondingManager;
    address public disputeDAO;
    address public playerRating;
    address public owner;

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
    event BondingManagerUpdated(address indexed oldAddress, address indexed newAddress);
    event DisputeDAOUpdated(address indexed oldAddress, address indexed newAddress);
    event PlayerRatingUpdated(address indexed oldAddress, address indexed newAddress);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
        ChessNFT newChessNFT = new ChessNFT(msg.sender);
        addressNFT = address(newChessNFT);
    }

    /// @notice Set the BondingManager contract address
    /// @param _bondingManager Address of BondingManager (address(0) to disable)
    function setBondingManager(address _bondingManager) external onlyOwner {
        emit BondingManagerUpdated(bondingManager, _bondingManager);
        bondingManager = _bondingManager;
    }

    /// @notice Set the DisputeDAO contract address
    /// @param _disputeDAO Address of DisputeDAO (address(0) to disable)
    function setDisputeDAO(address _disputeDAO) external onlyOwner {
        emit DisputeDAOUpdated(disputeDAO, _disputeDAO);
        disputeDAO = _disputeDAO;
    }

    /// @notice Set the PlayerRating contract address
    /// @param _playerRating Address of PlayerRating (address(0) to disable)
    function setPlayerRating(address _playerRating) external onlyOwner {
        emit PlayerRatingUpdated(playerRating, _playerRating);
        playerRating = _playerRating;
    }

    /// @notice Transfer ownership
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid owner");
        owner = newOwner;
    }

    function createChessGame(ChessCore.TimeoutPreset _timeoutPreset, ChessCore.GameMode _gameMode) public payable returns (address) {
        require(msg.value >= MIN_BET, "Bet amount too low");
        require(msg.value <= MAX_BET, "Bet amount too high");

        // If bonding is enabled, verify white player has sufficient bond
        if (bondingManager != address(0)) {
            require(
                BondingManager(payable(bondingManager)).hasSufficientBond(msg.sender, msg.value),
                "Insufficient bond - deposit more CHESS and ETH"
            );
        }

        uint256 gameId = totalChessGames;

        ChessCore newChessGame = new ChessCore{value: msg.value}(
            msg.sender,
            msg.value,
            _timeoutPreset,
            _gameMode,
            gameId,
            bondingManager,
            disputeDAO,
            playerRating
        );
        address toRet = address(newChessGame);
        deployedChessGames.push(toRet);

        totalChessGames++;

        ChessNFT(addressNFT).createGameNFT(gameId, toRet, msg.sender);

        emit GameCreated(gameId, toRet, msg.sender, msg.value, _timeoutPreset, _gameMode);
        return toRet;
    }

    /// @notice Check if a player has sufficient bond for a given bet amount
    function hasSufficientBond(address player, uint256 betAmount) external view returns (bool) {
        if (bondingManager == address(0)) {
            return true; // Bonding not enabled
        }
        return BondingManager(payable(bondingManager)).hasSufficientBond(player, betAmount);
    }

    /// @notice Get required bond amounts for a bet
    function getRequiredBond(uint256 betAmount) external view returns (uint256 chessRequired, uint256 ethRequired) {
        if (bondingManager == address(0)) {
            return (0, 0);
        }
        return BondingManager(payable(bondingManager)).calculateRequiredBond(betAmount);
    }

    function getDeployedChessGames() public view returns (address[] memory) {
        return deployedChessGames;
    }

}