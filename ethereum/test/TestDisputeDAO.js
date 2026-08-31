const ChessToken = artifacts.require("ChessToken");
const BondingManager = artifacts.require("BondingManager");
const ArbitratorRegistry = artifacts.require("ArbitratorRegistry");
const ArbitratorRegistryHarness = artifacts.require("ArbitratorRegistryHarness");
const DisputeDAO = artifacts.require("DisputeDAO");
const SelectiveAbortChallenger = artifacts.require("SelectiveAbortChallenger");

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

const mineBlock = () => new Promise((resolve, reject) => {
  web3.currentProvider.send(
    { jsonrpc: "2.0", method: "evm_mine", params: [], id: Date.now() },
    (err, result) => err ? reject(err) : resolve(result)
  );
});

async function mineBlocks(count) {
  for (let i = 0; i < count; i++) await mineBlock();
}

async function expectRevert(promise, label) {
  let caught;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  assert.exists(caught, `${label}: expected a revert`);
  assert.match(caught.message, /revert|custom error|invalid opcode/i, label);
}

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

  async function finalizeScheduledPanel(disputeId) {
    const target = web3.utils.toBN(await disputeDAO.panelSelectionBlock(disputeId));
    while (web3.utils.toBN(await web3.eth.getBlockNumber()).lt(target)) {
      await mineBlock();
    }
    return disputeDAO.finalizePanel(disputeId);
  }

  async function voteCommitment(disputeId, vote, salt, arbitrator) {
    return disputeDAO.computeVoteCommitment(disputeId, vote, salt, arbitrator);
  }

  async function lockGameBonds(gameId, stake) {
    const whiteBond = await bondingManager.gameBonds(gameId, player1);
    if (whiteBond.player === "0x0000000000000000000000000000000000000000") {
      await bondingManager.lockBondsForGame(gameId, player1, player2, stake, { from: gameManager });
    }
  }

  async function lockAndChallenge(gameId, options = { from: player1 }) {
    const disputeId = await disputeDAO.gameToDispute(gameId);
    const fullDispute = await disputeDAO.disputes(disputeId);
    await lockGameBonds(gameId, fullDispute.gameStake);
    return disputeDAO.challenge(gameId, options);
  }

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
    await chessToken.approve(disputeDAO.address, mintAmount, { from: player1 });
    await chessToken.approve(disputeDAO.address, mintAmount, { from: player2 });
    await chessToken.approve(arbitratorRegistry.address, mintAmount, { from: arb1 });
    await chessToken.approve(arbitratorRegistry.address, mintAmount, { from: arb2 });
    await chessToken.approve(arbitratorRegistry.address, mintAmount, { from: arb3 });
    await chessToken.approve(bondingManager.address, mintAmount, { from: player1 });
    await chessToken.approve(bondingManager.address, mintAmount, { from: player2 });

    // Setup arbitrators
    await arbitratorRegistry.stake(TIER1_STAKE, { from: arb1 });
    await arbitratorRegistry.stake(TIER1_STAKE, { from: arb2 });
    await arbitratorRegistry.stake(TIER1_STAKE, { from: arb3 });

    // The default fixture represents the production-ready pool. Tests that need
    // immature positions deploy an isolated registry so challenge admission cannot
    // accidentally rely on totalStaked rather than the eligible snapshot.
    await advanceTime(7 * 24 * 60 * 60 + 1);
    await bondingManager.updatePrice(initialPrice, { from: admin });

    // Setup bonds for players
    const bondChess = web3.utils.toWei("2000", "ether");
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
      const quorumPercentage = await disputeDAO.quorumPercentage();
      const supermajority = await disputeDAO.supermajority();

      assert.equal(challengeWindow.toString(), (48 * 3600).toString()); // 48 hours
      assert.equal(commitPeriod.toString(), (24 * 3600).toString()); // 24 hours
      assert.equal(revealPeriod.toString(), (24 * 3600).toString()); // 24 hours
      assert.equal(quorumPercentage.toString(), "66");
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

      await expectRevert(
        disputeDAO.registerGame(gameId, player1, player2, stake, { from: gameManager }),
        "duplicate game registration"
      );
    });

    it("should reject registration from non-game-manager", async () => {
      const gameId = 1;
      const stake = web3.utils.toWei("0.1", "ether");

      await expectRevert(
        disputeDAO.registerGame(gameId, player1, player2, stake, { from: challenger }),
        "registration without the game-manager role"
      );
    });
  });

  describe("Challenge Creation", () => {
    const gameId = 1;
    const stake = web3.utils.toWei("0.1", "ether");

    beforeEach(async () => {
      await disputeDAO.registerGame(gameId, player1, player2, stake, { from: gameManager });
    });

    it("should create a challenge", async () => {
      const balanceBefore = await chessToken.balanceOf(player1);

      await lockAndChallenge(gameId, { from: player1 });

      const balanceAfter = await chessToken.balanceOf(player1);
      const diff = web3.utils.toBN(balanceBefore).sub(web3.utils.toBN(balanceAfter));
      assert.equal(diff.toString(), CHALLENGE_DEPOSIT);
    });

    it("should enter the irrevocable future-entropy selection phase", async () => {
      await lockAndChallenge(gameId, { from: player1 });

      const dispute = await disputeDAO.getDispute(1);
      assert.equal(dispute.state.toString(), "6"); // Selecting
      assert.equal(dispute.challenger, player1);
      assert.isTrue(
        web3.utils.toBN(await disputeDAO.panelSelectionBlock(1)).gt(web3.utils.toBN("0")),
        "A future selection block must be committed"
      );
    });

    it("should derive a proportional deposit from the locked game exposure", async () => {
      await lockGameBonds(gameId, stake);
      assert.equal(
        (await disputeDAO.getRequiredChallengeDepositForGame(gameId)).toString(),
        CHALLENGE_DEPOSIT
      );
    });

    it("should reject challenges from addresses that are not players in the game", async () => {
      await lockGameBonds(gameId, stake);
      await expectRevert(
        disputeDAO.challenge(gameId, { from: challenger }),
        "challenge by a non-participant"
      );
    });

    it("should track active challenges per user", async () => {
      await lockAndChallenge(gameId, { from: player1 });

      const activeCount = await disputeDAO.activeChallenges(player1);
      assert.equal(activeCount.toString(), "1");
    });

    it("should not expose a panel in the challenge transaction", async () => {
      await lockAndChallenge(gameId, { from: player1 });

      const arbitrators = await disputeDAO.getSelectedArbitrators(1);
      assert.equal(arbitrators.length, 0, "Selection must use a later block hash");
    });

    it("should reject a same-transaction selective-abort helper that is not a player", async () => {
      const helper = await SelectiveAbortChallenger.new({ from: challenger });
      await lockGameBonds(gameId, stake);
      await chessToken.transfer(helper.address, CHALLENGE_DEPOSIT, { from: challenger });

      await expectRevert(
        helper.attemptSelectiveAbort(
          disputeDAO.address,
          chessToken.address,
          gameId,
          player1,
          "0x0000000000000000000000000000000000000000",
          { from: challenger }
        ),
        "non-participant selective-abort helper"
      );
      assert.equal((await disputeDAO.disputeDeposits(1)).toString(), "0");
    });

    it("should preserve a valid challenge through the backstop when the pool is immature", async () => {
      const immatureRegistry = await ArbitratorRegistry.new(chessToken.address, { from: admin });
      const immatureDAO = await DisputeDAO.new(
        chessToken.address,
        bondingManager.address,
        immatureRegistry.address,
        { from: admin }
      );
      const registryRole = await immatureRegistry.DISPUTE_MANAGER_ROLE();
      const gameRole = await immatureDAO.GAME_MANAGER_ROLE();
      await immatureRegistry.grantRole(registryRole, immatureDAO.address, { from: admin });
      await immatureDAO.grantRole(gameRole, gameManager, { from: admin });

      for (const arbitrator of [arb1, arb2, arb3]) {
        await chessToken.approve(immatureRegistry.address, TIER1_STAKE, { from: arbitrator });
        await immatureRegistry.stake(TIER1_STAKE, { from: arbitrator });
      }

      const immatureGameId = 901;
      await bondingManager.lockBondsForGame(
        immatureGameId,
        player1,
        player2,
        stake,
        { from: gameManager }
      );
      await immatureDAO.registerGame(
        immatureGameId,
        player1,
        player2,
        stake,
        { from: gameManager }
      );
      await chessToken.approve(immatureDAO.address, CHALLENGE_DEPOSIT, { from: player1 });
      const challengerBalanceBefore = await chessToken.balanceOf(player1);

      await immatureDAO.challenge(immatureGameId, { from: player1 });

      assert.equal((await immatureDAO.getDispute(1)).state.toString(), "7");
      assert.equal((await immatureDAO.disputeDeposits(1)).toString(), CHALLENGE_DEPOSIT);
      assert.equal((await immatureDAO.activeChallenges(player1)).toString(), "1");
      assert.equal((await immatureDAO.selectionSequenceCounter()).toString(), "0");
      assert.equal((await immatureRegistry.activePanelSelection()).toString(), "0");
      assert.equal(
        web3.utils.toBN(challengerBalanceBefore)
          .sub(web3.utils.toBN(await chessToken.balanceOf(player1)))
          .toString(),
        CHALLENGE_DEPOSIT,
        "The unresolved challenge must retain the same escrowed deposit"
      );

      for (const arbitrator of [arb1, arb2, arb3]) {
        await immatureRegistry.unstake(TIER1_STAKE, { from: arbitrator });
      }
      assert.equal((await immatureRegistry.totalStaked()).toString(), "0");
    });

    it("should refresh an expired selection target without releasing the challenge", async () => {
      await lockAndChallenge(gameId, { from: player1 });
      const target = web3.utils.toBN(await disputeDAO.panelSelectionBlock(1));
      const current = web3.utils.toBN(await web3.eth.getBlockNumber());
      const blocksToExpiry = target.add(web3.utils.toBN("257")).sub(current).toNumber();
      await mineBlocks(blocksToExpiry);

      await expectRevert(
        disputeDAO.finalizePanel(1),
        "an expired blockhash must not form a panel"
      );

      const expiredTarget = await disputeDAO.panelSelectionBlock(1);
      await disputeDAO.refreshPanelSelection(1);
      const refreshedTarget = web3.utils.toBN(await disputeDAO.panelSelectionBlock(1));
      const refreshedAtBlock = web3.utils.toBN(await web3.eth.getBlockNumber());

      assert.isTrue(refreshedTarget.gt(refreshedAtBlock));
      assert.isTrue(refreshedTarget.gt(web3.utils.toBN(expiredTarget)));
      assert.equal((await disputeDAO.disputeDeposits(1)).toString(), CHALLENGE_DEPOSIT);
      assert.equal((await disputeDAO.getDispute(1)).state.toString(), "6");
    });

    it("should release the selection lock and give a long-waiting FIFO entry a fresh timeout", async () => {
      await disputeDAO.registerGame(2, player1, player2, stake, { from: gameManager });
      await lockAndChallenge(gameId, { from: player1 });
      await lockAndChallenge(2, { from: player2 });
      const firstId = await disputeDAO.gameToDispute(gameId);
      const secondId = await disputeDAO.gameToDispute(2);
      const timeout = await disputeDAO.PANEL_SELECTION_TIMEOUT();
      const firstTarget = web3.utils.toBN(await disputeDAO.panelSelectionBlock(firstId));
      const blockhashWindow = web3.utils.toBN(await disputeDAO.BLOCKHASH_WINDOW());

      await advanceTime(timeout.toNumber() + 1);
      await expectRevert(
        disputeDAO.markPanelUnavailable(firstId),
        "an activated selection while its target blockhash remains recoverable"
      );
      while (
        web3.utils.toBN(await web3.eth.getBlockNumber()).lte(firstTarget.add(blockhashWindow))
      ) {
        await mineBlock();
      }
      await expectRevert(
        disputeDAO.refreshPanelSelection(firstId),
        "refresh after the bounded recovery window"
      );
      await disputeDAO.markPanelUnavailable(firstId);

      assert.equal((await arbitratorRegistry.activePanelSelection()).toString(), "0");
      assert.equal((await disputeDAO.nextSelectionSequence()).toString(), "2");
      const promotedAt = await disputeDAO.panelSelectionScheduledAt(secondId);
      const latestBlock = await web3.eth.getBlock("latest");
      assert.equal(promotedAt.toString(), latestBlock.timestamp.toString());
      await expectRevert(
        disputeDAO.markPanelUnavailable(secondId),
        "a promoted entry before its own full timeout"
      );

      await disputeDAO.activatePanelSelection(secondId);
      assert.isTrue(
        web3.utils.toBN(await disputeDAO.panelSelectionBlock(secondId)).gt(web3.utils.toBN("0"))
      );
    });

    it("should not time out an activated panel before its future entropy can be consumed", async () => {
      await lockAndChallenge(gameId, { from: player1 });
      const disputeId = await disputeDAO.gameToDispute(gameId);
      const target = web3.utils.toBN(await disputeDAO.panelSelectionBlock(disputeId));
      const timeout = await disputeDAO.PANEL_SELECTION_TIMEOUT();

      // A timestamp jump can cross the seven-day recovery deadline while only
      // mining one block. The committed future target must still win over a
      // permissionless timeout attempt.
      await advanceTime(timeout.toNumber() + 1);
      await expectRevert(
        disputeDAO.markPanelUnavailable(disputeId),
        "timeout before recoverable future entropy is finalized"
      );
      while (web3.utils.toBN(await web3.eth.getBlockNumber()).lte(target)) await mineBlock();

      await disputeDAO.finalizePanel(disputeId);
      assert.equal((await disputeDAO.getDispute(disputeId)).state.toString(), "2");
      assert.equal((await disputeDAO.disputeDeposits(disputeId)).toString(), CHALLENGE_DEPOSIT);
    });

    it("should immediately backstop a promoted FIFO head that became structurally impossible", async () => {
      await disputeDAO.registerGame(2, player1, player2, stake, { from: gameManager });
      await lockAndChallenge(gameId, { from: player1 });
      await lockAndChallenge(2, { from: player2 });
      const firstId = await disputeDAO.gameToDispute(gameId);
      const secondId = await disputeDAO.gameToDispute(2);

      // Finalizing the only three arbitrators on the first dispute promotes the
      // second as a transiently unavailable FIFO head.
      await finalizeScheduledPanel(firstId);
      assert.equal((await disputeDAO.nextSelectionSequence()).toString(), "2");
      assert.equal((await disputeDAO.panelSelectionBlock(secondId)).toString(), "0");

      // A newly recorded relationship permanently removes one of the three
      // potential candidates for this game. The remaining two can never meet
      // the snapshotted three-address minimum, even after assignments clear.
      await disputeDAO.registerGame(3, arb1, player1, stake, { from: gameManager });
      const tx = await disputeDAO.activatePanelSelection(secondId);

      const second = await disputeDAO.getDispute(secondId);
      assert.equal(second.state.toString(), "7", "Structurally impossible head must use backstop");
      assert.equal((await disputeDAO.nextSelectionSequence()).toString(), "3");
      assert.equal((await arbitratorRegistry.activePanelSelection()).toString(), "0");
      assert.equal((await disputeDAO.disputeDeposits(secondId)).toString(), CHALLENGE_DEPOSIT);
      assert.isTrue(
        tx.logs.some((log) => log.event === "StructuralPanelUnavailable"),
        "The structural reason must be observable"
      );
    });

    it("should block a last-look tier exit without invalidating the committed panel", async () => {
      const tierUpgrade = web3.utils.toWei("4000", "ether");
      await arbitratorRegistry.stake(tierUpgrade, { from: arb1 });
      await advanceTime(7 * 24 * 3600 + 1);
      await arbitratorRegistry.activatePendingStake({ from: arb1 });
      await bondingManager.updatePrice(initialPrice, { from: admin });

      const lastLookGameId = 902;
      await bondingManager.lockBondsForGame(
        lastLookGameId,
        player1,
        player2,
        stake,
        { from: gameManager }
      );
      await disputeDAO.registerGame(
        lastLookGameId,
        player1,
        player2,
        stake,
        { from: gameManager }
      );
      await disputeDAO.challenge(lastLookGameId, { from: player1 });
      const disputeId = await disputeDAO.gameToDispute(lastLookGameId);
      const target = web3.utils.toBN(await disputeDAO.panelSelectionBlock(disputeId));
      while (web3.utils.toBN(await web3.eth.getBlockNumber()).lt(target)) await mineBlock();

      // The target hash is now public. Moving from tier two back to tier one must
      // not let the arbitrator choose whether the known seed is used.
      await expectRevert(
        arbitratorRegistry.unstake(tierUpgrade, { from: arb1 }),
        "a stake mutation while population is committed"
      );
      await disputeDAO.finalizePanel(disputeId);
      assert.equal((await disputeDAO.getDispute(disputeId)).state.toString(), "2");
      assert.equal((await disputeDAO.disputeDeposits(disputeId)).toString(), CHALLENGE_DEPOSIT);
    });

    it("should block a matured top-up activation without invalidating the committed panel", async () => {
      const tierUpgrade = web3.utils.toWei("4000", "ether");
      await arbitratorRegistry.stake(tierUpgrade, { from: arb1 });
      await advanceTime(7 * 24 * 3600 + 1);
      await bondingManager.updatePrice(initialPrice, { from: admin });

      const activationGameId = 903;
      await bondingManager.lockBondsForGame(
        activationGameId,
        player1,
        player2,
        stake,
        { from: gameManager }
      );
      await disputeDAO.registerGame(
        activationGameId,
        player1,
        player2,
        stake,
        { from: gameManager }
      );
      await disputeDAO.challenge(activationGameId, { from: player1 });
      const disputeId = await disputeDAO.gameToDispute(activationGameId);
      const target = web3.utils.toBN(await disputeDAO.panelSelectionBlock(disputeId));
      while (web3.utils.toBN(await web3.eth.getBlockNumber()).lt(target)) await mineBlock();

      await expectRevert(
        arbitratorRegistry.activatePendingStake({ from: arb1 }),
        "activation while population is committed"
      );
      await disputeDAO.finalizePanel(disputeId);
      assert.equal((await disputeDAO.getDispute(disputeId)).state.toString(), "2");
      assert.equal((await disputeDAO.disputeDeposits(disputeId)).toString(), CHALLENGE_DEPOSIT);
    });

    it("should snapshot policy at registration for the direct-manager fallback", async () => {
      await lockGameBonds(gameId, stake);
      const originalDeadline = await disputeDAO.challengeDeadline(1);
      const balanceBefore = await chessToken.balanceOf(player1);

      await disputeDAO.setArbitrationSecurityParameters(
        15,
        web3.utils.toWei("3000", "ether"),
        10000,
        { from: admin }
      );
      await disputeDAO.setParameters(
        1 * 3600,
        1 * 3600,
        2 * 3600,
        100,
        100,
        web3.utils.toWei("100", "ether"),
        { from: admin }
      );
      await disputeDAO.setChallengeDepositBps(10000, { from: admin });

      await disputeDAO.registerGame(2, player1, player2, stake, { from: gameManager });
      const second = await disputeDAO.disputes(2);

      await disputeDAO.challenge(gameId, { from: player1 });

      assert.equal((await disputeDAO.disputeMinimumPanelSize(1)).toString(), "3");
      assert.equal((await disputeDAO.disputeQuorumPercentage(1)).toString(), "66");
      assert.equal((await disputeDAO.disputeSupermajority(1)).toString(), "66");
      assert.equal((await disputeDAO.disputeCommitPeriod(1)).toString(), (24 * 3600).toString());
      assert.equal((await disputeDAO.disputeRevealPeriod(1)).toString(), (24 * 3600).toString());
      assert.equal((await disputeDAO.commitPeriod()).toString(), (1 * 3600).toString());
      assert.equal((await disputeDAO.revealPeriod()).toString(), (2 * 3600).toString());
      assert.equal((await disputeDAO.challengeDeadline(1)).toString(), originalDeadline.toString());
      assert.equal(
        (await disputeDAO.getRequiredChallengeDepositForGame(gameId)).toString(),
        CHALLENGE_DEPOSIT,
        "Deposit floor/rate changes must apply only to future registrations"
      );
      assert.equal(
        web3.utils.toBN(balanceBefore)
          .sub(web3.utils.toBN(await chessToken.balanceOf(player1)))
          .toString(),
        CHALLENGE_DEPOSIT
      );

      assert.equal(
        web3.utils.toBN(await disputeDAO.challengeDeadline(2))
          .sub(web3.utils.toBN(second.registeredAt))
          .toString(),
        (1 * 3600).toString(),
        "New registrations must use the updated challenge window"
      );

      const finalization = await finalizeScheduledPanel(1);
      const finalizedBlock = await web3.eth.getBlock(finalization.receipt.blockNumber);
      const finalizedAt = web3.utils.toBN(finalizedBlock.timestamp);
      const storedDispute = await disputeDAO.disputes(1);
      assert.equal(
        web3.utils.toBN(storedDispute.commitDeadline).sub(finalizedAt).toString(),
        (24 * 3600).toString(),
        "The first round must use the commit period snapshotted at registration"
      );
      assert.equal(
        web3.utils.toBN(storedDispute.revealDeadline)
          .sub(web3.utils.toBN(storedDispute.commitDeadline))
          .toString(),
        (24 * 3600).toString(),
        "Every round must use the reveal period snapshotted at registration"
      );
      assert.equal((await disputeDAO.getSelectedArbitrators(1)).length, 3);
      assert.equal((await disputeDAO.getEffectiveQuorum(1)).toString(), "3");
    });

    it("should reject challenge on non-pending game", async () => {
      await lockAndChallenge(gameId, { from: player1 });

      // Try to challenge again
      await chessToken.mintPlayToEarn(accounts[9], web3.utils.toWei("100", "ether"), { from: admin });
      await chessToken.approve(disputeDAO.address, web3.utils.toWei("100", "ether"), { from: accounts[9] });

      await expectRevert(
        lockAndChallenge(gameId, { from: accounts[9] }),
        "a second challenge for the same game"
      );
    });

    it("should not strand a fourth bonded game behind a per-challenger cap", async () => {
      // All four games already carry independent locked exposure. A global cap
      // here would let an opponent strand the fourth game's challenge window.
      for (let i = 2; i <= 4; i++) {
        await disputeDAO.registerGame(i, player1, player2, stake, { from: gameManager });
      }

      await lockAndChallenge(gameId, { from: player1 });
      await lockAndChallenge(2, { from: player1 });
      await lockAndChallenge(3, { from: player1 });
      await lockAndChallenge(4, { from: player1 });

      assert.equal((await disputeDAO.activeChallenges(player1)).toString(), "4");
      assert.equal((await disputeDAO.selectionSequenceCounter()).toString(), "4");
      for (let disputeId = 1; disputeId <= 4; disputeId++) {
        assert.equal(
          (await disputeDAO.disputeDeposits(disputeId)).toString(),
          CHALLENGE_DEPOSIT,
          `Dispute ${disputeId} must retain its independent deposit`
        );
      }
    });

    it("should scale required panel active stake with the registered game stake", async () => {
      const highValueGameId = 99;
      const highStake = web3.utils.toWei("10", "ether");
      const extraChessBond = web3.utils.toWei("30000", "ether");
      const extraEthBond = web3.utils.toWei("20", "ether");
      await bondingManager.depositBond(extraChessBond, { from: player1, value: extraEthBond });
      await bondingManager.depositBond(extraChessBond, { from: player2, value: extraEthBond });
      await bondingManager.lockBondsForGame(
        highValueGameId,
        player1,
        player2,
        highStake,
        { from: gameManager }
      );
      await disputeDAO.registerGame(highValueGameId, player1, player2, highStake, { from: gameManager });

      const requiredPanelActiveStake = await disputeDAO.getRequiredPanelCollateralForGame(highValueGameId);
      assert.equal(requiredPanelActiveStake.toString(), web3.utils.toWei("60000", "ether"));
      assert.equal(
        (await disputeDAO.getRequiredChallengeDepositForGame(highValueGameId)).toString(),
        web3.utils.toWei("3000", "ether"),
        "The challenge deposit must scale to 5% of locked CHESS exposure"
      );

      const requiredDeposit = await disputeDAO.getRequiredChallengeDepositForGame(highValueGameId);
      await chessToken.approve(disputeDAO.address, requiredDeposit, { from: player1 });
      const balanceBefore = await chessToken.balanceOf(player1);
      const challengeTx = await disputeDAO.challenge(highValueGameId, { from: player1 });

      assert.equal((await disputeDAO.getDispute(2)).state.toString(), "7");
      assert.equal((await disputeDAO.disputeDeposits(2)).toString(), requiredDeposit.toString());
      assert.equal((await disputeDAO.activeChallenges(player1)).toString(), "1");
      assert.equal((await disputeDAO.selectionSequenceCounter()).toString(), "0");
      assert.equal((await arbitratorRegistry.activePanelSelection()).toString(), "0");
      assert.equal(
        web3.utils.toBN(balanceBefore)
          .sub(web3.utils.toBN(await chessToken.balanceOf(player1)))
          .toString(),
        requiredDeposit.toString(),
        "A structurally unavailable challenge must remain escrowed for backstop"
      );
      assert.exists(
        challengeTx.logs.find((log) => log.event === "StructuralPanelUnavailable"),
        "The structural backstop reason should be observable"
      );

      await expectRevert(
        disputeDAO.resolveByBackstop(2, 1, { from: player2 }),
        "a non-governance backstop decision"
      );
      await disputeDAO.resolveByBackstop(2, 1, { from: admin });
      assert.equal((await disputeDAO.getDispute(2)).state.toString(), "4");
      assert.equal((await disputeDAO.disputeDeposits(2)).toString(), "0");
      assert.equal((await disputeDAO.activeChallenges(player1)).toString(), "0");
    });

    it("should cap same-tier capacity and route whale-dependent collateral to backstop", async () => {
      const skewedRegistry = await ArbitratorRegistryHarness.new(chessToken.address, { from: admin });
      const skewedDAO = await DisputeDAO.new(
        chessToken.address,
        bondingManager.address,
        skewedRegistry.address,
        { from: admin }
      );
      const registryRole = await skewedRegistry.DISPUTE_MANAGER_ROLE();
      const gameRole = await skewedDAO.GAME_MANAGER_ROLE();
      await skewedRegistry.grantRole(registryRole, skewedDAO.address, { from: admin });
      await skewedRegistry.grantRole(registryRole, admin, { from: admin });
      await skewedDAO.grantRole(gameRole, gameManager, { from: admin });
      await skewedRegistry.fillTier1ToCountForTest(15, { from: admin });

      const skewedGameId = 904;
      const highStake = web3.utils.toWei("1", "ether");
      await bondingManager.depositBond(
        web3.utils.toWei("1000", "ether"),
        { from: player1, value: web3.utils.toWei("1", "ether") }
      );
      await bondingManager.depositBond(
        web3.utils.toWei("1000", "ether"),
        { from: player2, value: web3.utils.toWei("1", "ether") }
      );
      await bondingManager.lockBondsForGame(
        skewedGameId,
        player1,
        player2,
        highStake,
        { from: gameManager }
      );
      await skewedDAO.registerGame(
        skewedGameId,
        player1,
        player2,
        highStake,
        { from: gameManager }
      );

      const tierCounts = await skewedRegistry.getTierCounts();
      assert.equal(tierCounts.t1.toString(), "15", "The regression requires 15 eligible tier-one positions");
      assert.equal(
        (await skewedDAO.getRequiredPanelCollateralForGame(skewedGameId)).toString(),
        web3.utils.toWei("6000", "ether"),
        "The locked game exposure must exceed the five selectable tier-one stakes"
      );

      const capacity = await skewedRegistry.getPotentialSelectionCapacity(
        1,
        player1,
        player2,
        player1,
        5,
        0,
        { from: admin }
      );
      assert.equal(capacity[0].toString(), "5", "Tier capacity must use the selection cap");
      assert.equal(
        capacity[1].toString(),
        web3.utils.toWei("5000", "ether"),
        "Admission must use collateral guaranteed by the selectable subset"
      );

      const requiredDeposit = await skewedDAO.getRequiredChallengeDepositForGame(skewedGameId);
      await chessToken.approve(skewedDAO.address, requiredDeposit, { from: player1 });
      const balanceBefore = await chessToken.balanceOf(player1);

      // One same-tier whale now makes a lucky five-address draw sufficiently
      // collateralized. Structural capacity must still use the worst selectable
      // subset instead of letting a challenge retry until that whale is drawn.
      await skewedRegistry.setTier1StakeForTest(
        14,
        web3.utils.toWei("4000", "ether"),
        { from: admin }
      );
      const whaleCapacity = await skewedRegistry.getPotentialSelectionCapacity(
        1,
        player1,
        player2,
        player1,
        5,
        0,
        { from: admin }
      );
      assert.equal(whaleCapacity[0].toString(), "5");
      assert.equal(
        whaleCapacity[1].toString(),
        web3.utils.toWei("5000", "ether"),
        "A lucky whale-dependent panel must not raise guaranteed collateral"
      );

      await skewedDAO.challenge(skewedGameId, { from: player1 });

      assert.equal((await skewedDAO.getDispute(1)).state.toString(), "7");
      assert.equal((await skewedDAO.activeChallenges(player1)).toString(), "1");
      assert.equal((await skewedDAO.selectionSequenceCounter()).toString(), "0");
      assert.equal((await skewedDAO.disputeDeposits(1)).toString(), requiredDeposit.toString());
      assert.equal((await skewedRegistry.activePanelSelection()).toString(), "0");
      assert.equal(
        web3.utils.toBN(balanceBefore)
          .sub(web3.utils.toBN(await chessToken.balanceOf(player1)))
          .toString(),
        requiredDeposit.toString()
      );
    });

    it("should fail closed before taking a deposit when either game bond is missing", async () => {
      const challengerBalanceBefore = await chessToken.balanceOf(player1);

      await expectRevert(
        disputeDAO.challenge(gameId, { from: player1 }),
        "missing GameBond records must never use a live oracle fallback"
      );

      assert.equal((await disputeDAO.disputeDeposits(1)).toString(), "0");
      assert.equal(
        (await chessToken.balanceOf(player1)).toString(),
        challengerBalanceBefore.toString()
      );
    });
  });

  describe("Vote Commit", () => {
    const gameId = 1;
    const stake = web3.utils.toWei("0.1", "ether");

    beforeEach(async () => {
      await disputeDAO.registerGame(gameId, player1, player2, stake, { from: gameManager });
      await lockAndChallenge(gameId, { from: player1 });
    });

    it("should allow arbitrator to commit vote", async () => {
      const vote = 2; // WhiteCheat
      const salt = web3.utils.keccak256("secret_salt");
      const commitHash = await voteCommitment(1, vote, salt, arb1);

      // The mature pool has not been finalized yet, so no address is assigned.
      await expectRevert(
        disputeDAO.commitVote(1, commitHash, { from: arb1 }),
        "a vote before panel finalization"
      );
    });
  });

  describe("Close Challenge Window", () => {
    const gameId = 1;
    const stake = web3.utils.toWei("0.1", "ether");

    beforeEach(async () => {
      await disputeDAO.registerGame(gameId, player1, player2, stake, { from: gameManager });
    });

    it("should not close window before 48 hours expire", async () => {
      await expectRevert(
        disputeDAO.closeChallengeWindow(gameId),
        "closing an unexpired challenge window"
      );
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
      await lockAndChallenge(gameId, { from: player1 });

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

      await expectRevert(
        disputeDAO.closeChallengeWindow(gameId),
        "closing a challenged game"
      );
    });
  });

  describe("Absolute Dispute Timeout", () => {
    const gameId = 1;
    const stake = web3.utils.toWei("0.1", "ether");

    it("rejects resolution of a dispute that does not exist", async () => {
      await expectRevert(
        disputeDAO.resolveDispute(0, { from: challenger }),
        "resolving a dispute that does not exist"
      );
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

    it("does not turn a stale challenged dispute into a free Vote.None", async () => {
      const challengerBalanceBefore = await chessToken.balanceOf(player1);
      await disputeDAO.registerGame(gameId, player1, player2, stake, { from: gameManager });
      await lockAndChallenge(gameId, { from: player1 });

      await advanceTime(30 * 24 * 3600 + 1);
      await expectRevert(
        disputeDAO.resolveDispute(1, { from: challenger }),
        "turning a stale challenged dispute into Vote.None"
      );

      const challengerBalanceAfter = await chessToken.balanceOf(player1);
      const reservedDeposit = await disputeDAO.disputeDeposits(1);
      const dispute = await disputeDAO.getDispute(1);
      assert.equal(
        web3.utils.toBN(challengerBalanceBefore).sub(web3.utils.toBN(challengerBalanceAfter)).toString(),
        CHALLENGE_DEPOSIT
      );
      assert.equal(reservedDeposit.toString(), CHALLENGE_DEPOSIT, "The challenge remains irrevocable");
      assert.equal(dispute.state.toString(), "6", "The dispute remains in selection recovery");
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
      await lockAndChallenge(gameId, { from: player1 });

      const dispute = await disputeDAO.getDispute(1);
      assert.equal(dispute.state.toString(), "6"); // Selecting
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

      await expectRevert(
        lockAndChallenge(gameId, { from: player1 }),
        "challenging after the window expires"
      );
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
      await lockAndChallenge(gameId, { from: player1 });

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
      await lockAndChallenge(gameId, { from: player1 });

      const isOpen = await disputeDAO.isChallengeWindowOpen(gameId);
      assert.equal(isOpen, false, "Should return false after challenge (state not Pending)");
    });
  });

  describe("View Functions", () => {
    const gameId = 1;
    const stake = web3.utils.toWei("0.1", "ether");

    beforeEach(async () => {
      await disputeDAO.registerGame(gameId, player1, player2, stake, { from: gameManager });
      await lockAndChallenge(gameId, { from: player1 });
    });

    it("should return dispute info", async () => {
      const dispute = await disputeDAO.getDispute(1);

      assert.equal(dispute.gameId.toString(), gameId.toString());
      assert.equal(dispute.challenger, player1);
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
      const newQuorumPercentage = 70;
      const newSupermajority = 70;
      const newChallengeDeposit = web3.utils.toWei("100", "ether");

      await disputeDAO.setParameters(
        newChallengeWindow,
        newCommitPeriod,
        newRevealPeriod,
        newQuorumPercentage,
        newSupermajority,
        newChallengeDeposit,
        { from: admin }
      );

      const challengeWindow = await disputeDAO.challengeWindow();
      const commitPeriod = await disputeDAO.commitPeriod();
      const quorumPercentage = await disputeDAO.quorumPercentage();

      assert.equal(challengeWindow.toString(), newChallengeWindow.toString());
      assert.equal(commitPeriod.toString(), newCommitPeriod.toString());
      assert.equal(quorumPercentage.toString(), newQuorumPercentage.toString());
    });

    it("should reject parameter change from non-admin", async () => {
      // Use valid parameters to ensure we're testing access control, not validation
      await expectRevert(
        disputeDAO.setParameters(
          2 * 3600, // 2 hours - valid
          2 * 3600, // 2 hours - valid
          2 * 3600, // 2 hours - valid
          60,       // quorum percentage - valid
          60,       // supermajority - valid
          web3.utils.toWei("10", "ether"), // deposit - valid
          { from: challenger }
        ),
        "parameter mutation without the admin role"
      );
    });

    it("should reject invalid challenge window (too short)", async () => {
      await expectRevert(
        disputeDAO.setParameters(
          30 * 60,  // 30 minutes - too short (min 1 hour)
          2 * 3600,
          2 * 3600,
          60,
          60,
          web3.utils.toWei("10", "ether"),
          { from: admin }
        ),
        "a challenge window below the minimum"
      );
    });

    it("should reject invalid challenge window (too long)", async () => {
      await expectRevert(
        disputeDAO.setParameters(
          8 * 24 * 3600,  // 8 days - too long (max 7 days)
          2 * 3600,
          2 * 3600,
          60,
          60,
          web3.utils.toWei("10", "ether"),
          { from: admin }
        ),
        "a challenge window above the maximum"
      );
    });

    it("should reject invalid quorum (too low)", async () => {
      await expectRevert(
        disputeDAO.setParameters(
          2 * 3600,
          2 * 3600,
          2 * 3600,
          50,       // quorum percentage - too low (min 51)
          60,
          web3.utils.toWei("10", "ether"),
          { from: admin }
        ),
        "a voting-power quorum below 51 percent"
      );
    });

    it("should reject invalid supermajority (too low)", async () => {
      await expectRevert(
        disputeDAO.setParameters(
          2 * 3600,
          2 * 3600,
          2 * 3600,
          60,
          50,       // supermajority - too low (min 51)
          web3.utils.toWei("10", "ether"),
          { from: admin }
        ),
        "a decision supermajority below 51 percent"
      );
    });

    it("should reject invalid challenge deposit (too low)", async () => {
      await expectRevert(
        disputeDAO.setParameters(
          2 * 3600,
          2 * 3600,
          2 * 3600,
          60,
          60,
          web3.utils.toWei("0.5", "ether"), // too low (min 1 token)
          { from: admin }
        ),
        "a challenge deposit below one token"
      );
    });

    it("should reject a minimum panel larger than the initial fifteen-seat capacity", async () => {
      await expectRevert(
        disputeDAO.setArbitrationSecurityParameters(
          16,
          web3.utils.toWei("3000", "ether"),
          10000,
          { from: admin }
        ),
        "an impossible initial panel configuration"
      );
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
      await lockAndChallenge(gameId, { from: player1 });
      await finalizeScheduledPanel(1);
    });

    async function commitAndRevealVotes(voteMap) {
      const disputeId = await disputeDAO.gameToDispute(gameId);
      const selectedArbitrators = await disputeDAO.getSelectedArbitrators(disputeId);

      for (let i = 0; i < selectedArbitrators.length; i++) {
        const arbitrator = selectedArbitrators[i];
        const vote = voteMap[arbitrator] ?? voteMap.defaultVote;
        const salt = web3.utils.soliditySha3(`dynamic-quorum-${i}-${vote}`);
        const commitHash = await voteCommitment(disputeId, vote, salt, arbitrator);

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

    it("should derive the minimum revealed-address count from the snapshotted panel policy", async () => {
      const disputeId = await disputeDAO.gameToDispute(gameId);
      const selectedArbitrators = await disputeDAO.getSelectedArbitrators(disputeId);
      const effectiveQuorum = await disputeDAO.getEffectiveQuorum(disputeId);

      assert.equal(selectedArbitrators.length, 3, "Expected the small bootstrap panel to contain three arbitrators");
      assert.equal(effectiveQuorum.toString(), "3", "The minimum panel snapshot is the diversity quorum");
    });

    it("should resolve a dispute with the bootstrap panel instead of escalating forever", async () => {
      const { disputeId } = await commitAndRevealVotes({ defaultVote: 2 });
      const selectedArbitrators = await disputeDAO.getSelectedArbitrators(disputeId);
      const challengerBeforeResolution = await chessToken.balanceOf(player1);
      const innocentBeforeResolution = await chessToken.balanceOf(player2);

      const assignmentsBefore = await arbitratorRegistry.activeAssignments(selectedArbitrators[0]);
      assert.equal(assignmentsBefore.toString(), "1", "The panel stake should remain locked");

      await disputeDAO.resolveDispute(disputeId, { from: challenger });

      const dispute = await disputeDAO.getDispute(disputeId);
      const assignmentsAfter = await arbitratorRegistry.activeAssignments(selectedArbitrators[0]);
      assert.equal(dispute.state.toString(), "4", "Dispute should resolve with the available bootstrap panel");
      assert.equal(dispute.finalDecision.toString(), "2", "Decision should be WhiteCheat");
      assert.equal(assignmentsAfter.toString(), "0", "Resolution should release the panel stake");
      assert.equal(
        (await chessToken.balanceOf(player1)).toString(),
        challengerBeforeResolution.toString(),
        "A challenger identified as the cheater must not recover the deposit"
      );
      assert.equal(
        web3.utils.toBN(await chessToken.balanceOf(player2)).sub(web3.utils.toBN(innocentBeforeResolution)).toString(),
        web3.utils.toWei("25", "ether"),
        "The innocent opponent receives compensation from the forfeited deposit"
      );
      assert.isTrue((await bondingManager.gameBonds(gameId, player1)).slashed);
    });

    it("should refund and reward an innocent challenger only when the other player cheated", async () => {
      const bonus = web3.utils.toWei("25", "ether");
      await chessToken.transfer(disputeDAO.address, bonus, { from: treasury });
      const { disputeId } = await commitAndRevealVotes({ defaultVote: 3 });
      const challengerBeforeResolution = await chessToken.balanceOf(player1);

      await disputeDAO.resolveDispute(disputeId);

      assert.equal((await disputeDAO.getDispute(disputeId)).finalDecision.toString(), "3");
      assert.equal(
        web3.utils.toBN(await chessToken.balanceOf(player1)).sub(web3.utils.toBN(challengerBeforeResolution)).toString(),
        web3.utils.toWei("75", "ether"),
        "The innocent challenger receives the deposit plus the prefunded capped bonus"
      );
      assert.isTrue((await bondingManager.gameBonds(gameId, player2)).slashed);
    });

    it("should compensate only the non-challenging player when the game is legitimate", async () => {
      const { disputeId } = await commitAndRevealVotes({ defaultVote: 1 });
      const challengerBeforeResolution = await chessToken.balanceOf(player1);
      const opponentBeforeResolution = await chessToken.balanceOf(player2);

      await disputeDAO.resolveDispute(disputeId);

      assert.equal((await disputeDAO.getDispute(disputeId)).finalDecision.toString(), "1");
      assert.equal(
        (await chessToken.balanceOf(player1)).toString(),
        challengerBeforeResolution.toString(),
        "A failed challenger receives no part of the deposit"
      );
      assert.equal(
        web3.utils.toBN(await chessToken.balanceOf(player2)).sub(web3.utils.toBN(opponentBeforeResolution)).toString(),
        web3.utils.toWei("25", "ether")
      );
    });

    it("should use snapshotted supermajority when live governance parameters change", async () => {
      const disputeId = await disputeDAO.gameToDispute(gameId);
      const selectedArbitrators = await disputeDAO.getSelectedArbitrators(disputeId);

      await disputeDAO.setParameters(
        48 * 3600,
        24 * 3600,
        24 * 3600,
        100,
        100,
        CHALLENGE_DEPOSIT,
        { from: admin }
      );

      const voteMap = {
        defaultVote: 2,
        [selectedArbitrators[2]]: 4
      };

      await commitAndRevealVotes(voteMap);
      await disputeDAO.resolveDispute(disputeId, { from: challenger });

      const dispute = await disputeDAO.getDispute(disputeId);
      const incorrectVoter = await arbitratorRegistry.getArbitratorInfo(selectedArbitrators[2]);
      assert.equal(dispute.state.toString(), "4", "Dispute should still resolve when two of three arbitrators agree");
      assert.equal(dispute.finalDecision.toString(), "2", "Two WhiteCheat votes and one abstain should resolve WhiteCheat");
      assert.equal((await disputeDAO.disputeSupermajority(disputeId)).toString(), "66");
      assert.equal(incorrectVoter.stakedAmount.toString(), web3.utils.toWei("990", "ether"));
      assert.equal(incorrectVoter.reputation.toString(), "99");
      assert.isFalse(incorrectVoter.isActive, "A minimum-tier incorrect voter must be deactivated");
      assert.isTrue(await arbitratorRegistry.incorrectVotePenalized(disputeId, selectedArbitrators[2]));
      assert.equal(
        (await arbitratorRegistry.activeAssignments(selectedArbitrators[2])).toString(),
        "0",
        "Resolution must release an assignment even after slashing deactivates it"
      );
      assert.isFalse(
        await arbitratorRegistry.disputeAssignments(disputeId, selectedArbitrators[2]),
        "The released per-dispute assignment marker must be cleared"
      );
    });

    it("should require all three bootstrap addresses even when two reveals have enough power", async () => {
      const disputeId = await disputeDAO.gameToDispute(gameId);
      const selected = await disputeDAO.getSelectedArbitrators(disputeId);
      const salts = [];

      for (let i = 0; i < 2; i++) {
        const salt = web3.utils.soliditySha3(`two-of-three-${i}`);
        salts.push(salt);
        await disputeDAO.commitVote(
          disputeId,
          await voteCommitment(disputeId, 2, salt, selected[i]),
          { from: selected[i] }
        );
      }

      await advanceTime(24 * 3600 + 1);
      for (let i = 0; i < 2; i++) {
        await disputeDAO.revealVote(disputeId, 2, salts[i], { from: selected[i] });
      }
      await advanceTime(24 * 3600 + 1);
      await disputeDAO.resolveDispute(disputeId);

      const dispute = await disputeDAO.getDispute(disputeId);
      const nonRevealer = await arbitratorRegistry.getArbitratorInfo(selected[2]);
      assert.equal(dispute.state.toString(), "7", "An exhausted pool must go directly to backstop");
      assert.equal(dispute.escalationLevel.toString(), "1");
      assert.equal(dispute.finalDecision.toString(), "0");
      assert.equal((await disputeDAO.disputeDeposits(disputeId)).toString(), CHALLENGE_DEPOSIT);
      assert.equal((await disputeDAO.selectionSequenceCounter()).toString(), "1");
      assert.equal((await arbitratorRegistry.activePanelSelection()).toString(), "0");
      assert.equal(nonRevealer.stakedAmount.toString(), web3.utils.toWei("950", "ether"));
      assert.isFalse(nonRevealer.isActive);
      for (const arbitrator of selected) {
        assert.equal((await arbitratorRegistry.activeAssignments(arbitrator)).toString(), "0");
      }
    });

    it("should slash and permanently exclude non-revealers without a free Vote.None", async () => {
      const disputeId = await disputeDAO.gameToDispute(gameId);
      const selectedArbitrators = await disputeDAO.getSelectedArbitrators(disputeId);

      for (let i = 0; i < selectedArbitrators.length; i++) {
        const arbitrator = selectedArbitrators[i];
        const salt = web3.utils.soliditySha3(`first-round-${i}`);
        const commitHash = await voteCommitment(disputeId, 2, salt, arbitrator);
        await disputeDAO.commitVote(disputeId, commitHash, { from: arbitrator });
      }

      await advanceTime(48 * 3600 + 2);
      await disputeDAO.resolveDispute(disputeId, { from: challenger });

      const escalated = await disputeDAO.getDispute(disputeId);
      assert.equal(escalated.state.toString(), "7", "An impossible next round must not enter the FIFO");
      assert.equal(escalated.escalationLevel.toString(), "1");
      assert.equal((await disputeDAO.disputeDeposits(disputeId)).toString(), CHALLENGE_DEPOSIT);
      assert.equal((await disputeDAO.selectionSequenceCounter()).toString(), "1");
      assert.equal((await arbitratorRegistry.activePanelSelection()).toString(), "0");

      for (const arbitrator of selectedArbitrators) {
        const status = await disputeDAO.getVoteStatus(disputeId, arbitrator);
        const assignments = await arbitratorRegistry.activeAssignments(arbitrator);
        const arbitratorInfo = await arbitratorRegistry.getArbitratorInfo(arbitrator);
        assert.isFalse(status.hasCommitted, "The previous round commit must be cleared");
        assert.equal(assignments.toString(), "0", "Escalation must release the prior assignment");
        assert.equal(arbitratorInfo.reputation.toString(), "99", "Non-reveal must be penalized before escalation");
        assert.equal(arbitratorInfo.stakedAmount.toString(), web3.utils.toWei("950", "ether"));
        assert.isTrue(await arbitratorRegistry.nonRevealPenalized(disputeId, arbitrator));
      }

      const stillOpen = await disputeDAO.getDispute(disputeId);
      assert.equal(stillOpen.state.toString(), "7");
      assert.equal(stillOpen.finalDecision.toString(), "0");
    });

    it("should rotate a fully revealed split panel and require the timelocked backstop when no pool remains", async () => {
      const disputeId = await disputeDAO.gameToDispute(gameId);
      const selected = await disputeDAO.getSelectedArbitrators(disputeId);
      const voteMap = {
        defaultVote: 1,
        [selected[1]]: 2,
        [selected[2]]: 4
      };

      await commitAndRevealVotes(voteMap);
      await disputeDAO.resolveDispute(disputeId);

      const escalated = await disputeDAO.getDispute(disputeId);
      assert.equal(escalated.state.toString(), "7");
      assert.equal(escalated.escalationLevel.toString(), "1");
      assert.equal((await disputeDAO.selectionSequenceCounter()).toString(), "1");
      assert.equal((await arbitratorRegistry.activePanelSelection()).toString(), "0");
      for (const arbitrator of selected) {
        assert.isTrue(await arbitratorRegistry.priorRoundExcluded(disputeId, arbitrator));
        assert.equal((await arbitratorRegistry.activeAssignments(arbitrator)).toString(), "0");
      }

      const unresolved = await disputeDAO.getDispute(disputeId);
      const whiteBond = await bondingManager.gameBonds(gameId, player1);
      const blackBond = await bondingManager.gameBonds(gameId, player2);
      assert.equal(unresolved.state.toString(), "7");
      assert.equal((await disputeDAO.disputeDeposits(disputeId)).toString(), CHALLENGE_DEPOSIT);
      assert.isFalse(whiteBond.released);
      assert.isFalse(whiteBond.slashed);
      assert.isFalse(blackBond.released);
      assert.isFalse(blackBond.slashed);

      await expectRevert(
        disputeDAO.resolveByBackstop(disputeId, 1, { from: challenger }),
        "a non-governance backstop decision after reaching Unresolved"
      );

      await expectRevert(
        disputeDAO.resolveByBackstop(disputeId, 4, { from: admin }),
        "governance must not settle an unresolved dispute as Abstain"
      );

      await disputeDAO.resolveByBackstop(disputeId, 1, { from: admin });
      const resolved = await disputeDAO.getDispute(disputeId);
      assert.equal(resolved.state.toString(), "4");
      assert.equal(resolved.finalDecision.toString(), "1");
      assert.equal((await disputeDAO.disputeDeposits(disputeId)).toString(), "0");
      assert.equal((await disputeDAO.activeChallenges(player1)).toString(), "0");
    });
  });

  describe("Bounded Population Gas", () => {
    it("should execute capped scheduling, finalization, and escalation below the local block gas limit", async () => {
      const executeBelowOperationalCeiling = async (label, sendTransaction) => {
        const latestBlock = await web3.eth.getBlock("latest");
        const blockGasLimit = web3.utils.toBN(latestBlock.gasLimit);
        const operationalCeiling = blockGasLimit.mul(web3.utils.toBN("9")).div(web3.utils.toBN("10"));
        const tx = await sendTransaction(operationalCeiling.toNumber());
        assert.isTrue(tx.receipt.status, `${label} transaction must succeed`);
        const gasUsed = web3.utils.toBN(tx.receipt.gasUsed);
        assert.isTrue(
          gasUsed.lt(operationalCeiling),
          `${label} gas ${gasUsed} must stay below 90% of block limit ${blockGasLimit}`
        );
        return tx;
      };

      const cappedRegistry = await ArbitratorRegistryHarness.new(chessToken.address, { from: admin });
      const cappedDAO = await DisputeDAO.new(
        chessToken.address,
        bondingManager.address,
        cappedRegistry.address,
        { from: admin }
      );
      const registryRole = await cappedRegistry.DISPUTE_MANAGER_ROLE();
      const bondingRole = await bondingManager.DISPUTE_MANAGER_ROLE();
      const gameRole = await cappedDAO.GAME_MANAGER_ROLE();
      await cappedRegistry.grantRole(registryRole, cappedDAO.address, { from: admin });
      await bondingManager.grantRole(bondingRole, cappedDAO.address, { from: admin });
      await cappedDAO.grantRole(gameRole, gameManager, { from: admin });

      const stakes = [
        [arb1, web3.utils.toWei("1000", "ether")],
        [arb2, web3.utils.toWei("5000", "ether")],
        [arb3, web3.utils.toWei("20000", "ether")]
      ];
      for (const [arbitrator, amount] of stakes) {
        await chessToken.approve(cappedRegistry.address, amount, { from: arbitrator });
        await cappedRegistry.stake(amount, { from: arbitrator });
      }
      await cappedRegistry.fillTier1ToCapForTest({ from: admin });
      await cappedRegistry.fillTier2ToCapForTest({ from: admin });
      await cappedRegistry.fillTier3ToCapForTest({ from: admin });
      await cappedRegistry.accountSeededPopulationForTest({ from: admin });

      // Synthetic positions used by the gas harness must obey the same aggregate
      // and token-backing invariants as production stakes before the measured
      // escalation transaction applies its non-reveal slashes.
      const accountedStake = web3.utils.toBN(await cappedRegistry.totalStaked());
      const registryBalance = web3.utils.toBN(await chessToken.balanceOf(cappedRegistry.address));
      await chessToken.transfer(
        cappedRegistry.address,
        accountedStake.sub(registryBalance).toString(),
        { from: treasury }
      );
      await advanceTime(7 * 24 * 3600 + 1);
      await bondingManager.updatePrice(initialPrice, { from: admin });

      const gasGameId = 650;
      const gameStake = web3.utils.toWei("0.1", "ether");
      await bondingManager.lockBondsForGame(
        gasGameId,
        player1,
        player2,
        gameStake,
        { from: gameManager }
      );
      await cappedDAO.registerGame(
        gasGameId,
        player1,
        player2,
        gameStake,
        { from: gameManager }
      );
      await chessToken.approve(cappedDAO.address, CHALLENGE_DEPOSIT, { from: player1 });

      await executeBelowOperationalCeiling(
        "Capped schedule",
        (gas) => cappedDAO.challenge(gasGameId, { from: player1, gas })
      );

      const target = web3.utils.toBN(await cappedDAO.panelSelectionBlock(1));
      while (web3.utils.toBN(await web3.eth.getBlockNumber()).lt(target)) await mineBlock();
      await executeBelowOperationalCeiling(
        "Capped finalize",
        (gas) => cappedDAO.finalizePanel(1, { from: challenger, gas })
      );

      const initialPanel = await cappedDAO.getSelectedArbitrators(1);
      assert.equal(initialPanel.length, 15, "The measured escalation must process a full capped panel");

      // Exercise the heaviest recovery path too: penalize/release a full initial
      // panel and snapshot the remaining capped population for the next round.
      await advanceTime(48 * 3600 + 1);
      assert.equal(
        (await cappedDAO.panelSnapshotEligibleCount(1)).toString(),
        "15",
        "Snapshot capacity must reflect five selectable candidates per tier"
      );
      assert.equal((await cappedRegistry.totalArbitrators()).toString(), "384");
      assert.equal((await cappedRegistry.totalStaked()).toString(), web3.utils.toWei("3328000", "ether"));
      assert.equal(
        (await chessToken.balanceOf(cappedRegistry.address)).toString(),
        web3.utils.toWei("3328000", "ether")
      );
      const tierCounts = await cappedRegistry.getTierCounts();
      assert.equal(tierCounts.t1.toString(), "128");
      assert.equal(tierCounts.t2.toString(), "128");
      assert.equal(tierCounts.t3.toString(), "128");

      const slashBps = web3.utils.toBN(await cappedRegistry.NON_REVEAL_SLASH_BPS());
      const basisPoints = web3.utils.toBN("10000");
      const panelStakes = await Promise.all(
        initialPanel.map((arbitrator) => cappedRegistry.getSlashableStake(arbitrator))
      );
      const expectedSlash = panelStakes.reduce(
        (total, stake) => total.add(web3.utils.toBN(stake).mul(slashBps).div(basisPoints)),
        web3.utils.toBN("0")
      );
      const totalStakedBeforeEscalation = web3.utils.toBN(await cappedRegistry.totalStaked());
      const registryBalanceBeforeEscalation = web3.utils.toBN(
        await chessToken.balanceOf(cappedRegistry.address)
      );

      await executeBelowOperationalCeiling(
        "Capped escalation",
        (gas) => cappedDAO.resolveDispute(1, { from: challenger, gas })
      );

      const escalated = await cappedDAO.getDispute(1);
      assert.equal(escalated.state.toString(), "6", "Escalation must schedule the next panel");
      assert.equal(escalated.escalationLevel.toString(), "1");
      assert.equal((await cappedDAO.getSelectedArbitrators(1)).length, 0);
      assert.isTrue(web3.utils.toBN(await cappedDAO.panelSelectionBlock(1)).gt(web3.utils.toBN("0")));
      assert.equal((await cappedRegistry.activePanelSelection()).toString(), "1");
      assert.equal(
        (await cappedRegistry.totalStaked()).toString(),
        totalStakedBeforeEscalation.sub(expectedSlash).toString(),
        "Escalation must account for every non-reveal slash"
      );
      assert.equal(
        (await chessToken.balanceOf(cappedRegistry.address)).toString(),
        registryBalanceBeforeEscalation.sub(expectedSlash).toString(),
        "Registry backing must decrease by the exact burned slash amount"
      );
      for (const arbitrator of initialPanel) {
        assert.isTrue(await cappedRegistry.nonRevealPenalized(1, arbitrator));
        assert.isTrue(await cappedRegistry.priorRoundExcluded(1, arbitrator));
        assert.equal((await cappedRegistry.activeAssignments(arbitrator)).toString(), "0");
      }
    });
  });

  describe("Stake-weighted Sybil Resistance", () => {
    it("should not give ten low-stake Sybils a raw-address veto over five honest high-power reveals", async () => {
      const sybils = [accounts[0], accounts[1], accounts[2], accounts[6], accounts[7], accounts[8], accounts[9], accounts[10], accounts[11], accounts[12]];
      const honest = [accounts[13], accounts[14], accounts[15], accounts[16], accounts[17]];
      assert.isDefined(honest[4], "The security suite requires Ganache with at least 18 accounts");

      const weightedRegistry = await ArbitratorRegistry.new(chessToken.address, { from: admin });
      const weightedDAO = await DisputeDAO.new(
        chessToken.address,
        bondingManager.address,
        weightedRegistry.address,
        { from: admin }
      );
      const registryRole = await weightedRegistry.DISPUTE_MANAGER_ROLE();
      const bondingRole = await bondingManager.DISPUTE_MANAGER_ROLE();
      const gameRole = await weightedDAO.GAME_MANAGER_ROLE();
      await weightedRegistry.grantRole(registryRole, weightedDAO.address, { from: admin });
      await bondingManager.grantRole(bondingRole, weightedDAO.address, { from: admin });
      await weightedDAO.grantRole(gameRole, gameManager, { from: admin });

      const tier1 = web3.utils.toWei("1000", "ether");
      const tier2 = web3.utils.toWei("5000", "ether");
      const tier3 = web3.utils.toWei("20000", "ether");
      const funding = web3.utils.toWei("25000", "ether");

      for (let i = 0; i < sybils.length; i++) {
        const stake = i < 5 ? tier1 : tier2;
        await chessToken.mintPlayToEarn(sybils[i], funding, { from: admin });
        await chessToken.approve(weightedRegistry.address, stake, { from: sybils[i] });
        await weightedRegistry.stake(stake, { from: sybils[i] });
      }
      for (const arbitrator of honest) {
        await chessToken.mintPlayToEarn(arbitrator, funding, { from: admin });
        await chessToken.approve(weightedRegistry.address, tier3, { from: arbitrator });
        await weightedRegistry.stake(tier3, { from: arbitrator });
      }

      // Mature the arbitrators before opening the 48-hour challenge window.
      await advanceTime(7 * 24 * 3600 + 1);
      await bondingManager.updatePrice(initialPrice, { from: admin });

      const gameId = 700;
      const stake = web3.utils.toWei("0.1", "ether");
      await bondingManager.lockBondsForGame(gameId, player1, player2, stake, { from: gameManager });
      await weightedDAO.registerGame(gameId, player1, player2, stake, { from: gameManager });
      await chessToken.approve(weightedDAO.address, CHALLENGE_DEPOSIT, { from: player1 });
      await weightedDAO.challenge(gameId, { from: player1 });

      const target = web3.utils.toBN(await weightedDAO.panelSelectionBlock(1));
      while (web3.utils.toBN(await web3.eth.getBlockNumber()).lt(target)) await mineBlock();
      await weightedDAO.finalizePanel(1);

      const panel = await weightedDAO.getSelectedArbitrators(1);
      assert.equal(panel.length, 15, "All three five-member tiers must be represented");
      assert.equal((await weightedDAO.getEffectiveQuorum(1)).toString(), "3");
      const honestSet = new Set(honest.map((address) => address.toLowerCase()));
      const salts = new Map();

      for (let i = 0; i < panel.length; i++) {
        const arbitrator = panel[i];
        if (!honestSet.has(arbitrator.toLowerCase())) continue;
        const vote = 1;
        const salt = web3.utils.soliditySha3(`weighted-panel-${i}`);
        salts.set(arbitrator.toLowerCase(), { salt, vote });
        const commitment = await weightedDAO.computeVoteCommitment(1, vote, salt, arbitrator);
        await weightedDAO.commitVote(1, commitment, { from: arbitrator });
      }

      await advanceTime(24 * 3600 + 1);
      for (const arbitrator of panel) {
        if (!honestSet.has(arbitrator.toLowerCase())) continue;
        const saved = salts.get(arbitrator.toLowerCase());
        await weightedDAO.revealVote(1, saved.vote, saved.salt, { from: arbitrator });
      }
      await advanceTime(24 * 3600 + 1);
      await weightedDAO.resolveDispute(1);

      const resolved = await weightedDAO.getDispute(1);
      assert.equal(resolved.finalDecision.toString(), "1", "100,000 revealed honest CHESS exceeds the 66% power quorum");
      assert.equal(resolved.state.toString(), "4");
      assert.equal(resolved.whiteCheatVotes.toString(), "0");
      assert.equal(resolved.blackCheatVotes.toString(), "0");
      assert.isTrue(web3.utils.toBN(resolved.legitVotes).gte(web3.utils.toBN(tier3).mul(web3.utils.toBN("5"))));

      const penalizedSybil = await weightedRegistry.getArbitratorInfo(sybils[0]);
      assert.isTrue(
        web3.utils.toBN(penalizedSybil.stakedAmount).lt(web3.utils.toBN(tier1)),
        "A non-revealing Sybil must incur the explicit non-reveal slash"
      );
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
        const commitHash = await voteCommitment(disputeId, vote, salt, arbitrator);
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

    it("serializes concurrent selections without invalidation and preserves the snapshot across registry activity", async () => {
      const extraArbitrators = accounts.slice(10, 16);
      assert.equal(extraArbitrators.length, 6, "The concurrency regression requires 16 accounts");
      for (const arbitrator of extraArbitrators) {
        await chessToken.mintPlayToEarn(arbitrator, TIER1_STAKE, { from: admin });
        await chessToken.approve(arbitratorRegistry.address, TIER1_STAKE, { from: arbitrator });
        await arbitratorRegistry.stake(TIER1_STAKE, { from: arbitrator });
      }
      await advanceTime(7 * 24 * 60 * 60 + 1);
      await bondingManager.updatePrice(initialPrice, { from: admin });
      await bondingManager.lockBondsForGame(1, player1, player2, stake, { from: gameManager });
      await bondingManager.lockBondsForGame(2, player1, player2, stake, { from: gameManager });
      await disputeDAO.registerGame(1, player1, player2, stake, { from: gameManager });
      await disputeDAO.registerGame(2, player1, player2, stake, { from: gameManager });
      await lockAndChallenge(1, { from: player1 });
      await lockAndChallenge(2, { from: player2 });

      const disputeId1 = await disputeDAO.gameToDispute(1);
      const disputeId2 = await disputeDAO.gameToDispute(2);
      assert.isTrue(
        web3.utils.toBN(await disputeDAO.panelSelectionBlock(disputeId1)).gt(web3.utils.toBN("0")),
        "The FIFO head must own the only active entropy target"
      );
      assert.equal(
        (await disputeDAO.panelSelectionBlock(disputeId2)).toString(),
        "0",
        "The next dispute must remain queued without a grindable seed"
      );

      await finalizeScheduledPanel(disputeId1);
      const firstRound = await commitVotes(disputeId1, 2, "white-cheat");

      await disputeDAO.activatePanelSelection(disputeId2);
      const secondTarget = web3.utils.toBN(await disputeDAO.panelSelectionBlock(disputeId2));
      assert.isTrue(secondTarget.gt(web3.utils.toBN("0")));

      // A game recorded after the historical snapshot must not retroactively
      // exclude a candidate, even when the timestamp is shared by nearby calls.
      await disputeDAO.registerGame(3, firstRound.selectedArbitrators[0], player1, stake, {
        from: gameManager
      });

      await advanceTime(24 * 3600 + 1);
      await revealVotes(disputeId1, firstRound);
      await advanceTime(24 * 3600 + 1);

      // Resolution/release is deferred for the short committed-population window,
      // rather than invalidating the second dispute's snapshot.
      await expectRevert(
        disputeDAO.resolveDispute(disputeId1),
        "release and reputation mutations while another snapshot is committed"
      );

      while (web3.utils.toBN(await web3.eth.getBlockNumber()).lte(secondTarget)) await mineBlock();
      await disputeDAO.finalizePanel(disputeId2);
      assert.equal((await arbitratorRegistry.activePanelSelection()).toString(), "0");

      // Once entropy is consumed the lock is released and the earlier panel can
      // settle normally. Its assignments never invalidated dispute two.
      await disputeDAO.resolveDispute(disputeId1);

      const firstDispute = await disputeDAO.getDispute(disputeId1);
      const secondDispute = await disputeDAO.getDispute(disputeId2);
      assert.equal(firstDispute.state.toString(), "4");
      assert.equal(firstDispute.finalDecision.toString(), "2");
      assert.equal(secondDispute.state.toString(), "2");
      assert.isTrue((await disputeDAO.getSelectedArbitrators(disputeId2)).length >= 3);
      assert.equal((await disputeDAO.disputeDeposits(disputeId1)).toString(), "0");
      assert.equal((await disputeDAO.disputeDeposits(disputeId2)).toString(), CHALLENGE_DEPOSIT);
      assert.equal((await disputeDAO.nextSelectionSequence()).toString(), "3");
      for (const arbitrator of firstRound.selectedArbitrators) {
        assert.equal((await arbitratorRegistry.activeAssignments(arbitrator)).toString(), "0");
      }
    });
  });
});
