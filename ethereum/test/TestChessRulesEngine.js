const ChessRulesEngine = artifacts.require("ChessRulesEngine");

contract("ChessRulesEngine regressions", () => {
  const EMPTY = 0;
  const PAWN = 1;
  const KNIGHT = 2;
  const ROOK = 4;
  const QUEEN = 5;
  const KING = 6;

  let rulesEngine;

  const emptyBoard = () => Array.from({ length: 8 }, () => Array(8).fill(EMPTY));

  beforeEach(async () => {
    rulesEngine = await ChessRulesEngine.new();
  });

  it("rejects a two-square pawn move when the intermediate square is occupied", async () => {
    const board = emptyBoard();
    board[6][4] = PAWN;
    board[5][4] = -ROOK;

    const isValid = await rulesEngine.isValidMoveView(board, -1, 0, 0, 6, 4, 4, 4);

    assert.isFalse(isValid, "A pawn cannot jump over an occupied square");
  });

  it("rejects castling through an attacked transit square", async () => {
    const board = emptyBoard();
    board[7][4] = KING;
    board[7][7] = ROOK;
    board[0][0] = -KING;
    board[0][5] = -ROOK;

    const isValid = await rulesEngine.isValidMoveView(board, -1, 0, 0, 7, 4, 7, 6);

    assert.isFalse(isValid, "The king cannot castle through check on f1");
  });

  it("rejects a castling-shaped king move to another rank", async () => {
    const board = emptyBoard();
    board[7][4] = KING;
    board[7][7] = ROOK;
    board[0][4] = -KING;

    const isValid = await rulesEngine.isValidMoveView(board, -1, 0, 0, 7, 4, 6, 6);

    assert.isFalse(isValid, "Castling cannot move the king from e1 to g2");
  });

  it("does not let castling overwrite a friendly destination", async () => {
    const board = emptyBoard();
    board[7][4] = KING;
    board[7][7] = ROOK;
    board[7][6] = KNIGHT;
    board[0][4] = -KING;

    const isValid = await rulesEngine.isValidMoveView(board, -1, 0, 0, 7, 4, 7, 6);

    assert.isFalse(isValid, "A castling branch must never bypass friendly-target protection");
  });

  it("detects a discovered rook check caused by an en passant capture", async () => {
    const board = emptyBoard();
    board[3][4] = KING;
    board[3][5] = PAWN;
    board[3][6] = -PAWN;
    board[3][7] = -ROOK;
    board[0][0] = -KING;

    const leavesKingInCheck = await rulesEngine.wouldMoveLeaveKingInCheck(
      board,
      3,
      4,
      0,
      0,
      3,
      5,
      2,
      6
    );

    assert.isTrue(leavesKingInCheck, "Removing the captured pawn must expose the rook attack");
  });

  it("recognizes checkmate when the checking piece is protected", async () => {
    const board = emptyBoard();
    board[0][0] = -KING;
    board[1][1] = QUEEN;
    board[2][2] = KING;

    const result = await rulesEngine.detectCheckState(
      board,
      true,
      false,
      false,
      2,
      2,
      0,
      0,
      -1,
      0,
      0,
      1,
      1
    );

    assert.isTrue(result.isMate, "Black cannot capture the protected queen on b7");
    assert.equal(result.newState.toString(), "3", "White should win by checkmate");
  });

  it("keeps terminal-state legal-move scanning within its gas budget", async () => {
    const board = emptyBoard();
    board[0][0] = -KING;
    board[1][1] = QUEEN;
    board[2][2] = KING;

    const tx = await rulesEngine.detectCheckState.sendTransaction(
      board,
      true,
      false,
      false,
      2,
      2,
      0,
      0,
      -1,
      0,
      0,
      1,
      1,
      { gas: 1000000 }
    );

    assert.isBelow(tx.receipt.gasUsed, 1000000, "Terminal-state scan exceeded the gas budget");
  });
});
