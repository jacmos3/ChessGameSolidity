import test from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import {
	computeVoteCommitHash,
	createVoteCommitRecord,
	getVoteCommitRetryPayload,
	getVoteCommitStorageKey,
	parseVoteCommit,
	reconcileVoteCommitRecord,
	serializeVoteCommit,
	updateVoteCommitStatus,
	voteCommitRecordMatchesContext,
	VoteCommitReconciliation
} from '../src/lib/utils/voteCommit.js';

const context = {
	chainId: 84532,
	daoAddress: '0x1111111111111111111111111111111111111111',
	account: '0x2222222222222222222222222222222222222222',
	gameId: 7,
	disputeId: 3
};
const salt = `0x${'ab'.repeat(32)}`;
const hashFor = (vote, overrides = {}) => computeVoteCommitHash({
	context: { ...context, ...overrides },
	vote,
	salt
});

test('scopes storage by chain, DAO, account, and dispute', () => {
	const baseKey = getVoteCommitStorageKey(context);
	assert.notEqual(baseKey, getVoteCommitStorageKey({ ...context, chainId: 8453 }));
	assert.notEqual(baseKey, getVoteCommitStorageKey({ ...context, disputeId: 4 }));
	assert.match(baseKey, /^mychess:vote-commit:v4:/);
});

test('accepts game id zero while requiring a positive dispute id', () => {
	const zeroGameContext = { ...context, gameId: 0 };
	const hash = hashFor(1, { gameId: 0 });
	const record = createVoteCommitRecord({ context: zeroGameContext, vote: 1, salt, hash });
	assert.equal(record.gameId, 0);
	assert.throws(
		() => getVoteCommitStorageKey({ ...zeroGameContext, disputeId: 0 }),
		/Invalid dispute id/
	);
});

test('matches the DAO domain-separated abi.encode commitment', () => {
	const expected = ethers.utils.keccak256(
		ethers.utils.defaultAbiCoder.encode(
			['uint256', 'address', 'uint256', 'uint8', 'bytes32', 'address'],
			[context.chainId, context.daoAddress, context.disputeId, 2, salt, context.account]
		)
	);
	const actual = hashFor(2);
	const legacyPacked = ethers.utils.solidityKeccak256(
		['uint8', 'bytes32', 'address'],
		[2, salt, context.account]
	);

	assert.equal(actual, expected.toLowerCase());
	assert.notEqual(actual, legacyPacked.toLowerCase());
	assert.notEqual(actual, hashFor(2, { chainId: 8453 }));
	assert.notEqual(actual, hashFor(2, { daoAddress: '0x3333333333333333333333333333333333333333' }));
	assert.notEqual(actual, hashFor(2, { disputeId: 4 }));
	assert.notEqual(actual, hashFor(2, { account: '0x4444444444444444444444444444444444444444' }));
});

test('round-trips a validated reveal backup', () => {
	const hash = hashFor(2);
	const record = createVoteCommitRecord({ context, vote: 2, salt, hash, createdAt: 1234 });
	const restored = parseVoteCommit(serializeVoteCommit(record), context, hash);

	assert.deepEqual(restored, record);
	assert.equal(restored.account, context.account.toLowerCase());
	assert.equal(restored.status, 'pending');
});

test('tracks pending, broadcast, and confirmed backup state without changing reveal data', () => {
	const hash = hashFor(4);
	const pending = createVoteCommitRecord({ context, vote: 4, salt, hash, createdAt: 1234 });
	const transactionHash = `0x${'cd'.repeat(32)}`;
	const broadcast = updateVoteCommitStatus(pending, 'broadcast', transactionHash, 12);
	const confirmed = updateVoteCommitStatus(broadcast, 'confirmed');

	assert.equal(pending.status, 'pending');
	assert.equal(broadcast.status, 'broadcast');
	assert.equal(broadcast.transactionHash, transactionHash);
	assert.equal(broadcast.nonce, 12);
	assert.equal(confirmed.status, 'confirmed');
	assert.equal(confirmed.salt, pending.salt);
	assert.equal(confirmed.hash, pending.hash);
});

test('restores a pre-broadcast pending secret while the on-chain commitment is still zero', () => {
	const hash = hashFor(1);
	const pending = createVoteCommitRecord({ context, vote: 1, salt, hash, status: 'pending' });
	const restored = parseVoteCommit(
		serializeVoteCommit(pending),
		context,
		ethers.constants.HashZero
	);

	assert.deepEqual(restored, pending);
});

