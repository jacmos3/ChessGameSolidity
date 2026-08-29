import { ethers } from 'ethers';

const STORAGE_PREFIX = 'mychess:vote-commit:v2';
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const VALID_VOTES = new Set([1, 2, 3]);

function normalizeAddress(address) {
	if (typeof address !== 'string' || !ADDRESS_PATTERN.test(address)) {
		throw new Error('Invalid commit address');
	}
	return address.toLowerCase();
}

function normalizeInteger(value, label) {
	const normalized = Number(value);
	if (!Number.isSafeInteger(normalized) || normalized < 0) {
		throw new Error(`Invalid ${label}`);
	}
	return normalized;
}

function normalizeContext(context) {
	return {
		chainId: normalizeInteger(context.chainId, 'chain id'),
		daoAddress: normalizeAddress(context.daoAddress),
		account: normalizeAddress(context.account),
		gameId: normalizeInteger(context.gameId, 'game id'),
		disputeId: normalizeInteger(context.disputeId, 'dispute id')
	};
}

export function getVoteCommitStorageKey(context) {
	const normalized = normalizeContext(context);
	return [
		STORAGE_PREFIX,
		normalized.chainId,
		normalized.daoAddress,
		normalized.account,
		normalized.disputeId
	].join(':');
}

export function computeVoteCommitHash({ vote, salt, account }) {
	const normalizedVote = Number(vote);
	if (!VALID_VOTES.has(normalizedVote)) throw new Error('Invalid committed vote');
	if (typeof salt !== 'string' || !BYTES32_PATTERN.test(salt)) throw new Error('Invalid vote salt');

	return ethers.utils.solidityKeccak256(
		['uint8', 'bytes32', 'address'],
		[normalizedVote, salt, normalizeAddress(account)]
	).toLowerCase();
}

export function createVoteCommitRecord({ context, vote, salt, hash, createdAt = Date.now() }) {
	const normalized = normalizeContext(context);
	const normalizedVote = Number(vote);
	if (!VALID_VOTES.has(normalizedVote)) throw new Error('Invalid committed vote');
	if (typeof salt !== 'string' || !BYTES32_PATTERN.test(salt)) throw new Error('Invalid vote salt');
	if (typeof hash !== 'string' || !BYTES32_PATTERN.test(hash)) throw new Error('Invalid commit hash');
	if (hash.toLowerCase() !== computeVoteCommitHash({ vote: normalizedVote, salt, account: normalized.account })) {
		throw new Error('Commit hash does not match reveal data');
	}

	return {
		version: 2,
		...normalized,
		vote: normalizedVote,
		salt: salt.toLowerCase(),
		hash: hash.toLowerCase(),
		createdAt: normalizeInteger(createdAt, 'creation time')
	};
}

export function serializeVoteCommit(record) {
	return JSON.stringify(record);
}

export function parseVoteCommit(serialized, expectedContext, expectedHash = '') {
	if (!serialized) return null;

	try {
		const parsed = JSON.parse(serialized);
		const record = createVoteCommitRecord({
			context: parsed,
			vote: parsed.vote,
			salt: parsed.salt,
			hash: parsed.hash,
			createdAt: parsed.createdAt
		});
		const expected = normalizeContext(expectedContext);

		if (parsed.version !== 2) return null;
		for (const field of ['chainId', 'daoAddress', 'account', 'gameId', 'disputeId']) {
			if (record[field] !== expected[field]) return null;
		}
		if (expectedHash && record.hash !== expectedHash.toLowerCase()) return null;

		return record;
	} catch {
		return null;
	}
}
