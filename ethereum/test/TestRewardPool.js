const ChessToken = artifacts.require("ChessToken");
const PlayerRating = artifacts.require("PlayerRating");
const RewardPool = artifacts.require("RewardPool");
const MockERC1271Signer = artifacts.require("MockERC1271Signer");
const ChessCore = artifacts.require("ChessCore");
const ChessFactory = artifacts.require("ChessFactory");
const RewardGameMock = artifacts.require("RewardGameMock");
const RewardFactoryMock = artifacts.require("RewardFactoryMock");

const advanceTime = (seconds) => new Promise((resolve, reject) => {
  web3.currentProvider.send({
    jsonrpc: "2.0",
    method: "evm_increaseTime",
    params: [seconds],
    id: Date.now()
  }, (err) => {
    if (err) return reject(err);
    web3.currentProvider.send({
      jsonrpc: "2.0",
      method: "evm_mine",
      params: [],
      id: Date.now() + 1
    }, (mineError) => mineError ? reject(mineError) : resolve());
  });
});

contract("RewardPool", (accounts) => {
  const admin = accounts[0];
  const teamWallet = accounts[1];
  const treasury = accounts[2];
  const claimant = accounts[3];
  const unauthorizedSigner = accounts[4];

  const rewardableMoves = [
    [6, 0, 5, 0],
    [1, 0, 2, 0],
    [6, 1, 5, 1],
    [1, 1, 2, 1],
    [6, 2, 5, 2],
    [1, 2, 2, 2],
    [6, 3, 5, 3],
    [1, 3, 2, 3],
    [6, 4, 5, 4],
    [1, 4, 2, 4],
    [6, 5, 5, 5],
    [1, 5, 2, 5],
    [6, 6, 5, 6],
    [1, 6, 2, 6],
    [6, 7, 5, 7],
    [1, 7, 2, 7],
    [5, 0, 4, 0],
    [2, 0, 3, 0],
    [5, 1, 4, 1],
    [2, 1, 3, 1]
  ];

  let chessToken;
  let playerRating;
  let rewardPool;

  beforeEach(async () => {
    chessToken = await ChessToken.new(teamWallet, treasury, { from: admin });
    playerRating = await PlayerRating.new({ from: admin });
    rewardPool = await RewardPool.new(chessToken.address, playerRating.address, { from: admin });

    const funding = web3.utils.toWei("100", "ether");
    await chessToken.mintPlayToEarn(admin, funding, { from: admin });
    await chessToken.approve(rewardPool.address, funding, { from: admin });
    await rewardPool.depositFaucetPool(funding, { from: admin });
  });

  async function authorizationDeadline(offset = 3600) {
    const latest = await web3.eth.getBlock("latest");
    return Number(latest.timestamp) + offset;
  }

  async function signFaucetAuthorization(
    beneficiary,
    signer = admin,
    deadline = null
  ) {
    const chainId = await web3.eth.getChainId();
    const domain = await rewardPool.FAUCET_AUTHORIZATION_DOMAIN();
    const epoch = await rewardPool.rewardEligibilityEpoch();
    const nonce = await rewardPool.faucetNonces(beneficiary);
    const validUntil = deadline ?? await authorizationDeadline();
    const encoded = web3.eth.abi.encodeParameters(
      ["bytes32", "address", "uint256", "address", "uint256", "uint256", "uint256"],
      [
        domain,
        rewardPool.address,
        chainId.toString(),
        beneficiary,
        epoch.toString(),
        nonce.toString(),
        validUntil.toString()
      ]
    );
    const authorization = await web3.eth.sign(web3.utils.keccak256(encoded), signer);
    return { authorization, deadline: validUntil };
  }

  async function signRewardEligibility(
    beneficiary,
    signer = admin,
    deadline = null
  ) {
    const chainId = await web3.eth.getChainId();
    const domain = await rewardPool.REWARD_ELIGIBILITY_DOMAIN();
    const epoch = await rewardPool.rewardEligibilityEpoch();
    const nonce = await rewardPool.rewardEligibilityNonces(beneficiary);
    const validUntil = deadline ?? await authorizationDeadline();
    const encoded = web3.eth.abi.encodeParameters(
      ["bytes32", "address", "uint256", "address", "uint256", "uint256", "uint256"],
      [
        domain,
        rewardPool.address,
        chainId.toString(),
        beneficiary,
        epoch.toString(),
        nonce.toString(),
        validUntil.toString()
      ]
    );
    const authorization = await web3.eth.sign(web3.utils.keccak256(encoded), signer);
    return { authorization, deadline: validUntil };
  }

  async function registerEligibility(player, signer = admin) {
    const signed = await signRewardEligibility(player, signer);
    return rewardPool.registerRewardEligibility(
      signed.deadline,
      signed.authorization,
      { from: player }
    );
  }

  async function setupRewardInfrastructure() {
    const rewardFunding = web3.utils.toWei("100", "ether");
    await chessToken.mintPlayToEarn(admin, rewardFunding, { from: admin });
    await chessToken.approve(rewardPool.address, rewardFunding, { from: admin });
    await rewardPool.depositRewardPool(rewardFunding, { from: admin });

    const implementation = await ChessCore.new({ from: admin });
    const factory = await ChessFactory.new(implementation.address, { from: admin });
    await factory.setRewardPool(rewardPool.address, { from: admin });
    await rewardPool.setChessFactory(factory.address, { from: admin });
    return factory;
  }

  async function setupDirectRewardInfrastructure(players) {
    const rewardFunding = web3.utils.toWei("100", "ether");
    await chessToken.mintPlayToEarn(admin, rewardFunding, { from: admin });
    await chessToken.approve(rewardPool.address, rewardFunding, { from: admin });
    await rewardPool.depositRewardPool(rewardFunding, { from: admin });

    const factory = await RewardFactoryMock.new({ from: admin });
    const game = await RewardGameMock.new({ from: admin });
    await rewardPool.setChessFactory(factory.address, { from: admin });
    await factory.register(rewardPool.address, game.address, { from: admin });
    for (const player of players) await registerEligibility(player);
    return game;
  }

  async function distributeDirect(
    game,
    white,
    black,
    result,
    behavior = {}
  ) {
    return game.distribute(
      rewardPool.address,
      white,
      black,
      result,
      false,
      20,
      Boolean(behavior.whiteResign),
      Boolean(behavior.whiteTimeout),
      Boolean(behavior.blackResign),
      Boolean(behavior.blackTimeout),
      "0x0000000000000000000000000000000000000000",
      { from: admin }
    );
  }

  async function completeRewardableDraw(factory, white, black, mode = 0) {
    const bet = await factory.MIN_BET();
    await factory.createChessGame(0, mode, { from: white, value: bet });
    const games = await factory.getDeployedChessGames();
    const game = await ChessCore.at(games[games.length - 1]);
    await game.joinGameAsBlack({ from: black, value: bet });

    for (let i = 0; i < rewardableMoves.length; i++) {
      const [fromRow, fromCol, toRow, toCol] = rewardableMoves[i];
      const player = i % 2 === 0 ? white : black;
      await game.makeMove(fromRow, fromCol, toRow, toCol, { from: player });
    }

    await game.offerDraw({ from: white });
    await game.acceptDraw({ from: black });
    await game.finalizePrizes({ from: white });
  }

  async function completeRewardableResignation(factory, white, black) {
    const bet = await factory.MIN_BET();
    await factory.createChessGame(0, 0, { from: white, value: bet });
    const games = await factory.getDeployedChessGames();
    const game = await ChessCore.at(games[games.length - 1]);
    await game.joinGameAsBlack({ from: black, value: bet });

    for (let i = 0; i < rewardableMoves.length; i++) {
      const [fromRow, fromCol, toRow, toCol] = rewardableMoves[i];
      const player = i % 2 === 0 ? white : black;
      await game.makeMove(fromRow, fromCol, toRow, toCol, { from: player });
    }

    await game.resign({ from: white });
    await game.finalizePrizes({ from: black });
  }

  async function completeImmediateDraw(factory, white, black) {
    const bet = await factory.MIN_BET();
    await factory.createChessGame(0, 0, { from: white, value: bet });
    const games = await factory.getDeployedChessGames();
    const game = await ChessCore.at(games[games.length - 1]);
    await game.joinGameAsBlack({ from: black, value: bet });
    await game.offerDraw({ from: white });
    await game.acceptDraw({ from: black });
    await game.finalizePrizes({ from: white });
  }

  it("rejects unlisted registrations and stale game authorization after factory rotation", async () => {
    const originalFactory = await RewardFactoryMock.new({ from: admin });
    const replacementFactory = await RewardFactoryMock.new({ from: admin });
    const game = await RewardGameMock.new({ from: admin });
    await rewardPool.setChessFactory(originalFactory.address, { from: admin });

    try {
      await originalFactory.registerUnlisted(rewardPool.address, game.address, { from: admin });
      assert.fail("An unlisted game must not be registered");
    } catch (error) {
      assert.include(error.message, "revert");
    }

    await originalFactory.register(rewardPool.address, game.address, { from: admin });
    assert.isTrue(await rewardPool.validGameContracts(game.address));
    await rewardPool.setChessFactory(replacementFactory.address, { from: admin });

    try {
      await game.distribute(
        rewardPool.address,
        claimant,
        unauthorizedSigner,
        0,
        false,
        20,
        false,
        false,
        false,
        false,
        "0x0000000000000000000000000000000000000000",
        { from: admin }
      );
      assert.fail("A game from the old factory must become inert");
    } catch (error) {
      assert.include(error.message, "revert");
    }
  });

  it("allows one faucet claim with a signer authorization", async () => {
    const signed = await signFaucetAuthorization(claimant);

    await rewardPool.claimFaucet(signed.deadline, signed.authorization, { from: claimant });

    const balance = await chessToken.balanceOf(claimant);
    assert.equal(balance.toString(), web3.utils.toWei("5", "ether"));
    assert.isTrue(await rewardPool.hasClaimedFaucet(claimant));
    assert.isTrue(await rewardPool.rewardEligible(claimant));
  });

  it("rejects an authorization produced by an untrusted signer", async () => {
    const signed = await signFaucetAuthorization(claimant, unauthorizedSigner);

    try {
      await rewardPool.claimFaucet(signed.deadline, signed.authorization, { from: claimant });
      assert.fail("Should have reverted");
    } catch (error) {
      assert.include(error.message, "revert");
    }
  });

  it("accepts an authorization from an ERC-1271 contract wallet", async () => {
    const contractSigner = await MockERC1271Signer.new(admin, { from: admin });
    await rewardPool.setFaucetSigner(contractSigner.address, { from: admin });
    const signed = await signFaucetAuthorization(claimant, admin);

    await rewardPool.claimFaucet(signed.deadline, signed.authorization, { from: claimant });

    const balance = await chessToken.balanceOf(claimant);
    assert.equal(balance.toString(), web3.utils.toWei("5", "ether"));
  });

  it("rejects an invalid ERC-1271 contract-wallet authorization", async () => {
    const contractSigner = await MockERC1271Signer.new(admin, { from: admin });
    await rewardPool.setFaucetSigner(contractSigner.address, { from: admin });
    const signed = await signFaucetAuthorization(claimant, unauthorizedSigner);

    try {
      await rewardPool.claimFaucet(signed.deadline, signed.authorization, { from: claimant });
      assert.fail("Should have reverted");
    } catch (error) {
      assert.include(error.message, "revert");
    }
  });

  it("binds the authorization to the intended beneficiary", async () => {
    const signed = await signFaucetAuthorization(claimant);

    try {
      await rewardPool.claimFaucet(signed.deadline, signed.authorization, { from: accounts[5] });
      assert.fail("Should have reverted");
    } catch (error) {
      assert.include(error.message, "revert");
    }
  });

  it("does not use permissionless ELO as an economic reward multiplier", async () => {
    const reporterRole = await playerRating.GAME_REPORTER_ROLE();
    await playerRating.grantRole(reporterRole, admin, { from: admin });

    let factors = await rewardPool.getPlayerFactors(claimant);
    assert.equal(factors.ratingFactor.toString(), "1000");

    for (let i = 0; i < 5; i++) {
      await playerRating.reportGame(claimant, accounts[5], 1, { from: admin });
    }

    factors = await rewardPool.getPlayerFactors(claimant);
    assert.equal(factors.ratingFactor.toString(), "1000");
  });

  it("registers signer-attested reward eligibility and rejects replay", async () => {
    const signed = await signRewardEligibility(claimant);
    const tx = await rewardPool.registerRewardEligibility(
      signed.deadline,
      signed.authorization,
      { from: claimant }
    );

    assert.isTrue(await rewardPool.rewardEligible(claimant));
    assert.equal(tx.logs[0].event, "RewardEligibilityRegistered");
    assert.equal(tx.logs[0].args.player, claimant);

    try {
      await rewardPool.registerRewardEligibility(
        signed.deadline,
        signed.authorization,
        { from: claimant }
      );
      assert.fail("Replayed eligibility authorization should revert");
    } catch (error) {
      assert.include(error.message, "revert");
    }
  });

  it("rejects reward attestations for another beneficiary or an untrusted signer", async () => {
    const otherBeneficiary = await signRewardEligibility(accounts[5]);
    try {
      await rewardPool.registerRewardEligibility(
        otherBeneficiary.deadline,
        otherBeneficiary.authorization,
        { from: claimant }
      );
      assert.fail("Authorization for another beneficiary should revert");
    } catch (error) {
      assert.include(error.message, "revert");
    }

    const untrusted = await signRewardEligibility(claimant, unauthorizedSigner);
    try {
      await rewardPool.registerRewardEligibility(
        untrusted.deadline,
        untrusted.authorization,
        { from: claimant }
      );
      assert.fail("Authorization from an untrusted signer should revert");
    } catch (error) {
      assert.include(error.message, "revert");
    }
  });

  it("keeps faucet and reward-eligibility signature domains non-interchangeable", async () => {
    const faucetAuthorization = await signFaucetAuthorization(claimant);
    try {
      await rewardPool.registerRewardEligibility(
        faucetAuthorization.deadline,
        faucetAuthorization.authorization,
        { from: claimant }
      );
      assert.fail("A faucet authorization must not register reward eligibility directly");
    } catch (error) {
      assert.include(error.message, "revert");
    }

    const rewardAuthorization = await signRewardEligibility(claimant);
    try {
      await rewardPool.claimFaucet(
        rewardAuthorization.deadline,
        rewardAuthorization.authorization,
        { from: claimant }
      );
      assert.fail("A reward-eligibility authorization must not claim faucet funds");
    } catch (error) {
      assert.include(error.message, "revert");
    }
  });

  it("expires and epoch-invalidates faucet authorizations", async () => {
    const expiredDeadline = await authorizationDeadline(1);
    const expired = await signFaucetAuthorization(claimant, admin, expiredDeadline);
    await advanceTime(2);
    try {
      await rewardPool.claimFaucet(expired.deadline, expired.authorization, { from: claimant });
      assert.fail("Expired faucet authorization should revert");
    } catch (error) {
      assert.include(error.message, "revert");
    }

    const stale = await signFaucetAuthorization(accounts[5]);
    await rewardPool.setFaucetSigner(unauthorizedSigner, { from: admin });
    try {
      await rewardPool.claimFaucet(stale.deadline, stale.authorization, { from: accounts[5] });
      assert.fail("A previous-epoch faucet authorization should revert");
    } catch (error) {
      assert.include(error.message, "revert");
    }

    const current = await signFaucetAuthorization(accounts[5], unauthorizedSigner);
    await rewardPool.claimFaucet(current.deadline, current.authorization, { from: accounts[5] });
    assert.isTrue(await rewardPool.hasClaimedFaucet(accounts[5]));
  });

  it("enforces the global daily faucet cap", async () => {
    await rewardPool.setGlobalDailyFaucetCap(web3.utils.toWei("5", "ether"), { from: admin });
    const first = await signFaucetAuthorization(claimant);
    await rewardPool.claimFaucet(first.deadline, first.authorization, { from: claimant });

    const second = await signFaucetAuthorization(accounts[5]);
    try {
      await rewardPool.claimFaucet(second.deadline, second.authorization, { from: accounts[5] });
      assert.fail("The second faucet claim should exceed the daily cap");
    } catch (error) {
      assert.include(error.message, "revert");
    }
    assert.isFalse(await rewardPool.hasClaimedFaucet(accounts[5]));
  });

  it("invalidates reward eligibility and outstanding attestations on signer rotation", async () => {
    const existing = await signRewardEligibility(claimant);
    await rewardPool.registerRewardEligibility(
      existing.deadline,
      existing.authorization,
      { from: claimant }
    );
    const stale = await signRewardEligibility(accounts[5]);

    await rewardPool.setFaucetSigner(unauthorizedSigner, { from: admin });
    assert.isFalse(await rewardPool.rewardEligible(claimant));
    try {
      await rewardPool.registerRewardEligibility(
        stale.deadline,
        stale.authorization,
        { from: accounts[5] }
      );
      assert.fail("A previous-epoch eligibility authorization should revert");
    } catch (error) {
      assert.include(error.message, "revert");
    }

    const current = await signRewardEligibility(accounts[5], unauthorizedSigner);
    await rewardPool.registerRewardEligibility(
      current.deadline,
      current.authorization,
      { from: accounts[5] }
    );
    assert.isTrue(await rewardPool.rewardEligible(accounts[5]));
  });

  it("supports preventive per-wallet revocation by consuming the nonce", async () => {
    const stale = await signRewardEligibility(claimant);
    const staleFaucet = await signFaucetAuthorization(claimant);
    await rewardPool.revokeRewardEligibility(claimant, { from: admin });
    assert.equal((await rewardPool.rewardEligibilityNonces(claimant)).toString(), "1");
    assert.equal((await rewardPool.faucetNonces(claimant)).toString(), "1");

    try {
      await rewardPool.registerRewardEligibility(
        stale.deadline,
        stale.authorization,
        { from: claimant }
      );
      assert.fail("A pre-revocation authorization should revert");
    } catch (error) {
      assert.include(error.message, "revert");
    }

    try {
      await rewardPool.claimFaucet(
        staleFaucet.deadline,
        staleFaucet.authorization,
        { from: claimant }
      );
      assert.fail("A pre-revocation faucet authorization should revert");
    } catch (error) {
      assert.include(error.message, "revert");
    }

    const current = await signRewardEligibility(claimant);
    await rewardPool.registerRewardEligibility(
      current.deadline,
      current.authorization,
      { from: claimant }
    );
    assert.isTrue(await rewardPool.rewardEligible(claimant));
    await rewardPool.revokeRewardEligibility(claimant, { from: admin });
    assert.isFalse(await rewardPool.rewardEligible(claimant));
  });

  it("rejects expired reward eligibility attestations", async () => {
    const deadline = await authorizationDeadline(1);
    const expired = await signRewardEligibility(claimant, admin, deadline);
    await advanceTime(2);
    try {
      await rewardPool.registerRewardEligibility(
        expired.deadline,
        expired.authorization,
        { from: claimant }
      );
      assert.fail("Expired reward eligibility authorization should revert");
    } catch (error) {
      assert.include(error.message, "revert");
    }
  });

  it("does not pay rewards unless both players are eligible", async () => {
    const white = accounts[5];
    const black = accounts[6];
    const factory = await setupRewardInfrastructure();
    await registerEligibility(white);

    const whiteBefore = web3.utils.toBN(await chessToken.balanceOf(white));
    const blackBefore = web3.utils.toBN(await chessToken.balanceOf(black));
    await completeRewardableDraw(factory, white, black);

    assert.equal((await chessToken.balanceOf(white)).toString(), whiteBefore.toString());
    assert.equal((await chessToken.balanceOf(black)).toString(), blackBefore.toString());
    const today = Math.floor((await web3.eth.getBlock("latest")).timestamp / 86400);
    assert.equal((await rewardPool.globalDailyRewards(today)).toString(), "0");
  });

  it("pays a qualifying game when both players are signer-eligible", async () => {
    const white = accounts[5];
    const black = accounts[6];
    const factory = await setupRewardInfrastructure();
    await registerEligibility(white);
    await registerEligibility(black);

    const whiteBefore = web3.utils.toBN(await chessToken.balanceOf(white));
    const blackBefore = web3.utils.toBN(await chessToken.balanceOf(black));
    await completeRewardableDraw(factory, white, black);

    const whiteDelta = web3.utils.toBN(await chessToken.balanceOf(white)).sub(whiteBefore);
    const blackDelta = web3.utils.toBN(await chessToken.balanceOf(black)).sub(blackBefore);
    assert.isTrue(whiteDelta.gt(web3.utils.toBN("0")));
    assert.isTrue(blackDelta.gt(web3.utils.toBN("0")));

    const today = Math.floor((await web3.eth.getBlock("latest")).timestamp / 86400);
    assert.equal(
      (await rewardPool.globalDailyRewards(today)).toString(),
      whiteDelta.add(blackDelta).toString()
    );
  });

  it("never pays rewards for Friendly games even after enough legal moves", async () => {
    const white = accounts[5];
    const black = accounts[6];
    const factory = await setupRewardInfrastructure();
    await registerEligibility(white);
    await registerEligibility(black);

    const whiteBefore = await chessToken.balanceOf(white);
    const blackBefore = await chessToken.balanceOf(black);
    await completeRewardableDraw(factory, white, black, 1);

    assert.equal((await chessToken.balanceOf(white)).toString(), whiteBefore.toString());
    assert.equal((await chessToken.balanceOf(black)).toString(), blackBefore.toString());
    const today = Math.floor((await web3.eth.getBlock("latest")).timestamp / 86400);
    assert.equal((await rewardPool.globalDailyRewards(today)).toString(), "0");
  });

  it("never pays beyond the global on-chain daily reward cap", async () => {
    const firstWhite = accounts[5];
    const firstBlack = accounts[6];
    const secondWhite = accounts[7];
    const secondBlack = accounts[8];
    const factory = await setupRewardInfrastructure();

    for (const player of [firstWhite, firstBlack, secondWhite, secondBlack]) {
      await registerEligibility(player);
    }

    const cap = web3.utils.toWei("4", "ether");
    await rewardPool.setGlobalDailyRewardCap(cap, { from: admin });
    const firstWhiteBefore = await chessToken.balanceOf(firstWhite);
    const firstBlackBefore = await chessToken.balanceOf(firstBlack);
    await completeRewardableDraw(factory, firstWhite, firstBlack);

    assert.isTrue(web3.utils.toBN(await chessToken.balanceOf(firstWhite)).gt(web3.utils.toBN(firstWhiteBefore)));
    assert.isTrue(web3.utils.toBN(await chessToken.balanceOf(firstBlack)).gt(web3.utils.toBN(firstBlackBefore)));

    const secondWhiteBefore = await chessToken.balanceOf(secondWhite);
    const secondBlackBefore = await chessToken.balanceOf(secondBlack);
    await completeRewardableDraw(factory, secondWhite, secondBlack);

    const today = Math.floor((await web3.eth.getBlock("latest")).timestamp / 86400);
    const emitted = await rewardPool.globalDailyRewards(today);
    assert.equal(emitted.toString(), cap, "Daily emissions should stop exactly at the cap");
    assert.isTrue(web3.utils.toBN(emitted).lte(web3.utils.toBN(cap)));
    assert.equal((await chessToken.balanceOf(secondWhite)).toString(), secondWhiteBefore.toString());
    assert.equal((await chessToken.balanceOf(secondBlack)).toString(), secondBlackBefore.toString());

    for (const invalidCap of [
      web3.utils.toWei("3", "ether"),
      "0",
      web3.utils.toBN(await rewardPool.MAX_GLOBAL_DAILY_REWARD()).add(web3.utils.toBN("1")).toString()
    ]) {
      try {
        await rewardPool.setGlobalDailyRewardCap(invalidCap, { from: admin });
        assert.fail("An invalid or retroactively low daily cap should revert");
      } catch (error) {
        assert.include(error.message, "revert");
      }
    }
  });

  it("does not partially reward one side when the remaining daily budget is insufficient", async () => {
    const white = accounts[5];
    const black = accounts[6];
    const factory = await setupRewardInfrastructure();
    await registerEligibility(white);
    await registerEligibility(black);
    await rewardPool.setGlobalDailyRewardCap(web3.utils.toWei("3", "ether"), { from: admin });

    const whiteBefore = await chessToken.balanceOf(white);
    const blackBefore = await chessToken.balanceOf(black);
    await completeRewardableDraw(factory, white, black);

    assert.equal((await chessToken.balanceOf(white)).toString(), whiteBefore.toString());
    assert.equal((await chessToken.balanceOf(black)).toString(), blackBefore.toString());
    const today = Math.floor((await web3.eth.getBlock("latest")).timestamp / 86400);
    assert.equal((await rewardPool.globalDailyRewards(today)).toString(), "0");
  });

  it("consumes the opponent cooldown in both directions after a one-sided payout", async () => {
    const limited = accounts[5];
    const opponent = accounts[6];
    const fillers = accounts.slice(7, 12);
    const game = await setupDirectRewardInfrastructure([limited, opponent, ...fillers]);

    for (const filler of fillers) {
      await distributeDirect(game, limited, filler, 1);
    }
    const today = Math.floor((await web3.eth.getBlock("latest")).timestamp / 86400);
    assert.equal((await rewardPool.dailyGames(limited, today)).toString(), "5");

    await distributeDirect(game, limited, opponent, 2);
    const forward = await rewardPool.lastOpponentGame(limited, opponent);
    const reverse = await rewardPool.lastOpponentGame(opponent, limited);
    assert.isTrue(web3.utils.toBN(forward).gt(web3.utils.toBN("0")));
    assert.equal(reverse.toString(), forward.toString());

    await advanceTime(24 * 60 * 60 + 1);
    const limitedBefore = await chessToken.balanceOf(limited);
    const opponentBefore = await chessToken.balanceOf(opponent);
    await distributeDirect(game, limited, opponent, 1);
    assert.equal((await chessToken.balanceOf(limited)).toString(), limitedBefore.toString());
    assert.equal((await chessToken.balanceOf(opponent)).toString(), opponentBefore.toString());
  });

  it("records qualifying negative behavior even when no reward can be paid", async () => {
    const resigning = accounts[5];
    const opponent = accounts[6];
    const game = await setupDirectRewardInfrastructure([resigning, opponent]);
    await rewardPool.setGlobalDailyRewardCap(web3.utils.toWei("1", "ether"), { from: admin });

    await distributeDirect(game, resigning, opponent, 2, { whiteResign: true });

    const stats = await rewardPool.getBehaviorStats(resigning);
    assert.equal(stats.totalGames.toString(), "1");
    assert.equal(stats.resignCount.toString(), "1");
    const today = Math.floor((await web3.eth.getBlock("latest")).timestamp / 86400);
    assert.equal((await rewardPool.globalDailyRewards(today)).toString(), "0");
  });

  it("does not let non-rewardable instant games wash behavior history", async () => {
    const white = accounts[5];
    const black = accounts[6];
    const factory = await setupRewardInfrastructure();
    await registerEligibility(white);
    await registerEligibility(black);

    await completeRewardableResignation(factory, white, black);
    const penalizedFactors = await rewardPool.getPlayerFactors(white);
    const statsBefore = await rewardPool.getBehaviorStats(white);
    assert.equal(penalizedFactors.behaviorFactor.toString(), "500");
    assert.equal(statsBefore.totalGames.toString(), "1");
    assert.equal(statsBefore.resignCount.toString(), "1");

    await completeImmediateDraw(factory, white, black);

    const factorsAfter = await rewardPool.getPlayerFactors(white);
    const statsAfter = await rewardPool.getBehaviorStats(white);
    assert.equal(factorsAfter.behaviorFactor.toString(), "500");
    assert.equal(statsAfter.totalGames.toString(), "1", "A zero-ply game must not enter reward behavior history");
    assert.equal(statsAfter.resignCount.toString(), "1");
  });
});
