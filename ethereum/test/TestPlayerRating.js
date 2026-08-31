const PlayerRating = artifacts.require("PlayerRating");
const ChessCore = artifacts.require("ChessCore");
const ChessFactory = artifacts.require("ChessFactory");
const RatingGameMock = artifacts.require("RatingGameMock");
const RatingFactoryMock = artifacts.require("RatingFactoryMock");
const RatingEligibilityMock = artifacts.require("RatingEligibilityMock");

async function expectRevert(promise) {
    let caught;
    try {
        await promise;
    } catch (error) {
        caught = error;
    }

    assert.exists(caught, "Expected transaction to revert");
    assert.match(caught.message, /revert|custom error|invalid opcode/i);
}

async function advanceTime(seconds) {
    await new Promise((resolve, reject) => {
        web3.currentProvider.send(
            {
                jsonrpc: "2.0",
                method: "evm_increaseTime",
                params: [seconds],
                id: Date.now()
            },
            (error) => error ? reject(error) : resolve()
        );
    });
    await new Promise((resolve, reject) => {
        web3.currentProvider.send(
            {
                jsonrpc: "2.0",
                method: "evm_mine",
                params: [],
                id: Date.now() + 1
            },
            (error) => error ? reject(error) : resolve()
        );
    });
}

contract("PlayerRating - ELO System", accounts => {
    const [admin, player1, player2, player3, unauthorized] = accounts;
    let rating;
    let factory;

    beforeEach(async () => {
        rating = await PlayerRating.new({ from: admin });
        const chessCoreImpl = await ChessCore.new({ from: admin });
        factory = await ChessFactory.new(chessCoreImpl.address, { from: admin });

        // Setup: connect factory and rating
        await rating.setChessFactory(factory.address, { from: admin });
        await factory.setPlayerRating(rating.address, { from: admin });
    });

    describe("Initial State", () => {
        it("should return default rating for unregistered player", async () => {
            const playerRating = await rating.getRating(player1);
            assert.equal(playerRating.toString(), "1200", "Default rating should be 1200");
        });

        it("should return default stats for unregistered player", async () => {
            const stats = await rating.getPlayerStats(player1);
            assert.equal(stats.rating.toString(), "1200", "Default rating should be 1200");
            assert.equal(stats.gamesPlayed.toString(), "0", "Games played should be 0");
            assert.equal(stats.wins.toString(), "0", "Wins should be 0");
        });

        it("should mark unplayed player as provisional", async () => {
            const isProvisional = await rating.isProvisional(player1);
            assert.equal(isProvisional, true, "New player should be provisional");
        });
    });

    describe("Player Registration", () => {
        it("should register new player with default rating", async () => {
            await rating.registerPlayer(player1, { from: player1 });
            const stats = await rating.getPlayerStats(player1);
            assert.equal(stats.rating.toString(), "1200", "Rating should be 1200");
            assert.equal(stats.peakRating.toString(), "1200", "Peak rating should be 1200");
        });

        it("should not re-register existing player", async () => {
            await rating.registerPlayer(player1, { from: player1 });

            // Grant GAME_REPORTER_ROLE to admin for testing
            const GAME_REPORTER_ROLE = await rating.GAME_REPORTER_ROLE();
            await rating.grantRole(GAME_REPORTER_ROLE, admin, { from: admin });

            // Report a game to change rating
            await rating.reportGame(player1, player2, 1, { from: admin }); // player1 wins

            const stats1 = await rating.getPlayerStats(player1);
            const rating1 = stats1.rating.toString();

            // Try to re-register
            await rating.registerPlayer(player1, { from: player1 });

            const stats2 = await rating.getPlayerStats(player1);
            assert.equal(stats2.rating.toString(), rating1, "Rating should not reset on re-registration");
        });

        it("should not consume a ranked slot before a rated result", async () => {
            await rating.registerPlayer(player1, { from: player1 });
            const count = await rating.getRankedPlayerCount();
            assert.equal(count.toString(), "0", "Self-registration must not fill the leaderboard");
            assert.isFalse(await rating.isRanked(player1));
        });

        it("should reject registration of an arbitrary third-party address", async () => {
            await expectRevert(rating.registerPlayer(player2, { from: unauthorized }));

            assert.equal((await rating.getRankedPlayerCount()).toString(), "0");
            assert.isFalse(await rating.isRanked(player2));
        });

        it("should reject the zero address", async () => {
            await expectRevert(rating.registerPlayer(
                "0x0000000000000000000000000000000000000000",
                { from: player1 }
            ));
        });
    });

    describe("Game Reporting", () => {
        beforeEach(async () => {
            // Grant GAME_REPORTER_ROLE to admin for direct testing
            const GAME_REPORTER_ROLE = await rating.GAME_REPORTER_ROLE();
            await rating.grantRole(GAME_REPORTER_ROLE, admin, { from: admin });
        });

        it("should update ratings after white wins", async () => {
            const initialRating1 = await rating.getRating(player1);
            const initialRating2 = await rating.getRating(player2);

            await rating.reportGame(player1, player2, 1, { from: admin }); // white wins

            const finalRating1 = await rating.getRating(player1);
            const finalRating2 = await rating.getRating(player2);

            assert(Number(finalRating1) > Number(initialRating1), "Winner rating should increase");
            assert(Number(finalRating2) < Number(initialRating2), "Loser rating should decrease");
        });

        it("should update ratings after black wins", async () => {
            const initialRating1 = await rating.getRating(player1);
            const initialRating2 = await rating.getRating(player2);

            await rating.reportGame(player1, player2, 2, { from: admin }); // black wins

            const finalRating1 = await rating.getRating(player1);
            const finalRating2 = await rating.getRating(player2);

            assert(Number(finalRating1) < Number(initialRating1), "Loser rating should decrease");
            assert(Number(finalRating2) > Number(initialRating2), "Winner rating should increase");
        });

        it("should update ratings symmetrically on draw", async () => {
            // First give player1 higher rating by winning
            await rating.reportGame(player1, player3, 1, { from: admin });
            await rating.reportGame(player1, player3, 1, { from: admin });

            const ratingBefore1 = await rating.getRating(player1);
            const ratingBefore2 = await rating.getRating(player2);

            await rating.reportGame(player1, player2, 0, { from: admin }); // draw

            const ratingAfter1 = await rating.getRating(player1);
            const ratingAfter2 = await rating.getRating(player2);

            // Higher rated player should lose points on draw, lower rated should gain
            assert(Number(ratingAfter1) <= Number(ratingBefore1), "Higher rated player should not gain on draw");
            assert(Number(ratingAfter2) >= Number(ratingBefore2), "Lower rated player should not lose on draw");
        });

        it("should increment games played", async () => {
            await rating.reportGame(player1, player2, 1, { from: admin });

            const stats1 = await rating.getPlayerStats(player1);
            const stats2 = await rating.getPlayerStats(player2);

            assert.equal(stats1.gamesPlayed.toString(), "1", "Player 1 games should be 1");
            assert.equal(stats2.gamesPlayed.toString(), "1", "Player 2 games should be 1");
        });

        it("should track wins and losses", async () => {
            await rating.reportGame(player1, player2, 1, { from: admin }); // player1 wins

            const stats1 = await rating.getPlayerStats(player1);
            const stats2 = await rating.getPlayerStats(player2);

            assert.equal(stats1.wins.toString(), "1", "Player 1 wins should be 1");
            assert.equal(stats1.losses.toString(), "0", "Player 1 losses should be 0");
            assert.equal(stats2.wins.toString(), "0", "Player 2 wins should be 0");
            assert.equal(stats2.losses.toString(), "1", "Player 2 losses should be 1");
        });

        it("should track draws", async () => {
            await rating.reportGame(player1, player2, 0, { from: admin }); // draw

            const stats1 = await rating.getPlayerStats(player1);
            const stats2 = await rating.getPlayerStats(player2);

            assert.equal(stats1.draws.toString(), "1", "Player 1 draws should be 1");
            assert.equal(stats2.draws.toString(), "1", "Player 2 draws should be 1");
        });

        it("should update peak rating", async () => {
            const initialPeak = (await rating.getPlayerStats(player1)).peakRating;

            await rating.reportGame(player1, player2, 1, { from: admin }); // player1 wins

            const finalPeak = (await rating.getPlayerStats(player1)).peakRating;
            assert(Number(finalPeak) > Number(initialPeak), "Peak rating should increase after win");
        });

        it("should not allow same player for both sides", async () => {
            try {
                await rating.reportGame(player1, player1, 1, { from: admin });
                assert.fail("Should have thrown error");
            } catch (error) {
                assert(error.message.includes("revert"), "Expected revert error");
            }
        });

        it("should not allow invalid result", async () => {
            try {
                await rating.reportGame(player1, player2, 3, { from: admin });
                assert.fail("Should have thrown error");
            } catch (error) {
                assert(error.message.includes("revert"), "Expected revert error");
            }
        });

        it("should reject zero-address participants", async () => {
            try {
                await rating.reportGame(
                    "0x0000000000000000000000000000000000000000",
                    player2,
                    1,
                    { from: admin }
                );
                assert.fail("Should have thrown error");
            } catch (error) {
                assert(error.message.includes("revert"), "Expected revert error");
            }
        });

        it("should reject unauthorized reporter", async () => {
            try {
                await rating.reportGame(player1, player2, 1, { from: unauthorized });
                assert.fail("Should have thrown error");
            } catch (error) {
                assert(error.message.includes("revert"), "Expected revert error");
            }
        });
    });

    describe("Win Rate Calculation", () => {
        beforeEach(async () => {
            const GAME_REPORTER_ROLE = await rating.GAME_REPORTER_ROLE();
            await rating.grantRole(GAME_REPORTER_ROLE, admin, { from: admin });
        });

        it("should return 0 for player with no games", async () => {
            const winRate = await rating.getWinRate(player1);
            assert.equal(winRate.toString(), "0", "Win rate should be 0 with no games");
        });

        it("should calculate 100% win rate correctly", async () => {
            await rating.reportGame(player1, player2, 1, { from: admin }); // player1 wins
            await rating.reportGame(player1, player3, 1, { from: admin }); // player1 wins

            const winRate = await rating.getWinRate(player1);
            assert.equal(winRate.toString(), "10000", "Win rate should be 100% (10000)");
        });

        it("should calculate 50% win rate correctly", async () => {
            await rating.reportGame(player1, player2, 1, { from: admin }); // player1 wins
            await rating.reportGame(player1, player3, 2, { from: admin }); // player1 loses

            const winRate = await rating.getWinRate(player1);
            assert.equal(winRate.toString(), "5000", "Win rate should be 50% (5000)");
        });

        it("should count draws as half wins", async () => {
            await rating.reportGame(player1, player2, 0, { from: admin }); // draw

            const winRate = await rating.getWinRate(player1);
            assert.equal(winRate.toString(), "5000", "Draw should count as 50% (5000)");
        });
    });

    describe("Provisional Status", () => {
        beforeEach(async () => {
            const GAME_REPORTER_ROLE = await rating.GAME_REPORTER_ROLE();
            await rating.grantRole(GAME_REPORTER_ROLE, admin, { from: admin });
        });

        it("should be provisional with less than 30 games", async () => {
            await rating.reportGame(player1, player2, 1, { from: admin });

            const isProvisional = await rating.isProvisional(player1);
            assert.equal(isProvisional, true, "Should still be provisional after 1 game");
        });
    });

    describe("Leaderboard", () => {
        beforeEach(async () => {
            const GAME_REPORTER_ROLE = await rating.GAME_REPORTER_ROLE();
            await rating.grantRole(GAME_REPORTER_ROLE, admin, { from: admin });

            // Register some players with different ratings
            await rating.reportGame(player1, player2, 1, { from: admin }); // player1 wins
            await rating.reportGame(player1, player3, 1, { from: admin }); // player1 wins
        });

        it("should return correct ranked player count", async () => {
            const count = await rating.getRankedPlayerCount();
            assert.equal(count.toString(), "3", "Should have 3 ranked players");
        });

        it("should return top players", async () => {
            const result = await rating.getTopPlayers(0, 10);
            assert.equal(result.addresses.length, 3, "Should return 3 players");
        });

        it("should handle pagination", async () => {
            const result = await rating.getTopPlayers(0, 2);
            assert.equal(result.addresses.length, 2, "Should return 2 players with limit 2");
        });

        it("should handle offset beyond range", async () => {
            const result = await rating.getTopPlayers(100, 10);
            assert.equal(result.addresses.length, 0, "Should return 0 players with offset beyond range");
        });
    });

    describe("Canonical rated-game policy", () => {
        let ratingFactory;
        let eligibility;

        beforeEach(async () => {
            ratingFactory = await RatingFactoryMock.new({ from: admin });
            eligibility = await RatingEligibilityMock.new({ from: admin });
            await rating.setChessFactory(ratingFactory.address, { from: admin });
            await rating.setEligibilityRegistry(eligibility.address, { from: admin });
            for (const player of [player1, player2, player3]) {
                await eligibility.setEligible(player, true, { from: admin });
            }
        });

        async function registeredGame(gameId) {
            const game = await RatingGameMock.new(rating.address, gameId, { from: admin });
            await ratingFactory.register(rating.address, game.address, { from: admin });
            return game;
        }

        it("rejects unlisted registrations and stale reporters after factory rotation", async () => {
            const game = await RatingGameMock.new(rating.address, 76, { from: admin });
            await expectRevert(
                ratingFactory.registerUnlisted(rating.address, game.address, { from: admin })
            );

            await ratingFactory.register(rating.address, game.address, { from: admin });
            assert.isTrue(await rating.validGameContracts(game.address));
            const replacementFactory = await RatingFactoryMock.new({ from: admin });
            await rating.setChessFactory(replacementFactory.address, { from: admin });

            await expectRevert(game.report(player1, player2, 1, 20, 0));
            assert.equal((await rating.getPlayerStats(player1)).gamesPlayed.toString(), "0");
        });

        it("should process a zero-ply result once without rating it", async () => {
            const game = await registeredGame(77);
            assert.isFalse(await game.report.call(player1, player2, 1, 0, 0));

            await game.report(player1, player2, 1, 0, 0);

            assert.isTrue(await rating.processedGameContracts(game.address));
            assert.equal((await rating.getPlayerStats(player1)).gamesPlayed.toString(), "0");
            await expectRevert(game.report(player1, player2, 1, 20, 0));
        });

        it("should never rate Friendly games", async () => {
            const game = await registeredGame(78);
            assert.isFalse(await game.report.call(player1, player2, 1, 40, 1));
            await game.report(player1, player2, 1, 40, 1);
            assert.equal((await rating.getPlayerStats(player1)).gamesPlayed.toString(), "0");
        });

        it("should rate one eligible Tournament game and suppress pair farming", async () => {
            const first = await registeredGame(79);
            assert.isTrue(await first.report.call(player1, player2, 1, 20, 0));
            await first.report(player1, player2, 1, 20, 0);
            assert.equal((await rating.getPlayerStats(player1)).gamesPlayed.toString(), "1");

            const rematch = await registeredGame(80);
            assert.isFalse(await rematch.report.call(player2, player1, 2, 20, 0));
            await rematch.report(player2, player1, 2, 20, 0);
            assert.equal((await rating.getPlayerStats(player1)).gamesPlayed.toString(), "1");

            const independent = await registeredGame(81);
            assert.isTrue(await independent.report.call(player1, player3, 1, 20, 0));
            await independent.report(player1, player3, 1, 20, 0);
            assert.equal((await rating.getPlayerStats(player1)).gamesPlayed.toString(), "2");

            await advanceTime(7 * 24 * 60 * 60);
            const postCooldownRematch = await registeredGame(82);
            assert.isTrue(await postCooldownRematch.report.call(player2, player1, 2, 20, 0));
            await postCooldownRematch.report(player2, player1, 2, 20, 0);
            assert.equal(
                (await rating.getPlayerStats(player1)).gamesPlayed.toString(),
                "3",
                "The unordered pair should become rateable again at the cooldown boundary"
            );
        });

        it("should reject fresh unverified opponents instead of allowing rotating-wallet ELO farming", async () => {
            const first = await registeredGame(83);
            await first.report(player1, player2, 1, 20, 0);
            const ratingAfterVerifiedGame = await rating.getRating(player1);

            const unverifiedPeer = accounts[8];
            const sybilGame = await registeredGame(84);
            assert.isFalse(await sybilGame.report.call(player1, unverifiedPeer, 1, 20, 0));
            await sybilGame.report(player1, unverifiedPeer, 1, 20, 0);

            assert.equal(
                (await rating.getRating(player1)).toString(),
                ratingAfterVerifiedGame.toString(),
                "A new wallet without signer-backed eligibility must not move ELO"
            );
            assert.equal((await rating.getPlayerStats(unverifiedPeer)).gamesPlayed.toString(), "0");
        });
    });

    describe("Admin Functions", () => {
        it("should allow admin to set chess factory", async () => {
            const chessCoreImpl = await ChessCore.new({ from: admin });
            const newFactory = await ChessFactory.new(chessCoreImpl.address, { from: admin });
            await rating.setChessFactory(newFactory.address, { from: admin });
            const setFactory = await rating.chessFactory();
            assert.equal(setFactory, newFactory.address, "Chess factory should be updated");
        });

        it("should not allow non-admin to set chess factory", async () => {
            try {
                await rating.setChessFactory(accounts[9], { from: unauthorized });
                assert.fail("Should have thrown error");
            } catch (error) {
                assert(error.message.includes("revert"), "Expected revert error");
            }
        });
    });

    describe("MAX_RANKED_PLAYERS Cap", () => {
        it("should have MAX_RANKED_PLAYERS constant set", async () => {
            const maxPlayers = await rating.MAX_RANKED_PLAYERS();
            assert.equal(maxPlayers.toString(), "100000", "MAX_RANKED_PLAYERS should be 100000");
        });

        it("should still track player ratings even if not in leaderboard", async () => {
            // This verifies that players can still have ratings tracked
            // even if they can't be added to the leaderboard (when cap is reached)
            // We can't easily test the cap being reached, but we verify the mechanism works
            await rating.registerPlayer(player1, { from: player1 });

            // Verify player has rating but we check the cap exists
            const playerRating = await rating.getRating(player1);
            assert.equal(playerRating.toString(), "1200", "Player should have default rating");

            // Registration alone cannot be used to exhaust permanent leaderboard slots.
            const isRanked = await rating.isRanked(player1);
            assert.isFalse(isRanked, "Player should be ranked only after a rated game");
        });
    });
});