test('retries an ambiguous pre-broadcast record with the exact same vote, salt, and hash', () => {
	const hash = hashFor(1);
	const pending = createVoteCommitRecord({ context, vote: 1, salt, hash, status: 'pending' });
	const retry = getVoteCommitRetryPayload(pending, context, ethers.constants.HashZero);

	assert.equal(retry.disputeId, pending.disputeId);
	assert.equal(retry.vote, pending.vote);
	assert.equal(retry.salt, pending.salt);
	assert.equal(retry.hash, pending.hash);
	assert.equal(
		computeVoteCommitHash({ context, vote: retry.vote, salt: retry.salt }),
		pending.hash
	);
	assert.throws(
		() => getVoteCommitRetryPayload(pending, { ...context, account: '0x3333333333333333333333333333333333333333' }, ethers.constants.HashZero),
		/active dispute context/
	);
	assert.throws(
		() => getVoteCommitRetryPayload(pending, context, pending.hash),
		/already exists on-chain/
	);
});

test('commit records remain account/chain scoped and recoverable after a reveal reorg', () => {
	const hash = hashFor(2);
	const retainedAfterReceipt = createVoteCommitRecord({
		context,
		vote: 2,
		salt,
		hash,
		status: 'confirmed'
	});
	const serialized = serializeVoteCommit(retainedAfterReceipt);

	assert.equal(voteCommitRecordMatchesContext(retainedAfterReceipt, context), true);
	assert.equal(
		voteCommitRecordMatchesContext(retainedAfterReceipt, { ...context, chainId: 8453 }),
		false
	);
	// If a one-confirmation reveal is reorged, the commitment remains and the
	// retained salt can still be restored and revealed again.
	assert.deepEqual(parseVoteCommit(serialized, context, hash), retainedAfterReceipt);
});

test('rejects status-less v4 backups instead of guessing their broadcast state', () => {
	const hash = hashFor(2);
	const record = createVoteCommitRecord({ context, vote: 2, salt, hash, status: 'confirmed' });
	const { status, ...statuslessV4 } = record;
	const restored = parseVoteCommit(JSON.stringify(statuslessV4), context, hash);

	assert.equal(restored, null);
});

test('does not reinterpret v3 backups after the vote enum changed semantics', () => {
	const hash = hashFor(2);
	const record = createVoteCommitRecord({ context, vote: 2, salt, hash });
	assert.equal(parseVoteCommit(JSON.stringify({ ...record, version: 3 }), context, hash), null);
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
	const abstainHash = hashFor(4);
	assert.doesNotThrow(() => createVoteCommitRecord({ context, vote: 4, salt, hash: abstainHash }));
	assert.throws(() => createVoteCommitRecord({ context, vote: 5, salt, hash }), /Invalid committed vote/);
	assert.throws(() => createVoteCommitRecord({ context, vote: 1, salt: '0x12', hash }), /Invalid vote salt/);
	assert.throws(
		() => createVoteCommitRecord({ context, vote: 1, salt, hash, status: 'unknown' }),
		/Invalid commit backup status/
	);
});

test('cleans up only a finalized failed commit and preserves shallow or contradictory receipts', async () => {
	const transactionHash = `0x${'cd'.repeat(32)}`;
	const blockHash = `0x${'11'.repeat(32)}`;
	const hash = hashFor(1);
	const pending = createVoteCommitRecord({ context, vote: 1, salt, hash });
	const broadcast = updateVoteCommitStatus(pending, 'broadcast', transactionHash, 12);

	assert.equal((await reconcileVoteCommitRecord({
		record: broadcast,
		onChainHash: hash,
		provider: {}
	})).status, VoteCommitReconciliation.Committed);

	const shallowRevertProvider = {
		getTransactionReceipt: async () => ({
			status: 0,
			transactionHash,
			blockNumber: 90,
			blockHash
		}),
		getBlock: async (tag) => tag === 'finalized'
			? { number: 89 }
			: { number: 90, hash: blockHash }
	};
	assert.equal((await reconcileVoteCommitRecord({
		record: broadcast,
		onChainHash: ethers.constants.HashZero,
		provider: shallowRevertProvider
	})).status, VoteCommitReconciliation.Ambiguous);

	const finalizedRevertProvider = {
		...shallowRevertProvider,
		getBlock: async (tag) => tag === 'finalized'
			? { number: 90 }
			: { number: 90, hash: blockHash }
	};
	assert.equal((await reconcileVoteCommitRecord({
		record: broadcast,
		onChainHash: ethers.constants.HashZero,
		provider: finalizedRevertProvider
	})).status, VoteCommitReconciliation.TerminallyNotCommitted);

	const missingBlockHashProvider = {
		...finalizedRevertProvider,
		getTransactionReceipt: async () => ({
			status: 0,
			transactionHash,
			blockNumber: 90
		})
	};
	assert.equal((await reconcileVoteCommitRecord({
		record: broadcast,
		onChainHash: ethers.constants.HashZero,
		provider: missingBlockHashProvider
	})).status, VoteCommitReconciliation.Ambiguous);

	const staleSuccessfulReceipt = {
		...finalizedRevertProvider,
		getTransactionReceipt: async () => ({
			status: 1,
			transactionHash,
			blockNumber: 90,
			blockHash
		})
	};
	assert.equal((await reconcileVoteCommitRecord({
		record: broadcast,
		onChainHash: ethers.constants.HashZero,
		provider: staleSuccessfulReceipt
	})).status, VoteCommitReconciliation.Ambiguous);
});

