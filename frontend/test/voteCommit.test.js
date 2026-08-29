import test from 'node:test';
import assert from 'node:assert/strict';
import {
	computeVoteCommitHash,
	createVoteCommitRecord,
	getVoteCommitStorageKey,
	parseVoteCommit,
	serializeVoteCommit
} from '../src/lib/utils/voteCommit.js';

const context = {
	chainId: 84532,
	daoAddress: '0x1111111111111111111111111111111111111111',
	account: '0x2222222222222222222222222222222222222222',
	gameId: 7,
	disputeId: 3
};
const salt = `0x${'ab'.repeat(32)}`;
const hashFor = (vote, account = context.account) => computeVoteCommitHash({ vote, salt, account });

test('scopes storage by chain, DAO, account, and dispute', () => {
	const baseKey = getVoteCommitStorageKey(context);
	assert.notEqual(baseKey, getVoteCommitStorageKey({ ...context, chainId: 8453 }));
	assert.notEqual(baseKey, getVoteCommitStorageKey({ ...context, disputeId: 4 }));
	assert.match(baseKey, /^mychess:vote-commit:v2:/);
});

test('round-trips a validated reveal backup', () => {
	const hash = hashFor(2);
	const record = createVoteCommitRecord({ context, vote: 2, salt, hash, createdAt: 1234 });
	const restored = parseVoteCommit(serializeVoteCommit(record), context, hash);

	assert.deepEqual(restored, record);
	assert.equal(restored.account, context.account.toLowerCase());
});

test('rejects malformed or mismatched backups', () => {
	const hash = hashFor(1);
	const record = createVoteCommitRecord({ context, vote: 1, salt, hash });
	const serialized = serializeVoteCommit(record);
	const tampered = JSON.stringify({ ...record, vote: 2 });

	assert.equal(parseVoteCommit('not-json', context, hash), null);
	assert.equal(parseVoteCommit(serialized, { ...context, account: '0x3333333333333333333333333333333333333333' }, hash), null);
	assert.equal(parseVoteCommit(serialized, context, `0x${'ef'.repeat(32)}`), null);
	assert.equal(parseVoteCommit(tampered, context, hash), null);
	assert.throws(() => createVoteCommitRecord({ context, vote: 4, salt, hash }), /Invalid committed vote/);
	assert.throws(() => createVoteCommitRecord({ context, vote: 1, salt: '0x12', hash }), /Invalid vote salt/);
});
