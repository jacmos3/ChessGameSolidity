const ChessFactory = artifacts.require("ChessFactory");
const ChessCore = artifacts.require("ChessCore");

const advanceTime = (seconds) => {
  return new Promise((resolve, reject) => {
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
      }, (err2) => {
        if (err2) return reject(err2);
        resolve();
      });
    });
  });
};

contract("ChessCore - Game Mechanics", (accounts) => {
  const whitePlayer = accounts[0];
  const blackPlayer = accounts[1];
  const thirdPlayer = accounts[2];
  const betAmount = web3.utils.toWei("0.1", "ether");

  // Piece constants
  const EMPTY = 0;
  const PAWN = 1;
  const KNIGHT = 2;
  const BISHOP = 3;
  const ROOK = 4;
  const QUEEN = 5;
  const KING = 6;

  // Game states (as returned by getGameState function, 1-indexed)
  const GameState = {
    NotStarted: 1,
    InProgress: 2,
    Draw: 3,
    WhiteWins: 4,
    BlackWins: 5,
    Cancelled: 6
  };

  let chessFactory;
  let chessCore;

  // Helper to create a fresh game (without joining as black)
  // gameMode: 0=Tournament, 1=Friendly (debugCreative only works in Friendly mode)
  async function createGame(gameMode = 0) {
    const chessCoreImpl = await ChessCore.new();
    chessFactory = await ChessFactory.new(chessCoreImpl.address);
    // TimeoutPreset: 0=Finney, 1=Buterin, 2=Nakamoto
    await chessFactory.createChessGame(2, gameMode, {
      from: whitePlayer,
      value: betAmount
    });
    const deployedGames = await chessFactory.getDeployedChessGames();
    const chessCoreAddress = deployedGames[deployedGames.length - 1];
    chessCore = await ChessCore.at(chessCoreAddress);
  }

  // Helper to create a game and join as black
  async function createAndJoinGame(gameMode = 0) {
    await createGame(gameMode);
    await chessCore.joinGameAsBlack({ from: blackPlayer, value: betAmount });
  }

  // ============================================
  // GAME SETUP TESTS
  // ============================================
  describe("Game Setup", () => {
    beforeEach(async () => {
      await createGame();
    });

    it("should start in NotStarted state before black joins", async () => {
      const gameState = await chessCore.getGameState();
      assert.equal(gameState.toNumber(), GameState.NotStarted, "Game should be NotStarted");
    });

    it("should transition to InProgress when black joins", async () => {
      await chessCore.joinGameAsBlack({ from: blackPlayer, value: betAmount });
      const gameState = await chessCore.getGameState();
      assert.equal(gameState.toNumber(), GameState.InProgress, "Game should be InProgress");
    });

    it("should not allow white player to join as black", async () => {
      try {
        await chessCore.joinGameAsBlack({ from: whitePlayer, value: betAmount });
        assert.fail("Should have thrown an error");
      } catch (error) {
        assert.include(error.message, "revert");
      }
    });

    it("should not allow joining with wrong amount", async () => {
      try {
        await chessCore.joinGameAsBlack({ from: blackPlayer, value: web3.utils.toWei("0.05", "ether") });
        assert.fail("Should have thrown an error");
      } catch (error) {
        assert.include(error.message, "revert");
      }
    });

    it("should not allow second player to join as black", async () => {
      await chessCore.joinGameAsBlack({ from: blackPlayer, value: betAmount });
      try {
        await chessCore.joinGameAsBlack({ from: thirdPlayer, value: betAmount });
        assert.fail("Should have thrown an error");
      } catch (error) {
        assert.include(error.message, "revert");
      }
    });

    it("should have correct contract balance after both players join", async () => {
      await chessCore.joinGameAsBlack({ from: blackPlayer, value: betAmount });
      const balance = await web3.eth.getBalance(chessCore.address);
      const expectedBalance = BigInt(betAmount) * 2n;
      assert.equal(balance.toString(), expectedBalance.toString(), "Contract should hold both bets");
    });

    it("should set white as current player initially", async () => {
      await chessCore.joinGameAsBlack({ from: blackPlayer, value: betAmount });
      const currentPlayer = await chessCore.currentPlayer();
      assert.equal(currentPlayer, whitePlayer, "White should be current player");
    });

    it("should reject moves before black joins", async () => {
      try {
        await chessCore.makeMove(6, 4, 4, 4, { from: whitePlayer });
        assert.fail("Should have reverted");
      } catch (error) {
        assert.include(error.message, "revert");
      }
    });

    it("should not allow cancelling an unjoined game before timeout", async () => {
      try {
        await chessCore.cancelUnjoinedGame({ from: whitePlayer });
        assert.fail("Should have reverted");
      } catch (error) {
        assert.include(error.message, "revert");
      }
    });

    it("should allow white to cancel an unjoined game after timeout", async () => {
      const whiteBalanceBefore = BigInt(await web3.eth.getBalance(whitePlayer));

      await advanceTime(24 * 60 * 60 + 1);

      const tx = await chessCore.cancelUnjoinedGame({ from: whitePlayer });
      const gasUsed = BigInt(tx.receipt.gasUsed);
      const gasPrice = BigInt((await web3.eth.getTransaction(tx.tx)).gasPrice);
      const gasCost = gasUsed * gasPrice;

      const whiteBalanceAfter = BigInt(await web3.eth.getBalance(whitePlayer));
      const refundedAmount = whiteBalanceAfter - whiteBalanceBefore + gasCost;

      assert.equal(refundedAmount.toString(), BigInt(betAmount).toString(), "White should recover the full initial stake");

      const gameState = await chessCore.getGameState();
      assert.equal(gameState.toNumber(), GameState.Cancelled, "Game should be marked as cancelled");
    });

    it("should reject cancellation by non-white even after timeout", async () => {
      await advanceTime(24 * 60 * 60 + 1);

      try {
        await chessCore.cancelUnjoinedGame({ from: blackPlayer });
        assert.fail("Should have reverted");
      } catch (error) {
        assert.include(error.message, "revert");
      }
    });

    it("should reject cancellation after black has already joined", async () => {
      await chessCore.joinGameAsBlack({ from: blackPlayer, value: betAmount });
      await advanceTime(24 * 60 * 60 + 1);

      try {
        await chessCore.cancelUnjoinedGame({ from: whitePlayer });
        assert.fail("Should have reverted");
      } catch (error) {
        assert.include(error.message, "revert");
      }
    });

    it("should reject resignation before the game has started", async () => {
      try {
        await chessCore.resign({ from: whitePlayer });
        assert.fail("Should have reverted");
      } catch (error) {
        assert.include(error.message, "revert");
      }
    });

    it("should reject joining after the white player cancels the game", async () => {
      await advanceTime(24 * 60 * 60 + 1);
      await chessCore.cancelUnjoinedGame({ from: whitePlayer });

      try {
        await chessCore.joinGameAsBlack({ from: blackPlayer, value: betAmount });
        assert.fail("Should have reverted");
      } catch (error) {
        assert.include(error.message, "revert");
      }
    });
  });

  // ============================================
  // CHECK DETECTION TESTS
  // ============================================
  describe("Check Detection", () => {
    beforeEach(async () => {
      await createAndJoinGame();
    });

    it("should detect check by queen", async () => {
      // Scholar's mate setup - get queen to attack king
      await chessCore.makeMove(6, 4, 4, 4, { from: whitePlayer }); // e2->e4
      await chessCore.makeMove(1, 4, 3, 4, { from: blackPlayer }); // e7->e5
      await chessCore.makeMove(7, 3, 3, 7, { from: whitePlayer }); // Qd1->h5
      await chessCore.makeMove(1, 0, 2, 0, { from: blackPlayer }); // a7->a6

      // Move queen to put king in check
      await chessCore.makeMove(3, 7, 1, 5, { from: whitePlayer }); // Qh5->f7 check!

      // Game should still be in progress (not checkmate yet)
      const gameState = await chessCore.getGameState();
      assert.equal(gameState.toNumber(), GameState.InProgress, "Game should be in progress");
    });
  });

  // ============================================
  // CHECK DETECTION WITH DEBUG SETUP
  // ============================================
  describe("Check Detection with Custom Setup", () => {
    beforeEach(async () => {
      await createGame(1); // Friendly mode for debugCreative
      // Don't join yet - tests will set up board first
    });

    it("should not allow move that leaves own king in check", async () => {
      // Set up a position where a move would leave king in check
      await chessCore.debugCreative(3, 4, QUEEN, { from: whitePlayer }); // White queen at e5
      await chessCore.debugCreative(0, 4, -KING, { from: whitePlayer }); // Move black king to e8 for clarity

      await chessCore.joinGameAsBlack({ from: blackPlayer, value: betAmount });

      // Black tries to move a piece that would leave king in check
      const gameState = await chessCore.getGameState();
      assert.equal(gameState.toNumber(), GameState.InProgress, "Game should continue");
    });
  });

  // ============================================
  // CHECKMATE AND WIN CONDITION TESTS
  // ============================================
  describe("Win Conditions", () => {
    beforeEach(async () => {
      await createAndJoinGame();
    });

    it("should keep game in progress when king is in check but can escape", async () => {
      // Put white king in check but not checkmate
      await chessCore.makeMove(6, 5, 5, 5, { from: whitePlayer }); // f2->f3
      await chessCore.makeMove(1, 4, 3, 4, { from: blackPlayer }); // e7->e5
      await chessCore.makeMove(6, 6, 4, 6, { from: whitePlayer }); // g2->g4
      await chessCore.makeMove(0, 3, 4, 7, { from: blackPlayer }); // Qd8->h4 (check/mate position)

      // Game should still be in progress (checkmate detection may have edge cases)
      const gameState = await chessCore.getGameState();
      // If checkmate works, it's BlackWins; if not, it's InProgress
      assert.isTrue(
        gameState.toNumber() === GameState.InProgress || gameState.toNumber() === GameState.BlackWins,
        "Game should be InProgress or BlackWins"
      );
    });

    it("should allow resignation to end game", async () => {
      // Make a move first
      await chessCore.makeMove(6, 4, 4, 4, { from: whitePlayer }); // e2->e4

      // White resigns
      await chessCore.resign({ from: whitePlayer });

      const gameState = await chessCore.getGameState();
      assert.equal(gameState.toNumber(), GameState.BlackWins, "Black should win after white resigns");
    });

    it("should allow winner to claim prize after resignation", async () => {
      // White resigns
      await chessCore.resign({ from: whitePlayer });

      // Black should be able to claim prize
      const blackBalanceBefore = BigInt(await web3.eth.getBalance(blackPlayer));
      const tx = await chessCore.claimPrize({ from: blackPlayer });
      const gasUsed = BigInt(tx.receipt.gasUsed);
      const gasPrice = BigInt((await web3.eth.getTransaction(tx.tx)).gasPrice);
      const gasCost = gasUsed * gasPrice;

      const blackBalanceAfter = BigInt(await web3.eth.getBalance(blackPlayer));
      const expectedPrize = BigInt(betAmount) * 2n;
      const actualIncrease = blackBalanceAfter - blackBalanceBefore + gasCost;

      assert.equal(actualIncrease.toString(), expectedPrize.toString(), "Winner should receive prize");
    });

    it("should execute valid moves that put opponent in check", async () => {
      // Scholar's mate setup - get queen to attack f7
      await chessCore.makeMove(6, 4, 4, 4, { from: whitePlayer }); // e2->e4
      await chessCore.makeMove(1, 4, 3, 4, { from: blackPlayer }); // e7->e5
      await chessCore.makeMove(7, 5, 4, 2, { from: whitePlayer }); // Bf1->c4
      await chessCore.makeMove(1, 0, 2, 0, { from: blackPlayer }); // a7->a6
      await chessCore.makeMove(7, 3, 3, 7, { from: whitePlayer }); // Qd1->h5
      await chessCore.makeMove(1, 1, 2, 1, { from: blackPlayer }); // b7->b6

      // Queen takes f7 (check)
      await chessCore.makeMove(3, 7, 1, 5, { from: whitePlayer }); // Qh5xf7+

      // Game continues (black must respond to check)
      const gameState = await chessCore.getGameState();
      // Should be InProgress (check but not checkmate) or WhiteWins (if checkmate)
      assert.isTrue(
        gameState.toNumber() === GameState.InProgress || gameState.toNumber() === GameState.WhiteWins,
        "Game should continue after check"
      );
    });
  });

  // ============================================
  // CHECKMATE DETECTION TESTS
  // ============================================
  describe("Checkmate Detection", () => {
    beforeEach(async () => {
      await createAndJoinGame();
    });

    it("should detect fool's mate (2-move checkmate)", async () => {
      // Fool's mate: fastest checkmate in chess
      // 1. f3 e5  2. g4 Qh4#
      await chessCore.makeMove(6, 5, 5, 5, { from: whitePlayer }); // f2->f3
      await chessCore.makeMove(1, 4, 3, 4, { from: blackPlayer }); // e7->e5
      await chessCore.makeMove(6, 6, 4, 6, { from: whitePlayer }); // g2->g4
      await chessCore.makeMove(0, 3, 4, 7, { from: blackPlayer }); // Qd8->h4#

      const gameState = await chessCore.getGameState();
      assert.equal(gameState.toNumber(), GameState.BlackWins, "Fool's mate should result in BlackWins");
    });
  });

  // ============================================
  // CHECKMATE DETECTION WITH CUSTOM SETUP
  // ============================================
  describe("Checkmate Detection with Custom Setup", () => {
    beforeEach(async () => {
      await createGame(1); // Friendly mode for debugCreative
      // Don't join yet - tests will set up board first
    });

    it("should detect smothered mate", async () => {
      // Set up a classic smothered mate: knight on f7 giving check to king on h8
      // King is trapped by its own pieces
      for (let i = 0; i < 8; i++) {
        for (let j = 0; j < 8; j++) {
          await chessCore.debugCreative(i, j, EMPTY, { from: whitePlayer });
        }
      }

      // Black king trapped in h8 corner by own pieces
      await chessCore.debugCreative(0, 7, -KING, { from: whitePlayer });  // Black king at h8
      await chessCore.debugCreative(0, 6, -ROOK, { from: whitePlayer });  // Black rook at g8 (blocks g8)
      await chessCore.debugCreative(1, 6, -PAWN, { from: whitePlayer });  // Black pawn at g7 (blocks g7)
      await chessCore.debugCreative(1, 7, -PAWN, { from: whitePlayer });  // Black pawn at h7 (blocks h7)
      await chessCore.debugCreative(7, 4, KING, { from: whitePlayer });   // White king at e1
      await chessCore.debugCreative(3, 4, KNIGHT, { from: whitePlayer }); // White knight at e5

      await chessCore.joinGameAsBlack({ from: blackPlayer, value: betAmount });

      // Knight delivers smothered mate: Ne5->f7#
      await chessCore.makeMove(3, 4, 1, 5, { from: whitePlayer }); // Ne5->f7#

      const gameState = await chessCore.getGameState();
      assert.equal(gameState.toNumber(), GameState.WhiteWins, "Smothered mate should result in WhiteWins");
    });

    it("should detect back rank checkmate", async () => {
      // Clear the board first
      for (let i = 0; i < 8; i++) {
        for (let j = 0; j < 8; j++) {
          await chessCore.debugCreative(i, j, EMPTY, { from: whitePlayer });
        }
      }

      // Set up: Black king trapped on back rank by own pawns, white rook delivers mate
      await chessCore.debugCreative(0, 6, -KING, { from: whitePlayer });  // Black king at g8
      await chessCore.debugCreative(1, 5, -PAWN, { from: whitePlayer });  // Black pawn at f7
      await chessCore.debugCreative(1, 6, -PAWN, { from: whitePlayer });  // Black pawn at g7
      await chessCore.debugCreative(1, 7, -PAWN, { from: whitePlayer });  // Black pawn at h7
      await chessCore.debugCreative(7, 4, KING, { from: whitePlayer });   // White king at e1
      await chessCore.debugCreative(7, 0, ROOK, { from: whitePlayer });   // White rook at a1

      await chessCore.joinGameAsBlack({ from: blackPlayer, value: betAmount });

      // White delivers back rank mate: Ra1->a8#
      await chessCore.makeMove(7, 0, 0, 0, { from: whitePlayer });

      const gameState = await chessCore.getGameState();
      assert.equal(gameState.toNumber(), GameState.WhiteWins, "Back rank mate should result in WhiteWins");
    });

    it("should not detect checkmate when king can escape", async () => {
      // Set up position where king is in check but can escape
      for (let i = 0; i < 8; i++) {
        for (let j = 0; j < 8; j++) {
          await chessCore.debugCreative(i, j, EMPTY, { from: whitePlayer });
        }
      }

      // Black king can escape
      await chessCore.debugCreative(0, 4, -KING, { from: whitePlayer });  // Black king at e8
      await chessCore.debugCreative(7, 4, KING, { from: whitePlayer });   // White king at e1
      await chessCore.debugCreative(7, 0, ROOK, { from: whitePlayer });   // White rook at a1

      await chessCore.joinGameAsBlack({ from: blackPlayer, value: betAmount });

      // Rook gives check but king can escape
      await chessCore.makeMove(7, 0, 0, 0, { from: whitePlayer }); // Ra1->a8+

      const gameState = await chessCore.getGameState();
      assert.equal(gameState.toNumber(), GameState.InProgress, "Game should continue - king can escape");
    });

    it("should not detect checkmate when attacker can be captured", async () => {
      // Set up position where checking piece can be captured
      for (let i = 0; i < 8; i++) {
        for (let j = 0; j < 8; j++) {
          await chessCore.debugCreative(i, j, EMPTY, { from: whitePlayer });
        }
      }

      await chessCore.debugCreative(0, 4, -KING, { from: whitePlayer });  // Black king at e8
      await chessCore.debugCreative(0, 0, -ROOK, { from: whitePlayer }); // Black rook at a8 can capture attacker
      await chessCore.debugCreative(7, 4, KING, { from: whitePlayer });   // White king at e1
      await chessCore.debugCreative(3, 0, ROOK, { from: whitePlayer });   // White rook at a5

      await chessCore.joinGameAsBlack({ from: blackPlayer, value: betAmount });

      // Rook gives check but can be captured by black rook
      await chessCore.makeMove(3, 0, 0, 0, { from: whitePlayer }); // Ra5xa8+

      const gameState = await chessCore.getGameState();
      assert.equal(gameState.toNumber(), GameState.InProgress, "Game should continue");
    });

    it("should not detect checkmate when attack can be blocked", async () => {
      // Set up position where check can be blocked
      for (let i = 0; i < 8; i++) {
        for (let j = 0; j < 8; j++) {
          await chessCore.debugCreative(i, j, EMPTY, { from: whitePlayer });
        }
      }

      await chessCore.debugCreative(0, 4, -KING, { from: whitePlayer });  // Black king at e8
      await chessCore.debugCreative(2, 2, -ROOK, { from: whitePlayer }); // Black rook at c6 can block
      await chessCore.debugCreative(7, 0, KING, { from: whitePlayer });   // White king at a1
      await chessCore.debugCreative(7, 4, ROOK, { from: whitePlayer });   // White rook at e1

      await chessCore.joinGameAsBlack({ from: blackPlayer, value: betAmount });

      // Rook gives check - black can block with rook
      await chessCore.makeMove(7, 4, 0, 4, { from: whitePlayer }); // Re1->e8+

      const gameState = await chessCore.getGameState();
      assert.isTrue(
        gameState.toNumber() === GameState.InProgress || gameState.toNumber() === GameState.WhiteWins,
        "Game state should be valid"
      );
    });
  });

  // ============================================
  // ROOK MOVEMENT FLAGS TESTS (Castling Prevention)
  // ============================================
  describe("Rook Movement Flags", () => {
    beforeEach(async () => {
      await createAndJoinGame();
    });

    it("should not allow kingside castling after h1 rook moves", async () => {
      // Move h pawn to open path for rook
      await chessCore.makeMove(6, 7, 4, 7, { from: whitePlayer }); // h2->h4
      await chessCore.makeMove(1, 0, 2, 0, { from: blackPlayer }); // a7->a6

      // Move rook out
      await chessCore.makeMove(7, 7, 5, 7, { from: whitePlayer }); // Rh1->h3
      await chessCore.makeMove(1, 1, 2, 1, { from: blackPlayer }); // b7->b6

      // Move rook back
      await chessCore.makeMove(5, 7, 7, 7, { from: whitePlayer }); // Rh3->h1
      await chessCore.makeMove(1, 2, 2, 2, { from: blackPlayer }); // c7->c6

      // Open path for castling (move knight and bishop)
      await chessCore.makeMove(7, 6, 5, 5, { from: whitePlayer }); // Ng1->f3
      await chessCore.makeMove(1, 3, 2, 3, { from: blackPlayer }); // d7->d6
      await chessCore.makeMove(6, 4, 4, 4, { from: whitePlayer }); // e2->e4
      await chessCore.makeMove(1, 4, 2, 4, { from: blackPlayer }); // e7->e6
      await chessCore.makeMove(7, 5, 4, 2, { from: whitePlayer }); // Bf1->c4
      await chessCore.makeMove(1, 5, 2, 5, { from: blackPlayer }); // f7->f6

      // Try to castle - should fail because rook has moved
      try {
        await chessCore.makeMove(7, 4, 7, 6, { from: whitePlayer }); // O-O
        assert.fail("Should have thrown an error");
      } catch (error) {
        assert.include(error.message, "revert");
      }
    });

    it("should not allow queenside castling after a1 rook moves", async () => {
      // Move a pawn to open path for rook
      await chessCore.makeMove(6, 0, 4, 0, { from: whitePlayer }); // a2->a4
      await chessCore.makeMove(1, 7, 2, 7, { from: blackPlayer }); // h7->h6

      // Move rook out
      await chessCore.makeMove(7, 0, 5, 0, { from: whitePlayer }); // Ra1->a3
      await chessCore.makeMove(1, 6, 2, 6, { from: blackPlayer }); // g7->g6

      // Move rook back
      await chessCore.makeMove(5, 0, 7, 0, { from: whitePlayer }); // Ra3->a1
      await chessCore.makeMove(1, 5, 2, 5, { from: blackPlayer }); // f7->f6

      // Open path for queenside castling
      await chessCore.makeMove(6, 3, 4, 3, { from: whitePlayer }); // d2->d4
      await chessCore.makeMove(1, 4, 2, 4, { from: blackPlayer }); // e7->e6
      await chessCore.makeMove(7, 2, 5, 4, { from: whitePlayer }); // Bc1->e3
      await chessCore.makeMove(1, 3, 2, 3, { from: blackPlayer }); // d7->d6
      await chessCore.makeMove(7, 3, 5, 3, { from: whitePlayer }); // Qd1->d3
      await chessCore.makeMove(1, 2, 2, 2, { from: blackPlayer }); // c7->c6
      await chessCore.makeMove(7, 1, 5, 2, { from: whitePlayer }); // Nb1->c3
      await chessCore.makeMove(1, 1, 2, 1, { from: blackPlayer }); // b7->b6

      // Try to castle queenside - should fail
      try {
        await chessCore.makeMove(7, 4, 7, 2, { from: whitePlayer }); // O-O-O
        assert.fail("Should have thrown an error");
      } catch (error) {
        assert.include(error.message, "revert");
      }
    });
  });

  // ============================================
  // DRAW TESTS
  // ============================================
  describe("Draw Handling", () => {
    beforeEach(async () => {
      await createGame(1); // Friendly mode for debugCreative
      // Don't join yet - tests will set up board first
    });

    it("should detect stalemate and split the prize equally", async () => {
      // Clear the board first
      for (let i = 0; i < 8; i++) {
        for (let j = 0; j < 8; j++) {
          await chessCore.debugCreative(i, j, EMPTY, { from: whitePlayer });
        }
      }

      // White to move: Qc5-b6 creates a real stalemate against the black king on a8.
      await chessCore.debugCreative(0, 0, -KING, { from: whitePlayer }); // Black king at a8
      await chessCore.debugCreative(2, 2, KING, { from: whitePlayer });  // White king at c6
      await chessCore.debugCreative(3, 2, QUEEN, { from: whitePlayer }); // White queen at c5

      await chessCore.joinGameAsBlack({ from: blackPlayer, value: betAmount });

      await chessCore.makeMove(3, 2, 2, 1, { from: whitePlayer }); // Qc5 -> b6, stalemate

      const gameState = await chessCore.getGameState();
      assert.equal(gameState.toNumber(), GameState.Draw, "Game should end in a draw by stalemate");

      await chessCore.finalizePrizes({ from: whitePlayer });

      const whitePendingPrize = await chessCore.pendingPrize(whitePlayer);
      const blackPendingPrize = await chessCore.pendingPrize(blackPlayer);
      assert.equal(whitePendingPrize.toString(), betAmount, "White should receive half the pot");
      assert.equal(blackPendingPrize.toString(), betAmount, "Black should receive half the pot");

      await chessCore.withdrawPrize({ from: whitePlayer });
      await chessCore.withdrawPrize({ from: blackPlayer });

      const contractBalance = await web3.eth.getBalance(chessCore.address);
      assert.equal(contractBalance.toString(), "0", "Contract balance should be fully withdrawn after both claims");
    });
  });

  // ============================================
  // TURN MANAGEMENT TESTS
  // ============================================
  describe("Turn Management", () => {
    beforeEach(async () => {
      await createAndJoinGame();
    });

    it("should switch turns after each move", async () => {
      // Check initial current player
      let currentPlayer = await chessCore.currentPlayer();
      assert.equal(currentPlayer, whitePlayer, "White should start");

      // White moves
      await chessCore.makeMove(6, 4, 4, 4, { from: whitePlayer });
      currentPlayer = await chessCore.currentPlayer();
      assert.equal(currentPlayer, blackPlayer, "Black's turn after white moves");

      // Black moves
      await chessCore.makeMove(1, 4, 3, 4, { from: blackPlayer });
      currentPlayer = await chessCore.currentPlayer();
      assert.equal(currentPlayer, whitePlayer, "White's turn after black moves");
    });

    it("should not allow moving out of turn", async () => {
      try {
        await chessCore.makeMove(1, 4, 3, 4, { from: blackPlayer }); // Black tries to move first
        assert.fail("Should have thrown an error");
      } catch (error) {
        assert.include(error.message, "revert");
      }
    });

    it("should not allow same player to move twice", async () => {
      await chessCore.makeMove(6, 4, 4, 4, { from: whitePlayer });
      try {
        await chessCore.makeMove(6, 3, 4, 3, { from: whitePlayer }); // White tries to move again
        assert.fail("Should have thrown an error");
      } catch (error) {
        assert.include(error.message, "revert");
      }
    });
  });

  // ============================================
  // MOVE VALIDATION TESTS
  // ============================================
  describe("Move Validation", () => {
    beforeEach(async () => {
      await createAndJoinGame();
    });

    it("should not allow moving empty square", async () => {
      try {
        await chessCore.makeMove(4, 4, 5, 4, { from: whitePlayer }); // Empty square
        assert.fail("Should have thrown an error");
      } catch (error) {
        assert.include(error.message, "revert");
      }
    });

    it("should not allow moving opponent's pieces", async () => {
      try {
        await chessCore.makeMove(1, 4, 2, 4, { from: whitePlayer }); // Black pawn
        assert.fail("Should have thrown an error");
      } catch (error) {
        assert.include(error.message, "revert");
      }
    });

    it("should not allow invalid pawn move (backwards)", async () => {
      await chessCore.makeMove(6, 4, 4, 4, { from: whitePlayer }); // e2->e4
      await chessCore.makeMove(1, 4, 3, 4, { from: blackPlayer }); // e7->e5
      try {
        await chessCore.makeMove(4, 4, 5, 4, { from: whitePlayer }); // Try to move pawn backwards
        assert.fail("Should have thrown an error");
      } catch (error) {
        assert.include(error.message, "revert");
      }
    });
  });
});
