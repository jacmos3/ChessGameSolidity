// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/proxy/Clones.sol";
import "./ChessCore.sol";
import "./ChessNFT.sol";
import "../Token/BondingManager.sol";
import "../Token/RewardPool.sol";
import "../Rating/PlayerRating.sol";
import "../DAO/DisputeDAO.sol";

contract ChessFactory {
    using Clones for address;

    address[] public deployedChessGames;
    /// @notice Canonical registry used by clients to reject look-alike game contracts.
    mapping(address => bool) public isDeployedGame;
    address public addressNFT;
    uint256 public totalChessGames;

    // ChessCore implementation contract (used for cloning)
    address public chessCoreImplementation;

    // Anti-cheating system contracts
    address public bondingManager;
    address public disputeDAO;
    address public playerRating;
    address public rewardPool;
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
    event RewardPoolUpdated(address indexed oldAddress, address indexed newAddress);
    event ImplementationUpdated(address indexed oldImplementation, address indexed newImplementation);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(address _chessCoreImplementation) {
        require(_chessCoreImplementation.code.length > 0, "Implementation must be contract");
        owner = msg.sender;
        chessCoreImplementation = _chessCoreImplementation;
        ChessNFT newChessNFT = new ChessNFT(msg.sender);
        addressNFT = address(newChessNFT);
    }

    /// @notice Update ChessCore implementation (for upgrades)
    /// @param _newImplementation New implementation address
    function setImplementation(address _newImplementation) external onlyOwner {
        require(_newImplementation.code.length > 0, "Implementation must be contract");
        emit ImplementationUpdated(chessCoreImplementation, _newImplementation);
        chessCoreImplementation = _newImplementation;
    }

    /// @notice Set the BondingManager contract address
    /// @param _bondingManager Address of BondingManager (address(0) to disable)
    function setBondingManager(address _bondingManager) external onlyOwner {
        require(_isContractOrZero(_bondingManager), "Bonding manager must be contract");
        require(_bondingManager != address(0) || disputeDAO == address(0), "Disable disputes first");
        emit BondingManagerUpdated(bondingManager, _bondingManager);
        bondingManager = _bondingManager;
    }

    /// @notice Set the DisputeDAO contract address
    /// @param _disputeDAO Address of DisputeDAO (address(0) to disable)
    function setDisputeDAO(address _disputeDAO) external onlyOwner {
        require(_isContractOrZero(_disputeDAO), "Dispute DAO must be contract");
        require(_disputeDAO == address(0) || bondingManager != address(0), "Bonding manager required");
        emit DisputeDAOUpdated(disputeDAO, _disputeDAO);
        disputeDAO = _disputeDAO;
    }

    /// @notice Set the PlayerRating contract address
    /// @param _playerRating Address of PlayerRating (address(0) to disable)
    function setPlayerRating(address _playerRating) external onlyOwner {
        require(_isContractOrZero(_playerRating), "Player rating must be contract");
        emit PlayerRatingUpdated(playerRating, _playerRating);
        playerRating = _playerRating;
    }

    /// @notice Set the RewardPool contract address
    /// @param _rewardPool Address of RewardPool (address(0) to disable)
    function setRewardPool(address _rewardPool) external onlyOwner {
        require(_isContractOrZero(_rewardPool), "Reward pool must be contract");
        emit RewardPoolUpdated(rewardPool, _rewardPool);
        rewardPool = _rewardPool;
    }

    /// @notice Transfer ownership
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid owner");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function createChessGame(ChessCore.TimeoutPreset _timeoutPreset, ChessCore.GameMode _gameMode) public payable returns (address) {
        require(msg.value >= MIN_BET, "Bet amount too low");
        require(msg.value <= MAX_BET, "Bet amount too high");

        // If bonding is enabled, verify white player has sufficient bond
        if (bondingManager != address(0)) {
            require(
                !BondingManager(payable(bondingManager)).paused(),
                "Bonding manager paused"
            );
            require(
                BondingManager(payable(bondingManager)).hasSufficientBond(msg.sender, msg.value),
                "Insufficient bond - deposit more CHESS and ETH"
            );
        }

        uint256 gameId = totalChessGames;

        // Create a minimal proxy clone of ChessCore implementation
        address clone = chessCoreImplementation.clone();

        if (bondingManager != address(0)) {
            BondingManager(payable(bondingManager)).authorizeGameContract(clone);
        }
        if (disputeDAO != address(0)) {
            DisputeDAO(disputeDAO).authorizeGameContract(clone);
        }

        // Initialize the clone with game parameters
        ChessCore(payable(clone)).initialize{value: msg.value}(
            msg.sender,
            msg.value,
            _timeoutPreset,
            _gameMode,
            gameId,
            bondingManager,
            disputeDAO,
            playerRating,
            rewardPool
        );

        deployedChessGames.push(clone);
        isDeployedGame[clone] = true;
        totalChessGames++;

        // Register game contract with RewardPool and PlayerRating for O(1) validation
        if (rewardPool != address(0)) {
            RewardPool(rewardPool).registerGameContract(clone);
        }
        if (playerRating != address(0)) {
            PlayerRating(playerRating).registerGameContract(clone);
        }

        ChessNFT(addressNFT).createGameNFT(gameId, clone, msg.sender);

        emit GameCreated(gameId, clone, msg.sender, msg.value, _timeoutPreset, _gameMode);
        return clone;
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

    function getDeployedChessGameCount() public view returns (uint256) {
        return deployedChessGames.length;
    }

    /// @notice Paginated slice of deployed games (oldest-first). Cap keeps the view callable.
    function getDeployedChessGamesPage(uint256 offset, uint256 limit) public view returns (address[] memory page) {
        require(limit > 0 && limit <= 100, "Invalid page size");

        uint256 total = deployedChessGames.length;
        if (offset >= total) {
            return new address[](0);
        }

        uint256 end = offset + limit;
        if (end > total) {
            end = total;
        }

        page = new address[](end - offset);
        for (uint256 i = 0; i < page.length;) {
            page[i] = deployedChessGames[offset + i];
            unchecked { ++i; }
        }
    }

    function _isContractOrZero(address candidate) internal view returns (bool) {
        return candidate == address(0) || candidate.code.length > 0;
    }

}
