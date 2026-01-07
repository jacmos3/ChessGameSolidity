// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import "./ChessMediaLibrary.sol";

interface IChessCore {
    function printChessBoardLayoutSVG() external view returns (string memory);
}
    
contract ChessNFT is ERC721Enumerable, Ownable {
    using ChessMediaLibrary for uint8[8][8];

    // Game ID => ChessCore address (single source of truth)
    mapping(uint256 => address) public gameNFTs;

    address public immutable factory;

    event GameNFTCreated(uint256 indexed gameId, address indexed gameAddress, address indexed owner);

    modifier onlyFactory() {
        require(msg.sender == factory, "Only factory can mint NFTs");
        _;
    }

    constructor(address _initialOwner) ERC721("ChessNFT", "Chess") Ownable(_initialOwner) {
        factory = msg.sender; // ChessFactory is the deployer
    }

    /// @notice Get the SVG representation of the game board
    /// @param _tokenId The game/token ID
    function tokenURI(uint256 _tokenId) public view virtual override returns (string memory) {
        address gameAddress = gameNFTs[_tokenId];
        require(gameAddress != address(0), "Token does not exist");
        IChessCore c = IChessCore(gameAddress);
        return c.printChessBoardLayoutSVG();
    }

    /// @notice Create an NFT for a new game
    /// @param gameId The unique game identifier
    /// @param _chessCoreAddress The address of the ChessCore contract
    /// @param _whitePlayer The white player who will own the NFT
    function createGameNFT(uint256 gameId, address _chessCoreAddress, address _whitePlayer) external onlyFactory {
        require(gameNFTs[gameId] == address(0), "NFT for the game already exists");
        require(_chessCoreAddress != address(0), "Invalid game address");

        gameNFTs[gameId] = _chessCoreAddress;
        _mint(_whitePlayer, gameId);

        emit GameNFTCreated(gameId, _chessCoreAddress, _whitePlayer);
    }

    /// @notice Get the game address for a token
    /// @param tokenId The token ID
    function getGameAddress(uint256 tokenId) external view returns (address) {
        return gameNFTs[tokenId];
    }
}