test('preserves same-calldata speed-ups and requires coherent finalized replacement metadata', async () => {
	const transactionHash = `0x${'cd'.repeat(32)}`;
	const replacementHash = `0x${'ef'.repeat(32)}`;
	const blockHash = `0x${'22'.repeat(32)}`;
	const hash = hashFor(1);
	const broadcast = updateVoteCommitStatus(
		createVoteCommitRecord({ context, vote: 1, salt, hash }),
		'broadcast',
		transactionHash,
		12
	);
	const commitInterface = new ethers.utils.Interface([
		'function commitVote(uint256 disputeId, bytes32 commitHash)'
	]);
	const finalizedProvider = {
		getBlock: async (tag) => tag === 'finalized'
			? { number: 100 }
			: { number: 90, hash: blockHash }
	};
	const receipt = {
		status: 1,
		transactionHash: replacementHash,
		blockNumber: 90,
		blockHash
	};
	const speedUp = {
		hash: replacementHash,
		nonce: 12,
		from: context.account,
		to: context.daoAddress,
		data: commitInterface.encodeFunctionData('commitVote', [context.disputeId, hash])
	};

	assert.equal((await reconcileVoteCommitRecord({
		record: broadcast,
		onChainHash: ethers.constants.HashZero,
		provider: finalizedProvider,
		knownReceipt: receipt,
		knownReplacement: speedUp
	})).status, VoteCommitReconciliation.Ambiguous);

	const cancellation = {
		...speedUp,
		to: context.account,
		data: '0x'
	};
	assert.equal((await reconcileVoteCommitRecord({
		record: broadcast,
		onChainHash: ethers.constants.HashZero,
		provider: finalizedProvider,
		knownReceipt: receipt,
		knownReplacement: cancellation
	})).status, VoteCommitReconciliation.TerminallyNotCommitted);

	assert.equal((await reconcileVoteCommitRecord({
		record: broadcast,
		onChainHash: ethers.constants.HashZero,
		provider: finalizedProvider,
		knownReceipt: receipt,
		knownReplacement: { ...cancellation, nonce: 13 }
	})).status, VoteCommitReconciliation.Ambiguous);

	assert.equal((await reconcileVoteCommitRecord({
		record: broadcast,
		onChainHash: ethers.constants.HashZero,
		provider: finalizedProvider,
		knownReceipt: receipt
	})).status, VoteCommitReconciliation.Ambiguous);
});

test('a nonce advance or missing transaction metadata remains ambiguous', async () => {
	const transactionHash = `0x${'cd'.repeat(32)}`;
	const hash = hashFor(1);
	const pending = createVoteCommitRecord({ context, vote: 1, salt, hash });
	const broadcast = updateVoteCommitStatus(pending, 'broadcast', transactionHash, 12);
	const droppedProvider = {
		getTransactionReceipt: async () => null,
		getTransactionCount: async () => 13
	};
	assert.equal((await reconcileVoteCommitRecord({
		record: broadcast,
		onChainHash: ethers.constants.HashZero,
		provider: droppedProvider
	})).status, VoteCommitReconciliation.Ambiguous);

	const pendingProvider = {
		getTransactionReceipt: async () => null,
		getTransactionCount: async () => 12
	};
	assert.equal((await reconcileVoteCommitRecord({
		record: broadcast,
		onChainHash: ethers.constants.HashZero,
		provider: pendingProvider
	})).status, VoteCommitReconciliation.Ambiguous);
	assert.equal((await reconcileVoteCommitRecord({
		record: pending,
		onChainHash: ethers.constants.HashZero,
		provider: droppedProvider
	})).status, VoteCommitReconciliation.Ambiguous);
});
