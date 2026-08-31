const ChessToken = artifacts.require("ChessToken");
const ArbitratorRegistry = artifacts.require("ArbitratorRegistry");
const ArbitratorRegistryHarness = artifacts.require("ArbitratorRegistryHarness");

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

contract("ArbitratorRegistry", (accounts) => {
  const admin = accounts[0];
  const teamWallet = accounts[1];
  const treasury = accounts[2];
  const arbitrator1 = accounts[3];
  const arbitrator2 = accounts[4];
  const arbitrator3 = accounts[5];
  const player1 = accounts[6];
  const player2 = accounts[7];
  const disputeManager = accounts[8];

  let chessToken;
  let arbitratorRegistry;

  const TIER1_STAKE = web3.utils.toWei("1000", "ether");
  const TIER2_STAKE = web3.utils.toWei("5000", "ether");
  const TIER3_STAKE = web3.utils.toWei("20000", "ether");
  const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
  const SELECTION_ENTROPY = web3.utils.soliditySha3("future-block-entropy");

  async function selectionArgs(
    registry,
    disputeId,
    count,
    entropy = SELECTION_ENTROPY,
    extraExcluded = ZERO_ADDRESS,
    snapshotRound = 0
  ) {
    const activeSelection = await registry.activePanelSelection();
    if (!web3.utils.toBN(activeSelection).isZero()) {
      await registry.unlockPanelSelection(activeSelection, { from: disputeManager });
    }
    await registry.lockPanelSelection(disputeId, { from: disputeManager });
    const snapshot = await registry.getSelectionSnapshot(
      disputeId,
      player1,
      player2,
      extraExcluded,
      count,
      snapshotRound,
      { from: disputeManager }
    );
    return [
      disputeId,
      player1,
      player2,
      extraExcluded,
      count,
      entropy,
      snapshotRound,
      (snapshot.snapshotTimestamp || snapshot[3]).toString(),
      (snapshot.snapshotGameRecordSequence || snapshot[4]).toString(),
      snapshot.fingerprint || snapshot[0]
    ];
  }

  beforeEach(async () => {
    chessToken = await ChessToken.new(teamWallet, treasury, { from: admin });
    arbitratorRegistry = await ArbitratorRegistry.new(chessToken.address, { from: admin });

    // Grant dispute manager role
    const DISPUTE_MANAGER_ROLE = await arbitratorRegistry.DISPUTE_MANAGER_ROLE();
    await arbitratorRegistry.grantRole(DISPUTE_MANAGER_ROLE, disputeManager, { from: admin });

    // Mint tokens to arbitrators
    const mintAmount = web3.utils.toWei("50000", "ether");
    await chessToken.mintPlayToEarn(arbitrator1, mintAmount, { from: admin });
    await chessToken.mintPlayToEarn(arbitrator2, mintAmount, { from: admin });
    await chessToken.mintPlayToEarn(arbitrator3, mintAmount, { from: admin });

    // Approve registry to spend tokens
    await chessToken.approve(arbitratorRegistry.address, mintAmount, { from: arbitrator1 });
    await chessToken.approve(arbitratorRegistry.address, mintAmount, { from: arbitrator2 });
    await chessToken.approve(arbitratorRegistry.address, mintAmount, { from: arbitrator3 });
  });

  describe("Staking", () => {
    it("should allow staking tier 1 amount", async () => {
      await arbitratorRegistry.stake(TIER1_STAKE, { from: arbitrator1 });

      const info = await arbitratorRegistry.getArbitratorInfo(arbitrator1);
      assert.equal(info.stakedAmount.toString(), TIER1_STAKE);
      assert.equal(info.tier.toString(), "1");
      assert.isTrue(info.isActive);
    });

    it("should allow staking tier 2 amount", async () => {
      await arbitratorRegistry.stake(TIER2_STAKE, { from: arbitrator1 });

      const info = await arbitratorRegistry.getArbitratorInfo(arbitrator1);
      assert.equal(info.tier.toString(), "2");
    });

    it("should allow staking tier 3 amount", async () => {
      await arbitratorRegistry.stake(TIER3_STAKE, { from: arbitrator1 });

      const info = await arbitratorRegistry.getArbitratorInfo(arbitrator1);
      assert.equal(info.tier.toString(), "3");
    });

    it("should reject staking below minimum", async () => {
      const belowMin = web3.utils.toWei("500", "ether");
      await expectRevert(
        arbitratorRegistry.stake(belowMin, { from: arbitrator1 }),
        "an initial stake below tier one"
      );
    });

    it("should set initial reputation to 100", async () => {
      await arbitratorRegistry.stake(TIER1_STAKE, { from: arbitrator1 });

      const info = await arbitratorRegistry.getArbitratorInfo(arbitrator1);
      assert.equal(info.reputation.toString(), "100");
    });

    it("should update total staked and arbitrator count", async () => {
      await arbitratorRegistry.stake(TIER1_STAKE, { from: arbitrator1 });
      await arbitratorRegistry.stake(TIER2_STAKE, { from: arbitrator2 });

      const totalStaked = await arbitratorRegistry.totalStaked();
      const totalArbitrators = await arbitratorRegistry.totalArbitrators();

      const expectedStake = web3.utils.toBN(TIER1_STAKE).add(web3.utils.toBN(TIER2_STAKE));
      assert.equal(totalStaked.toString(), expectedStake.toString());
      assert.equal(totalArbitrators.toString(), "2");
    });

    it("should add to correct tier pool", async () => {
      await arbitratorRegistry.stake(TIER1_STAKE, { from: arbitrator1 });
      await arbitratorRegistry.stake(TIER2_STAKE, { from: arbitrator2 });
      await arbitratorRegistry.stake(TIER3_STAKE, { from: arbitrator3 });

      const tierCounts = await arbitratorRegistry.getTierCounts();
      assert.equal(tierCounts.t1.toString(), "1");
      assert.equal(tierCounts.t2.toString(), "1");
      assert.equal(tierCounts.t3.toString(), "1");
    });

    it("should allow increasing stake", async () => {
      await arbitratorRegistry.stake(TIER1_STAKE, { from: arbitrator1 });
      await arbitratorRegistry.stake(TIER1_STAKE, { from: arbitrator1 }); // Double

      const info = await arbitratorRegistry.getArbitratorInfo(arbitrator1);
      const pending = await arbitratorRegistry.getPendingStake(arbitrator1);
      const expectedStake = web3.utils.toBN(TIER1_STAKE).mul(web3.utils.toBN("2"));
      assert.equal(info.stakedAmount.toString(), expectedStake.toString());
      assert.equal(pending.amount.toString(), TIER1_STAKE);
      assert.equal(info.tier.toString(), "1", "A pending top-up must not change tier");
      assert.equal(
        (await arbitratorRegistry.totalStaked()).toString(),
        TIER1_STAKE,
        "Pending stake must not enter active-pool stake accounting"
      );
    });

    it("should upgrade tier only after the top-up activation delay", async () => {
      await arbitratorRegistry.stake(TIER1_STAKE, { from: arbitrator1 });
      let info = await arbitratorRegistry.getArbitratorInfo(arbitrator1);
      assert.equal(info.tier.toString(), "1");

      // Stake more to reach tier 2
      const additional = web3.utils.toBN(TIER2_STAKE).sub(web3.utils.toBN(TIER1_STAKE));
      await arbitratorRegistry.stake(additional.toString(), { from: arbitrator1 });

      info = await arbitratorRegistry.getArbitratorInfo(arbitrator1);
      assert.equal(info.tier.toString(), "1");

      await expectRevert(
        arbitratorRegistry.activatePendingStake({ from: arbitrator1 }),
        "an immature top-up"
      );

      await advanceTime(7 * 24 * 60 * 60 + 1);
      await arbitratorRegistry.activatePendingStake({ from: arbitrator1 });
      info = await arbitratorRegistry.getArbitratorInfo(arbitrator1);
      assert.equal(info.tier.toString(), "2");
      assert.equal((await arbitratorRegistry.totalStaked()).toString(), TIER2_STAKE);
    });
  });

  describe("Voting Power & Timelock", () => {
    it("should have zero voting power immediately after staking", async () => {
      await arbitratorRegistry.stake(TIER1_STAKE, { from: arbitrator1 });

      const votingPower = await arbitratorRegistry.getVotingPower(arbitrator1);
      assert.equal(votingPower.toString(), "0");
    });

    it("should not be able to vote during timelock", async () => {
      await arbitratorRegistry.stake(TIER1_STAKE, { from: arbitrator1 });

      const canVote = await arbitratorRegistry.canVote(arbitrator1);
      assert.isFalse(canVote);
    });

    it("should not give an active position immediate voting power or inherited age for a top-up", async () => {
      await arbitratorRegistry.stake(TIER1_STAKE, { from: arbitrator1 });
      await advanceTime(365 * 24 * 60 * 60 + 1);

      const maturedPower = web3.utils.toBN(await arbitratorRegistry.getVotingPower(arbitrator1));
      const additional = web3.utils.toBN(TIER2_STAKE).sub(web3.utils.toBN(TIER1_STAKE));
      await arbitratorRegistry.stake(additional.toString(), { from: arbitrator1 });

      const pendingPower = web3.utils.toBN(await arbitratorRegistry.getVotingPower(arbitrator1));
      const pendingInfo = await arbitratorRegistry.getArbitratorInfo(arbitrator1);
      const roundingTolerance = web3.utils.toBN(web3.utils.toWei("0.001", "ether"));
      assert.equal(pendingInfo.tier.toString(), "1");
      assert.isTrue(
        pendingPower.lte(maturedPower.add(roundingTolerance)),
        "Pending stake must not affect voting power"
      );

      await advanceTime(7 * 24 * 60 * 60 + 1);
      await arbitratorRegistry.activatePendingStake({ from: arbitrator1 });

      const activatedPower = web3.utils.toBN(await arbitratorRegistry.getVotingPower(arbitrator1));
      const maxFreshPower = web3.utils.toBN(TIER2_STAKE).add(
        web3.utils.toBN(web3.utils.toWei("0.01", "ether"))
      );
      assert.isTrue(activatedPower.gte(web3.utils.toBN(TIER2_STAKE)));
      assert.isTrue(activatedPower.lte(maxFreshPower), "Top-up must not inherit the one-year bonus");
    });

    // Note: Testing timelock passage would require time manipulation (ganache evm_increaseTime)
  });

  describe("Unstaking", () => {
    beforeEach(async () => {
      await arbitratorRegistry.stake(TIER2_STAKE, { from: arbitrator1 });
    });

    it("should allow partial unstaking", async () => {
      // Advance time past cooldown (if needed - assuming no votes yet)
      const unstakeAmount = web3.utils.toWei("1000", "ether");
      await arbitratorRegistry.unstake(unstakeAmount, { from: arbitrator1 });

      const info = await arbitratorRegistry.getArbitratorInfo(arbitrator1);
      const expectedStake = web3.utils.toBN(TIER2_STAKE).sub(web3.utils.toBN(unstakeAmount));
      assert.equal(info.stakedAmount.toString(), expectedStake.toString());
    });

    it("should downgrade tier when stake decreases", async () => {
      // Unstake to go from tier 2 to tier 1
      const unstakeAmount = web3.utils.toWei("2000", "ether"); // 5000 - 2000 = 3000 (tier 1)
      await arbitratorRegistry.unstake(unstakeAmount, { from: arbitrator1 });

      const info = await arbitratorRegistry.getArbitratorInfo(arbitrator1);
      assert.equal(info.tier.toString(), "1");
    });

    it("should deactivate when stake falls below minimum", async () => {
      const unstakeAmount = web3.utils.toWei("4500", "ether"); // 5000 - 4500 = 500 (below min)
      await arbitratorRegistry.unstake(unstakeAmount, { from: arbitrator1 });

      const info = await arbitratorRegistry.getArbitratorInfo(arbitrator1);
      assert.isFalse(info.isActive);
    });

    it("should allow an inactive arbitrator to withdraw the remaining stake", async () => {
      const firstWithdrawal = web3.utils.toWei("4500", "ether");
      const remainingStake = web3.utils.toWei("500", "ether");
      await arbitratorRegistry.unstake(firstWithdrawal, { from: arbitrator1 });

      await arbitratorRegistry.unstake(remainingStake, { from: arbitrator1 });

      const info = await arbitratorRegistry.getArbitratorInfo(arbitrator1);
      const totalStaked = await arbitratorRegistry.totalStaked();
      const totalArbitrators = await arbitratorRegistry.totalArbitrators();
      assert.equal(info.stakedAmount.toString(), "0");
      assert.equal(totalStaked.toString(), "0");
      assert.equal(totalArbitrators.toString(), "0");
    });

    it("should reactivate and restore pool membership using existing residual stake", async () => {
      await arbitratorRegistry.unstake(web3.utils.toWei("4500", "ether"), { from: arbitrator1 });
      await arbitratorRegistry.stake(web3.utils.toWei("500", "ether"), { from: arbitrator1 });

      const info = await arbitratorRegistry.getArbitratorInfo(arbitrator1);
      const tierCounts = await arbitratorRegistry.getTierCounts();
      assert.isTrue(info.isActive);
      assert.equal(info.stakedAmount.toString(), TIER1_STAKE);
      assert.equal(tierCounts.t1.toString(), "1");
    });

    it("should reject unstaking more than staked", async () => {
      const tooMuch = web3.utils.toWei("10000", "ether");
      await expectRevert(
        arbitratorRegistry.unstake(tooMuch, { from: arbitrator1 }),
        "unstaking more than the position"
      );
    });

    it("should return tokens on unstake", async () => {
      const unstakeAmount = web3.utils.toWei("1000", "ether");
      const balanceBefore = await chessToken.balanceOf(arbitrator1);

      await arbitratorRegistry.unstake(unstakeAmount, { from: arbitrator1 });

      const balanceAfter = await chessToken.balanceOf(arbitrator1);
      const diff = web3.utils.toBN(balanceAfter).sub(web3.utils.toBN(balanceBefore));
      assert.equal(diff.toString(), unstakeAmount);
    });
  });

  describe("Reputation", () => {
    beforeEach(async () => {
      await arbitratorRegistry.stake(TIER1_STAKE, { from: arbitrator1 });
    });

    it("should increase reputation for voting with majority", async () => {
      await arbitratorRegistry.updateReputation(arbitrator1, true, { from: disputeManager });

      const info = await arbitratorRegistry.getArbitratorInfo(arbitrator1);
      assert.equal(info.reputation.toString(), "101"); // 100 + 1
    });

    it("should decrease reputation for voting against majority", async () => {
      await arbitratorRegistry.updateReputation(arbitrator1, false, { from: disputeManager });

      const info = await arbitratorRegistry.getArbitratorInfo(arbitrator1);
      assert.equal(info.reputation.toString(), "99"); // 100 - 1
    });

    it("should cap reputation at 200", async () => {
      // Increase reputation many times
      for (let i = 0; i < 150; i++) {
        await arbitratorRegistry.updateReputation(arbitrator1, true, { from: disputeManager });
      }

      const info = await arbitratorRegistry.getArbitratorInfo(arbitrator1);
      assert.equal(info.reputation.toString(), "200");
    });

    it("should remove arbitrator when reputation falls below 50", async () => {
      // Decrease reputation many times
      for (let i = 0; i < 51; i++) {
        try {
          await arbitratorRegistry.updateReputation(arbitrator1, false, { from: disputeManager });
        } catch (e) {
          // May revert after removal
          break;
        }
      }

      const info = await arbitratorRegistry.getArbitratorInfo(arbitrator1);
      assert.isFalse(info.isActive);
    });

    it("should not reset a low reputation with a tiny restake", async () => {
      for (let i = 0; i < 51; i++) {
        try {
          await arbitratorRegistry.updateReputation(arbitrator1, false, { from: disputeManager });
        } catch (e) {
          break;
        }
      }

      await expectRevert(
        arbitratorRegistry.stake(web3.utils.toWei("1", "wei"), { from: arbitrator1 }),
        "a low-reputation restake"
      );

      const info = await arbitratorRegistry.getArbitratorInfo(arbitrator1);
      assert.isFalse(info.isActive);
      assert.isTrue(web3.utils.toBN(info.reputation).lt(web3.utils.toBN("50")));
    });

    it("should settle reputation idempotently after an arbitrator is inactive", async () => {
      for (let i = 0; i < 51; i++) {
        await arbitratorRegistry.updateReputation(arbitrator1, false, { from: disputeManager });
      }

      const inactiveInfo = await arbitratorRegistry.getArbitratorInfo(arbitrator1);
      assert.isFalse(inactiveInfo.isActive);
      assert.equal(inactiveInfo.reputation.toString(), "49");

      await arbitratorRegistry.updateReputation(arbitrator1, false, { from: disputeManager });
      const settledInfo = await arbitratorRegistry.getArbitratorInfo(arbitrator1);
      assert.equal(settledInfo.reputation.toString(), "48");
      assert.equal((await arbitratorRegistry.totalArbitrators()).toString(), "0");
    });
  });

  describe("Game Recording & Exclusion", () => {
    beforeEach(async () => {
      await arbitratorRegistry.stake(TIER1_STAKE, { from: arbitrator1 });
    });

    it("should record game between players", async () => {
      await arbitratorRegistry.recordGame(player1, player2, { from: disputeManager });

      const lastGame = await arbitratorRegistry.lastGameWith(player1, player2);
      assert.isTrue(web3.utils.toBN(lastGame).gt(web3.utils.toBN("0")));
    });

    it("should exclude players from arbitrating their own game", async () => {
      const shouldExclude = await arbitratorRegistry.shouldExclude(player1, player1, player2);
      assert.isTrue(shouldExclude);
    });

    it("should exclude recent opponents from arbitrating", async () => {
      await arbitratorRegistry.recordGame(arbitrator1, player1, { from: disputeManager });

      const shouldExclude = await arbitratorRegistry.shouldExclude(arbitrator1, player1, player2);
      assert.isTrue(shouldExclude);
    });

    it("should not exclude unrelated arbitrators", async () => {
      const shouldExclude = await arbitratorRegistry.shouldExclude(arbitrator1, player1, player2);
      assert.isFalse(shouldExclude);
    });

    it("should exclude an extra address such as the challenger", async () => {
      const shouldExclude = await arbitratorRegistry.shouldExclude(
        arbitrator1,
        player1,
        player2,
        arbitrator1
      );
      assert.isTrue(shouldExclude);
    });
  });

  describe("Assignment Reservation", () => {
    beforeEach(async () => {
      await arbitratorRegistry.stake(TIER1_STAKE, { from: arbitrator1 });
      await advanceTime(7 * 24 * 60 * 60 + 1);
    });

    it("should reserve cooldown and weekly quota when selected", async () => {
      const args = await selectionArgs(arbitratorRegistry, 90, 1);
      await arbitratorRegistry.selectArbitrators(
        ...args,
        { from: disputeManager }
      );
      await arbitratorRegistry.unlockPanelSelection(90, { from: disputeManager });

      const arb = await arbitratorRegistry.arbitrators(arbitrator1);
      assert.isTrue(web3.utils.toBN(arb.lastVoteTime).gt(web3.utils.toBN("0")));
      assert.equal(arb.disputesThisWeek.toString(), "1");
      assert.equal((await arbitratorRegistry.activeAssignments(arbitrator1)).toString(), "1");
      assert.isFalse(await arbitratorRegistry.canVote(arbitrator1));
    });

    it("should reject the sixth reservation in the same weekly bucket", async () => {
      const harness = await ArbitratorRegistryHarness.new(chessToken.address, { from: admin });
      const disputeRole = await harness.DISPUTE_MANAGER_ROLE();
      await harness.grantRole(disputeRole, disputeManager, { from: admin });
      await chessToken.approve(harness.address, TIER1_STAKE, { from: arbitrator1 });
      await harness.stake(TIER1_STAKE, { from: arbitrator1 });
      await advanceTime(7 * 24 * 60 * 60 + 1);

      for (let disputeId = 1; disputeId <= 5; disputeId++) {
        await harness.reserveAssignmentForTest(disputeId, arbitrator1, { from: admin });
        await harness.releaseArbitrators(disputeId, [arbitrator1], { from: disputeManager });
      }

      await expectRevert(
        harness.reserveAssignmentForTest(6, arbitrator1, { from: admin }),
        "the sixth weekly reservation"
      );
    });
  });

  describe("Tier Pool Management", () => {
    it("should track tier counts correctly", async () => {
      await arbitratorRegistry.stake(TIER1_STAKE, { from: arbitrator1 });
      await arbitratorRegistry.stake(TIER1_STAKE, { from: arbitrator2 });
      await arbitratorRegistry.stake(TIER3_STAKE, { from: arbitrator3 });

      const counts = await arbitratorRegistry.getTierCounts();
      assert.equal(counts.t1.toString(), "2");
      assert.equal(counts.t2.toString(), "0");
      assert.equal(counts.t3.toString(), "1");
    });

    it("should update tier pools when stake changes", async () => {
      await arbitratorRegistry.stake(TIER1_STAKE, { from: arbitrator1 });

      let counts = await arbitratorRegistry.getTierCounts();
      assert.equal(counts.t1.toString(), "1");

      // Upgrade to tier 2
      const additional = web3.utils.toBN(TIER2_STAKE).sub(web3.utils.toBN(TIER1_STAKE));
      await arbitratorRegistry.stake(additional.toString(), { from: arbitrator1 });

      counts = await arbitratorRegistry.getTierCounts();
      assert.equal(counts.t1.toString(), "1");
      assert.equal(counts.t2.toString(), "0");

      await advanceTime(7 * 24 * 60 * 60 + 1);
      await arbitratorRegistry.activatePendingStake({ from: arbitrator1 });

      counts = await arbitratorRegistry.getTierCounts();
      assert.equal(counts.t1.toString(), "0");
      assert.equal(counts.t2.toString(), "1");
    });

    it("should reject registration when the bounded tier pool is full", async () => {
      const harness = await ArbitratorRegistryHarness.new(chessToken.address, { from: admin });
      await harness.fillTier1ToCapForTest({ from: admin });
      await chessToken.approve(harness.address, TIER1_STAKE, { from: arbitrator1 });

      await expectRevert(
        harness.stake(TIER1_STAKE, { from: arbitrator1 }),
        "a permissionless entry into a full tier"
      );

      const counts = await harness.getTierCounts();
      const cap = await harness.MAX_ARBITRATORS_PER_TIER_POOL();
      assert.equal(counts.t1.toString(), cap.toString());
    });
  });

  describe("Arbitrator Selection", () => {
    beforeEach(async () => {
      // Create multiple arbitrators in each tier
      // Note: In real tests, we'd need to advance time for voting power
      await arbitratorRegistry.stake(TIER1_STAKE, { from: arbitrator1 });
      await arbitratorRegistry.stake(TIER2_STAKE, { from: arbitrator2 });
      await arbitratorRegistry.stake(TIER3_STAKE, { from: arbitrator3 });
    });

    it("should return empty array when arbitrators are in timelock", async () => {
      // Arbitrators just staked, so they're still in the 7-day timelock
      // Selection should return an empty array since no one can vote yet
      // Use .call() to get the return value without sending a transaction
      const args = await selectionArgs(arbitratorRegistry, 1, 1);
      const selected = await arbitratorRegistry.selectArbitrators.call(
        ...args,
        { from: disputeManager }
      );

      // Selection returns empty because arbitrators can't vote during timelock
      assert.isTrue(Array.isArray(selected));
      assert.equal(selected.length, 0, "Should return empty array during timelock");
    });

    it("should return a unique full panel from a single populated tier after timelock", async () => {
      const freshRegistry = await ArbitratorRegistry.new(chessToken.address, { from: admin });
      const disputeRole = await freshRegistry.DISPUTE_MANAGER_ROLE();
      await freshRegistry.grantRole(disputeRole, disputeManager, { from: admin });

      await chessToken.approve(freshRegistry.address, TIER1_STAKE, { from: arbitrator1 });
      await chessToken.approve(freshRegistry.address, TIER1_STAKE, { from: arbitrator2 });
      await chessToken.approve(freshRegistry.address, TIER1_STAKE, { from: arbitrator3 });

      await freshRegistry.stake(TIER1_STAKE, { from: arbitrator1 });
      await freshRegistry.stake(TIER1_STAKE, { from: arbitrator2 });
      await freshRegistry.stake(TIER1_STAKE, { from: arbitrator3 });

      await advanceTime(7 * 24 * 60 * 60 + 1);

      const args = await selectionArgs(freshRegistry, 7, 5);
      const selected = await freshRegistry.selectArbitrators.call(
        ...args,
        { from: disputeManager }
      );

      const unique = new Set(selected.map((address) => address.toLowerCase()));
      assert.equal(selected.length, 3, "Should select all eligible arbitrators from the populated tier");
      assert.equal(unique.size, 3, "Selected arbitrators should be unique");
    });

    it("should lock selected arbitrator stakes until the dispute panel is released", async () => {
      await advanceTime(7 * 24 * 60 * 60 + 1);

      const args = await selectionArgs(arbitratorRegistry, 42, 1);
      await arbitratorRegistry.selectArbitrators(
        ...args,
        { from: disputeManager }
      );
      await arbitratorRegistry.unlockPanelSelection(42, { from: disputeManager });

      const assignments = await arbitratorRegistry.activeAssignments(arbitrator1);
      assert.equal(assignments.toString(), "1", "The selected panel must be tracked");

      await expectRevert(
        arbitratorRegistry.unstake(TIER1_STAKE, { from: arbitrator1 }),
        "unstaking an assigned position"
      );

      await arbitratorRegistry.releaseArbitrators(
        42,
        [arbitrator1, arbitrator2, arbitrator3],
        { from: disputeManager }
      );

      const assignmentsAfterRelease = await arbitratorRegistry.activeAssignments(arbitrator1);
      assert.equal(assignmentsAfterRelease.toString(), "0");
      await advanceTime(48 * 3600 + 1);
      await arbitratorRegistry.unstake(TIER1_STAKE, { from: arbitrator1 });
    });

    it("should omit an extra excluded address from the selected panel", async () => {
      await advanceTime(7 * 24 * 60 * 60 + 1);

      const args = await selectionArgs(arbitratorRegistry, 8, 5, SELECTION_ENTROPY, arbitrator3);
      const selected = await arbitratorRegistry.selectArbitrators.call(
        ...args,
        { from: disputeManager }
      );

      const selectedSet = new Set(selected.map((address) => address.toLowerCase()));
      assert.isFalse(selectedSet.has(arbitrator3.toLowerCase()), "Challenger must not sit on the panel");
      assert.isTrue(selectedSet.has(arbitrator1.toLowerCase()));
      assert.isTrue(selectedSet.has(arbitrator2.toLowerCase()));
    });

    it("should not let an inert pending top-up veto an already snapshotted panel", async () => {
      await advanceTime(7 * 24 * 60 * 60 + 1);
      const args = await selectionArgs(arbitratorRegistry, 9, 5);

      await arbitratorRegistry.stake("1", { from: arbitrator1 });

      const selected = await arbitratorRegistry.selectArbitrators.call(
        ...args,
        { from: disputeManager }
      );
      assert.equal(selected.length, 3, "Pending stake has no eligibility or power effect");
    });

    it("should never reuse a stake position in a concurrent panel", async () => {
      await advanceTime(7 * 24 * 60 * 60 + 1);

      const firstArgs = await selectionArgs(arbitratorRegistry, 70, 5);
      await arbitratorRegistry.selectArbitrators(
        ...firstArgs,
        { from: disputeManager }
      );

      for (let disputeId = 71; disputeId <= 75; disputeId++) {
        const args = await selectionArgs(
          arbitratorRegistry,
          disputeId,
          5,
          web3.utils.soliditySha3(`concurrent-entropy-${disputeId}`)
        );
        const additionalPanel = await arbitratorRegistry.selectArbitrators.call(
          ...args,
          { from: disputeManager }
        );
        assert.equal(
          additionalPanel.length,
          0,
          `Concurrent assignment ${disputeId - 69} must not reuse reserved stake`
        );
      }
    });

    it("should burn stake and deactivate a minimum-tier non-revealer", async () => {
      const freshRegistry = await ArbitratorRegistry.new(chessToken.address, { from: admin });
      const disputeRole = await freshRegistry.DISPUTE_MANAGER_ROLE();
      await freshRegistry.grantRole(disputeRole, disputeManager, { from: admin });
      await chessToken.approve(freshRegistry.address, TIER1_STAKE, { from: arbitrator1 });
      await freshRegistry.stake(TIER1_STAKE, { from: arbitrator1 });
      await advanceTime(7 * 24 * 60 * 60 + 1);

      const args = await selectionArgs(freshRegistry, 72, 1);
      await freshRegistry.selectArbitrators(
        ...args,
        { from: disputeManager }
      );
      await freshRegistry.unlockPanelSelection(72, { from: disputeManager });
      const supplyBefore = await chessToken.totalSupply();
      await freshRegistry.slashForNonReveal(72, arbitrator1, { from: disputeManager });

      const info = await freshRegistry.getArbitratorInfo(arbitrator1);
      const supplyAfter = await chessToken.totalSupply();
      assert.equal(info.stakedAmount.toString(), web3.utils.toWei("950", "ether"));
      assert.isFalse(info.isActive, "Falling below the minimum must remove the arbitrator");
      assert.equal(
        web3.utils.toBN(supplyBefore).sub(web3.utils.toBN(supplyAfter)).toString(),
        web3.utils.toWei("50", "ether")
      );
    });

    it("should slash an incorrect vote exactly once and still release the inactive assignment", async () => {
      const freshRegistry = await ArbitratorRegistry.new(chessToken.address, { from: admin });
      const disputeRole = await freshRegistry.DISPUTE_MANAGER_ROLE();
      await freshRegistry.grantRole(disputeRole, disputeManager, { from: admin });
      await chessToken.approve(freshRegistry.address, TIER1_STAKE, { from: arbitrator1 });
      await freshRegistry.stake(TIER1_STAKE, { from: arbitrator1 });
      await advanceTime(7 * 24 * 60 * 60 + 1);

      const disputeId = 73;
      const args = await selectionArgs(freshRegistry, disputeId, 1);
      await freshRegistry.selectArbitrators(...args, { from: disputeManager });
      await freshRegistry.unlockPanelSelection(disputeId, { from: disputeManager });

      const before = await freshRegistry.getArbitratorInfo(arbitrator1);
      const supplyBefore = await chessToken.totalSupply();
      const totalStakedBefore = await freshRegistry.totalStaked();

      await expectRevert(
        freshRegistry.slashForIncorrectVote(disputeId, arbitrator1, { from: arbitrator2 }),
        "incorrect-vote slashing without the manager role"
      );
      assert.equal(
        (await freshRegistry.getArbitratorInfo(arbitrator1)).stakedAmount.toString(),
        before.stakedAmount.toString(),
        "An unauthorized slash must not mutate stake"
      );

      const slashTx = await freshRegistry.slashForIncorrectVote(
        disputeId,
        arbitrator1,
        { from: disputeManager }
      );
      const slashEvent = slashTx.logs.find((log) => log.event === "IncorrectVoteSlashed");
      const expectedSlash = web3.utils.toBN(web3.utils.toWei("10", "ether"));
      const after = await freshRegistry.getArbitratorInfo(arbitrator1);
      const supplyAfter = await chessToken.totalSupply();
      const totalStakedAfter = await freshRegistry.totalStaked();

      assert.exists(slashEvent, "The 1% slash must be observable");
      assert.equal(slashEvent.args.amount.toString(), expectedSlash.toString());
      assert.equal(after.stakedAmount.toString(), web3.utils.toWei("990", "ether"));
      assert.equal(after.reputation.toString(), "99");
      assert.isFalse(after.isActive, "The slashed minimum-tier position must be inactive");
      assert.equal(
        web3.utils.toBN(supplyBefore).sub(web3.utils.toBN(supplyAfter)).toString(),
        expectedSlash.toString(),
        "Exactly 1% of active stake must be burned"
      );
      assert.equal(
        web3.utils.toBN(totalStakedBefore).sub(web3.utils.toBN(totalStakedAfter)).toString(),
        expectedSlash.toString(),
        "Active-stake accounting must decrease by the burned amount"
      );
      assert.isTrue(await freshRegistry.incorrectVotePenalized(disputeId, arbitrator1));
      assert.equal(
        (await freshRegistry.activeAssignments(arbitrator1)).toString(),
        "1",
        "Slashing must not silently discard the still-live assignment"
      );

      const secondSlash = await freshRegistry.slashForIncorrectVote(
        disputeId,
        arbitrator1,
        { from: disputeManager }
      );
      const afterSecondSlash = await freshRegistry.getArbitratorInfo(arbitrator1);
      assert.isUndefined(
        secondSlash.logs.find((log) => log.event === "IncorrectVoteSlashed"),
        "An idempotent retry must not emit a second slash"
      );
      assert.equal(afterSecondSlash.stakedAmount.toString(), after.stakedAmount.toString());
      assert.equal(afterSecondSlash.reputation.toString(), after.reputation.toString());
      assert.equal((await chessToken.totalSupply()).toString(), supplyAfter.toString());

      await freshRegistry.releaseArbitrators(
        disputeId,
        [arbitrator1],
        { from: disputeManager }
      );
      assert.equal((await freshRegistry.activeAssignments(arbitrator1)).toString(), "0");
      assert.isFalse(await freshRegistry.disputeAssignments(disputeId, arbitrator1));
    });
  });

  describe("Access Control", () => {
    it("should reject recordGame from non-dispute-manager", async () => {
      await expectRevert(
        arbitratorRegistry.recordGame(player1, player2, { from: arbitrator1 }),
        "recordGame without the manager role"
      );
    });

    it("should reject updateReputation from non-dispute-manager", async () => {
      await arbitratorRegistry.stake(TIER1_STAKE, { from: arbitrator1 });

      await expectRevert(
        arbitratorRegistry.updateReputation(arbitrator1, true, { from: arbitrator2 }),
        "reputation mutation without the manager role"
      );
    });

    it("should reject non-reveal slashing from non-dispute-manager after isolating authorization", async () => {
      await arbitratorRegistry.stake(TIER1_STAKE, { from: arbitrator1 });
      await advanceTime(7 * 24 * 60 * 60 + 1);
      const args = await selectionArgs(arbitratorRegistry, 1, 1);
      await arbitratorRegistry.selectArbitrators(...args, { from: disputeManager });
      await arbitratorRegistry.unlockPanelSelection(1, { from: disputeManager });
      const before = await arbitratorRegistry.getArbitratorInfo(arbitrator1);

      await expectRevert(
        arbitratorRegistry.slashForNonReveal(1, arbitrator1, { from: arbitrator2 }),
        "non-reveal slashing without the manager role"
      );

      const after = await arbitratorRegistry.getArbitratorInfo(arbitrator1);
      assert.equal(after.stakedAmount.toString(), before.stakedAmount.toString());
      assert.equal(after.reputation.toString(), before.reputation.toString());
    });
  });
});
