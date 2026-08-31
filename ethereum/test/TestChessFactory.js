const ChessCore = artifacts.require("ChessCore");
const ChessFactory = artifacts.require("ChessFactory");
const ChessToken = artifacts.require("ChessToken");
const BondingManager = artifacts.require("BondingManager");

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
    const deployedGames = await chessFactory.getDeployedChessGames();
    const createdGame = deployedGames[deployedGames.length - 1];

    assert.equal(newChessGames.toNumber(), (initialChessGames + 1), "Total number of ChessGame should be increased by 1");
    assert.isTrue(await chessFactory.isDeployedGame(createdGame), "Created game must be registered");
    assert.isFalse(await chessFactory.isDeployedGame(accounts[1]), "Arbitrary addresses must not be registered");
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

  it("should paginate deployed chess games", async () => {
    const count = await chessFactory.getDeployedChessGameCount();
    const allGames = await chessFactory.getDeployedChessGames();
    assert.equal(count.toNumber(), allGames.length);

    const firstPage = await chessFactory.getDeployedChessGamesPage(0, 1);
    assert.equal(firstPage.length, 1);
    assert.equal(firstPage[0], allGames[0]);

    const emptyPage = await chessFactory.getDeployedChessGamesPage(allGames.length, 1);
    assert.equal(emptyPage.length, 0);
  });

  it("should reject an EOA as ChessCore implementation", async () => {
    let deploymentFailed = false;
    try {
      await ChessFactory.new(accounts[1]);
    } catch (error) {
      deploymentFailed = true;
    }
    assert.isTrue(deploymentFailed, "Factory deployment should reject an EOA implementation");

    try {
      await chessFactory.setImplementation(accounts[1], { from: accounts[0] });
      assert.fail("Should have reverted");
    } catch (error) {
      assert.include(error.message, "revert");
    }
  });

  it("should reject contract dependencies that point to EOAs", async () => {
    for (const setter of ["setBondingManager", "setDisputeDAO", "setPlayerRating", "setRewardPool"]) {
      try {
        await chessFactory[setter](accounts[1], { from: accounts[0] });
        assert.fail(`${setter} should have reverted`);
      } catch (error) {
        assert.include(error.message, "revert");
      }
    }
  });

  it("should not enable disputes without a bonding manager", async () => {
    try {
      await chessFactory.setDisputeDAO(chessCoreImpl.address, { from: accounts[0] });
      assert.fail("Should have reverted");
    } catch (error) {
      assert.include(error.message, "revert");
    }
  });

  it("should reject new games while the bonding circuit breaker is paused", async () => {
    const token = await ChessToken.new(accounts[1], accounts[2], { from: accounts[0] });
    const manager = await BondingManager.new(
      token.address,
      web3.utils.toWei("0.001", "ether"),
      { from: accounts[0] }
    );
    const guardedFactory = await ChessFactory.new(chessCoreImpl.address, { from: accounts[0] });
    await guardedFactory.setBondingManager(manager.address, { from: accounts[0] });
    await manager.updatePrice(web3.utils.toWei("0.002", "ether"), { from: accounts[0] });
    assert.isTrue(await manager.circuitBreakerTripped(), "The oracle move should trip the circuit breaker");
    assert.isTrue(await manager.paused(), "A tripped circuit breaker should pause bonding");

    const before = await guardedFactory.totalChessGames();
    try {
      await guardedFactory.createChessGame(2, 0, {
        from: accounts[0],
        value: web3.utils.toWei("0.001", "ether")
      });
      assert.fail("Should have reverted while bonding is paused");
    } catch (error) {
      assert.include(error.message, "revert");
    }
    assert.equal((await guardedFactory.totalChessGames()).toString(), before.toString());
  });
});
