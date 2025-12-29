const ChessFactory = artifacts.require("ChessFactory");
const ChessCore = artifacts.require("ChessCore");

contract("ChessCore - Piece Movements", (accounts) => {
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

  // Row constants
  const ROW_BLACK_PIECES = 0;
  const ROW_BLACK_PAWNS = 1;
  const ROW_WHITE_PAWNS = 6;
  const ROW_WHITE_PIECES = 7;

  // Column constants
  const COL_A = 0;
  const COL_B = 1;
  const COL_C = 2;
  const COL_D = 3;
  const COL_E = 4;
  const COL_F = 5;
  const COL_G = 6;
  const COL_H = 7;

  let chessFactory;
  let chessCore;

  beforeEach(async () => {
    chessFactory = await ChessFactory.new();

    await chessFactory.createChessGame({
      from: whitePlayer,
      value: betAmount
    });

    const deployedGames = await chessFactory.getDeployedChessGames();
    const chessCoreAddress = deployedGames[deployedGames.length - 1];
    chessCore = await ChessCore.at(chessCoreAddress);

    await chessCore.joinGameAsBlack({
      from: blackPlayer,
      value: betAmount
    });
  });

  // ============================================
  // PAWN TESTS
  // ============================================
  describe("Pawn Movements", () => {
    it("should allow white pawn to move one square forward", async () => {
      // White pawn e2->e3 (row 6, col 4) -> (row 5, col 4)
      await chessCore.makeMove(6, 4, 5, 4, { from: whitePlayer });

      const pawnSquare = await chessCore.board(5, 4);
      assert.equal(pawnSquare.toNumber(), PAWN, "White pawn should be at e3");

      const originalSquare = await chessCore.board(6, 4);
      assert.equal(originalSquare.toNumber(), EMPTY, "e2 should be empty");
    });

    it("should allow white pawn to move two squares forward from starting position", async () => {
      // White pawn e2->e4 (row 6, col 4) -> (row 4, col 4)
      await chessCore.makeMove(6, 4, 4, 4, { from: whitePlayer });

      const pawnSquare = await chessCore.board(4, 4);
      assert.equal(pawnSquare.toNumber(), PAWN, "White pawn should be at e4");
    });

    it("should allow black pawn to move one square forward", async () => {
      // White moves first
      await chessCore.makeMove(6, 0, 5, 0, { from: whitePlayer });

      // Black pawn e7->e6 (row 1, col 4) -> (row 2, col 4)
      await chessCore.makeMove(1, 4, 2, 4, { from: blackPlayer });

      const pawnSquare = await chessCore.board(2, 4);
      assert.equal(pawnSquare.toNumber(), -PAWN, "Black pawn should be at e6");
    });

    it("should allow black pawn to move two squares forward from starting position", async () => {
      // White moves first
      await chessCore.makeMove(6, 0, 5, 0, { from: whitePlayer });

      // Black pawn e7->e5 (row 1, col 4) -> (row 3, col 4)
      await chessCore.makeMove(1, 4, 3, 4, { from: blackPlayer });

      const pawnSquare = await chessCore.board(3, 4);
      assert.equal(pawnSquare.toNumber(), -PAWN, "Black pawn should be at e5");
    });

    it("should not allow pawn to move two squares after leaving starting position", async () => {
      // White pawn e2->e3
      await chessCore.makeMove(6, 4, 5, 4, { from: whitePlayer });

      // Black moves
      await chessCore.makeMove(1, 0, 2, 0, { from: blackPlayer });

      // White tries e3->e5 (illegal - can't move 2 squares after first move)
      try {
        await chessCore.makeMove(5, 4, 3, 4, { from: whitePlayer });
        assert.fail("Should have thrown an error");
      } catch (error) {
        assert.include(error.message, "Invalid move");
      }
    });

    it("should allow pawn to capture diagonally", async () => {
      // Setup: Move pawns to create capture opportunity
      await chessCore.makeMove(6, 4, 4, 4, { from: whitePlayer }); // e2->e4
      await chessCore.makeMove(1, 3, 3, 3, { from: blackPlayer }); // d7->d5
      await chessCore.makeMove(4, 4, 3, 3, { from: whitePlayer }); // e4 captures d5

      const captureSquare = await chessCore.board(3, 3);
      assert.equal(captureSquare.toNumber(), PAWN, "White pawn should capture at d5");
    });

    it("should not allow pawn to move forward onto occupied square", async () => {
      await chessCore.makeMove(6, 4, 4, 4, { from: whitePlayer }); // e2->e4
      await chessCore.makeMove(1, 4, 3, 4, { from: blackPlayer }); // e7->e5

      // White tries e4->e5 (illegal - square occupied)
      try {
        await chessCore.makeMove(4, 4, 3, 4, { from: whitePlayer });
        assert.fail("Should have thrown an error");
      } catch (error) {
        assert.include(error.message, "Invalid move");
      }
    });

    it("should not allow pawn to capture forward", async () => {
      await chessCore.makeMove(6, 4, 4, 4, { from: whitePlayer }); // e2->e4
      await chessCore.makeMove(1, 4, 3, 4, { from: blackPlayer }); // e7->e5

      // White tries e4->e5 (not diagonal capture - illegal)
      try {
        await chessCore.makeMove(4, 4, 3, 4, { from: whitePlayer });
        assert.fail("Should have thrown an error");
      } catch (error) {
        assert.include(error.message, "Invalid move");
      }
    });

    it("should not allow pawn to move backward", async () => {
      await chessCore.makeMove(6, 4, 4, 4, { from: whitePlayer }); // e2->e4
      await chessCore.makeMove(1, 0, 2, 0, { from: blackPlayer }); // a7->a6

      // White tries e4->e5 (going backwards for white is row increase - not allowed)
      try {
        await chessCore.makeMove(4, 4, 5, 4, { from: whitePlayer });
        assert.fail("Should have thrown an error");
      } catch (error) {
        assert.include(error.message, "Invalid move");
      }
    });
  });

  // ============================================
  // KNIGHT TESTS
  // ============================================
  describe("Knight Movements", () => {
    it("should allow knight to move in L-shape (2 up, 1 right)", async () => {
      // White knight g1->f3 (row 7, col 6) -> (row 5, col 5)
      await chessCore.makeMove(7, 6, 5, 5, { from: whitePlayer });

      const knightSquare = await chessCore.board(5, 5);
      assert.equal(knightSquare.toNumber(), KNIGHT, "Knight should be at f3");
    });

    it("should allow knight to move in L-shape (2 up, 1 left)", async () => {
      // White knight g1->h3 (row 7, col 6) -> (row 5, col 7)
      await chessCore.makeMove(7, 6, 5, 7, { from: whitePlayer });

      const knightSquare = await chessCore.board(5, 7);
      assert.equal(knightSquare.toNumber(), KNIGHT, "Knight should be at h3");
    });

    it("should allow knight to move in L-shape (1 up, 2 right)", async () => {
      // First move knight to center
      await chessCore.makeMove(7, 6, 5, 5, { from: whitePlayer }); // Ng1->f3
      await chessCore.makeMove(1, 0, 2, 0, { from: blackPlayer }); // a7->a6

      // Knight f3->g5 (doesn't work from f3) - let's do f3->e5
      await chessCore.makeMove(5, 5, 3, 4, { from: whitePlayer }); // Nf3->e5

      const knightSquare = await chessCore.board(3, 4);
      assert.equal(knightSquare.toNumber(), KNIGHT, "Knight should be at e5");
    });

    it("should allow black knight to move", async () => {
      await chessCore.makeMove(7, 6, 5, 5, { from: whitePlayer }); // White Ng1->f3

      // Black knight b8->c6 (row 0, col 1) -> (row 2, col 2)
      await chessCore.makeMove(0, 1, 2, 2, { from: blackPlayer });

      const knightSquare = await chessCore.board(2, 2);
      assert.equal(knightSquare.toNumber(), -KNIGHT, "Black knight should be at c6");
    });

    it("should allow knight to jump over pieces", async () => {
      // Knight can jump over pawns from starting position
      await chessCore.makeMove(7, 1, 5, 2, { from: whitePlayer }); // Nb1->c3

      const knightSquare = await chessCore.board(5, 2);
      assert.equal(knightSquare.toNumber(), KNIGHT, "Knight should jump to c3");

      // Verify pawns are still in place
      const pawnB2 = await chessCore.board(6, 1);
      assert.equal(pawnB2.toNumber(), PAWN, "Pawn at b2 should still be there");
    });

    it("should not allow knight to move in non-L pattern", async () => {
      // Try to move knight straight
      try {
        await chessCore.makeMove(7, 6, 5, 6, { from: whitePlayer }); // Ng1->g3 (straight up)
        assert.fail("Should have thrown an error");
      } catch (error) {
        assert.include(error.message, "Invalid move");
      }
    });

    it("should allow knight to capture enemy piece", async () => {
      // Setup position where knight can capture
      await chessCore.makeMove(7, 6, 5, 5, { from: whitePlayer }); // Ng1->f3
      await chessCore.makeMove(1, 4, 3, 4, { from: blackPlayer }); // e7->e5
      await chessCore.makeMove(5, 5, 3, 4, { from: whitePlayer }); // Nf3 captures e5

      const captureSquare = await chessCore.board(3, 4);
      assert.equal(captureSquare.toNumber(), KNIGHT, "Knight should capture pawn at e5");
    });
  });

  // ============================================
  // BISHOP TESTS
  // ============================================
  describe("Bishop Movements", () => {
    it("should allow bishop to move diagonally", async () => {
      // First open a path for the bishop
      await chessCore.makeMove(6, 4, 4, 4, { from: whitePlayer }); // e2->e4
      await chessCore.makeMove(1, 0, 2, 0, { from: blackPlayer }); // a7->a6

      // White bishop f1->c4 (row 7, col 5) -> (row 4, col 2)
      await chessCore.makeMove(7, 5, 4, 2, { from: whitePlayer });

      const bishopSquare = await chessCore.board(4, 2);
      assert.equal(bishopSquare.toNumber(), BISHOP, "Bishop should be at c4");
    });

    it("should allow bishop to move multiple squares diagonally", async () => {
      // Open path and move bishop far
      await chessCore.makeMove(6, 4, 4, 4, { from: whitePlayer }); // e2->e4
      await chessCore.makeMove(1, 0, 2, 0, { from: blackPlayer }); // a7->a6
      await chessCore.makeMove(7, 5, 3, 1, { from: whitePlayer }); // Bf1->b5

      const bishopSquare = await chessCore.board(3, 1);
      assert.equal(bishopSquare.toNumber(), BISHOP, "Bishop should be at b5");
    });

    it("should not allow bishop to move straight", async () => {
      await chessCore.makeMove(6, 4, 4, 4, { from: whitePlayer }); // e2->e4
      await chessCore.makeMove(1, 0, 2, 0, { from: blackPlayer }); // a7->a6

      // Try to move bishop straight up
      try {
        await chessCore.makeMove(7, 5, 5, 5, { from: whitePlayer }); // Bf1->f3 (straight)
        assert.fail("Should have thrown an error");
      } catch (error) {
        assert.include(error.message, "Invalid move");
      }
    });

    it("should not allow bishop to jump over pieces", async () => {
      // Try to move bishop without opening path (pawn in the way)
      try {
        await chessCore.makeMove(7, 5, 5, 3, { from: whitePlayer }); // Bf1->d3 (blocked by pawn)
        assert.fail("Should have thrown an error");
      } catch (error) {
        assert.include(error.message, "Invalid move");
      }
    });

    it("should allow bishop to capture diagonally", async () => {
      await chessCore.makeMove(6, 4, 4, 4, { from: whitePlayer }); // e2->e4
      await chessCore.makeMove(1, 3, 3, 3, { from: blackPlayer }); // d7->d5
      await chessCore.makeMove(7, 5, 4, 2, { from: whitePlayer }); // Bf1->c4
      await chessCore.makeMove(1, 2, 2, 2, { from: blackPlayer }); // c7->c6
      await chessCore.makeMove(4, 2, 3, 3, { from: whitePlayer }); // Bc4 captures d5

      const captureSquare = await chessCore.board(3, 3);
      assert.equal(captureSquare.toNumber(), BISHOP, "Bishop should capture pawn at d5");
    });
  });

  // ============================================
  // ROOK TESTS
  // ============================================
  describe("Rook Movements", () => {
    it("should allow rook to move vertically after pawn clears path", async () => {
      // Open path by moving pawn
      await chessCore.makeMove(6, 7, 4, 7, { from: whitePlayer }); // h2->h4
      await chessCore.makeMove(1, 0, 2, 0, { from: blackPlayer }); // a7->a6

      // Move rook up
      await chessCore.makeMove(7, 7, 5, 7, { from: whitePlayer }); // Rh1->h3

      const rookSquare = await chessCore.board(5, 7);
      assert.equal(rookSquare.toNumber(), ROOK, "Rook should be at h3");
    });

    it("should allow rook to move horizontally", async () => {
      // Setup: move h pawn, then rook up, then rook sideways
      await chessCore.makeMove(6, 7, 4, 7, { from: whitePlayer }); // h2->h4
      await chessCore.makeMove(1, 0, 2, 0, { from: blackPlayer }); // a7->a6
      await chessCore.makeMove(7, 7, 5, 7, { from: whitePlayer }); // Rh1->h3
      await chessCore.makeMove(1, 1, 2, 1, { from: blackPlayer }); // b7->b6
      await chessCore.makeMove(5, 7, 5, 4, { from: whitePlayer }); // Rh3->e3

      const rookSquare = await chessCore.board(5, 4);
      assert.equal(rookSquare.toNumber(), ROOK, "Rook should be at e3");
    });

    it("should not allow rook to move diagonally", async () => {
      await chessCore.makeMove(6, 7, 4, 7, { from: whitePlayer }); // h2->h4
      await chessCore.makeMove(1, 0, 2, 0, { from: blackPlayer }); // a7->a6
      await chessCore.makeMove(7, 7, 5, 7, { from: whitePlayer }); // Rh1->h3
      await chessCore.makeMove(1, 1, 2, 1, { from: blackPlayer }); // b7->b6

      // Try diagonal move
      try {
        await chessCore.makeMove(5, 7, 4, 6, { from: whitePlayer }); // Rh3->g4 (diagonal)
        assert.fail("Should have thrown an error");
      } catch (error) {
        assert.include(error.message, "Invalid move");
      }
    });

    it("should not allow rook to jump over pieces", async () => {
      // Try to move rook through pawn
      try {
        await chessCore.makeMove(7, 0, 5, 0, { from: whitePlayer }); // Ra1->a3 (blocked by pawn)
        assert.fail("Should have thrown an error");
      } catch (error) {
        assert.include(error.message, "Invalid move");
      }
    });

    it("should allow rook to capture enemy piece", async () => {
      // Setup: get rook out and capture a black piece
      await chessCore.makeMove(6, 7, 4, 7, { from: whitePlayer }); // h2->h4
      await chessCore.makeMove(1, 6, 3, 6, { from: blackPlayer }); // g7->g5
      await chessCore.makeMove(4, 7, 3, 6, { from: whitePlayer }); // h4 captures g5

      const captureSquare = await chessCore.board(3, 6);
      assert.equal(captureSquare.toNumber(), PAWN, "White pawn should capture at g5");
    });
  });

  // ============================================
  // QUEEN TESTS
  // ============================================
  describe("Queen Movements", () => {
    it("should allow queen to move diagonally", async () => {
      // Open path for queen
      await chessCore.makeMove(6, 4, 4, 4, { from: whitePlayer }); // e2->e4
      await chessCore.makeMove(1, 0, 2, 0, { from: blackPlayer }); // a7->a6

      // Move queen diagonally through opened diagonal
      await chessCore.makeMove(7, 3, 3, 7, { from: whitePlayer }); // Qd1->h5

      const queenSquare = await chessCore.board(3, 7);
      assert.equal(queenSquare.toNumber(), QUEEN, "Queen should be at h5");
    });

    it("should allow queen to move vertically", async () => {
      // Open path for queen
      await chessCore.makeMove(6, 3, 4, 3, { from: whitePlayer }); // d2->d4
      await chessCore.makeMove(1, 0, 2, 0, { from: blackPlayer }); // a7->a6

      // Move queen vertically
      await chessCore.makeMove(7, 3, 5, 3, { from: whitePlayer }); // Qd1->d3

      const queenSquare = await chessCore.board(5, 3);
      assert.equal(queenSquare.toNumber(), QUEEN, "Queen should be at d3");
    });

    it("should allow queen to move horizontally", async () => {
      // Open path and get queen out
      await chessCore.makeMove(6, 3, 4, 3, { from: whitePlayer }); // d2->d4
      await chessCore.makeMove(1, 0, 2, 0, { from: blackPlayer }); // a7->a6
      await chessCore.makeMove(7, 3, 5, 3, { from: whitePlayer }); // Qd1->d3
      await chessCore.makeMove(1, 1, 2, 1, { from: blackPlayer }); // b7->b6

      // Move queen horizontally
      await chessCore.makeMove(5, 3, 5, 7, { from: whitePlayer }); // Qd3->h3

      const queenSquare = await chessCore.board(5, 7);
      assert.equal(queenSquare.toNumber(), QUEEN, "Queen should be at h3");
    });

    it("should not allow queen to move in L-shape like knight", async () => {
      await chessCore.makeMove(6, 3, 4, 3, { from: whitePlayer }); // d2->d4
      await chessCore.makeMove(1, 0, 2, 0, { from: blackPlayer }); // a7->a6
      await chessCore.makeMove(7, 3, 5, 3, { from: whitePlayer }); // Qd1->d3
      await chessCore.makeMove(1, 1, 2, 1, { from: blackPlayer }); // b7->b6

      // Try L-shape move (2 up, 1 right = knight move)
      try {
        await chessCore.makeMove(5, 3, 3, 4, { from: whitePlayer }); // Qd3->e5 (L-shape)
        assert.fail("Should have thrown an error");
      } catch (error) {
        assert.include(error.message, "Invalid move");
      }
    });

    it("should not allow queen to jump over pieces", async () => {
      // Try to move queen through pieces from starting position
      try {
        await chessCore.makeMove(7, 3, 4, 3, { from: whitePlayer }); // Qd1->d4 (blocked by pawn)
        assert.fail("Should have thrown an error");
      } catch (error) {
        assert.include(error.message, "Invalid move");
      }
    });

    it("should allow queen to capture", async () => {
      // Open path and capture enemy pawn with queen
      await chessCore.makeMove(6, 4, 4, 4, { from: whitePlayer }); // e2->e4
      await chessCore.makeMove(1, 3, 3, 3, { from: blackPlayer }); // d7->d5
      await chessCore.makeMove(4, 4, 3, 3, { from: whitePlayer }); // e4 captures d5
      await chessCore.makeMove(1, 2, 2, 2, { from: blackPlayer }); // c7->c6
      await chessCore.makeMove(7, 3, 3, 7, { from: whitePlayer }); // Qd1->h5
      await chessCore.makeMove(1, 5, 3, 5, { from: blackPlayer }); // f7->f5 (double move)

      // Queen captures f5 horizontally: h5 (3,7) to f5 (3,5), deltaX=0, deltaY=2
      await chessCore.makeMove(3, 7, 3, 5, { from: whitePlayer }); // Qh5->f5 (horizontal capture)

      const captureSquare = await chessCore.board(3, 5);
      assert.equal(captureSquare.toNumber(), QUEEN, "Queen should capture at f5");
    });
  });

  // ============================================
  // KING TESTS
  // ============================================
  describe("King Movements", () => {
    it("should allow king to move one square forward", async () => {
      // Open path for king
      await chessCore.makeMove(6, 4, 4, 4, { from: whitePlayer }); // e2->e4
      await chessCore.makeMove(1, 0, 2, 0, { from: blackPlayer }); // a7->a6

      // Move king up
      await chessCore.makeMove(7, 4, 6, 4, { from: whitePlayer }); // Ke1->e2

      const kingSquare = await chessCore.board(6, 4);
      assert.equal(kingSquare.toNumber(), KING, "King should be at e2");
    });

    it("should allow king to move diagonally one square", async () => {
      // Open path
      await chessCore.makeMove(6, 5, 4, 5, { from: whitePlayer }); // f2->f4
      await chessCore.makeMove(1, 0, 2, 0, { from: blackPlayer }); // a7->a6

      // Move king diagonally
      await chessCore.makeMove(7, 4, 6, 5, { from: whitePlayer }); // Ke1->f2

      const kingSquare = await chessCore.board(6, 5);
      assert.equal(kingSquare.toNumber(), KING, "King should be at f2");
    });

    it("should not allow king to move more than one square", async () => {
      await chessCore.makeMove(6, 4, 4, 4, { from: whitePlayer }); // e2->e4
      await chessCore.makeMove(1, 0, 2, 0, { from: blackPlayer }); // a7->a6

      // Try to move king 2 squares (non-castling)
      try {
        await chessCore.makeMove(7, 4, 5, 4, { from: whitePlayer }); // Ke1->e3 (2 squares)
        assert.fail("Should have thrown an error");
      } catch (error) {
        assert.include(error.message, "Invalid move");
      }
    });

    it("should allow king to capture adjacent enemy piece", async () => {
      // Get king out and set up capture
      await chessCore.makeMove(6, 4, 4, 4, { from: whitePlayer }); // e2->e4
      await chessCore.makeMove(1, 3, 3, 3, { from: blackPlayer }); // d7->d5
      await chessCore.makeMove(7, 4, 6, 4, { from: whitePlayer }); // Ke1->e2
      await chessCore.makeMove(3, 3, 4, 4, { from: blackPlayer }); // d5 captures e4
      await chessCore.makeMove(6, 4, 5, 4, { from: whitePlayer }); // Ke2->e3
      await chessCore.makeMove(1, 2, 2, 2, { from: blackPlayer }); // c7->c6

      // King captures pawn on e4
      await chessCore.makeMove(5, 4, 4, 4, { from: whitePlayer }); // Ke3 captures e4

      const captureSquare = await chessCore.board(4, 4);
      assert.equal(captureSquare.toNumber(), KING, "King should capture pawn at e4");
    });
  });

  // ============================================
  // CASTLING TESTS
  // ============================================
  describe("Castling", () => {
    it("should allow white kingside castling", async () => {
      // Open path for kingside castling by moving knight and bishop
      await chessCore.makeMove(7, 6, 5, 5, { from: whitePlayer }); // Ng1->f3
      await chessCore.makeMove(1, 0, 2, 0, { from: blackPlayer }); // a7->a6
      await chessCore.makeMove(6, 4, 4, 4, { from: whitePlayer }); // e2->e4
      await chessCore.makeMove(1, 1, 2, 1, { from: blackPlayer }); // b7->b6
      await chessCore.makeMove(7, 5, 4, 2, { from: whitePlayer }); // Bf1->c4
      await chessCore.makeMove(1, 2, 2, 2, { from: blackPlayer }); // c7->c6

      // Castle kingside: king e1->g1
      await chessCore.makeMove(7, 4, 7, 6, { from: whitePlayer });

      const kingSquare = await chessCore.board(7, 6);
      assert.equal(kingSquare.toNumber(), KING, "King should be at g1");

      const rookSquare = await chessCore.board(7, 5);
      assert.equal(rookSquare.toNumber(), ROOK, "Rook should be at f1");
    });

    it("should allow white queenside castling", async () => {
      // Open path for queenside castling
      await chessCore.makeMove(6, 3, 4, 3, { from: whitePlayer }); // d2->d4
      await chessCore.makeMove(1, 0, 2, 0, { from: blackPlayer }); // a7->a6
      await chessCore.makeMove(7, 2, 5, 4, { from: whitePlayer }); // Bc1->e3
      await chessCore.makeMove(1, 1, 2, 1, { from: blackPlayer }); // b7->b6
      await chessCore.makeMove(7, 3, 5, 3, { from: whitePlayer }); // Qd1->d3
      await chessCore.makeMove(1, 2, 2, 2, { from: blackPlayer }); // c7->c6
      await chessCore.makeMove(7, 1, 5, 2, { from: whitePlayer }); // Nb1->c3
      await chessCore.makeMove(1, 3, 2, 3, { from: blackPlayer }); // d7->d6

      // Castle queenside: king e1->c1
      await chessCore.makeMove(7, 4, 7, 2, { from: whitePlayer });

      const kingSquare = await chessCore.board(7, 2);
      assert.equal(kingSquare.toNumber(), KING, "King should be at c1");

      const rookSquare = await chessCore.board(7, 3);
      assert.equal(rookSquare.toNumber(), ROOK, "Rook should be at d1");
    });

    it("should allow black kingside castling", async () => {
      // White moves
      await chessCore.makeMove(6, 0, 5, 0, { from: whitePlayer }); // a2->a3

      // Black opens path for castling
      await chessCore.makeMove(0, 6, 2, 5, { from: blackPlayer }); // Ng8->f6
      await chessCore.makeMove(6, 1, 5, 1, { from: whitePlayer }); // b2->b3
      await chessCore.makeMove(1, 4, 3, 4, { from: blackPlayer }); // e7->e5
      await chessCore.makeMove(6, 2, 5, 2, { from: whitePlayer }); // c2->c3
      await chessCore.makeMove(0, 5, 1, 4, { from: blackPlayer }); // Bf8->e7
      await chessCore.makeMove(6, 3, 5, 3, { from: whitePlayer }); // d2->d3

      // Black castles kingside
      await chessCore.makeMove(0, 4, 0, 6, { from: blackPlayer });

      const kingSquare = await chessCore.board(0, 6);
      assert.equal(kingSquare.toNumber(), -KING, "Black king should be at g8");

      const rookSquare = await chessCore.board(0, 5);
      assert.equal(rookSquare.toNumber(), -ROOK, "Black rook should be at f8");
    });

    it("should not allow castling if king has moved", async () => {
      // Open path
      await chessCore.makeMove(7, 6, 5, 5, { from: whitePlayer }); // Ng1->f3
      await chessCore.makeMove(1, 0, 2, 0, { from: blackPlayer }); // a7->a6
      await chessCore.makeMove(6, 4, 4, 4, { from: whitePlayer }); // e2->e4
      await chessCore.makeMove(1, 1, 2, 1, { from: blackPlayer }); // b7->b6
      await chessCore.makeMove(7, 5, 4, 2, { from: whitePlayer }); // Bf1->c4
      await chessCore.makeMove(1, 2, 2, 2, { from: blackPlayer }); // c7->c6

      // Move king and back
      await chessCore.makeMove(7, 4, 6, 4, { from: whitePlayer }); // Ke1->e2
      await chessCore.makeMove(1, 3, 2, 3, { from: blackPlayer }); // d7->d6
      await chessCore.makeMove(6, 4, 7, 4, { from: whitePlayer }); // Ke2->e1
      await chessCore.makeMove(1, 4, 2, 4, { from: blackPlayer }); // e7->e6

      // Try to castle (should fail - king has moved)
      try {
        await chessCore.makeMove(7, 4, 7, 6, { from: whitePlayer });
        assert.fail("Should have thrown an error");
      } catch (error) {
        assert.include(error.message, "revert");
      }
    });

    it("should not allow castling through pieces", async () => {
      // Don't clear the path - pieces still there
      try {
        await chessCore.makeMove(7, 4, 7, 6, { from: whitePlayer }); // Try to castle through pieces
        assert.fail("Should have thrown an error");
      } catch (error) {
        assert.include(error.message, "Invalid move");
      }
    });
  });

  // ============================================
  // GENERAL MOVEMENT TESTS
  // ============================================
  describe("General Movement Rules", () => {
    it("should not allow moving opponent's pieces", async () => {
      try {
        await chessCore.makeMove(1, 4, 3, 4, { from: whitePlayer }); // Try to move black pawn
        assert.fail("Should have thrown an error");
      } catch (error) {
        assert.include(error.message, "You can only move your own pieces");
      }
    });

    it("should not allow moving when not your turn", async () => {
      await chessCore.makeMove(6, 4, 4, 4, { from: whitePlayer }); // White moves

      try {
        await chessCore.makeMove(6, 3, 4, 3, { from: whitePlayer }); // White tries to move again
        assert.fail("Should have thrown an error");
      } catch (error) {
        assert.include(error.message, "It's not your turn");
      }
    });

    it("should not allow capturing own pieces", async () => {
      // Setup: try to move knight onto own pawn
      try {
        await chessCore.makeMove(7, 6, 6, 4, { from: whitePlayer }); // Ng1->e2 (own pawn there)
        assert.fail("Should have thrown an error");
      } catch (error) {
        assert.include(error.message, "Invalid move");
      }
    });

    it("should properly alternate turns", async () => {
      await chessCore.makeMove(6, 4, 4, 4, { from: whitePlayer }); // White

      const currentPlayer1 = await chessCore.currentPlayer();
      assert.equal(currentPlayer1, blackPlayer, "Should be black's turn");

      await chessCore.makeMove(1, 4, 3, 4, { from: blackPlayer }); // Black

      const currentPlayer2 = await chessCore.currentPlayer();
      assert.equal(currentPlayer2, whitePlayer, "Should be white's turn again");
    });
  });
});
