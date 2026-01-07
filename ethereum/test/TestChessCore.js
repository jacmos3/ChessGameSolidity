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
    // TimeoutPreset: 0=Finney, 1=Buterin, 2=Nakamoto
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

  describe("Draw Prize - Pull Pattern (finalizePrizes/withdrawPrize)", () => {
    beforeEach(async () => {
      // Offer and accept draw to create draw state
      await chessCore.offerDraw({ from: whitePlayer });
      await chessCore.acceptDraw({ from: blackPlayer });
    });

    it("should have game state as Draw after accepting draw", async () => {
      const gameState = await chessCore.getGameState();
      // getGameState() returns: NotStarted=1, InProgress=2, Draw=3, WhiteWins=4, BlackWins=5
      assert.equal(gameState.toNumber(), 3, "Game state should be Draw (3 from getGameState)");
    });

    it("should not allow claimPrize for draws - must use finalizePrizes", async () => {
      try {
        await chessCore.claimPrize({ from: whitePlayer });
        assert.fail("Should have thrown an error");
      } catch (error) {
        assert.include(error.message, "revert", "Should revert for draws");
      }
    });

    it("should allow finalizePrizes to allocate prizes for draw", async () => {
      await chessCore.finalizePrizes({ from: whitePlayer });

      // Check pending prizes
      const whitePending = await chessCore.pendingPrize(whitePlayer);
      const blackPending = await chessCore.pendingPrize(blackPlayer);

      const expectedHalf = BigInt(betAmount);
      assert.equal(whitePending.toString(), expectedHalf.toString(), "White should have half prize pending");
      assert.equal(blackPending.toString(), expectedHalf.toString(), "Black should have half prize pending");
    });

    it("should allow either player to call finalizePrizes", async () => {
      // Black player calls finalizePrizes
      await chessCore.finalizePrizes({ from: blackPlayer });

      const whitePending = await chessCore.pendingPrize(whitePlayer);
      assert.ok(BigInt(whitePending.toString()) > 0n, "White should have pending prize");
    });

    it("should not allow double finalizePrizes", async () => {
      await chessCore.finalizePrizes({ from: whitePlayer });

      try {
        await chessCore.finalizePrizes({ from: blackPlayer });
        assert.fail("Should have thrown an error");
      } catch (error) {
        assert.include(error.message, "revert", "Should revert on double finalize");
      }
    });

    it("should allow withdrawPrize after finalizePrizes", async () => {
      await chessCore.finalizePrizes({ from: whitePlayer });

      const whiteBalanceBefore = BigInt(await web3.eth.getBalance(whitePlayer));

      const tx = await chessCore.withdrawPrize({ from: whitePlayer });
      const gasUsed = BigInt(tx.receipt.gasUsed);
      const gasPrice = BigInt((await web3.eth.getTransaction(tx.tx)).gasPrice);
      const gasCost = gasUsed * gasPrice;

      const whiteBalanceAfter = BigInt(await web3.eth.getBalance(whitePlayer));
      const expectedPrize = BigInt(betAmount); // Half of total

      const actualIncrease = whiteBalanceAfter - whiteBalanceBefore + gasCost;
      assert.equal(actualIncrease.toString(), expectedPrize.toString(), "White should receive half prize");
    });

    it("should allow both players to withdraw independently", async () => {
      await chessCore.finalizePrizes({ from: whitePlayer });

      // White withdraws
      await chessCore.withdrawPrize({ from: whitePlayer });

      // Black withdraws
      const blackBalanceBefore = BigInt(await web3.eth.getBalance(blackPlayer));
      const tx = await chessCore.withdrawPrize({ from: blackPlayer });
      const gasUsed = BigInt(tx.receipt.gasUsed);
      const gasPrice = BigInt((await web3.eth.getTransaction(tx.tx)).gasPrice);
      const gasCost = gasUsed * gasPrice;
      const blackBalanceAfter = BigInt(await web3.eth.getBalance(blackPlayer));

      const expectedPrize = BigInt(betAmount);
      const actualIncrease = blackBalanceAfter - blackBalanceBefore + gasCost;
      assert.equal(actualIncrease.toString(), expectedPrize.toString(), "Black should receive half prize");

      // Contract should be empty
      const contractBalance = await web3.eth.getBalance(chessCore.address);
      assert.equal(contractBalance.toString(), "0", "Contract should be empty");
    });

    it("should not allow withdrawPrize before finalizePrizes", async () => {
      // Reset to fresh draw game
      const chessCoreImpl = await ChessCore.new();
      const newFactory = await ChessFactory.new(chessCoreImpl.address);
      const tx = await newFactory.createChessGame(2, 0, { from: whitePlayer, value: betAmount });
      const deployedGames = await newFactory.getDeployedChessGames();
      const newGame = await ChessCore.at(deployedGames[0]);
      await newGame.joinGameAsBlack({ from: blackPlayer, value: betAmount });
      await newGame.offerDraw({ from: whitePlayer });
      await newGame.acceptDraw({ from: blackPlayer });

      try {
        await newGame.withdrawPrize({ from: whitePlayer });
        assert.fail("Should have thrown an error");
      } catch (error) {
        assert.include(error.message, "revert", "Should revert before finalize");
      }
    });

    it("should not allow double withdrawPrize", async () => {
      await chessCore.finalizePrizes({ from: whitePlayer });
      await chessCore.withdrawPrize({ from: whitePlayer });

      try {
        await chessCore.withdrawPrize({ from: whitePlayer });
        assert.fail("Should have thrown an error");
      } catch (error) {
        assert.include(error.message, "revert", "Should revert on double withdraw");
      }
    });

    it("should emit PrizeClaimed event on withdrawPrize", async () => {
      await chessCore.finalizePrizes({ from: whitePlayer });
      const tx = await chessCore.withdrawPrize({ from: whitePlayer });

      assert.equal(tx.logs.length, 1, "Should emit one event");
      assert.equal(tx.logs[0].event, "PrizeClaimed", "Should be PrizeClaimed event");
      assert.equal(tx.logs[0].args.winner, whitePlayer, "Winner should be white");

      const expectedPrize = BigInt(betAmount);
      assert.equal(tx.logs[0].args.amount.toString(), expectedPrize.toString(), "Amount should be half prize");
    });

    it("should not allow non-players to withdraw", async () => {
      await chessCore.finalizePrizes({ from: whitePlayer });

      try {
        await chessCore.withdrawPrize({ from: nonPlayer });
        assert.fail("Should have thrown an error");
      } catch (error) {
        assert.include(error.message, "revert", "Should revert for non-players");
      }
    });
  });
});
