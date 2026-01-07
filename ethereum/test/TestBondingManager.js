const ChessToken = artifacts.require("ChessToken");
const BondingManager = artifacts.require("BondingManager");

contract("BondingManager", (accounts) => {
  const admin = accounts[0];
  const teamWallet = accounts[1];
  const treasury = accounts[2];
  const player1 = accounts[3];
  const player2 = accounts[4];
  const gameManager = accounts[5];
  const disputeManager = accounts[6];

  let chessToken;
  let bondingManager;

  const initialPrice = web3.utils.toWei("0.001", "ether"); // 1 CHESS = 0.001 ETH

  beforeEach(async () => {
    chessToken = await ChessToken.new(teamWallet, treasury, { from: admin });
    bondingManager = await BondingManager.new(chessToken.address, initialPrice, { from: admin });

    // Grant roles
    const GAME_MANAGER_ROLE = await bondingManager.GAME_MANAGER_ROLE();
    const DISPUTE_MANAGER_ROLE = await bondingManager.DISPUTE_MANAGER_ROLE();
    await bondingManager.grantRole(GAME_MANAGER_ROLE, gameManager, { from: admin });
    await bondingManager.grantRole(DISPUTE_MANAGER_ROLE, disputeManager, { from: admin });

    // Add bonding manager as minter and mint tokens for players
    await chessToken.addMinter(bondingManager.address, { from: admin });

    // Mint tokens to players for testing
    const mintAmount = web3.utils.toWei("10000", "ether");
    await chessToken.mintPlayToEarn(player1, mintAmount, { from: admin });
    await chessToken.mintPlayToEarn(player2, mintAmount, { from: admin });

    // Approve bonding manager to spend tokens
    await chessToken.approve(bondingManager.address, mintAmount, { from: player1 });
    await chessToken.approve(bondingManager.address, mintAmount, { from: player2 });
  });

  describe("Deployment", () => {
    it("should set correct token address", async () => {
      const token = await bondingManager.chessToken();
      assert.equal(token, chessToken.address);
    });

    it("should set correct initial price", async () => {
      const price = await bondingManager.chessEthPrice();
      assert.equal(price.toString(), initialPrice);
    });

    it("should set default multipliers", async () => {
      const chessMultiplier = await bondingManager.chessMultiplier();
      const ethMultiplier = await bondingManager.ethMultiplier();
      assert.equal(chessMultiplier.toString(), "3");
      assert.equal(ethMultiplier.toString(), "2");
    });
  });

  describe("Deposit Bond", () => {
    it("should deposit CHESS bond", async () => {
      const chessAmount = web3.utils.toWei("1000", "ether");
      await bondingManager.depositBond(chessAmount, { from: player1, value: 0 });

      const bond = await bondingManager.bonds(player1);
      assert.equal(bond.chessAmount.toString(), chessAmount);
    });

    it("should deposit ETH bond", async () => {
      const ethAmount = web3.utils.toWei("1", "ether");
      await bondingManager.depositBond(0, { from: player1, value: ethAmount });

      const bond = await bondingManager.bonds(player1);
      assert.equal(bond.ethAmount.toString(), ethAmount);
    });

    it("should deposit hybrid bond (CHESS + ETH)", async () => {
      const chessAmount = web3.utils.toWei("1000", "ether");
      const ethAmount = web3.utils.toWei("1", "ether");

      await bondingManager.depositBond(chessAmount, { from: player1, value: ethAmount });

      const bond = await bondingManager.bonds(player1);
      assert.equal(bond.chessAmount.toString(), chessAmount);
      assert.equal(bond.ethAmount.toString(), ethAmount);
    });

    it("should update total bonded", async () => {
      const chessAmount = web3.utils.toWei("1000", "ether");
      const ethAmount = web3.utils.toWei("1", "ether");

      await bondingManager.depositBond(chessAmount, { from: player1, value: ethAmount });

      const totalChess = await bondingManager.totalChessBonded();
      const totalEth = await bondingManager.totalEthBonded();
      assert.equal(totalChess.toString(), chessAmount);
      assert.equal(totalEth.toString(), ethAmount);
    });

    it("should reject deposit of nothing", async () => {
      try {
        await bondingManager.depositBond(0, { from: player1, value: 0 });
        assert.fail("Should have reverted");
      } catch (error) {
        assert.include(error.message, "revert");
      }
    });
  });

  describe("Withdraw Bond", () => {
    beforeEach(async () => {
      const chessAmount = web3.utils.toWei("1000", "ether");
      const ethAmount = web3.utils.toWei("1", "ether");
      await bondingManager.depositBond(chessAmount, { from: player1, value: ethAmount });
    });

    it("should withdraw CHESS bond", async () => {
      const withdrawAmount = web3.utils.toWei("500", "ether");
      const balanceBefore = await chessToken.balanceOf(player1);

      await bondingManager.withdrawBond(withdrawAmount, 0, { from: player1 });

      const balanceAfter = await chessToken.balanceOf(player1);
      const diff = web3.utils.toBN(balanceAfter).sub(web3.utils.toBN(balanceBefore));
      assert.equal(diff.toString(), withdrawAmount);
    });

    it("should withdraw ETH bond", async () => {
      const withdrawAmount = web3.utils.toWei("0.5", "ether");
      const balanceBefore = web3.utils.toBN(await web3.eth.getBalance(player1));

      const tx = await bondingManager.withdrawBond(0, withdrawAmount, { from: player1 });
      const gasUsed = web3.utils.toBN(tx.receipt.gasUsed);
      const gasPrice = web3.utils.toBN((await web3.eth.getTransaction(tx.tx)).gasPrice);
      const gasCost = gasUsed.mul(gasPrice);

      const balanceAfter = web3.utils.toBN(await web3.eth.getBalance(player1));
      const diff = balanceAfter.add(gasCost).sub(balanceBefore);
      assert.equal(diff.toString(), withdrawAmount);
    });

    it("should reject withdrawal of more than available", async () => {
      const overAmount = web3.utils.toWei("2000", "ether");
      try {
        await bondingManager.withdrawBond(overAmount, 0, { from: player1 });
        assert.fail("Should have reverted");
      } catch (error) {
        assert.include(error.message, "revert");
      }
    });
  });

  describe("Calculate Required Bond", () => {
    it("should calculate correct bond for stake", async () => {
      const stake = web3.utils.toWei("0.1", "ether");
      const result = await bondingManager.calculateRequiredBond(stake);

      // ETH required = stake * 2 = 0.2 ETH
      assert.equal(result.ethRequired.toString(), web3.utils.toWei("0.2", "ether"));

      // CHESS required = (stake * 3) / price = (0.1 * 3) / 0.001 = 300 CHESS
      assert.equal(result.chessRequired.toString(), web3.utils.toWei("300", "ether"));
    });
  });

  describe("Lock Bond for Game", () => {
    beforeEach(async () => {
      const chessAmount = web3.utils.toWei("1000", "ether");
      const ethAmount = web3.utils.toWei("1", "ether");
      await bondingManager.depositBond(chessAmount, { from: player1, value: ethAmount });
    });

    it("should lock bond for game", async () => {
      const gameId = 1;
      const stake = web3.utils.toWei("0.1", "ether");

      await bondingManager.lockBondForGame(gameId, player1, stake, { from: gameManager });

      const bond = await bondingManager.bonds(player1);
      assert.isTrue(web3.utils.toBN(bond.lockedChess).gt(web3.utils.toBN("0")));
      assert.isTrue(web3.utils.toBN(bond.lockedEth).gt(web3.utils.toBN("0")));
    });

    it("should track game bond", async () => {
      const gameId = 1;
      const stake = web3.utils.toWei("0.1", "ether");

      await bondingManager.lockBondForGame(gameId, player1, stake, { from: gameManager });

      const gameBond = await bondingManager.gameBonds(gameId, player1);
      assert.equal(gameBond.player, player1);
      assert.isFalse(gameBond.released);
      assert.isFalse(gameBond.slashed);
    });

    it("should reject lock without sufficient bond", async () => {
      const gameId = 1;
      const stake = web3.utils.toWei("10", "ether"); // Too high

      try {
        await bondingManager.lockBondForGame(gameId, player1, stake, { from: gameManager });
        assert.fail("Should have reverted");
      } catch (error) {
        assert.include(error.message, "revert");
      }
    });

    it("should reject lock from non-game-manager", async () => {
      const gameId = 1;
      const stake = web3.utils.toWei("0.1", "ether");

      try {
        await bondingManager.lockBondForGame(gameId, player1, stake, { from: player2 });
        assert.fail("Should have reverted");
      } catch (error) {
        assert.include(error.message, "revert");
      }
    });
  });

  describe("Release Bond", () => {
    const gameId = 1;
    const stake = web3.utils.toWei("0.1", "ether");

    beforeEach(async () => {
      const chessAmount = web3.utils.toWei("1000", "ether");
      const ethAmount = web3.utils.toWei("1", "ether");
      await bondingManager.depositBond(chessAmount, { from: player1, value: ethAmount });
      await bondingManager.lockBondForGame(gameId, player1, stake, { from: gameManager });
    });

    it("should release bond after game", async () => {
      const bondBefore = await bondingManager.bonds(player1);
      const lockedBefore = bondBefore.lockedChess;

      await bondingManager.releaseBond(gameId, player1, { from: gameManager });

      const bondAfter = await bondingManager.bonds(player1);
      assert.isTrue(web3.utils.toBN(bondAfter.lockedChess).lt(web3.utils.toBN(lockedBefore)));
    });

    it("should mark game bond as released", async () => {
      await bondingManager.releaseBond(gameId, player1, { from: gameManager });

      const gameBond = await bondingManager.gameBonds(gameId, player1);
      assert.isTrue(gameBond.released);
    });

    it("should reject double release", async () => {
      await bondingManager.releaseBond(gameId, player1, { from: gameManager });

      try {
        await bondingManager.releaseBond(gameId, player1, { from: gameManager });
        assert.fail("Should have reverted");
      } catch (error) {
        assert.include(error.message, "revert");
      }
    });
  });

  describe("Slash Bond", () => {
    const gameId = 1;
    const stake = web3.utils.toWei("0.1", "ether");

    beforeEach(async () => {
      const chessAmount = web3.utils.toWei("1000", "ether");
      const ethAmount = web3.utils.toWei("1", "ether");
      await bondingManager.depositBond(chessAmount, { from: player1, value: ethAmount });
      await bondingManager.lockBondForGame(gameId, player1, stake, { from: gameManager });
    });

    it("should slash bond for cheater", async () => {
      const bondBefore = await bondingManager.bonds(player1);

      await bondingManager.slashBond(gameId, player1, { from: disputeManager });

      const bondAfter = await bondingManager.bonds(player1);
      assert.isTrue(web3.utils.toBN(bondAfter.chessAmount).lt(web3.utils.toBN(bondBefore.chessAmount)));
    });

    it("should burn slashed CHESS tokens", async () => {
      const supplyBefore = await chessToken.totalSupply();

      await bondingManager.slashBond(gameId, player1, { from: disputeManager });

      const supplyAfter = await chessToken.totalSupply();
      assert.isTrue(web3.utils.toBN(supplyAfter).lt(web3.utils.toBN(supplyBefore)));
    });

    it("should track total slashed", async () => {
      await bondingManager.slashBond(gameId, player1, { from: disputeManager });

      const totalSlashed = await bondingManager.totalChessSlashed();
      assert.isTrue(web3.utils.toBN(totalSlashed).gt(web3.utils.toBN("0")));
    });

    it("should mark game bond as slashed", async () => {
      await bondingManager.slashBond(gameId, player1, { from: disputeManager });

      const gameBond = await bondingManager.gameBonds(gameId, player1);
      assert.isTrue(gameBond.slashed);
    });
  });

  describe("Price Update & Circuit Breaker", () => {
    it("should update price", async () => {
      const newPrice = web3.utils.toWei("0.0012", "ether");
      await bondingManager.updatePrice(newPrice, { from: admin });

      const price = await bondingManager.chessEthPrice();
      assert.equal(price.toString(), newPrice);
    });

    it("should trigger circuit breaker on large price change", async () => {
      // 60% change (over 50% threshold)
      const newPrice = web3.utils.toWei("0.0016", "ether");
      await bondingManager.updatePrice(newPrice, { from: admin });

      const isPaused = await bondingManager.paused();
      assert.isTrue(isPaused);
    });

    it("should not trigger circuit breaker on small price change", async () => {
      // 20% change (under 50% threshold)
      const newPrice = web3.utils.toWei("0.0012", "ether");
      await bondingManager.updatePrice(newPrice, { from: admin });

      const isPaused = await bondingManager.paused();
      assert.isFalse(isPaused);
    });

    it("should reject deposits when paused", async () => {
      // Trigger circuit breaker
      const newPrice = web3.utils.toWei("0.002", "ether");
      await bondingManager.updatePrice(newPrice, { from: admin });

      try {
        await bondingManager.depositBond(web3.utils.toWei("100", "ether"), { from: player1 });
        assert.fail("Should have reverted");
      } catch (error) {
        assert.include(error.message, "revert");
      }
    });

    it("should allow admin to unpause", async () => {
      // Trigger and unpause
      const newPrice = web3.utils.toWei("0.002", "ether");
      await bondingManager.updatePrice(newPrice, { from: admin });
      await bondingManager.unpause({ from: admin });

      const isPaused = await bondingManager.paused();
      assert.isFalse(isPaused);
    });

    it("should reject price below MIN_PRICE floor", async () => {
      // MIN_PRICE is 1e12 (0.000001 ETH)
      const belowMinPrice = "999999999999"; // Just below 1e12

      try {
        await bondingManager.updatePrice(belowMinPrice, { from: admin });
        assert.fail("Should have reverted");
      } catch (error) {
        assert.include(error.message, "revert");
      }
    });

    it("should have MIN_PRICE constant set correctly", async () => {
      const minPrice = await bondingManager.MIN_PRICE();
      assert.equal(minPrice.toString(), "1000000000000"); // 1e12
    });
  });

  describe("View Functions", () => {
    beforeEach(async () => {
      const chessAmount = web3.utils.toWei("1000", "ether");
      const ethAmount = web3.utils.toWei("1", "ether");
      await bondingManager.depositBond(chessAmount, { from: player1, value: ethAmount });
    });

    it("should return available bond", async () => {
      const available = await bondingManager.getAvailableBond(player1);
      assert.equal(available.chess.toString(), web3.utils.toWei("1000", "ether"));
      assert.equal(available.eth.toString(), web3.utils.toWei("1", "ether"));
    });

    it("should check sufficient bond correctly", async () => {
      const stake = web3.utils.toWei("0.1", "ether");
      const hasSufficient = await bondingManager.hasSufficientBond(player1, stake);
      assert.isTrue(hasSufficient);
    });

    it("should return false for insufficient bond", async () => {
      const stake = web3.utils.toWei("10", "ether");
      const hasSufficient = await bondingManager.hasSufficientBond(player1, stake);
      assert.isFalse(hasSufficient);
    });
  });

  describe("Admin Functions", () => {
    it("should allow admin to set multipliers", async () => {
      await bondingManager.setMultipliers(4, 3, { from: admin });

      const chessMultiplier = await bondingManager.chessMultiplier();
      const ethMultiplier = await bondingManager.ethMultiplier();
      assert.equal(chessMultiplier.toString(), "4");
      assert.equal(ethMultiplier.toString(), "3");
    });

    it("should allow admin to set min bond ETH value", async () => {
      const newMin = web3.utils.toWei("0.05", "ether");
      await bondingManager.setMinBondEthValue(newMin, { from: admin });

      const minValue = await bondingManager.minBondEthValue();
      assert.equal(minValue.toString(), newMin);
    });
  });
});
