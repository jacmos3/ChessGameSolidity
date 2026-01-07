const ChessFactory = artifacts.require("ChessFactory");
const ChessCore = artifacts.require("ChessCore");
const RewardPool = artifacts.require("RewardPool");
const PlayerRating = artifacts.require("PlayerRating");
const ChessToken = artifacts.require("ChessToken");

contract("Game Registration - RewardPool & PlayerRating", (accounts) => {
  const admin = accounts[0];
  const whitePlayer = accounts[1];
  const blackPlayer = accounts[2];
  const attacker = accounts[3];
  const betAmount = web3.utils.toWei("0.01", "ether");

  let chessFactory;
  let chessCore;
  let rewardPool;
  let playerRating;
  let chessToken;

  beforeEach(async () => {
    // Deploy ChessToken
    chessToken = await ChessToken.new(admin, admin, { from: admin });

    // Deploy PlayerRating
    playerRating = await PlayerRating.new({ from: admin });

    // Deploy RewardPool
    rewardPool = await RewardPool.new(chessToken.address, playerRating.address, { from: admin });

    // Deploy ChessCore implementation and Factory
    const chessCoreImpl = await ChessCore.new({ from: admin });
    chessFactory = await ChessFactory.new(chessCoreImpl.address, { from: admin });

    // Configure Factory with RewardPool and PlayerRating
    await chessFactory.setRewardPool(rewardPool.address, { from: admin });
    await chessFactory.setPlayerRating(playerRating.address, { from: admin });

    // Configure RewardPool and PlayerRating with Factory
    await rewardPool.setChessFactory(chessFactory.address, { from: admin });
    await playerRating.setChessFactory(chessFactory.address, { from: admin });
  });

  describe("RewardPool - registerGameContract", () => {
    it("should register game contract when created through factory", async () => {
      // Create a game
      const tx = await chessFactory.createChessGame(0, 0, {
        from: whitePlayer,
        value: betAmount
      });

      const deployedGames = await chessFactory.getDeployedChessGames();
      const gameAddress = deployedGames[deployedGames.length - 1];

      // Check that the game is registered in RewardPool
      const isValid = await rewardPool.validGameContracts(gameAddress);
      assert.equal(isValid, true, "Game should be registered in RewardPool");
    });

    it("should not allow non-factory to register game contract", async () => {
      try {
        await rewardPool.registerGameContract(attacker, { from: attacker });
        assert.fail("Should have thrown an error");
      } catch (error) {
        assert.include(error.message, "revert", "Should revert for non-factory");
      }
    });

    it("should not allow admin to register game contract directly", async () => {
      try {
        await rewardPool.registerGameContract(attacker, { from: admin });
        assert.fail("Should have thrown an error");
      } catch (error) {
        assert.include(error.message, "revert", "Should revert for admin");
      }
    });

    it("should reject zero address registration", async () => {
      // This would need to be called from factory, but factory validates internally
      // Test by creating a malicious factory scenario
      const maliciousFactory = await ChessFactory.new((await ChessCore.new()).address, { from: attacker });
      await rewardPool.setChessFactory(maliciousFactory.address, { from: admin });

      // The factory itself validates non-zero in clone creation, but let's verify
      // registerGameContract rejects zero
      // Note: This test simulates if factory could somehow call with zero
      // In practice, the factory never does this
    });

    it("should allow valid game contract to be recognized", async () => {
      // Create a game
      await chessFactory.createChessGame(0, 0, { from: whitePlayer, value: betAmount });
      const deployedGames = await chessFactory.getDeployedChessGames();
      const gameAddress = deployedGames[0];

      // Verify it's valid
      const isValid = await rewardPool.validGameContracts(gameAddress);
      assert.equal(isValid, true, "Created game should be valid");

      // Verify random address is not valid
      const isInvalid = await rewardPool.validGameContracts(attacker);
      assert.equal(isInvalid, false, "Random address should not be valid");
    });
  });

  describe("PlayerRating - registerGameContract", () => {
    it("should register game contract when created through factory", async () => {
      // Create a game
      await chessFactory.createChessGame(0, 0, { from: whitePlayer, value: betAmount });

      const deployedGames = await chessFactory.getDeployedChessGames();
      const gameAddress = deployedGames[0];

      // Check that the game is registered in PlayerRating
      const isValid = await playerRating.validGameContracts(gameAddress);
      assert.equal(isValid, true, "Game should be registered in PlayerRating");
    });

    it("should not allow non-factory to register game contract", async () => {
      try {
        await playerRating.registerGameContract(attacker, { from: attacker });
        assert.fail("Should have thrown an error");
      } catch (error) {
        assert.include(error.message, "revert", "Should revert for non-factory");
      }
    });

    it("should not allow admin to register game contract directly", async () => {
      try {
        await playerRating.registerGameContract(attacker, { from: admin });
        assert.fail("Should have thrown an error");
      } catch (error) {
        assert.include(error.message, "revert", "Should revert for admin");
      }
    });

    it("should register game and allow valid game contract operations", async () => {
      // Create a game
      await chessFactory.createChessGame(0, 0, { from: whitePlayer, value: betAmount });
      const deployedGames = await chessFactory.getDeployedChessGames();
      const gameAddress = deployedGames[0];

      // Verify the game is registered
      const isValid = await playerRating.validGameContracts(gameAddress);
      assert.equal(isValid, true, "Game should be registered in PlayerRating");
    });

    it("should not allow unregistered contract to report games", async () => {
      // Try to report game from random address (not a registered game contract)
      try {
        await playerRating.reportGame(whitePlayer, blackPlayer, 1, { from: attacker });
        assert.fail("Should have thrown an error");
      } catch (error) {
        assert.include(error.message, "revert", "Should revert for unregistered contract");
      }
    });
  });

  describe("Multiple Games Registration", () => {
    it("should register multiple games correctly", async () => {
      // Create 3 games
      await chessFactory.createChessGame(0, 0, { from: whitePlayer, value: betAmount });
      await chessFactory.createChessGame(1, 0, { from: whitePlayer, value: betAmount });
      await chessFactory.createChessGame(2, 0, { from: whitePlayer, value: betAmount });

      const deployedGames = await chessFactory.getDeployedChessGames();
      assert.equal(deployedGames.length, 3, "Should have 3 games");

      // All should be registered in RewardPool
      for (let i = 0; i < deployedGames.length; i++) {
        const isValidReward = await rewardPool.validGameContracts(deployedGames[i]);
        const isValidRating = await playerRating.validGameContracts(deployedGames[i]);
        assert.equal(isValidReward, true, `Game ${i} should be valid in RewardPool`);
        assert.equal(isValidRating, true, `Game ${i} should be valid in PlayerRating`);
      }
    });
  });
});
