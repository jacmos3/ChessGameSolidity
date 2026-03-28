const ChessToken = artifacts.require("ChessToken");
const BondingManager = artifacts.require("BondingManager");
const ArbitratorRegistry = artifacts.require("ArbitratorRegistry");
const DisputeDAO = artifacts.require("DisputeDAO");
const ChessFactory = artifacts.require("ChessFactory");
const ChessCore = artifacts.require("ChessCore");
const PlayerRating = artifacts.require("PlayerRating");
const RewardPool = artifacts.require("RewardPool");

// Time manipulation helper using promise
const advanceTime = (seconds) => {
  return new Promise((resolve, reject) => {
    web3.currentProvider.send({
      jsonrpc: "2.0",
      method: "evm_increaseTime",
      params: [seconds],
      id: Date.now()
    }, (err) => {
      if (err) reject(err);
      web3.currentProvider.send({
        jsonrpc: "2.0",
        method: "evm_mine",
        params: [],
        id: Date.now() + 1
      }, (err2) => {
        if (err2) reject(err2);
        resolve();
      });
    });
  });
};

const CHALLENGE_WINDOW = 48 * 60 * 60; // 48 hours in seconds

contract("Integration - ChessCore with Anti-Cheating System", (accounts) => {
  const admin = accounts[0];
  const teamWallet = accounts[1];
  const treasury = accounts[2];
  const whitePlayer = accounts[3];
  const blackPlayer = accounts[4];
  const challenger = accounts[5];
  const arb1 = accounts[6];
  const arb2 = accounts[7];
  const arb3 = accounts[8];

  let chessToken;
  let bondingManager;
  let arbitratorRegistry;
  let disputeDAO;
  let chessFactory;

  const initialPrice = web3.utils.toWei("0.001", "ether");
  const BET_AMOUNT = web3.utils.toWei("0.1", "ether");
  const BOND_CHESS = web3.utils.toWei("1000", "ether");
  const BOND_ETH = web3.utils.toWei("1", "ether");
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
    // Deploy ChessCore implementation first, then pass to factory
    const chessCoreImpl = await ChessCore.new({ from: admin });
    chessFactory = await ChessFactory.new(chessCoreImpl.address, { from: admin });

    // Configure ChessFactory with anti-cheating contracts
    await chessFactory.setBondingManager(bondingManager.address, { from: admin });
    await chessFactory.setDisputeDAO(disputeDAO.address, { from: admin });
    await bondingManager.setChessFactory(chessFactory.address, { from: admin });
    await disputeDAO.setChessFactory(chessFactory.address, { from: admin });

    // Grant roles
    const GAME_MANAGER_ROLE = await bondingManager.GAME_MANAGER_ROLE();
    await bondingManager.grantRole(GAME_MANAGER_ROLE, chessFactory.address, { from: admin });

    const DISPUTE_MANAGER_ROLE_BONDING = await bondingManager.DISPUTE_MANAGER_ROLE();
    await bondingManager.grantRole(DISPUTE_MANAGER_ROLE_BONDING, disputeDAO.address, { from: admin });

    const DISPUTE_MANAGER_ROLE_ARB = await arbitratorRegistry.DISPUTE_MANAGER_ROLE();
    await arbitratorRegistry.grantRole(DISPUTE_MANAGER_ROLE_ARB, disputeDAO.address, { from: admin });

    const GAME_MANAGER_ROLE_DAO = await disputeDAO.GAME_MANAGER_ROLE();
    assert.isFalse(
      await disputeDAO.hasRole(GAME_MANAGER_ROLE_DAO, chessFactory.address),
      "Factory should not need GAME_MANAGER_ROLE on DisputeDAO"
    );

    // Mint tokens to players for bonding
    const mintAmount = web3.utils.toWei("100000", "ether");
    await chessToken.mintPlayToEarn(whitePlayer, mintAmount, { from: admin });
    await chessToken.mintPlayToEarn(blackPlayer, mintAmount, { from: admin });
    await chessToken.mintPlayToEarn(challenger, mintAmount, { from: admin });
    await chessToken.mintPlayToEarn(arb1, mintAmount, { from: admin });
    await chessToken.mintPlayToEarn(arb2, mintAmount, { from: admin });
    await chessToken.mintPlayToEarn(arb3, mintAmount, { from: admin });

    // Approve tokens
    await chessToken.approve(bondingManager.address, mintAmount, { from: whitePlayer });
    await chessToken.approve(bondingManager.address, mintAmount, { from: blackPlayer });
    await chessToken.approve(disputeDAO.address, mintAmount, { from: challenger });
    await chessToken.approve(arbitratorRegistry.address, mintAmount, { from: arb1 });
    await chessToken.approve(arbitratorRegistry.address, mintAmount, { from: arb2 });
    await chessToken.approve(arbitratorRegistry.address, mintAmount, { from: arb3 });

    // Setup arbitrators
    await arbitratorRegistry.stake(TIER1_STAKE, { from: arb1 });
    await arbitratorRegistry.stake(TIER1_STAKE, { from: arb2 });
    await arbitratorRegistry.stake(TIER1_STAKE, { from: arb3 });

    // Setup bonds for players
    await bondingManager.depositBond(BOND_CHESS, { from: whitePlayer, value: BOND_ETH });
    await bondingManager.depositBond(BOND_CHESS, { from: blackPlayer, value: BOND_ETH });
  });

  describe("ChessFactory with BondingManager", () => {
    it("should verify factory has bonding manager configured", async () => {
      const bm = await chessFactory.bondingManager();
      assert.equal(bm, bondingManager.address);
    });

    it("should verify factory has dispute DAO configured", async () => {
      const dao = await chessFactory.disputeDAO();
      assert.equal(dao, disputeDAO.address);
    });

    it("should allow game creation when player has sufficient bond", async () => {
      const hasBond = await chessFactory.hasSufficientBond(whitePlayer, BET_AMOUNT);
      assert.isTrue(hasBond);

      const tx = await chessFactory.createChessGame(2, 0, {
        from: whitePlayer,
        value: BET_AMOUNT
      });

      const games = await chessFactory.getDeployedChessGames();
      assert.equal(games.length, 1);
    });

    it("should reject game creation when player has insufficient bond", async () => {
      const newPlayer = accounts[9];
      // newPlayer has no bond

      try {
        await chessFactory.createChessGame(2, 0, {
          from: newPlayer,
          value: BET_AMOUNT
        });
        assert.fail("Should have reverted");
      } catch (error) {
        assert.include(error.message, "revert");
      }
    });

    it("should return required bond amounts", async () => {
      const result = await chessFactory.getRequiredBond(BET_AMOUNT);
      assert.isTrue(web3.utils.toBN(result.chessRequired).gt(web3.utils.toBN("0")));
    });
  });

  describe("ChessCore Bond Locking", () => {
    let chessCore;

    beforeEach(async () => {
      // Create game
      await chessFactory.createChessGame(2, 0, {
        from: whitePlayer,
        value: BET_AMOUNT
      });

      const games = await chessFactory.getDeployedChessGames();
      chessCore = await ChessCore.at(games[0]);
    });

    it("should have bonding manager set in ChessCore", async () => {
      const bm = await chessCore.bondingManager();
      assert.equal(bm, bondingManager.address);
    });

    it("should have dispute DAO set in ChessCore", async () => {
      const dao = await chessCore.disputeDAO();
      assert.equal(dao, disputeDAO.address);
    });

    it("should authorize the cloned ChessCore on bonding manager and dispute DAO", async () => {
      const bondingRole = await bondingManager.GAME_MANAGER_ROLE();
      const disputeRole = await disputeDAO.GAME_MANAGER_ROLE();

      assert.isTrue(await bondingManager.hasRole(bondingRole, chessCore.address));
      assert.isTrue(await disputeDAO.hasRole(disputeRole, chessCore.address));
    });

    it("should lock bonds when black joins the game", async () => {
      // Check bonds are not locked before
      const bondsLockedBefore = await chessCore.bondsLocked();
      assert.isFalse(bondsLockedBefore);

      // Black joins
      await chessCore.joinGameAsBlack({
        from: blackPlayer,
        value: BET_AMOUNT
      });

      // Check bonds are locked after
      const bondsLockedAfter = await chessCore.bondsLocked();
      assert.isTrue(bondsLockedAfter);
    });

    it("should track game bond in bonding manager", async () => {
      const gameId = await chessCore.gameId();

      // Black joins (this locks bonds)
      await chessCore.joinGameAsBlack({
        from: blackPlayer,
        value: BET_AMOUNT
      });

      // Check white's bond is locked
      const whiteBond = await bondingManager.gameBonds(gameId, whitePlayer);
      assert.isTrue(web3.utils.toBN(whiteBond.chessAmount).gt(web3.utils.toBN("0")));

      // Check black's bond is locked
      const blackBond = await bondingManager.gameBonds(gameId, blackPlayer);
      assert.isTrue(web3.utils.toBN(blackBond.chessAmount).gt(web3.utils.toBN("0")));
    });
  });

  describe("ChessCore with DisputeDAO Integration", () => {
    let chessCore;
    let gameId;

    beforeEach(async () => {
      // Create and start game
      await chessFactory.createChessGame(2, 0, {
        from: whitePlayer,
        value: BET_AMOUNT
      });

      const games = await chessFactory.getDeployedChessGames();
      chessCore = await ChessCore.at(games[games.length - 1]); // Get latest game
      gameId = await chessCore.gameId();

      // Black joins
      await chessCore.joinGameAsBlack({
        from: blackPlayer,
        value: BET_AMOUNT
      });
    });

    it("should register game in dispute DAO after resignation", async () => {
      // Game not registered yet
      const disputeIdBefore = await disputeDAO.gameToDispute(gameId);
      assert.equal(disputeIdBefore.toString(), "0");

      // White resigns
      await chessCore.resign({ from: whitePlayer });

      // Game should be registered now
      const disputeIdAfter = await disputeDAO.gameToDispute(gameId);
      assert.isTrue(web3.utils.toBN(disputeIdAfter).gt(web3.utils.toBN("0")));
    });

    it("should allow prize claim when no challenge is made", async () => {
      // White resigns - black wins
      await chessCore.resign({ from: whitePlayer });

      // Verify game is registered
      const disputeId = await disputeDAO.gameToDispute(gameId);
      assert.isTrue(web3.utils.toBN(disputeId).gt(web3.utils.toBN("0")), "Game should be registered");

      // Check initial window status
      const windowOpenBefore = await disputeDAO.isChallengeWindowOpen(gameId);
      assert.isTrue(windowOpenBefore, "Challenge window should be open initially");

      // Cannot claim immediately - challenge window must expire first (security fix)
      const canClaimBefore = await chessCore.canClaimPrize();
      assert.isFalse(canClaimBefore, "Should NOT be able to claim prize during challenge window");

      // Advance time past challenge window (48 hours + 1 second)
      await advanceTime(CHALLENGE_WINDOW + 1);

      // Verify window is now closed
      const windowOpenAfter = await disputeDAO.isChallengeWindowOpen(gameId);
      assert.isFalse(windowOpenAfter, "Challenge window should be closed after time advance");

      // Now should be able to claim
      const canClaim = await chessCore.canClaimPrize();
      assert.isTrue(canClaim, "Should be able to claim prize after challenge window expires");

      // Black claims prize
      const balanceBefore = BigInt(await web3.eth.getBalance(blackPlayer));
      const tx = await chessCore.claimPrize({ from: blackPlayer });
      const gasUsed = BigInt(tx.receipt.gasUsed);
      const gasPrice = BigInt((await web3.eth.getTransaction(tx.tx)).gasPrice);
      const gasCost = gasUsed * gasPrice;
      const balanceAfter = BigInt(await web3.eth.getBalance(blackPlayer));

      const expectedPrize = BigInt(BET_AMOUNT) * 2n;
      const actualIncrease = balanceAfter - balanceBefore + gasCost;
      assert.equal(actualIncrease.toString(), expectedPrize.toString());
    });

    it("should mark game as registered for dispute", async () => {
      // Not registered before
      const registeredBefore = await chessCore.gameRegisteredForDispute();
      assert.isFalse(registeredBefore);

      // White resigns
      await chessCore.resign({ from: whitePlayer });

      // Should be registered after
      const registeredAfter = await chessCore.gameRegisteredForDispute();
      assert.isTrue(registeredAfter);
    });
  });

  describe("Full Integration Flow", () => {
    let chessCore;
    let gameId;

    beforeEach(async () => {
      // Create and start game
      await chessFactory.createChessGame(2, 0, {
        from: whitePlayer,
        value: BET_AMOUNT
      });

      const games = await chessFactory.getDeployedChessGames();
      chessCore = await ChessCore.at(games[0]);
      gameId = await chessCore.gameId();

      // Black joins
      await chessCore.joinGameAsBlack({
        from: blackPlayer,
        value: BET_AMOUNT
      });
    });

    it("should complete full game flow: play, resign, claim", async () => {
      // Make a few moves
      await chessCore.makeMove(6, 4, 4, 4, { from: whitePlayer }); // e4
      await chessCore.makeMove(1, 4, 3, 4, { from: blackPlayer }); // e5

      // White resigns
      await chessCore.resign({ from: whitePlayer });

      // Verify game state
      const gameState = await chessCore.getGameState();
      assert.equal(gameState.toNumber(), 5, "Black should win");

      // Verify dispute registered
      const disputeId = await disputeDAO.gameToDispute(gameId);
      assert.isTrue(web3.utils.toBN(disputeId).gt(web3.utils.toBN("0")));

      // Advance time past challenge window (security fix - prevents frontrunning)
      await advanceTime(CHALLENGE_WINDOW + 1);

      // Black claims prize
      const contractBalanceBefore = await web3.eth.getBalance(chessCore.address);
      assert.equal(contractBalanceBefore.toString(), (BigInt(BET_AMOUNT) * 2n).toString());

      await chessCore.claimPrize({ from: blackPlayer });

      // Verify contract is empty
      const contractBalanceAfter = await web3.eth.getBalance(chessCore.address);
      assert.equal(contractBalanceAfter.toString(), "0");
    });

    it("should track game ID across contracts", async () => {
      const chessCoreGameId = await chessCore.gameId();

      // Resign to trigger registration
      await chessCore.resign({ from: whitePlayer });

      // Check dispute DAO has this game registered
      const disputeId = await disputeDAO.gameToDispute(chessCoreGameId);
      const dispute = await disputeDAO.getDispute(disputeId);

      assert.equal(dispute.gameId.toString(), chessCoreGameId.toString());
    });
  });

  describe("Dispute-aware settlement for rewards and rating", () => {
    let chessCore;
    let gameId;
    let playerRating;
    let rewardPool;
    const extraArb1 = accounts[9];
    const extraArb2 = accounts[10];

    beforeEach(async () => {
      playerRating = await PlayerRating.new({ from: admin });
      rewardPool = await RewardPool.new(chessToken.address, playerRating.address, { from: admin });

      await playerRating.setChessFactory(chessFactory.address, { from: admin });
      await rewardPool.setChessFactory(chessFactory.address, { from: admin });
      await chessFactory.setPlayerRating(playerRating.address, { from: admin });
      await chessFactory.setRewardPool(rewardPool.address, { from: admin });

      const rewardFunding = web3.utils.toWei("10000", "ether");
      await chessToken.mintPlayToEarn(admin, rewardFunding, { from: admin });
      await chessToken.approve(rewardPool.address, rewardFunding, { from: admin });
      await rewardPool.depositRewardPool(rewardFunding, { from: admin });

      const extraMintAmount = web3.utils.toWei("100000", "ether");
      await chessToken.mintPlayToEarn(extraArb1, extraMintAmount, { from: admin });
      await chessToken.mintPlayToEarn(extraArb2, extraMintAmount, { from: admin });
      await chessToken.approve(arbitratorRegistry.address, extraMintAmount, { from: extraArb1 });
      await chessToken.approve(arbitratorRegistry.address, extraMintAmount, { from: extraArb2 });
      await arbitratorRegistry.stake(TIER1_STAKE, { from: extraArb1 });
      await arbitratorRegistry.stake(TIER1_STAKE, { from: extraArb2 });

      await disputeDAO.setParameters(
        3600,
        3600,
        3600,
        3,
        66,
        web3.utils.toWei("1", "ether"),
        { from: admin }
      );

      await advanceTime(7 * 24 * 60 * 60 + 1);

      await chessFactory.createChessGame(2, 0, {
        from: whitePlayer,
        value: BET_AMOUNT
      });

      const games = await chessFactory.getDeployedChessGames();
      chessCore = await ChessCore.at(games[games.length - 1]);
      gameId = await chessCore.gameId();

      await chessCore.joinGameAsBlack({
        from: blackPlayer,
        value: BET_AMOUNT
      });
    });

    async function resolveCurrentDisputeAsCheat(accusedPlayer, saltPrefix = "settlement-cheat") {
      await disputeDAO.challenge(gameId, accusedPlayer, { from: challenger });
      const disputeId = await disputeDAO.gameToDispute(gameId);
      const selectedArbitrators = await disputeDAO.getSelectedArbitrators(disputeId);

      assert.isAtLeast(selectedArbitrators.length, 3, "Dispute should select enough arbitrators to reach quorum");

      const cheatVote = 2;
      const salts = {};

      for (let i = 0; i < selectedArbitrators.length; i++) {
        const arbitrator = selectedArbitrators[i];
        const salt = web3.utils.soliditySha3(`${saltPrefix}-${i}`);
        salts[arbitrator.toLowerCase()] = salt;
        const commitHash = web3.utils.soliditySha3(
          { type: "uint8", value: cheatVote },
          { type: "bytes32", value: salt },
          { type: "address", value: arbitrator }
        );

        await disputeDAO.commitVote(disputeId, commitHash, { from: arbitrator });
      }

      await advanceTime(3600 + 1);

      for (const arbitrator of selectedArbitrators) {
        await disputeDAO.revealVote(disputeId, cheatVote, salts[arbitrator.toLowerCase()], { from: arbitrator });
      }

      await advanceTime(3600 + 1);
      await disputeDAO.resolveDispute(disputeId, { from: challenger });

      return disputeId;
    }

    it("should delay rewards and rating until settlement and use the dispute outcome", async () => {
      const scriptedMoves = [
        [6, 0, 5, 0, whitePlayer],
        [1, 0, 2, 0, blackPlayer],
        [6, 1, 5, 1, whitePlayer],
        [1, 1, 2, 1, blackPlayer],
        [6, 2, 5, 2, whitePlayer],
        [1, 2, 2, 2, blackPlayer],
        [6, 3, 5, 3, whitePlayer],
        [1, 3, 2, 3, blackPlayer],
        [6, 4, 5, 4, whitePlayer],
        [1, 4, 2, 4, blackPlayer],
        [6, 5, 5, 5, whitePlayer],
        [1, 5, 2, 5, blackPlayer],
        [6, 6, 5, 6, whitePlayer],
        [1, 6, 2, 6, blackPlayer],
        [6, 7, 5, 7, whitePlayer],
        [1, 7, 2, 7, blackPlayer],
        [5, 0, 4, 0, whitePlayer],
        [2, 0, 3, 0, blackPlayer],
        [5, 1, 4, 1, whitePlayer],
        [2, 1, 3, 1, blackPlayer]
      ];

      for (const [fromRow, fromCol, toRow, toCol, player] of scriptedMoves) {
        await chessCore.makeMove(fromRow, fromCol, toRow, toCol, { from: player });
      }

      const recordedPlyCount = await chessCore.plyCount();
      assert.equal(recordedPlyCount.toString(), "20", "Every half-move should be counted");

      await chessCore.resign({ from: whitePlayer });

      const whiteTokenBeforeSettlement = await chessToken.balanceOf(whitePlayer);
      const blackTokenBeforeSettlement = await chessToken.balanceOf(blackPlayer);
      const whiteRatingBeforeSettlement = await playerRating.getRating(whitePlayer);
      const blackRatingBeforeSettlement = await playerRating.getRating(blackPlayer);

      const disputeId = await resolveCurrentDisputeAsCheat(blackPlayer);

      const dispute = await disputeDAO.getDispute(disputeId);
      assert.equal(dispute.finalDecision.toString(), "2", "The dispute should resolve as Cheat");

      assert.equal(
        (await chessToken.balanceOf(whitePlayer)).toString(),
        whiteTokenBeforeSettlement.toString(),
        "Rewards should not be distributed before settlement"
      );
      assert.equal(
        (await chessToken.balanceOf(blackPlayer)).toString(),
        blackTokenBeforeSettlement.toString(),
        "Loser rewards should not be distributed before settlement"
      );
      assert.equal(
        (await playerRating.getRating(whitePlayer)).toString(),
        whiteRatingBeforeSettlement.toString(),
        "Rating should not change before settlement"
      );
      assert.equal(
        (await playerRating.getRating(blackPlayer)).toString(),
        blackRatingBeforeSettlement.toString(),
        "Opponent rating should not change before settlement"
      );

      await chessCore.finalizePrizes({ from: whitePlayer });

      const whiteTokenAfterSettlement = await chessToken.balanceOf(whitePlayer);
      const blackTokenAfterSettlement = await chessToken.balanceOf(blackPlayer);
      const whiteRewardDelta = web3.utils.toBN(whiteTokenAfterSettlement).sub(web3.utils.toBN(whiteTokenBeforeSettlement));
      const blackRewardDelta = web3.utils.toBN(blackTokenAfterSettlement).sub(web3.utils.toBN(blackTokenBeforeSettlement));

      assert.isTrue(whiteRewardDelta.gt(web3.utils.toBN("0")), "White should receive the winner reward");
      assert.isTrue(blackRewardDelta.gt(web3.utils.toBN("0")), "Black should still receive the loser reward");
      assert.isTrue(whiteRewardDelta.gt(blackRewardDelta), "Winner reward should exceed loser reward");

      const whiteRatingAfterSettlement = await playerRating.getRating(whitePlayer);
      const blackRatingAfterSettlement = await playerRating.getRating(blackPlayer);

      assert.isTrue(
        web3.utils.toBN(whiteRatingAfterSettlement).gt(web3.utils.toBN(whiteRatingBeforeSettlement)),
        "White rating should increase after the dispute flips the outcome"
      );
      assert.isTrue(
        web3.utils.toBN(blackRatingAfterSettlement).lt(web3.utils.toBN(blackRatingBeforeSettlement)),
        "Black rating should decrease after being judged the cheater"
      );

      const whitePendingPrize = await chessCore.pendingPrize(whitePlayer);
      const blackPendingPrize = await chessCore.pendingPrize(blackPlayer);
      assert.equal(whitePendingPrize.toString(), (BigInt(BET_AMOUNT) * 2n).toString(), "White should receive the full prize after settlement");
      assert.equal(blackPendingPrize.toString(), "0", "Cheater should not keep any pending prize");

      const blackFactors = await rewardPool.getPlayerFactors(blackPlayer);
      const blackBehaviorFactor = blackFactors.behaviorFactor || blackFactors[2];
      assert.equal(blackBehaviorFactor.toString(), "1000", "Cheat resolution should not fabricate a resign penalty for black");
    });

    it("should block the cheater from claiming the prize and allow the honest player to claim it", async () => {
      await chessCore.resign({ from: whitePlayer });
      await resolveCurrentDisputeAsCheat(blackPlayer, "claim-prize-cheat");

      const canClaim = await chessCore.canClaimPrize();
      assert.isTrue(canClaim, "Prize should be claimable once the cheat dispute is resolved");

      try {
        await chessCore.claimPrize({ from: blackPlayer });
        assert.fail("Cheater should not be able to claim the prize");
      } catch (error) {
        assert.include(error.message, "revert");
      }

      const whiteBalanceBefore = BigInt(await web3.eth.getBalance(whitePlayer));
      const tx = await chessCore.claimPrize({ from: whitePlayer });
      const gasUsed = BigInt(tx.receipt.gasUsed);
      const gasPrice = BigInt((await web3.eth.getTransaction(tx.tx)).gasPrice);
      const gasCost = gasUsed * gasPrice;
      const whiteBalanceAfter = BigInt(await web3.eth.getBalance(whitePlayer));

      const prizeIncrease = whiteBalanceAfter - whiteBalanceBefore + gasCost;
      assert.equal(prizeIncrease.toString(), (BigInt(BET_AMOUNT) * 2n).toString(), "Honest player should receive the full prize");

      const contractBalance = await web3.eth.getBalance(chessCore.address);
      assert.equal(contractBalance.toString(), "0", "Prize claim should empty the game contract");
    });
  });

  describe("Without Anti-Cheating (Backward Compatibility)", () => {
    let chessFactoryNoAC;

    beforeEach(async () => {
      // Deploy a factory without anti-cheating configuration
      const chessCoreImplNoAC = await ChessCore.new({ from: admin });
      chessFactoryNoAC = await ChessFactory.new(chessCoreImplNoAC.address, { from: admin });
      // Don't set bondingManager or disputeDAO
    });

    it("should allow game creation without bond requirement", async () => {
      const newPlayer = accounts[9];
      // newPlayer has no bond, but factory has no bonding manager set

      const tx = await chessFactoryNoAC.createChessGame(2, 0, {
        from: newPlayer,
        value: BET_AMOUNT
      });

      const games = await chessFactoryNoAC.getDeployedChessGames();
      assert.equal(games.length, 1);
    });

    it("should allow prize claim without dispute registration", async () => {
      // Create game without anti-cheating
      await chessFactoryNoAC.createChessGame(2, 0, {
        from: whitePlayer,
        value: BET_AMOUNT
      });

      const games = await chessFactoryNoAC.getDeployedChessGames();
      const chessCore = await ChessCore.at(games[0]);

      // Black joins
      await chessCore.joinGameAsBlack({
        from: blackPlayer,
        value: BET_AMOUNT
      });

      // Check no bonds locked (bondingManager is address(0))
      const bondsLocked = await chessCore.bondsLocked();
      assert.isFalse(bondsLocked);

      // White resigns
      await chessCore.resign({ from: whitePlayer });

      // Should be able to claim immediately
      const canClaim = await chessCore.canClaimPrize();
      assert.isTrue(canClaim);

      // Black claims prize
      await chessCore.claimPrize({ from: blackPlayer });

      const balance = await web3.eth.getBalance(chessCore.address);
      assert.equal(balance.toString(), "0");
    });
  });
});
