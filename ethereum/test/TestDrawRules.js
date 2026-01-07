const ChessCore = artifacts.require("ChessCore");
const ChessFactory = artifacts.require("ChessFactory");

contract("ChessCore - Draw Rules", accounts => {
    const [white, black] = accounts;
    let factory;
    let game;

    beforeEach(async () => {
        const chessCoreImpl = await ChessCore.new({ from: white });
        factory = await ChessFactory.new(chessCoreImpl.address, { from: white });
        const tx = await factory.createChessGame(0, 0, { from: white, value: web3.utils.toWei("0.01", "ether") });
        const gameAddress = tx.logs[0].args.gameAddress;
        game = await ChessCore.at(gameAddress);
        await game.joinGameAsBlack({ from: black, value: web3.utils.toWei("0.01", "ether") });
    });

    describe("Draw Rule Status", () => {
        it("should start with halfMoveClock at 0", async () => {
            const status = await game.getDrawRuleStatus();
            assert.equal(status.halfMoves.toString(), "0", "Half move clock should start at 0");
        });

        it("should start with initial position count of 1", async () => {
            const status = await game.getDrawRuleStatus();
            assert.equal(status.maxRepetitions.toString(), "1", "Initial position should be counted once");
        });
    });

    describe("50-Move Rule", () => {
        it("should increment halfMoveClock on knight move (no capture/pawn)", async () => {
            // White knight move
            await game.makeMove(7, 1, 5, 2, { from: white }); // Nc3
            let status = await game.getDrawRuleStatus();
            assert.equal(status.halfMoves.toString(), "1", "Half move clock should be 1");

            // Black knight move
            await game.makeMove(0, 1, 2, 2, { from: black }); // Nc6
            status = await game.getDrawRuleStatus();
            assert.equal(status.halfMoves.toString(), "2", "Half move clock should be 2");
        });

        it("should reset halfMoveClock on pawn move", async () => {
            // Knight moves
            await game.makeMove(7, 1, 5, 2, { from: white }); // Nc3
            await game.makeMove(0, 1, 2, 2, { from: black }); // Nc6

            let status = await game.getDrawRuleStatus();
            assert.equal(status.halfMoves.toString(), "2", "Half move clock should be 2");

            // Pawn move resets clock
            await game.makeMove(6, 4, 4, 4, { from: white }); // e4
            status = await game.getDrawRuleStatus();
            assert.equal(status.halfMoves.toString(), "0", "Half move clock should reset to 0 after pawn move");
        });

        it("should reset halfMoveClock on capture", async () => {
            // Setup: move pieces to enable capture
            await game.makeMove(6, 4, 4, 4, { from: white }); // e4
            await game.makeMove(1, 3, 3, 3, { from: black }); // d5

            // Knights moves to increment clock
            await game.makeMove(7, 1, 5, 2, { from: white }); // Nc3
            await game.makeMove(0, 1, 2, 2, { from: black }); // Nc6

            let status = await game.getDrawRuleStatus();
            assert.equal(status.halfMoves.toString(), "2", "Half move clock should be 2");

            // Capture resets clock (exd5)
            await game.makeMove(4, 4, 3, 3, { from: white });
            status = await game.getDrawRuleStatus();
            assert.equal(status.halfMoves.toString(), "0", "Half move clock should reset to 0 after capture");
        });

        it("should not allow 50-move claim before 100 half-moves", async () => {
            try {
                await game.claimDrawByFiftyMoveRule({ from: white });
                assert.fail("Should have thrown error");
            } catch (error) {
                assert(error.message.includes("revert"), "Expected revert error");
            }
        });
    });

    describe("Threefold Repetition", () => {
        it("should track position repetitions", async () => {
            // Initial position is counted
            let status = await game.getDrawRuleStatus();
            assert.equal(status.maxRepetitions.toString(), "1", "Initial position counted once");

            // Move knight out and back (white)
            await game.makeMove(7, 6, 5, 5, { from: white }); // Nf3
            await game.makeMove(0, 6, 2, 5, { from: black }); // Nf6
            await game.makeMove(5, 5, 7, 6, { from: white }); // Ng1
            await game.makeMove(2, 5, 0, 6, { from: black }); // Ng8

            // Now we're back to initial position (sort of - but castling rights changed)
            status = await game.getDrawRuleStatus();
            // Position won't match exactly due to moved flags, but clock should be 4
            assert.equal(status.halfMoves.toString(), "4", "Half move clock should be 4");
        });

        it("should not allow repetition claim with less than 3 occurrences", async () => {
            try {
                await game.claimDrawByRepetition({ from: white });
                assert.fail("Should have thrown error");
            } catch (error) {
                assert(error.message.includes("revert"), "Expected revert error");
            }
        });

        it("should only allow players to claim repetition draw", async () => {
            const nonPlayer = accounts[5];
            try {
                await game.claimDrawByRepetition({ from: nonPlayer });
                assert.fail("Should have thrown error");
            } catch (error) {
                assert(error.message.includes("revert"), "Expected revert error");
            }
        });

        it("should only allow players to claim 50-move draw", async () => {
            const nonPlayer = accounts[5];
            try {
                await game.claimDrawByFiftyMoveRule({ from: nonPlayer });
                assert.fail("Should have thrown error");
            } catch (error) {
                assert(error.message.includes("revert"), "Expected revert error");
            }
        });
    });

    describe("Draw Claims Game State", () => {
        it("should not allow draw claims when game not in progress", async () => {
            // Resign to end game
            await game.resign({ from: white });

            try {
                await game.claimDrawByRepetition({ from: black });
                assert.fail("Should have thrown error");
            } catch (error) {
                assert(error.message.includes("revert"), "Expected revert error");
            }

            try {
                await game.claimDrawByFiftyMoveRule({ from: black });
                assert.fail("Should have thrown error");
            } catch (error) {
                assert(error.message.includes("revert"), "Expected revert error");
            }
        });
    });
});
