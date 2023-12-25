const Base64Library = artifacts.require("Utility/Base64Library");
const ChessMediaLibrary = artifacts.require("ChesS/ChessMediaLibrary");
const ChessFactory = artifacts.require("Chess/ChessFactory");
const ChessNFT = artifacts.require("Chess/ChessNFT");
const ChessCore = artifacts.require("Chess/ChessCore");
module.exports = function(deployer) {
  deployer.deploy(Base64Library);
  deployer.link(Base64Library, ChessMediaLibrary);
  deployer.deploy(ChessMediaLibrary);
  deployer.link(ChessMediaLibrary, ChessFactory);
  deployer.link(ChessMediaLibrary, ChessNFT);
  deployer.deploy(ChessFactory /*, {gas:6700000}*/);
};
