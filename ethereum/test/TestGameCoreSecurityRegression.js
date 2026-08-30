const ChessCore = artifacts.require("ChessCore");
const ChessCoreSecurityHarness = artifacts.require("ChessCoreSecurityHarness");
const ChessFactory = artifacts.require("ChessFactory");
const ChessRulesEngine = artifacts.require("ChessRulesEngine");
const ChessMediaLibrary = artifacts.require("ChessMediaLibrary");
const FlakyPlayerRating = artifacts.require("FlakyPlayerRating");

contract("ChessCore security regressions", (accounts) => {
  const [white, black, thirdParty] = accounts;
  const bet = web3.utils.toWei("0.01", "ether");

  const EMPTY = 0;
  const PAWN = 1;
  const KNIGHT = 2;
  const ROOK = 4;
  const KING = 6;

  const state = {
    InProgress: 2,
    Draw: 3,
    WhiteWins: 4,
    BlackWins: 5
  };
  const eventState = {
    NotStarted: 0,
    InProgress: 1,
    Draw: 2,
    WhiteWins: 3,
    BlackWins: 4
  };

  before(async () => {
    const mediaLibrary = await ChessMediaLibrary.deployed();
    ChessCoreSecurityHarness.link("ChessMediaLibrary", mediaLibrary.address);
  });

  async function expectRevert(promise, label) {
	let reverted = false;
    try {
      await promise;
    } catch (error) {
	  reverted = true;
      assert.include(error.message, "revert", label);
    }
	assert.isTrue(reverted, `${label}: expected revert`);
  }

  async function createHarnessGame(mode = 1) {
    const implementation = await ChessCoreSecurityHarness.new({ from: white });
    const factory = await ChessFactory.new(implementation.address, { from: white });
    const tx = await factory.createChessGame(2, mode, { from: white, value: bet });
    const address = tx.logs.find((log) => log.event === "GameCreated").args.gameAddress;
    return ChessCoreSecurityHarness.at(address);
  }

  async function joinCustomized(game) {
    const setupHash = await game.getBoardSetupHash();
    await game.joinGameAsBlackConfirmingBoard(setupHash, { from: black, value: bet });
  }

  async function clearStandardPieces(game) {
    for (const row of [0, 1, 6, 7]) {
      for (let col = 0; col < 8; col++) {
        await game.debugCreative(row, col, EMPTY, { from: white });
      }
    }
  }

  describe("Friendly setup canonicalization", () => {
    it("derives king caches from the final board and produces no hidden-state hash", async () => {
      const game = await createHarnessGame(1);
      const originalHash = await game.getBoardSetupHash();

      await game.debugCreative(5, 2, -KING, { from: white });
      await expectRevert(
        game.getBoardSetupHash(),
        "a setup with two black kings must not be confirmable"
      );

      await game.debugCreative(5, 2, EMPTY, { from: white });
      const restoredHash = await game.getBoardSetupHash();
      assert.equal(restoredHash, originalHash, "the same canonical board must restore the same hash");

      await game.joinGameAsBlackConfirmingBoard(restoredHash, { from: black, value: bet });
      const cached = await game.getCachedKingsForTest();
      assert.deepEqual(
        [cached[0], cached[1], cached[2], cached[3]].map((value) => value.toString()),
        ["7", "4", "0", "4"],
        "join must rebuild both king caches from the accepted board"
      );
    });

    it("requires exactly one king of each color", async () => {
      const game = await createHarnessGame(1);
      await game.debugCreative(0, 4, EMPTY, { from: white });

      await expectRevert(game.getBoardSetupHash(), "missing black king");
      await expectRevert(
        game.joinGameAsBlackConfirmingBoard(web3.utils.randomHex(32), { from: black, value: bet }),
        "an invalid setup must not be joinable"
      );
    });

    it("binds setup confirmations to the concrete game contract", async () => {
      const first = await createHarnessGame(1);
      const second = await createHarnessGame(1);
      const firstHash = await first.getBoardSetupHash();
      const secondHash = await second.getBoardSetupHash();

      assert.notEqual(firstHash, secondHash, "identical boards in different games need distinct approvals");
      await expectRevert(
        second.joinGameAsBlackConfirmingBoard(firstHash, { from: black, value: bet }),
        "a setup approval cannot be replayed against another game"
      );
    });

    it("rejects every out-of-domain custom piece before it reaches storage", async () => {
      const game = await createHarnessGame(1);

      for (const invalidPiece of [-128, -7, 7, 127]) {
        await expectRevert(
          game.debugCreative(4, 4, invalidPiece, { from: white }),
          `piece ${invalidPiece}`
        );
      }
    });

    it("seeds repetition history from the custom initial position only at join", async () => {
      const game = await createHarnessGame(1);
      await clearStandardPieces(game);
      await game.debugCreative(7, 4, KING, { from: white });
      await game.debugCreative(7, 6, KNIGHT, { from: white });
      await game.debugCreative(0, 4, -KING, { from: white });
      await game.debugCreative(0, 6, -KNIGHT, { from: white });

      const beforeJoin = await game.getDrawRuleStatus();
      assert.equal(beforeJoin.maxRepetitions.toString(), "0", "setup edits are not played positions");

      await joinCustomized(game);
      let drawStatus = await game.getDrawRuleStatus();
      assert.equal(drawStatus.maxRepetitions.toString(), "1", "the finalized setup is occurrence one");

      for (let cycle = 0; cycle < 2; cycle++) {
        await game.makeMove(7, 6, 5, 5, { from: white });
        await game.makeMove(0, 6, 2, 5, { from: black });
        await game.makeMove(5, 5, 7, 6, { from: white });
        await game.makeMove(2, 5, 0, 6, { from: black });
      }

      drawStatus = await game.getDrawRuleStatus();
      assert.equal(drawStatus.maxRepetitions.toString(), "3", "two returns make three real occurrences");
      await game.claimDrawByRepetition({ from: white });
      assert.equal((await game.getGameState()).toString(), state.Draw.toString());
    });

    it("seeds a setup restored to the standard board exactly once", async () => {
      const game = await createHarnessGame(1);
      const originalHash = await game.getBoardSetupHash();

      await game.debugCreative(4, 4, KNIGHT, { from: white });
      await game.debugCreative(4, 4, EMPTY, { from: white });
      assert.equal(await game.getBoardSetupHash(), originalHash, "the board must be restored exactly");

      const beforeJoin = await game.getDrawRuleStatus();
      assert.equal(beforeJoin.maxRepetitions.toString(), "0", "setup edits are not positions");

      await joinCustomized(game);
      const afterJoin = await game.getDrawRuleStatus();
      assert.equal(afterJoin.maxRepetitions.toString(), "1", "the restored setup is seeded once");
      await expectRevert(
        game.claimDrawByRepetition({ from: black }),
        "restoring the setup must not manufacture repetition history"
      );
    });

    it("treats a non-capturable en-passant marker as the same repetition position", async () => {
      const game = await createHarnessGame(1);
      await game.joinGameAsBlack({ from: black, value: bet });

      await game.makeMove(6, 4, 4, 4, { from: white });
      for (let cycle = 0; cycle < 2; cycle++) {
        await game.makeMove(0, 6, 2, 5, { from: black });
        await game.makeMove(7, 6, 5, 5, { from: white });
        await game.makeMove(2, 5, 0, 6, { from: black });
        await game.makeMove(5, 5, 7, 6, { from: white });
      }

      const drawStatus = await game.getDrawRuleStatus();
      assert.equal(drawStatus.maxRepetitions.toString(), "3", "phantom en passant must not split the position hash");
      await game.claimDrawByRepetition({ from: black });
      assert.equal((await game.getGameState()).toString(), state.Draw.toString());
    });

    it("keeps a capturable en-passant right distinct in repetition history", async () => {
      const game = await createHarnessGame(1);
      await game.debugCreative(1, 3, EMPTY, { from: white });
      await game.debugCreative(4, 3, -PAWN, { from: white });
      await joinCustomized(game);

      await game.makeMove(6, 4, 4, 4, { from: white });
      for (let cycle = 0; cycle < 2; cycle++) {
        await game.makeMove(0, 6, 2, 5, { from: black });
        await game.makeMove(7, 6, 5, 5, { from: white });
        await game.makeMove(2, 5, 0, 6, { from: black });
        await game.makeMove(5, 5, 7, 6, { from: white });
      }

      const drawStatus = await game.getDrawRuleStatus();
      assert.equal(drawStatus.maxRepetitions.toString(), "2", "a real en-passant option must retain a distinct hash");
      await expectRevert(
        game.claimDrawByRepetition({ from: black }),
        "two no-en-passant occurrences are not a threefold repetition"
      );
    });

    it("ignores an en-passant marker when the only adjacent pawn is pinned", async () => {
      const game = await createHarnessGame(1);
      await clearStandardPieces(game);
      await game.debugCreative(3, 0, KING, { from: white });
      await game.debugCreative(3, 1, PAWN, { from: white });
      await game.debugCreative(7, 1, KNIGHT, { from: white });
      await game.debugCreative(0, 4, -KING, { from: white });
      await game.debugCreative(0, 6, -KNIGHT, { from: white });
      await game.debugCreative(1, 2, -PAWN, { from: white });
      await game.debugCreative(3, 7, -ROOK, { from: white });
      await joinCustomized(game);

      await game.makeMove(7, 1, 5, 2, { from: white });
      await game.makeMove(1, 2, 3, 2, { from: black });

      for (let cycle = 0; cycle < 2; cycle++) {
        await game.makeMove(5, 2, 7, 1, { from: white });
        await game.makeMove(0, 6, 2, 5, { from: black });
        await game.makeMove(7, 1, 5, 2, { from: white });
        await game.makeMove(2, 5, 0, 6, { from: black });
      }

      const drawStatus = await game.getDrawRuleStatus();
      assert.equal(
        drawStatus.maxRepetitions.toString(),
        "3",
        "an en-passant capture that exposes the king must not split the position hash"
      );
      await game.claimDrawByRepetition({ from: white });
      assert.equal((await game.getGameState()).toString(), state.Draw.toString());
    });

    it("canonicalizes subordinate rook history after the king loses castling rights", async () => {
      const game = await createHarnessGame(1);
      await clearStandardPieces(game);
      await game.debugCreative(7, 4, KING, { from: white });
      await game.debugCreative(7, 7, ROOK, { from: white });
      await game.debugCreative(0, 4, -KING, { from: white });
      await game.debugCreative(0, 6, -KNIGHT, { from: white });
      await joinCustomized(game);

      await game.makeMove(7, 4, 6, 4, { from: white });
      await game.makeMove(0, 6, 2, 5, { from: black });
      await game.makeMove(6, 4, 7, 4, { from: white });
      await game.makeMove(2, 5, 0, 6, { from: black });

      await game.makeMove(7, 7, 6, 7, { from: white });
      await game.makeMove(0, 6, 2, 5, { from: black });
      await game.makeMove(6, 7, 7, 7, { from: white });
      await game.makeMove(2, 5, 0, 6, { from: black });

      await game.makeMove(7, 4, 6, 4, { from: white });
      await game.makeMove(0, 6, 2, 5, { from: black });
      await game.makeMove(6, 4, 7, 4, { from: white });
      await game.makeMove(2, 5, 0, 6, { from: black });

      const drawStatus = await game.getDrawRuleStatus();
      assert.equal(
        drawStatus.maxRepetitions.toString(),
        "3",
        "rook history cannot matter after the king has already moved"
      );
      await game.claimDrawByRepetition({ from: white });
      assert.equal((await game.getGameState()).toString(), state.Draw.toString());
    });
  });

  describe("invalid-piece defensive handling", () => {
    it("fails safely for every int8 piece value without arithmetic or path panics", async () => {
      const rules = await ChessRulesEngine.new({ from: white });

      for (let piece = -128; piece <= 127; piece++) {
        const board = Array.from({ length: 8 }, () => Array(8).fill(EMPTY));
        board[4][4] = piece;
        const result = await rules.isValidMoveView(board, -1, 0, 0, 4, 4, 4, 5);

        if (piece < -KING || piece > KING || piece === EMPTY) {
          assert.isFalse(result, `unsupported piece ${piece} must be immobile`);
        }
      }

      const attackedBoard = Array.from({ length: 8 }, () => Array(8).fill(EMPTY));
      attackedBoard[7][4] = KING;
      attackedBoard[0][4] = -KING;
      attackedBoard[7][0] = -128;
      const failClosed = await rules.wouldMoveLeaveKingInCheck(
        attackedBoard,
        7,
        4,
        0,
        4,
        7,
        4,
        6,
        4
      );
      assert.isTrue(failClosed, "a corrupted attacker must fail closed, not be treated as a slider or panic");
      await expectRevert(
        rules.detectCheckState(
          attackedBoard,
          true,
          false,
          false,
          7,
          4,
          0,
          4,
          -1,
          0,
          0,
          6,
          4
        ),
        "terminal-state detection must reject a corrupted board"
      );

      const boundaryPawnBoard = Array.from({ length: 8 }, () => Array(8).fill(EMPTY));
      boundaryPawnBoard[0][0] = PAWN;
      boundaryPawnBoard[7][7] = -PAWN;
      assert.isFalse(await rules.isValidMoveView(boundaryPawnBoard, -1, 0, 0, 0, 0, 1, 0));
      assert.isFalse(await rules.isValidMoveView(boundaryPawnBoard, -1, 0, 0, 7, 7, 6, 7));
    });

    it("refuses to render corrupted piece values as apparently empty squares", async () => {
      const game = await createHarnessGame(1);
      await game.setBoardSquareForTest(0, 0, 127, { from: thirdParty });

      await expectRevert(
        game.printChessBoardLayoutSVG(),
        "the on-chain renderer must expose corruption instead of hiding it"
      );
    });
  });

  describe("terminal result precedence", () => {
    it("does not overwrite a quiet checkmate with the automatic 75-move draw", async () => {
      const game = await createHarnessGame(1);
      await clearStandardPieces(game);
      await game.debugCreative(0, 6, -KING, { from: white });
      await game.debugCreative(1, 5, -PAWN, { from: white });
      await game.debugCreative(1, 6, -PAWN, { from: white });
      await game.debugCreative(1, 7, -PAWN, { from: white });
      await game.debugCreative(7, 4, KING, { from: white });
      await game.debugCreative(7, 0, ROOK, { from: white });
      await joinCustomized(game);
      await game.setHalfMoveClockForTest(149, { from: thirdParty });

      const tx = await game.makeMove(7, 0, 0, 0, { from: white });
      assert.equal((await game.getGameState()).toString(), state.WhiteWins.toString());
      assert.equal((await game.getDrawRuleStatus()).halfMoves.toString(), "150", "the quiet move must reach the draw threshold");
      assert.isTrue(
        tx.logs.some((log) => log.event === "GameStateChanged" && log.args.newState.toString() === eventState.WhiteWins.toString()),
        "the move must emit the winning terminal state"
      );
      assert.isFalse(
        tx.logs.some((log) => log.event === "GameStateChanged" && log.args.newState.toString() === eventState.Draw.toString()),
        "the move must not emit a contradictory draw"
      );
    });

    it("records Tournament self-check as an illegal loss, never as checkmate", async () => {
      const game = await createHarnessGame(0);
      await game.joinGameAsBlack({ from: black, value: bet });

      await game.makeMove(6, 4, 5, 4, { from: white }); // e2-e3
      await game.makeMove(1, 3, 3, 3, { from: black }); // d7-d5
      await game.makeMove(7, 5, 3, 1, { from: white }); // Bf1-b5+
      assert.equal((await game.getGameState()).toString(), state.InProgress.toString());
      await game.setHalfMoveClockForTest(149, { from: thirdParty });

      const tx = await game.makeMove(0, 6, 2, 5, { from: black }); // Ng8-f6 ignores check
      const move = tx.logs.find((log) => log.event === "MoveMade");
      const illegalLoss = tx.logs.find((log) => log.event === "IllegalMoveLoss");
      const terminalFlags = await game.getTerminalFlagsForTest();

      assert.equal((await game.getGameState()).toString(), state.WhiteWins.toString());
      assert.equal((await game.getDrawRuleStatus()).halfMoves.toString(), "150", "the quiet illegal move must reach the draw threshold");
      assert.isFalse(move.args.isMate, "self-check loss must not be labeled checkmate");
      assert.isFalse(terminalFlags.checkmate, "illegal loss must not enable the checkmate bonus");
      assert.isTrue(terminalFlags.resignationLike, "illegal loss must apply the resignation-like penalty");
      assert.equal(illegalLoss.args.player, black);
      assert.equal(illegalLoss.args.winner, white);
      assert.isFalse(
        tx.logs.some((log) => log.event === "GameStateChanged" && log.args.newState.toString() === eventState.Draw.toString()),
        "the 75-move draw must not overwrite an illegal-move loss"
      );
    });
  });

  describe("castling provenance", () => {
    it("does not restore castling rights when a captured corner rook is replaced", async () => {
      const game = await createHarnessGame(1);
      await clearStandardPieces(game);
      await game.debugCreative(7, 4, KING, { from: white });
      await game.debugCreative(7, 7, ROOK, { from: white });
      await game.debugCreative(7, 1, KNIGHT, { from: white });
      await game.debugCreative(0, 4, -KING, { from: white });
      await game.debugCreative(0, 7, -ROOK, { from: white });
      await joinCustomized(game);

      await game.makeMove(7, 1, 5, 2, { from: white });
      await game.makeMove(0, 7, 7, 7, { from: black });

      // Simulate a later promoted rook reaching the original corner.
      await game.setBoardSquareForTest(7, 7, ROOK, { from: thirdParty });
      await expectRevert(
        game.makeMove(7, 4, 7, 6, { from: white }),
        "a replacement rook must not recover the captured rook's castling right"
      );
    });
  });

  describe("rating delivery recovery", () => {
    it("leaves a failed report retryable and marks it only after success", async () => {
      const implementation = await ChessCore.new({ from: white });
      const factory = await ChessFactory.new(implementation.address, { from: white });
      const flakyRating = await FlakyPlayerRating.new({ from: white });
      await factory.setPlayerRating(flakyRating.address, { from: white });

      const creation = await factory.createChessGame(2, 0, { from: white, value: bet });
      const gameAddress = creation.logs.find((log) => log.event === "GameCreated").args.gameAddress;
      const game = await ChessCore.at(gameAddress);
      await game.joinGameAsBlack({ from: black, value: bet });
      await game.resign({ from: black });

      await expectRevert(
        game.retryRatingReport({ from: thirdParty }),
        "a provisional result must not be reported before prize/dispute finalization"
      );

      const finalize = await game.finalizePrizes({ from: thirdParty });
      assert.isTrue(finalize.logs.some((log) => log.event === "RatingReportFailed"));
      assert.isFalse(await game.ratingReported(), "a caught downstream failure must not burn the retry");

      await flakyRating.setShouldFail(false, { from: white });
      await game.retryRatingReport({ from: thirdParty });

      assert.isTrue(await game.ratingReported());
      assert.equal((await flakyRating.successfulReports()).toString(), "1");

      await game.retryRatingReport({ from: thirdParty });
      assert.equal((await flakyRating.successfulReports()).toString(), "1", "successful reports stay idempotent");
    });
  });
});
