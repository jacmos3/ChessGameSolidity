const ChessFactory = artifacts.require("ChessFactory");
const ChessCore = artifacts.require("ChessCore");

contract("ChessCore - Resign and ClaimPrize", (accounts) => {
  const whitePlayer = accounts[0];
  const blackPlayer = accounts[1];
  const nonPlayer = accounts[2];
  const betAmount = web3.utils.toWei("1", "ether");

  let chessFactory;
  let chessCore;

  beforeEach(async () => {
    // Deploy fresh contracts for each test
    const chessCoreImpl = await ChessCore.new();
    chessFactory = await ChessFactory.new(chessCoreImpl.address);

    // Create a new game with white player
    // TimeoutPreset: 0=Blitz, 1=Rapid, 2=Classical
    const tx = await chessFactory.createChessGame(2, 0, {
      from: whitePlayer,
      value: betAmount
    });

    // Get the deployed ChessCore address
    const deployedGames = await chessFactory.getDeployedChessGames();
    const chessCoreAddress = deployedGames[deployedGames.length - 1];
    chessCore = await ChessCore.at(chessCoreAddress);

    // Black player joins the game
    await chessCore.joinGameAsBlack({
      from: blackPlayer,
      value: betAmount
    });
  });

  describe("Resign", () => {
    it("should allow white player to resign", async () => {
      await chessCore.resign({ from: whitePlayer });

      const gameState = await chessCore.getGameState();
      assert.equal(gameState.toNumber(), 5, "Game state should be BlackWins (5)");
    });

    it("should allow black player to resign", async () => {
      await chessCore.resign({ from: blackPlayer });

      const gameState = await chessCore.getGameState();
      assert.equal(gameState.toNumber(), 4, "Game state should be WhiteWins (4)");
    });

    it("should not allow non-player to resign", async () => {
      try {
        await chessCore.resign({ from: nonPlayer });
        assert.fail("Should have thrown an error");
      } catch (error) {
        assert.include(error.message, "revert");
      }
    });

    it("should not allow resign after game is finished", async () => {
      // First resign
      await chessCore.resign({ from: whitePlayer });

      // Try to resign again
      try {
        await chessCore.resign({ from: blackPlayer });
        assert.fail("Should have thrown an error");
      } catch (error) {
        assert.include(error.message, "revert");
      }
    });

    it("should emit PlayerResigned event", async () => {
      const tx = await chessCore.resign({ from: whitePlayer });

      // resign emits PlayerResigned and GameStateChanged events
      assert.equal(tx.logs.length, 2, "Should emit two events");
      const resignEvent = tx.logs.find(log => log.event === "PlayerResigned");
      assert.ok(resignEvent, "Should have PlayerResigned event");
      assert.equal(resignEvent.args.player, whitePlayer, "Player should be white");
      assert.equal(resignEvent.args.winner, blackPlayer, "Winner should be black");
    });
  });

  describe("ClaimPrize", () => {
    it("should allow winner to claim prize after resignation", async () => {
      // White resigns, black wins
      await chessCore.resign({ from: whitePlayer });

      const blackBalanceBefore = BigInt(await web3.eth.getBalance(blackPlayer));

      const tx = await chessCore.claimPrize({ from: blackPlayer });
      const gasUsed = BigInt(tx.receipt.gasUsed);
      const gasPrice = BigInt((await web3.eth.getTransaction(tx.tx)).gasPrice);
      const gasCost = gasUsed * gasPrice;

      const blackBalanceAfter = BigInt(await web3.eth.getBalance(blackPlayer));
      const expectedPrize = BigInt(betAmount) * 2n;

      // Balance should increase by prize minus gas cost
      const actualIncrease = blackBalanceAfter - blackBalanceBefore + gasCost;
      assert.equal(actualIncrease.toString(), expectedPrize.toString(), "Winner should receive the full prize");
    });

    it("should not allow loser to claim prize", async () => {
      // White resigns, black wins
      await chessCore.resign({ from: whitePlayer });

      try {
        await chessCore.claimPrize({ from: whitePlayer });
        assert.fail("Should have thrown an error");
      } catch (error) {
        assert.include(error.message, "revert");
      }
    });

    it("should not allow claiming prize before game ends", async () => {
      try {
        await chessCore.claimPrize({ from: whitePlayer });
        assert.fail("Should have thrown an error");
      } catch (error) {
        assert.include(error.message, "revert");
      }
    });

    it("should not allow double claiming", async () => {
      await chessCore.resign({ from: whitePlayer });
      await chessCore.claimPrize({ from: blackPlayer });

      try {
        await chessCore.claimPrize({ from: blackPlayer });
        assert.fail("Should have thrown an error");
      } catch (error) {
        assert.include(error.message, "revert");
      }
    });

    it("should not allow non-player to claim prize", async () => {
      await chessCore.resign({ from: whitePlayer });

      try {
        await chessCore.claimPrize({ from: nonPlayer });
        assert.fail("Should have thrown an error");
      } catch (error) {
        assert.include(error.message, "revert");
      }
    });

    it("should emit PrizeClaimed event", async () => {
      await chessCore.resign({ from: whitePlayer });

      const tx = await chessCore.claimPrize({ from: blackPlayer });

      assert.equal(tx.logs.length, 1, "Should emit one event");
      assert.equal(tx.logs[0].event, "PrizeClaimed", "Should be PrizeClaimed event");
      assert.equal(tx.logs[0].args.winner, blackPlayer, "Winner should be black");

      const expectedPrize = BigInt(betAmount) * 2n;
      assert.equal(tx.logs[0].args.amount.toString(), expectedPrize.toString(), "Amount should be total prize");
    });
  });

  describe("Integration - Full game flow with resign", () => {
    it("should handle complete resign and claim flow", async () => {
      // Check initial contract balance
      const contractBalance = await web3.eth.getBalance(chessCore.address);
      const expectedBalance = BigInt(betAmount) * 2n;
      assert.equal(contractBalance.toString(), expectedBalance.toString(), "Contract should hold both bets");

      // White player resigns
      await chessCore.resign({ from: whitePlayer });

      // Verify game state
      const gameState = await chessCore.getGameState();
      assert.equal(gameState.toNumber(), 5, "Black should win");

      // Black claims prize
      await chessCore.claimPrize({ from: blackPlayer });

      // Contract balance should be 0
      const finalBalance = await web3.eth.getBalance(chessCore.address);
      assert.equal(finalBalance.toString(), "0", "Contract should be empty after claim");
    });
  });
});
