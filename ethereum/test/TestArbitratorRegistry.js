const ChessToken = artifacts.require("ChessToken");
const ArbitratorRegistry = artifacts.require("ArbitratorRegistry");

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
      try {
        await arbitratorRegistry.stake(belowMin, { from: arbitrator1 });
        assert.fail("Should have reverted");
      } catch (error) {
        assert.include(error.message, "revert");
      }
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
      const expectedStake = web3.utils.toBN(TIER1_STAKE).mul(web3.utils.toBN("2"));
      assert.equal(info.stakedAmount.toString(), expectedStake.toString());
    });

    it("should upgrade tier when stake increases", async () => {
      await arbitratorRegistry.stake(TIER1_STAKE, { from: arbitrator1 });
      let info = await arbitratorRegistry.getArbitratorInfo(arbitrator1);
      assert.equal(info.tier.toString(), "1");

      // Stake more to reach tier 2
      const additional = web3.utils.toBN(TIER2_STAKE).sub(web3.utils.toBN(TIER1_STAKE));
      await arbitratorRegistry.stake(additional.toString(), { from: arbitrator1 });

      info = await arbitratorRegistry.getArbitratorInfo(arbitrator1);
      assert.equal(info.tier.toString(), "2");
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

    it("should reject unstaking more than staked", async () => {
      const tooMuch = web3.utils.toWei("10000", "ether");
      try {
        await arbitratorRegistry.unstake(tooMuch, { from: arbitrator1 });
        assert.fail("Should have reverted");
      } catch (error) {
        assert.include(error.message, "revert");
      }
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
  });

  describe("Vote Recording", () => {
    beforeEach(async () => {
      await arbitratorRegistry.stake(TIER1_STAKE, { from: arbitrator1 });
    });

    it("should record vote and update last vote time", async () => {
      await arbitratorRegistry.recordVote(arbitrator1, { from: disputeManager });

      const arb = await arbitratorRegistry.arbitrators(arbitrator1);
      assert.isTrue(web3.utils.toBN(arb.lastVoteTime).gt(web3.utils.toBN("0")));
    });

    it("should increment disputes this week", async () => {
      await arbitratorRegistry.recordVote(arbitrator1, { from: disputeManager });

      const arb = await arbitratorRegistry.arbitrators(arbitrator1);
      assert.equal(arb.disputesThisWeek.toString(), "1");
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
      assert.equal(counts.t1.toString(), "0");
      assert.equal(counts.t2.toString(), "1");
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
      const selected = await arbitratorRegistry.selectArbitrators.call(
        1, // disputeId
        player1,
        player2,
        1, // count per tier
        { from: disputeManager }
      );

      // Selection returns empty because arbitrators can't vote during timelock
      assert.isTrue(Array.isArray(selected));
      assert.equal(selected.length, 0, "Should return empty array during timelock");
    });
  });

  describe("Access Control", () => {
    it("should reject recordGame from non-dispute-manager", async () => {
      try {
        await arbitratorRegistry.recordGame(player1, player2, { from: arbitrator1 });
        assert.fail("Should have reverted");
      } catch (error) {
        assert.include(error.message, "revert");
      }
    });

    it("should reject updateReputation from non-dispute-manager", async () => {
      await arbitratorRegistry.stake(TIER1_STAKE, { from: arbitrator1 });

      try {
        await arbitratorRegistry.updateReputation(arbitrator1, true, { from: arbitrator2 });
        assert.fail("Should have reverted");
      } catch (error) {
        assert.include(error.message, "revert");
      }
    });

    it("should reject recordVote from non-dispute-manager", async () => {
      await arbitratorRegistry.stake(TIER1_STAKE, { from: arbitrator1 });

      try {
        await arbitratorRegistry.recordVote(arbitrator1, { from: arbitrator2 });
        assert.fail("Should have reverted");
      } catch (error) {
        assert.include(error.message, "revert");
      }
    });
  });
});
