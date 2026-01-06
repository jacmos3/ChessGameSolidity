const ChessFactory = artifacts.require("ChessFactory");
const ChessCore = artifacts.require("ChessCore");

contract("ChessCore - En Passant and Pawn Promotion", (accounts) => {
  const whitePlayer = accounts[0];
  const blackPlayer = accounts[1];
  const betAmount = web3.utils.toWei("0.1", "ether");

  // Piece constants (matching ChessMediaLibrary)
  const EMPTY = 0;
  const PAWN = 1;
  const KNIGHT = 2;
  const BISHOP = 3;
  const ROOK = 4;
  const QUEEN = 5;
  const KING = 6;

  // Board positions
  // Row 0 = black pieces, Row 1 = black pawns
  // Row 6 = white pawns, Row 7 = white pieces
  // White moves UP (row decreases), Black moves DOWN (row increases)

  let chessFactory;
  let chessCore;

  // Helper to create a fresh game
  async function createGame() {
    chessFactory = await ChessFactory.new();

    // TimeoutPreset: 0=Blitz, 1=Rapid, 2=Classical
    await chessFactory.createChessGame(2, 0, {
      from: whitePlayer,
      value: betAmount
    });

    const deployedGames = await chessFactory.getDeployedChessGames();
    const chessCoreAddress = deployedGames[deployedGames.length - 1];
    chessCore = await ChessCore.at(chessCoreAddress);
  }

  describe("En Passant", () => {
    beforeEach(async () => {
      await createGame();
      await chessCore.joinGameAsBlack({
        from: blackPlayer,
        value: betAmount
      });
    });

    it("should allow white to capture black pawn en passant", async () => {
      // Setup: Get white pawn to row 3 (index 3), then black does double move

      // 1. White pawn e2->e4 (row 6, col 4) -> (row 4, col 4)
      await chessCore.makeMove(6, 4, 4, 4, { from: whitePlayer });

      // 2. Black pawn a7->a6 (row 1, col 0) -> (row 2, col 0) - any move
      await chessCore.makeMove(1, 0, 2, 0, { from: blackPlayer });

      // 3. White pawn e4->e5 (row 4, col 4) -> (row 3, col 4)
      await chessCore.makeMove(4, 4, 3, 4, { from: whitePlayer });

      // 4. Black pawn d7->d5 (row 1, col 3) -> (row 3, col 3) - double move next to white pawn
      await chessCore.makeMove(1, 3, 3, 3, { from: blackPlayer });

      // 5. White captures en passant: e5->d6 (row 3, col 4) -> (row 2, col 3)
      await chessCore.makeMove(3, 4, 2, 3, { from: whitePlayer });

      // Verify: Black pawn at d5 (row 3, col 3) should be captured (empty)
      const capturedSquare = await chessCore.board(3, 3);
      assert.equal(capturedSquare.toNumber(), EMPTY, "Black pawn should be captured");

      // Verify: White pawn should be at d6 (row 2, col 3)
      const whitePawnSquare = await chessCore.board(2, 3);
      assert.equal(whitePawnSquare.toNumber(), PAWN, "White pawn should be at d6");
    });

    it("should allow black to capture white pawn en passant", async () => {
      // 1. White pawn a2->a3 (row 6, col 0) -> (row 5, col 0)
      await chessCore.makeMove(6, 0, 5, 0, { from: whitePlayer });

      // 2. Black pawn d7->d5 (row 1, col 3) -> (row 3, col 3)
      await chessCore.makeMove(1, 3, 3, 3, { from: blackPlayer });

      // 3. White pawn a3->a4 (row 5, col 0) -> (row 4, col 0)
      await chessCore.makeMove(5, 0, 4, 0, { from: whitePlayer });

      // 4. Black pawn d5->d4 (row 3, col 3) -> (row 4, col 3)
      await chessCore.makeMove(3, 3, 4, 3, { from: blackPlayer });

      // 5. White pawn e2->e4 (row 6, col 4) -> (row 4, col 4) - double move next to black pawn
      await chessCore.makeMove(6, 4, 4, 4, { from: whitePlayer });

      // 6. Black captures en passant: d4->e3 (row 4, col 3) -> (row 5, col 4)
      await chessCore.makeMove(4, 3, 5, 4, { from: blackPlayer });

      // Verify: White pawn at e4 (row 4, col 4) should be captured (empty)
      const capturedSquare = await chessCore.board(4, 4);
      assert.equal(capturedSquare.toNumber(), EMPTY, "White pawn should be captured");

      // Verify: Black pawn should be at e3 (row 5, col 4)
      const blackPawnSquare = await chessCore.board(5, 4);
      assert.equal(blackPawnSquare.toNumber(), -PAWN, "Black pawn should be at e3");
    });

    it("should not allow en passant if not immediately after double move", async () => {
      // 1. White pawn e2->e4
      await chessCore.makeMove(6, 4, 4, 4, { from: whitePlayer });

      // 2. Black pawn a7->a6
      await chessCore.makeMove(1, 0, 2, 0, { from: blackPlayer });

      // 3. White pawn e4->e5
      await chessCore.makeMove(4, 4, 3, 4, { from: whitePlayer });

      // 4. Black pawn d7->d5 (double move)
      await chessCore.makeMove(1, 3, 3, 3, { from: blackPlayer });

      // 5. White makes a different move (pawn b2->b3)
      await chessCore.makeMove(6, 1, 5, 1, { from: whitePlayer });

      // 6. Black makes a move
      await chessCore.makeMove(2, 0, 3, 0, { from: blackPlayer });

      // 7. White tries en passant - should fail (too late)
      try {
        await chessCore.makeMove(3, 4, 2, 3, { from: whitePlayer });
        assert.fail("Should have thrown an error - en passant no longer valid");
      } catch (error) {
        assert.include(error.message, "revert");
      }
    });
  });

  describe("Pawn Promotion", () => {
    // For promotion tests, we need to use debugCreative BEFORE joining the game
    beforeEach(async () => {
      await createGame();
      // Note: We do NOT join as black here - tests will set up board first
    });

    it("should promote white pawn to queen by default", async () => {
      // Setup board with white pawn at row 1, col 0 (a7) - away from black king
      // Clear a8 (row 0, col 0) which has black rook
      await chessCore.debugCreative(0, 0, EMPTY, { from: whitePlayer }); // Clear a8
      await chessCore.debugCreative(1, 0, PAWN, { from: whitePlayer });  // Place white pawn at a7

      // Now join the game
      await chessCore.joinGameAsBlack({ from: blackPlayer, value: betAmount });

      // White moves the pawn from a7 to a8 (row 1 -> row 0)
      await chessCore.makeMove(1, 0, 0, 0, { from: whitePlayer });

      // Verify pawn is promoted to queen
      const promotedPiece = await chessCore.board(0, 0);
      assert.equal(promotedPiece.toNumber(), QUEEN, "Pawn should be promoted to Queen");
    });

    it("should promote white pawn to knight using makeMoveWithPromotion", async () => {
      // Setup board with white pawn at a7
      await chessCore.debugCreative(0, 0, EMPTY, { from: whitePlayer });
      await chessCore.debugCreative(1, 0, PAWN, { from: whitePlayer });

      await chessCore.joinGameAsBlack({ from: blackPlayer, value: betAmount });

      // Promote to knight
      await chessCore.makeMoveWithPromotion(1, 0, 0, 0, KNIGHT, { from: whitePlayer });

      const promotedPiece = await chessCore.board(0, 0);
      assert.equal(promotedPiece.toNumber(), KNIGHT, "Pawn should be promoted to Knight");
    });

    it("should promote white pawn to rook using makeMoveWithPromotion", async () => {
      await chessCore.debugCreative(0, 0, EMPTY, { from: whitePlayer });
      await chessCore.debugCreative(1, 0, PAWN, { from: whitePlayer });

      await chessCore.joinGameAsBlack({ from: blackPlayer, value: betAmount });

      await chessCore.makeMoveWithPromotion(1, 0, 0, 0, ROOK, { from: whitePlayer });

      const promotedPiece = await chessCore.board(0, 0);
      assert.equal(promotedPiece.toNumber(), ROOK, "Pawn should be promoted to Rook");
    });

    it("should promote white pawn to bishop using makeMoveWithPromotion", async () => {
      await chessCore.debugCreative(0, 0, EMPTY, { from: whitePlayer });
      await chessCore.debugCreative(1, 0, PAWN, { from: whitePlayer });

      await chessCore.joinGameAsBlack({ from: blackPlayer, value: betAmount });

      await chessCore.makeMoveWithPromotion(1, 0, 0, 0, BISHOP, { from: whitePlayer });

      const promotedPiece = await chessCore.board(0, 0);
      assert.equal(promotedPiece.toNumber(), BISHOP, "Pawn should be promoted to Bishop");
    });

    it("should promote black pawn to queen", async () => {
      // Setup board with black pawn at row 6 (one move from promotion)
      await chessCore.debugCreative(6, 4, -PAWN, { from: whitePlayer });
      await chessCore.debugCreative(7, 4, EMPTY, { from: whitePlayer }); // Clear e1

      await chessCore.joinGameAsBlack({ from: blackPlayer, value: betAmount });

      // First white makes a move
      await chessCore.makeMove(6, 0, 5, 0, { from: whitePlayer });

      // Black moves pawn from e2 to e1 (row 6 -> row 7)
      await chessCore.makeMove(6, 4, 7, 4, { from: blackPlayer });

      // Verify pawn is promoted to queen (negative value for black)
      const promotedPiece = await chessCore.board(7, 4);
      assert.equal(promotedPiece.toNumber(), -QUEEN, "Black pawn should be promoted to Queen");
    });

    it("should not allow promotion to king", async () => {
      await chessCore.debugCreative(1, 4, PAWN, { from: whitePlayer });
      await chessCore.debugCreative(0, 4, EMPTY, { from: whitePlayer });

      await chessCore.joinGameAsBlack({ from: blackPlayer, value: betAmount });

      try {
        await chessCore.makeMoveWithPromotion(1, 4, 0, 4, KING, { from: whitePlayer });
        assert.fail("Should have thrown an error");
      } catch (error) {
        assert.include(error.message, "revert");
      }
    });

    it("should not allow promotion to pawn", async () => {
      await chessCore.debugCreative(1, 4, PAWN, { from: whitePlayer });
      await chessCore.debugCreative(0, 4, EMPTY, { from: whitePlayer });

      await chessCore.joinGameAsBlack({ from: blackPlayer, value: betAmount });

      try {
        await chessCore.makeMoveWithPromotion(1, 4, 0, 4, PAWN, { from: whitePlayer });
        assert.fail("Should have thrown an error");
      } catch (error) {
        assert.include(error.message, "revert");
      }
    });

    it("should allow promotion while capturing", async () => {
      // Setup: white pawn at row 1, black piece at row 0 diagonally
      await chessCore.debugCreative(1, 4, PAWN, { from: whitePlayer }); // White pawn at e7
      await chessCore.debugCreative(0, 5, -ROOK, { from: whitePlayer }); // Black rook at f8

      await chessCore.joinGameAsBlack({ from: blackPlayer, value: betAmount });

      // White captures and promotes: e7->f8
      await chessCore.makeMoveWithPromotion(1, 4, 0, 5, QUEEN, { from: whitePlayer });

      const promotedPiece = await chessCore.board(0, 5);
      assert.equal(promotedPiece.toNumber(), QUEEN, "Pawn should be promoted to Queen after capture");
    });
  });

  describe("Integration - En Passant edge cases", () => {
    beforeEach(async () => {
      await createGame();
      await chessCore.joinGameAsBlack({
        from: blackPlayer,
        value: betAmount
      });
    });

    it("should only allow en passant on correct column", async () => {
      // Setup en passant situation
      await chessCore.makeMove(6, 4, 4, 4, { from: whitePlayer }); // e2->e4
      await chessCore.makeMove(1, 0, 2, 0, { from: blackPlayer }); // a7->a6
      await chessCore.makeMove(4, 4, 3, 4, { from: whitePlayer }); // e4->e5
      await chessCore.makeMove(1, 3, 3, 3, { from: blackPlayer }); // d7->d5 (enables en passant on col 3)

      // Try en passant on wrong column (f6 instead of d6)
      try {
        await chessCore.makeMove(3, 4, 2, 5, { from: whitePlayer });
        assert.fail("Should not allow en passant on wrong column");
      } catch (error) {
        assert.include(error.message, "revert");
      }
    });
  });
});
