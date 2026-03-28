const ChessToken = artifacts.require("ChessToken");
const BondingManager = artifacts.require("BondingManager");
const ArbitratorRegistry = artifacts.require("ArbitratorRegistry");
const DisputeDAO = artifacts.require("DisputeDAO");
const ChessFactory = artifacts.require("ChessFactory");
const ChessCore = artifacts.require("ChessCore");

const advanceTime = (seconds) =>
  new Promise((resolve, reject) => {
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

module.exports = async function (callback) {
  try {
    const accounts = await web3.eth.getAccounts();
    const admin = accounts[0];
    const whitePlayer = accounts[3];
    const blackPlayer = accounts[4];
    const challenger = accounts[5];
    const arb1 = accounts[6];
    const arb2 = accounts[7];
    const arb3 = accounts[8];

    const BET_AMOUNT = web3.utils.toWei("0.1", "ether");
    const BOND_CHESS = web3.utils.toWei("1000", "ether");
    const BOND_ETH = web3.utils.toWei("1", "ether");
    const TIER1_STAKE = web3.utils.toWei("1000", "ether");
    const MINT_AMOUNT = web3.utils.toWei("100000", "ether");
    const CHALLENGE_DEPOSIT = web3.utils.toWei("50", "ether");

    console.log("");
    console.log("=== Local Smoke Test ===");

    const chessToken = await ChessToken.deployed();
    const bondingManager = await BondingManager.deployed();
    const arbitratorRegistry = await ArbitratorRegistry.deployed();
    const disputeDAO = await DisputeDAO.deployed();
    const chessFactory = await ChessFactory.deployed();

    console.log("Contracts:");
    console.log(" - ChessFactory:", chessFactory.address);
    console.log(" - BondingManager:", bondingManager.address);
    console.log(" - DisputeDAO:", disputeDAO.address);

    for (const recipient of [whitePlayer, blackPlayer, challenger, arb1, arb2, arb3]) {
      await chessToken.mintPlayToEarn(recipient, MINT_AMOUNT, { from: admin });
    }

    await chessToken.approve(bondingManager.address, MINT_AMOUNT, { from: whitePlayer });
    await chessToken.approve(bondingManager.address, MINT_AMOUNT, { from: blackPlayer });
    await chessToken.approve(disputeDAO.address, CHALLENGE_DEPOSIT, { from: challenger });
    await chessToken.approve(arbitratorRegistry.address, MINT_AMOUNT, { from: arb1 });
    await chessToken.approve(arbitratorRegistry.address, MINT_AMOUNT, { from: arb2 });
    await chessToken.approve(arbitratorRegistry.address, MINT_AMOUNT, { from: arb3 });

    await arbitratorRegistry.stake(TIER1_STAKE, { from: arb1 });
    await arbitratorRegistry.stake(TIER1_STAKE, { from: arb2 });
    await arbitratorRegistry.stake(TIER1_STAKE, { from: arb3 });
    await advanceTime(7 * 24 * 60 * 60 + 1);

    await bondingManager.depositBond(BOND_CHESS, { from: whitePlayer, value: BOND_ETH });
    await bondingManager.depositBond(BOND_CHESS, { from: blackPlayer, value: BOND_ETH });

    console.log("Creating game...");
    await chessFactory.createChessGame(2, 0, {
      from: whitePlayer,
      value: BET_AMOUNT
    });

    const games = await chessFactory.getDeployedChessGames();
    const chessCore = await ChessCore.at(games[games.length - 1]);
    const gameId = await chessCore.gameId();

    console.log("Game created:");
    console.log(" - gameId:", gameId.toString());
    console.log(" - address:", chessCore.address);

    console.log("Joining as black...");
    await chessCore.joinGameAsBlack({
      from: blackPlayer,
      value: BET_AMOUNT
    });

    console.log("Making two opening moves...");
    await chessCore.makeMove(6, 4, 4, 4, { from: whitePlayer });
    await chessCore.makeMove(1, 4, 3, 4, { from: blackPlayer });

    console.log("White resigns...");
    await chessCore.resign({ from: whitePlayer });

    console.log("Opening dispute...");
    await disputeDAO.challenge(gameId, blackPlayer, { from: challenger });
    const disputeId = await disputeDAO.gameToDispute(gameId);
    const selectedArbitrators = await disputeDAO.getSelectedArbitrators(disputeId);
    const revealData = [];

    console.log(" - selected arbitrators:", selectedArbitrators.length);

    for (let i = 0; i < selectedArbitrators.length; i++) {
      const arbitrator = selectedArbitrators[i];
      const salt = web3.utils.soliditySha3(`smoke-local-${i}`);
      const commitHash = web3.utils.soliditySha3(
        { type: "uint8", value: 2 },
        { type: "bytes32", value: salt },
        { type: "address", value: arbitrator }
      );
      await disputeDAO.commitVote(disputeId, commitHash, { from: arbitrator });
      revealData.push({ arbitrator, salt });
    }

    await advanceTime(24 * 60 * 60 + 1);

    for (const { arbitrator, salt } of revealData) {
      await disputeDAO.revealVote(disputeId, 2, salt, { from: arbitrator });
    }

    await advanceTime(24 * 60 * 60 + 1);
    await disputeDAO.resolveDispute(disputeId, { from: challenger });
    await chessCore.finalizePrizes({ from: whitePlayer });

    const whitePendingPrize = await chessCore.pendingPrize(whitePlayer);
    const blackPendingPrize = await chessCore.pendingPrize(blackPlayer);

    console.log("Smoke test passed:");
    console.log(" - white pending prize:", whitePendingPrize.toString());
    console.log(" - black pending prize:", blackPendingPrize.toString());
    console.log(" - dispute resolved:", disputeId.toString());
    console.log("");

    callback();
  } catch (error) {
    console.error("");
    console.error("Smoke test failed.");
    console.error(error.message || error);
    callback(error);
  }
};
