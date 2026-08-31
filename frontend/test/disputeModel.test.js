import test from 'node:test';
import assert from 'node:assert/strict';
import {
	Vote,
	getVoteLabel,
	isChallengeableGameState,
	isCheatDecision,
	isValidArbitratorVote
} from '../src/lib/utils/disputeModel.js';

test('whole-game vote values match the DisputeDAO enum exactly', () => {
	assert.deepEqual(Vote, {
		None: 0,
		Legit: 1,
		WhiteCheat: 2,
		BlackCheat: 3,
		Abstain: 4
	});
	assert.equal(isValidArbitratorVote(Vote.None), false);
	for (const vote of [Vote.Legit, Vote.WhiteCheat, Vote.BlackCheat, Vote.Abstain]) {
		assert.equal(isValidArbitratorVote(vote), true);
	}
});

test('whole-game review is available for every terminal chess result, including draws', () => {
	for (const state of [3, 4, 5]) assert.equal(isChallengeableGameState(state), true);
	for (const state of [0, 1, 2, 6]) assert.equal(isChallengeableGameState(state), false);
});

test('whole-game decisions identify the cheating side without a challenger-selected accused', () => {
	assert.equal(getVoteLabel(Vote.Legit), 'Legitimate');
	assert.equal(getVoteLabel(Vote.WhiteCheat), 'White Cheated');
	assert.equal(getVoteLabel(Vote.BlackCheat), 'Black Cheated');
	assert.equal(getVoteLabel(Vote.Abstain), 'Abstain');
	assert.equal(isCheatDecision(Vote.Legit), false);
	assert.equal(isCheatDecision(Vote.WhiteCheat), true);
	assert.equal(isCheatDecision(Vote.BlackCheat), true);
});
