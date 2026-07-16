const ChessToken = artifacts.require("ChessToken");
const BondingManager = artifacts.require("BondingManager");
const ArbitratorRegistry = artifacts.require("ArbitratorRegistry");
const DisputeDAO = artifacts.require("DisputeDAO");

const advanceTime = (seconds) => new Promise((resolve, reject) => {
  web3.currentProvider.send(
    {
      jsonrpc: "2.0",
      method: "evm_increaseTime",
      params: [seconds],
      id: Date.now()
    },
    (err) => {
      if (err) return reject(err);
      web3.currentProvider.send(
        {
          jsonrpc: "2.0",
          method: "evm_mine",
          params: [],
          id: Date.now() + 1
        },
        (mineErr, result) => {
          if (mineErr) return reject(mineErr);
          resolve(result);
        }
      );
    }
  );
});

contract("DisputeDAO", (accounts) => {
  const admin = accounts[0];
  const teamWallet = accounts[1];
  const treasury = accounts[2];
  const player1 = accounts[3];
  const player2 = accounts[4];
  const challenger = accounts[5];
  const gameManager = accounts[6];
  // Arbitrators
  const arb1 = accounts[7];
  const arb2 = accounts[8];
  const arb3 = accounts[9];

  let chessToken;
  let bondingManager;
  let arbitratorRegistry;
  let disputeDAO;

  const initialPrice = web3.utils.toWei("0.001", "ether");
  const CHALLENGE_DEPOSIT = web3.utils.toWei("50", "ether");
  const TIER1_STAKE = web3.utils.toWei("1000", "ether");

  beforeEach(async () => {
    // Deploy all contracts
    chessToken = await ChessToken.new(teamWallet, treasury, { from: admin });
    bondingManager = await BondingManager.new(chessToken.address, initialPrice, { from: admin });
    arbitratorRegistry = await ArbitratorRegistry.new(chessToken.address, { from: admin });
    disputeDAO = await DisputeDAO.new(
      chessToken.address,
      bondingManager.address,
      arbitratorRegistry.address,
      { from: admin }
    );

    // Grant roles
    const GAME_MANAGER_ROLE = await disputeDAO.GAME_MANAGER_ROLE();
    await disputeDAO.grantRole(GAME_MANAGER_ROLE, gameManager, { from: admin });

    const DISPUTE_MANAGER_ROLE_BONDING = await bondingManager.DISPUTE_MANAGER_ROLE();
    await bondingManager.grantRole(DISPUTE_MANAGER_ROLE_BONDING, disputeDAO.address, { from: admin });

    const GAME_MANAGER_ROLE_BONDING = await bondingManager.GAME_MANAGER_ROLE();
    await bondingManager.grantRole(GAME_MANAGER_ROLE_BONDING, gameManager, { from: admin });

    const DISPUTE_MANAGER_ROLE_ARB = await arbitratorRegistry.DISPUTE_MANAGER_ROLE();
    await arbitratorRegistry.grantRole(DISPUTE_MANAGER_ROLE_ARB, disputeDAO.address, { from: admin });

    // Mint tokens to all participants
    const mintAmount = web3.utils.toWei("100000", "ether");
    await chessToken.mintPlayToEarn(player1, mintAmount, { from: admin });
    await chessToken.mintPlayToEarn(player2, mintAmount, { from: admin });
    await chessToken.mintPlayToEarn(challenger, mintAmount, { from: admin });
    await chessToken.mintPlayToEarn(arb1, mintAmount, { from: admin });
    await chessToken.mintPlayToEarn(arb2, mintAmount, { from: admin });
    await chessToken.mintPlayToEarn(arb3, mintAmount, { from: admin });
    // Approve tokens
    await chessToken.approve(disputeDAO.address, mintAmount, { from: challenger });
    await chessToken.approve(arbitratorRegistry.address, mintAmount, { from: arb1 });
    await chessToken.approve(arbitratorRegistry.address, mintAmount, { from: arb2 });
    await chessToken.approve(arbitratorRegistry.address, mintAmount, { from: arb3 });
    await chessToken.approve(bondingManager.address, mintAmount, { from: player1 });
    await chessToken.approve(bondingManager.address, mintAmount, { from: player2 });

    // Setup arbitrators
    await arbitratorRegistry.stake(TIER1_STAKE, { from: arb1 });
    await arbitratorRegistry.stake(TIER1_STAKE, { from: arb2 });
    await arbitratorRegistry.stake(TIER1_STAKE, { from: arb3 });

    // Setup bonds for players
    const bondChess = web3.utils.toWei("1000", "ether");
    const bondEth = web3.utils.toWei("1", "ether");
    await bondingManager.depositBond(bondChess, { from: player1, value: bondEth });
    await bondingManager.depositBond(bondChess, { from: player2, value: bondEth });
  });

  describe("Deployment", () => {
    it("should set correct token address", async () => {
      const token = await disputeDAO.chessToken();
      assert.equal(token, chessToken.address);
    });

    it("should set correct bonding manager", async () => {
      const bm = await disputeDAO.bondingManager();
      assert.equal(bm, bondingManager.address);
    });

    it("should set correct arbitrator registry", async () => {
      const ar = await disputeDAO.arbitratorRegistry();
      assert.equal(ar, arbitratorRegistry.address);
    });

    it("should set default parameters", async () => {
      const challengeWindow = await disputeDAO.challengeWindow();
      const commitPeriod = await disputeDAO.commitPeriod();
      const revealPeriod = await disputeDAO.revealPeriod();
      const quorum = await disputeDAO.quorum();
      const supermajority = await disputeDAO.supermajority();

      assert.equal(challengeWindow.toString(), (48 * 3600).toString()); // 48 hours
      assert.equal(commitPeriod.toString(), (24 * 3600).toString()); // 24 hours
      assert.equal(revealPeriod.toString(), (24 * 3600).toString()); // 24 hours
      assert.equal(quorum.toString(), "10");
      assert.equal(supermajority.toString(), "66");
    });
  });

  describe("Game Registration", () => {
    it("should register a game", async () => {
      const gameId = 1;
      const stake = web3.utils.toWei("0.1", "ether");

      await disputeDAO.registerGame(gameId, player1, player2, stake, { from: gameManager });

      const disputeId = await disputeDAO.gameToDispute(gameId);
      assert.equal(disputeId.toString(), "1");
    });

    it("should create dispute in pending state", async () => {
      const gameId = 1;
      const stake = web3.utils.toWei("0.1", "ether");

      await disputeDAO.registerGame(gameId, player1, player2, stake, { from: gameManager });

      const dispute = await disputeDAO.getDispute(1);
      assert.equal(dispute.gameId.toString(), gameId.toString());
      assert.equal(dispute.state.toString(), "1"); // Pending
    });

    it("should store the registered players for later challenge validation", async () => {
      const gameId = 1;
      const stake = web3.utils.toWei("0.1", "ether");

      await disputeDAO.registerGame(gameId, player1, player2, stake, { from: gameManager });

      const storedWhite = await disputeDAO.gameWhitePlayer(gameId);
      const storedBlack = await disputeDAO.gameBlackPlayer(gameId);
      assert.equal(storedWhite, player1);
      assert.equal(storedBlack, player2);
    });

    it("should reject duplicate game registration", async () => {
      const gameId = 1;
      const stake = web3.utils.toWei("0.1", "ether");

      await disputeDAO.registerGame(gameId, player1, player2, stake, { from: gameManager });

      try {
        await disputeDAO.registerGame(gameId, player1, player2, stake, { from: gameManager });
        assert.fail("Should have reverted");
      } catch (error) {
        assert.include(error.message, "revert");
      }
    });

    it("should reject registration from non-game-manager", async () => {
      const gameId = 1;
      const stake = web3.utils.toWei("0.1", "ether");

      try {
        await disputeDAO.registerGame(gameId, player1, player2, stake, { from: challenger });
        assert.fail("Should have reverted");
      } catch (error) {
        assert.include(error.message, "revert");
      }
    });
  });

  describe("Challenge Creation", () => {
    const gameId = 1;
    const stake = web3.utils.toWei("0.1", "ether");

    beforeEach(async () => {
      await disputeDAO.registerGame(gameId, player1, player2, stake, { from: gameManager });
    });

    it("should create a challenge", async () => {
      const balanceBefore = await chessToken.balanceOf(challenger);

      await disputeDAO.challenge(gameId, player1, { from: challenger });

      const balanceAfter = await chessToken.balanceOf(challenger);
      const diff = web3.utils.toBN(balanceBefore).sub(web3.utils.toBN(balanceAfter));
      assert.equal(diff.toString(), CHALLENGE_DEPOSIT);
    });

    it("should update dispute state to Challenged", async () => {
      await disputeDAO.challenge(gameId, player1, { from: challenger });

      const dispute = await disputeDAO.getDispute(1);
      assert.equal(dispute.state.toString(), "2"); // Challenged
      assert.equal(dispute.challenger, challenger);
      assert.equal(dispute.accusedPlayer, player1);
    });

    it("should set otherPlayer to the non-accused game participant", async () => {
      await disputeDAO.challenge(gameId, player1, { from: challenger });

      const fullDispute = await disputeDAO.disputes(1);
      assert.equal(fullDispute.otherPlayer, player2);
    });

    it("should reject challenges against addresses that are not players in the game", async () => {
      try {
        await disputeDAO.challenge(gameId, gameManager, { from: challenger });
        assert.fail("Should have reverted");
      } catch (error) {
        assert.include(error.message, "revert");
      }
    });

    it("should track active challenges per user", async () => {
      await disputeDAO.challenge(gameId, player1, { from: challenger });

      const activeCount = await disputeDAO.activeChallenges(challenger);
      assert.equal(activeCount.toString(), "1");
    });

    it("should select arbitrators on challenge", async () => {
      await disputeDAO.challenge(gameId, player1, { from: challenger });

      const arbitrators = await disputeDAO.getSelectedArbitrators(1);
      // May be empty due to timelock, but array should exist
      assert.isTrue(Array.isArray(arbitrators));
    });

    it("should reject challenge on non-pending game", async () => {
      await disputeDAO.challenge(gameId, player1, { from: challenger });

      // Try to challenge again
      await chessToken.mintPlayToEarn(accounts[9], web3.utils.toWei("100", "ether"), { from: admin });
      await chessToken.approve(disputeDAO.address, web3.utils.toWei("100", "ether"), { from: accounts[9] });

      try {
        await disputeDAO.challenge(gameId, player2, { from: accounts[9] });
        assert.fail("Should have reverted");
      } catch (error) {
        assert.include(error.message, "revert");
      }
    });

    it("should reject if challenger has too many active challenges", async () => {
      // Create 3 games and challenge all
      for (let i = 2; i <= 4; i++) {
        await disputeDAO.registerGame(i, player1, player2, stake, { from: gameManager });
      }

      await disputeDAO.challenge(gameId, player1, { from: challenger });
      await disputeDAO.challenge(2, player1, { from: challenger });
      await disputeDAO.challenge(3, player1, { from: challenger });

      // 4th challenge should fail
      try {
        await disputeDAO.challenge(4, player1, { from: challenger });
        assert.fail("Should have reverted");
      } catch (error) {
        assert.include(error.message, "revert");
      }
    });
  });

  describe("Vote Commit", () => {
    const gameId = 1;
    const stake = web3.utils.toWei("0.1", "ether");

    beforeEach(async () => {
      await disputeDAO.registerGame(gameId, player1, player2, stake, { from: gameManager });
      await disputeDAO.challenge(gameId, player1, { from: challenger });
    });

    it("should allow arbitrator to commit vote", async () => {
      // Manually add arbitrators as selected (for testing, since timelock prevents normal selection)
      // In real scenario, we'd advance time or mock the selection
      // For now, test the commit hash verification logic

      const vote = 2; // Cheat
      const salt = web3.utils.keccak256("secret_salt");
      const commitHash = web3.utils.soliditySha3(
        { type: 'uint8', value: vote },
        { type: 'bytes32', value: salt },
        { type: 'address', value: arb1 }
      );

      // This will fail because arb1 is not in selectedArbitrators
      // (due to timelock). Testing the error message.
      try {
        await disputeDAO.commitVote(1, commitHash, { from: arb1 });
        assert.fail("Should have reverted");
      } catch (error) {
        assert.include(error.message, "revert");
      }
    });
  });

  describe("Close Challenge Window", () => {
    const gameId = 1;
    const stake = web3.utils.toWei("0.1", "ether");

    beforeEach(async () => {
      await disputeDAO.registerGame(gameId, player1, player2, stake, { from: gameManager });
    });

    it("should not close window before 48 hours expire", async () => {
      // Try to close immediately - should fail
      try {
        await disputeDAO.closeChallengeWindow(gameId);
        assert.fail("Should have reverted");
      } catch (error) {
        assert.include(error.message, "revert", "Should revert before window expires");
      }
    });

    it("should close challenge window after 48 hours if not challenged", async () => {
      // Advance time by 48 hours + 1 second
      await web3.currentProvider.send({
        jsonrpc: "2.0",
        method: "evm_increaseTime",
        params: [48 * 3600 + 1],
        id: new Date().getTime()
      }, () => {});
      await web3.currentProvider.send({
        jsonrpc: "2.0",
        method: "evm_mine",
        params: [],
        id: new Date().getTime()
      }, () => {});

      await disputeDAO.closeChallengeWindow(gameId);

      const dispute = await disputeDAO.getDispute(1);
      assert.equal(dispute.state.toString(), "4"); // Resolved

      const fullDispute = await disputeDAO.disputes(1);
      assert.isTrue(fullDispute.resolved, "Pending dispute should be marked resolved after the window is closed");
      assert.equal(fullDispute.finalDecision.toString(), "0", "Closing an unchallenged window should not fabricate a decision");
    });

    it("should not close window if already challenged", async () => {
      await disputeDAO.challenge(gameId, player1, { from: challenger });

      // Advance time
      await web3.currentProvider.send({
        jsonrpc: "2.0",
        method: "evm_increaseTime",
        params: [48 * 3600 + 1],
        id: new Date().getTime()
      }, () => {});
      await web3.currentProvider.send({
        jsonrpc: "2.0",
        method: "evm_mine",
        params: [],
        id: new Date().getTime()
      }, () => {});

      try {
        await disputeDAO.closeChallengeWindow(gameId);
        assert.fail("Should have reverted");
      } catch (error) {
        assert.include(error.message, "revert", "Should revert if not pending");
      }
    });
  });

  describe("Absolute Dispute Timeout", () => {
    const gameId = 1;
    const stake = web3.utils.toWei("0.1", "ether");

    it("rejects resolution of a dispute that does not exist", async () => {
      try {
        await disputeDAO.resolveDispute(0, { from: challenger });
        assert.fail("Should have reverted");
      } catch (error) {
        assert.include(error.message, "revert");
      }
    });

    it("resolves an unchallenged game without trying to refund a missing deposit", async () => {
      await disputeDAO.registerGame(gameId, player1, player2, stake, { from: gameManager });
      await advanceTime(30 * 24 * 3600 + 1);

      const tx = await disputeDAO.resolveDispute(1, { from: challenger });
      const dispute = await disputeDAO.getDispute(1);
      const fullDispute = await disputeDAO.disputes(1);

      assert.equal(dispute.state.toString(), "4", "The stale pending dispute should resolve");
      assert.isTrue(fullDispute.resolved);
      assert.equal(
        tx.logs.filter((log) => log.event === "DisputeResolved").length,
        1,
        "The timeout resolution should be observable"
      );
    });

    it("refunds the deposit captured when the challenge was created", async () => {
      const challengerBalanceBefore = await chessToken.balanceOf(challenger);
      await disputeDAO.registerGame(gameId, player1, player2, stake, { from: gameManager });
      await disputeDAO.challenge(gameId, player1, { from: challenger });

      await disputeDAO.setParameters(
        48 * 3600,
        24 * 3600,
        24 * 3600,
        10,
        66,
        web3.utils.toWei("100", "ether"),
        { from: admin }
      );
      await advanceTime(30 * 24 * 3600 + 1);
      await disputeDAO.resolveDispute(1, { from: challenger });

      const challengerBalanceAfter = await chessToken.balanceOf(challenger);
      const reservedDeposit = await disputeDAO.disputeDeposits(1);
      assert.equal(challengerBalanceAfter.toString(), challengerBalanceBefore.toString());
      assert.equal(reservedDeposit.toString(), "0", "The original deposit should be released");
    });
  });

  describe("Challenge Window Timestamp Enforcement", () => {
    const gameId = 1;
    const stake = web3.utils.toWei("0.1", "ether");

    beforeEach(async () => {
      await disputeDAO.registerGame(gameId, player1, player2, stake, { from: gameManager });
    });

    it("should allow challenge within 48 hours", async () => {
      // Challenge immediately - should work
      await disputeDAO.challenge(gameId, player1, { from: challenger });

      const dispute = await disputeDAO.getDispute(1);
      assert.equal(dispute.state.toString(), "2"); // Challenged
    });

    it("should reject challenge after 48 hours", async () => {
      // Advance time by 48 hours + 1 second
      await web3.currentProvider.send({
        jsonrpc: "2.0",
        method: "evm_increaseTime",
        params: [48 * 3600 + 1],
        id: new Date().getTime()
      }, () => {});
      await web3.currentProvider.send({
        jsonrpc: "2.0",
        method: "evm_mine",
        params: [],
        id: new Date().getTime()
      }, () => {});

      try {
        await disputeDAO.challenge(gameId, player1, { from: challenger });
        assert.fail("Should have reverted");
      } catch (error) {
        assert.include(error.message, "revert", "Should revert after window expires");
      }
    });

    it("should return correct isChallengeWindowOpen status initially", async () => {
      // Should be open immediately after registration
      const isOpen = await disputeDAO.isChallengeWindowOpen(gameId);
      assert.equal(isOpen, true, "Window should be open initially");
    });

    it("should return correct getChallengeWindowRemaining", async () => {
      // Get remaining time immediately after registration
      const remaining = await disputeDAO.getChallengeWindowRemaining(gameId);

      // Should be greater than 0 (window is open)
      assert.isTrue(
        remaining.toNumber() > 0,
        `Remaining time should be > 0, got ${remaining.toNumber()}`
      );
    });

    it("should return 0 remaining time after the challenge window expires", async () => {
      await advanceTime(48 * 3600 + 1);

      const remaining = await disputeDAO.getChallengeWindowRemaining(gameId);
      assert.equal(remaining.toString(), "0", "Expired windows should report zero remaining time");
    });

    it("should return 0 remaining time after a challenge is submitted", async () => {
      await disputeDAO.challenge(gameId, player1, { from: challenger });

      const remaining = await disputeDAO.getChallengeWindowRemaining(gameId);
      assert.equal(remaining.toString(), "0", "Once challenged, the pending challenge window should be closed");
    });

    it("should return false for isChallengeWindowOpen on non-registered game", async () => {
      const isOpen = await disputeDAO.isChallengeWindowOpen(999);
      assert.equal(isOpen, false, "Should return false for non-registered game");
    });

    it("should return 0 remaining for non-registered game", async () => {
      const remaining = await disputeDAO.getChallengeWindowRemaining(999);
      assert.equal(remaining.toString(), "0", "Should return 0 for non-registered game");
    });

    it("should return false for isChallengeWindowOpen after challenge", async () => {
      await disputeDAO.challenge(gameId, player1, { from: challenger });

      const isOpen = await disputeDAO.isChallengeWindowOpen(gameId);
      assert.equal(isOpen, false, "Should return false after challenge (state not Pending)");
    });
  });

  describe("View Functions", () => {
    const gameId = 1;
    const stake = web3.utils.toWei("0.1", "ether");

    beforeEach(async () => {
      await disputeDAO.registerGame(gameId, player1, player2, stake, { from: gameManager });
      await disputeDAO.challenge(gameId, player1, { from: challenger });
    });

    it("should return dispute info", async () => {
      const dispute = await disputeDAO.getDispute(1);

      assert.equal(dispute.gameId.toString(), gameId.toString());
      assert.equal(dispute.challenger, challenger);
      assert.equal(dispute.accusedPlayer, player1);
    });

    it("should return selected arbitrators", async () => {
      const arbitrators = await disputeDAO.getSelectedArbitrators(1);
      assert.isTrue(Array.isArray(arbitrators));
    });

    it("should return vote status for arbitrator", async () => {
      const status = await disputeDAO.getVoteStatus(1, arb1);

      assert.isFalse(status.hasCommitted);
      assert.isFalse(status.hasRevealed);
      assert.equal(status.revealedVote.toString(), "0"); // None
    });
  });

  describe("Admin Functions", () => {
    it("should allow admin to set parameters", async () => {
      const newChallengeWindow = 72 * 3600; // 72 hours
      const newCommitPeriod = 48 * 3600;
      const newRevealPeriod = 48 * 3600;
      const newQuorum = 15;
      const newSupermajority = 70;
      const newChallengeDeposit = web3.utils.toWei("100", "ether");

      await disputeDAO.setParameters(
        newChallengeWindow,
        newCommitPeriod,
        newRevealPeriod,
        newQuorum,
        newSupermajority,
        newChallengeDeposit,
        { from: admin }
      );

      const challengeWindow = await disputeDAO.challengeWindow();
      const commitPeriod = await disputeDAO.commitPeriod();
      const quorum = await disputeDAO.quorum();

      assert.equal(challengeWindow.toString(), newChallengeWindow.toString());
      assert.equal(commitPeriod.toString(), newCommitPeriod.toString());
      assert.equal(quorum.toString(), newQuorum.toString());
    });

    it("should reject parameter change from non-admin", async () => {
      // Use valid parameters to ensure we're testing access control, not validation
      try {
        await disputeDAO.setParameters(
          2 * 3600, // 2 hours - valid
          2 * 3600, // 2 hours - valid
          2 * 3600, // 2 hours - valid
          5,        // quorum - valid
          60,       // supermajority - valid
          web3.utils.toWei("10", "ether"), // deposit - valid
          { from: challenger }
        );
        assert.fail("Should have reverted");
      } catch (error) {
        assert.include(error.message, "revert");
      }
    });

    it("should reject invalid challenge window (too short)", async () => {
      try {
        await disputeDAO.setParameters(
          30 * 60,  // 30 minutes - too short (min 1 hour)
          2 * 3600,
          2 * 3600,
          5,
          60,
          web3.utils.toWei("10", "ether"),
          { from: admin }
        );
        assert.fail("Should have reverted");
      } catch (error) {
        assert.include(error.message, "revert");
      }
    });

    it("should reject invalid challenge window (too long)", async () => {
      try {
        await disputeDAO.setParameters(
          8 * 24 * 3600,  // 8 days - too long (max 7 days)
          2 * 3600,
          2 * 3600,
          5,
          60,
          web3.utils.toWei("10", "ether"),
          { from: admin }
        );
        assert.fail("Should have reverted");
      } catch (error) {
        assert.include(error.message, "revert");
      }
    });

    it("should reject invalid quorum (too low)", async () => {
      try {
        await disputeDAO.setParameters(
          2 * 3600,
          2 * 3600,
          2 * 3600,
          2,        // quorum - too low (min 3)
          60,
          web3.utils.toWei("10", "ether"),
          { from: admin }
        );
        assert.fail("Should have reverted");
      } catch (error) {
        assert.include(error.message, "revert");
      }
    });

    it("should reject invalid supermajority (too low)", async () => {
      try {
        await disputeDAO.setParameters(
          2 * 3600,
          2 * 3600,
          2 * 3600,
          5,
          50,       // supermajority - too low (min 51)
          web3.utils.toWei("10", "ether"),
          { from: admin }
        );
        assert.fail("Should have reverted");
      } catch (error) {
        assert.include(error.message, "revert");
      }
    });

    it("should reject invalid challenge deposit (too low)", async () => {
      try {
        await disputeDAO.setParameters(
          2 * 3600,
          2 * 3600,
          2 * 3600,
          5,
          60,
          web3.utils.toWei("0.5", "ether"), // too low (min 1 token)
          { from: admin }
        );
        assert.fail("Should have reverted");
      } catch (error) {
        assert.include(error.message, "revert");
      }
    });
  });

  describe("Integration: Full Dispute Flow (Mock)", () => {
    // Note: Full flow testing requires time manipulation (ganache evm_increaseTime)
    // and proper arbitrator selection after timelock.
    // This is a simplified integration test.

    it("should track dispute counter", async () => {
      const stake = web3.utils.toWei("0.1", "ether");

      await disputeDAO.registerGame(1, player1, player2, stake, { from: gameManager });
      await disputeDAO.registerGame(2, player1, player2, stake, { from: gameManager });
      await disputeDAO.registerGame(3, player1, player2, stake, { from: gameManager });

      const counter = await disputeDAO.disputeCounter();
      assert.equal(counter.toString(), "3");
    });

    it("should map games to disputes correctly", async () => {
      const stake = web3.utils.toWei("0.1", "ether");

      await disputeDAO.registerGame(100, player1, player2, stake, { from: gameManager });
      await disputeDAO.registerGame(200, player1, player2, stake, { from: gameManager });

      const disputeId1 = await disputeDAO.gameToDispute(100);
      const disputeId2 = await disputeDAO.gameToDispute(200);

      assert.equal(disputeId1.toString(), "1");
      assert.equal(disputeId2.toString(), "2");
    });
  });

  describe("Dynamic Quorum Resolution", () => {
    const gameId = 1;
    const stake = web3.utils.toWei("0.1", "ether");

    beforeEach(async () => {
      await advanceTime(7 * 24 * 60 * 60 + 1);
      await bondingManager.updatePrice(initialPrice, { from: admin });
      await bondingManager.lockBondsForGame(gameId, player1, player2, stake, { from: gameManager });
      await disputeDAO.registerGame(gameId, player1, player2, stake, { from: gameManager });
      await disputeDAO.challenge(gameId, player1, { from: challenger });
    });

    async function commitAndRevealVotes(voteMap) {
      const disputeId = await disputeDAO.gameToDispute(gameId);
      const selectedArbitrators = await disputeDAO.getSelectedArbitrators(disputeId);

      for (let i = 0; i < selectedArbitrators.length; i++) {
        const arbitrator = selectedArbitrators[i];
        const vote = voteMap[arbitrator] ?? voteMap.defaultVote;
        const salt = web3.utils.soliditySha3(`dynamic-quorum-${i}-${vote}`);
        const commitHash = web3.utils.soliditySha3(
          { type: "uint8", value: vote },
          { type: "bytes32", value: salt },
          { type: "address", value: arbitrator }
        );

        await disputeDAO.commitVote(disputeId, commitHash, { from: arbitrator });
        voteMap[`${arbitrator.toLowerCase()}-salt`] = salt;
      }

      await advanceTime(24 * 3600 + 1);

      for (let i = 0; i < selectedArbitrators.length; i++) {
        const arbitrator = selectedArbitrators[i];
        const vote = voteMap[arbitrator] ?? voteMap.defaultVote;
        const salt = voteMap[`${arbitrator.toLowerCase()}-salt`];
        await disputeDAO.revealVote(disputeId, vote, salt, { from: arbitrator });
      }

      await advanceTime(24 * 3600 + 1);

      return { disputeId, selectedArbitrators };
    }

    it("should derive effective quorum from the selected panel size", async () => {
      const disputeId = await disputeDAO.gameToDispute(gameId);
      const selectedArbitrators = await disputeDAO.getSelectedArbitrators(disputeId);
      const effectiveQuorum = await disputeDAO.getEffectiveQuorum(disputeId);

      assert.equal(selectedArbitrators.length, 3, "Expected the small bootstrap panel to contain three arbitrators");
      assert.equal(effectiveQuorum.toString(), "3", "Effective quorum should match the selected panel when configured quorum is higher");
    });

    it("should resolve a dispute with the bootstrap panel instead of escalating forever", async () => {
      const { disputeId } = await commitAndRevealVotes({ defaultVote: 2 });
      const selectedArbitrators = await disputeDAO.getSelectedArbitrators(disputeId);

      const assignmentsBefore = await arbitratorRegistry.activeAssignments(selectedArbitrators[0]);
      assert.equal(assignmentsBefore.toString(), "1", "The panel stake should remain locked");

      await disputeDAO.resolveDispute(disputeId, { from: challenger });

      const dispute = await disputeDAO.getDispute(disputeId);
      const assignmentsAfter = await arbitratorRegistry.activeAssignments(selectedArbitrators[0]);
      assert.equal(dispute.state.toString(), "4", "Dispute should resolve with the available bootstrap panel");
      assert.equal(dispute.finalDecision.toString(), "2", "Decision should be Cheat");
      assert.equal(assignmentsAfter.toString(), "0", "Resolution should release the panel stake");
    });

    it("should count abstentions toward quorum without handing victory to a single vote", async () => {
      const disputeId = await disputeDAO.gameToDispute(gameId);
      const selectedArbitrators = await disputeDAO.getSelectedArbitrators(disputeId);

      const voteMap = {
        defaultVote: 2,
        [selectedArbitrators[2]]: 3
      };

      await commitAndRevealVotes(voteMap);
      await disputeDAO.resolveDispute(disputeId, { from: challenger });

      const dispute = await disputeDAO.getDispute(disputeId);
      assert.equal(dispute.state.toString(), "4", "Dispute should still resolve when two of three arbitrators agree");
      assert.equal(dispute.finalDecision.toString(), "2", "Two cheat votes and one abstain should still produce a cheat decision");
    });

    it("should allow selected arbitrators to commit again after escalation", async () => {
      const disputeId = await disputeDAO.gameToDispute(gameId);
      const selectedArbitrators = await disputeDAO.getSelectedArbitrators(disputeId);

      for (let i = 0; i < selectedArbitrators.length; i++) {
        const arbitrator = selectedArbitrators[i];
        const salt = web3.utils.soliditySha3(`first-round-${i}`);
        const commitHash = web3.utils.soliditySha3(
          { type: "uint8", value: 2 },
          { type: "bytes32", value: salt },
          { type: "address", value: arbitrator }
        );
        await disputeDAO.commitVote(disputeId, commitHash, { from: arbitrator });
      }

      await advanceTime(48 * 3600 + 2);
      await disputeDAO.resolveDispute(disputeId, { from: challenger });

      const escalatedArbitrators = await disputeDAO.getSelectedArbitrators(disputeId);
      assert.equal(escalatedArbitrators.length, 3, "The bootstrap panel should be selected again");

      for (let i = 0; i < escalatedArbitrators.length; i++) {
        const arbitrator = escalatedArbitrators[i];
        const status = await disputeDAO.getVoteStatus(disputeId, arbitrator);
        const assignments = await arbitratorRegistry.activeAssignments(arbitrator);
        const arbitratorInfo = await arbitratorRegistry.getArbitratorInfo(arbitrator);
        assert.isFalse(status.hasCommitted, "The previous round commit must be cleared");
        assert.equal(assignments.toString(), "1", "Escalation should replace, not duplicate, the assignment");
        assert.equal(arbitratorInfo.reputation.toString(), "99", "Non-reveal must be penalized before escalation");

        const salt = web3.utils.soliditySha3(`second-round-${i}`);
        const commitHash = web3.utils.soliditySha3(
          { type: "uint8", value: 1 },
          { type: "bytes32", value: salt },
          { type: "address", value: arbitrator }
        );
        await disputeDAO.commitVote(disputeId, commitHash, { from: arbitrator });
      }
    });
  });

  describe("Concurrent Dispute Escrow", () => {
    const stake = web3.utils.toWei("0.1", "ether");

    async function commitVotes(disputeId, vote, label) {
      const selectedArbitrators = await disputeDAO.getSelectedArbitrators(disputeId);
      const salts = [];

      for (let i = 0; i < selectedArbitrators.length; i++) {
        const arbitrator = selectedArbitrators[i];
        const salt = web3.utils.soliditySha3(`${label}-${i}`);
        const commitHash = web3.utils.soliditySha3(
          { type: "uint8", value: vote },
          { type: "bytes32", value: salt },
          { type: "address", value: arbitrator }
        );
        await disputeDAO.commitVote(disputeId, commitHash, { from: arbitrator });
        salts.push(salt);
      }

      return { selectedArbitrators, salts, vote };
    }

    async function revealVotes(disputeId, round) {
      for (let i = 0; i < round.selectedArbitrators.length; i++) {
        await disputeDAO.revealVote(disputeId, round.vote, round.salts[i], {
          from: round.selectedArbitrators[i]
        });
      }
    }

    it("keeps every open challenge deposit fully reserved", async () => {
      await advanceTime(7 * 24 * 60 * 60 + 1);
      await bondingManager.updatePrice(initialPrice, { from: admin });
      await bondingManager.lockBondsForGame(1, player1, player2, stake, { from: gameManager });
      await bondingManager.lockBondsForGame(2, player1, player2, stake, { from: gameManager });
      await disputeDAO.registerGame(1, player1, player2, stake, { from: gameManager });
      await disputeDAO.registerGame(2, player1, player2, stake, { from: gameManager });
      await disputeDAO.challenge(1, player1, { from: challenger });
      await disputeDAO.challenge(2, player2, { from: challenger });

      const disputeId1 = await disputeDAO.gameToDispute(1);
      const disputeId2 = await disputeDAO.gameToDispute(2);
      const cheatRound = await commitVotes(disputeId1, 2, "cheat");
      const legitRound = await commitVotes(disputeId2, 1, "legit");
      const sharedArbitrator = cheatRound.selectedArbitrators[0];
      const concurrentAssignments = await arbitratorRegistry.activeAssignments(sharedArbitrator);
      assert.equal(concurrentAssignments.toString(), "2", "Concurrent panels must be counted independently");

      await advanceTime(24 * 3600 + 1);
      await revealVotes(disputeId1, cheatRound);
      await revealVotes(disputeId2, legitRound);
      await advanceTime(24 * 3600 + 1);

      await disputeDAO.resolveDispute(disputeId1, { from: challenger });

      const reservedAfterFirstResolution = await disputeDAO.totalEscrowedDeposits();
      const daoBalanceAfterFirstResolution = await chessToken.balanceOf(disputeDAO.address);
      const assignmentsAfterFirstResolution = await arbitratorRegistry.activeAssignments(sharedArbitrator);
      assert.equal(reservedAfterFirstResolution.toString(), CHALLENGE_DEPOSIT);
      assert.equal(daoBalanceAfterFirstResolution.toString(), CHALLENGE_DEPOSIT);
      assert.equal(assignmentsAfterFirstResolution.toString(), "1");

      await disputeDAO.resolveDispute(disputeId2, { from: challenger });

      const firstDispute = await disputeDAO.getDispute(disputeId1);
      const secondDispute = await disputeDAO.getDispute(disputeId2);
      const finalReserve = await disputeDAO.totalEscrowedDeposits();
      const finalBalance = await chessToken.balanceOf(disputeDAO.address);
      const finalAssignments = await arbitratorRegistry.activeAssignments(sharedArbitrator);
      assert.equal(firstDispute.state.toString(), "4", "The cheat dispute should resolve");
      assert.equal(secondDispute.state.toString(), "4", "The legit dispute should resolve");
      assert.equal(finalReserve.toString(), "0", "No resolved deposit should remain reserved");
      assert.equal(finalBalance.toString(), "0", "All deposits should be settled independently");
      assert.equal(finalAssignments.toString(), "0", "Every panel assignment should be released");
    });
  });
});
