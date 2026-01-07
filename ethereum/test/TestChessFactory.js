const ChessCore = artifacts.require("ChessCore");
const ChessFactory = artifacts.require("ChessFactory");

contract("ChessFactory", (accounts) => {
  let chessFactory;
  let chessCoreImpl;

  before(async () => {
    // Deploy ChessCore implementation first
    chessCoreImpl = await ChessCore.new();
    // Pass implementation address to factory
    chessFactory = await ChessFactory.new(chessCoreImpl.address);
  });

  //it("should deploy NFT", async () => {
    //await chessFactory.deployNFT({ from: accounts[0] });
    //const deployedNFT = await chessFactory.addressNFT();

    //assert.notEqual(deployedNFT, "0x0000000000000000000000000000000000000000", "Address should not be zero");
  //});

  it("should create chess game", async () => {
    const initialChessGames = await chessFactory.totalChessGames();
    // TimeoutPreset: 0=Finney, 1=Buterin, 2=Nakamoto
    await chessFactory.createChessGame(2, 0, { from: accounts[0], value: web3.utils.toWei("1", "ether") });
    const newChessGames = await chessFactory.totalChessGames();

    assert.equal(newChessGames.toNumber(), (initialChessGames + 1), "Total number of ChessGame should be increased by 1");
  });

  it("should get deployed chess games", async () => {
    await chessFactory.createChessGame(2, 0, { from: accounts[0], value: web3.utils.toWei("1", "ether") });
    await chessFactory.createChessGame(2, 0, { from: accounts[0], value: web3.utils.toWei("1", "ether") });

    const deployedGames = await chessFactory.getDeployedChessGames();

    assert.notEqual(deployedGames.length, 0, "deployedChessGame array should not be empty!");

    deployedGames.forEach((game) => {
      assert.notEqual(game, "0x0000000000000000000000000000000000000000", "Contract address should not be zero");
    });
  });
});