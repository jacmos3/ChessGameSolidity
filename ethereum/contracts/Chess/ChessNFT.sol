// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import "./ChessMediaLibrary.sol";

interface IChessCore {
    function printChessBoardLayoutSVG() external view returns (string memory);
}
    
contract ChessNFT is ERC721Enumerable, Ownable {
    using ChessMediaLibrary for uint8[8][8];
    mapping(uint256 => address) public gameNFTs;
    address[] public gameAddresses;
    

    constructor(address _initialOwner) ERC721("ChessNFT", "Chess") Ownable(_initialOwner) {
        //transferOwnership(_initialOwner);
    }
    
    function tokenURI(uint256 _tokenId) public view virtual override returns (string memory) {
        address gameAddress = gameAddresses[_tokenId];
        IChessCore c = IChessCore(gameAddress);
        return c.printChessBoardLayoutSVG();
    }

    function createGameNFT(uint256 gameId, address _chessCoreAddress) external {
        require(gameNFTs[gameId] == address(0), "NFT for the game already exists");
        gameAddresses.push(_chessCoreAddress);
        _mint(msg.sender, gameId);
        gameNFTs[gameId] = msg.sender;
    }

}