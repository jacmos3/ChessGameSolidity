import { ethers } from 'ethers';
import { isValidArbitratorVote } from './disputeModel.js';

const STORAGE_PREFIX = 'mychess:vote-commit:v4';
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const VALID_STATUSES = new Set(['pending', 'broadcast', 'confirmed']);

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

function normalizePositiveInteger(value, label) {
	const normalized = normalizeInteger(value, label);
	if (normalized === 0) throw new Error(`Invalid ${label}`);
	return normalized;
}

function normalizeContext(context) {
	return {
		chainId: normalizeInteger(context.chainId, 'chain id'),
		daoAddress: normalizeAddress(context.daoAddress),
		account: normalizeAddress(context.account),
		gameId: normalizeInteger(context.gameId, 'game id'),
		disputeId: normalizePositiveInteger(context.disputeId, 'dispute id')
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

export function computeVoteCommitHash({ context, vote, salt }) {
	const normalized = normalizeContext(context);
	const normalizedVote = Number(vote);
	if (!isValidArbitratorVote(normalizedVote)) throw new Error('Invalid committed vote');
	if (typeof salt !== 'string' || !BYTES32_PATTERN.test(salt)) throw new Error('Invalid vote salt');

	return ethers.utils.keccak256(
		ethers.utils.defaultAbiCoder.encode(
			['uint256', 'address', 'uint256', 'uint8', 'bytes32', 'address'],
			[
				normalized.chainId,
				normalized.daoAddress,
				normalized.disputeId,
				normalizedVote,
				salt,
				normalized.account
			]
		)
	).toLowerCase();
}

export function createVoteCommitRecord({
	context,
	vote,
	salt,
	hash,
	createdAt = Date.now(),
	status = 'pending',
	transactionHash = '',
	nonce
}) {
	const normalized = normalizeContext(context);
	const normalizedVote = Number(vote);
	if (!isValidArbitratorVote(normalizedVote)) throw new Error('Invalid committed vote');
	if (typeof salt !== 'string' || !BYTES32_PATTERN.test(salt)) throw new Error('Invalid vote salt');
	if (typeof hash !== 'string' || !BYTES32_PATTERN.test(hash)) throw new Error('Invalid commit hash');
	if (hash.toLowerCase() !== computeVoteCommitHash({ context: normalized, vote: normalizedVote, salt })) {
		throw new Error('Commit hash does not match reveal data');
	}
	if (!VALID_STATUSES.has(status)) throw new Error('Invalid commit backup status');
	if (transactionHash && !BYTES32_PATTERN.test(transactionHash)) {
		throw new Error('Invalid commit transaction hash');
	}
	const normalizedNonce = nonce === undefined || nonce === null
		? undefined
		: normalizeInteger(nonce, 'commit transaction nonce');

	return {
		version: 4,
		...normalized,
		vote: normalizedVote,
		salt: salt.toLowerCase(),
		hash: hash.toLowerCase(),
		createdAt: normalizeInteger(createdAt, 'creation time'),
		status,
		...(transactionHash ? { transactionHash: transactionHash.toLowerCase() } : {}),
		...(normalizedNonce === undefined ? {} : { nonce: normalizedNonce })
	};
}

export function updateVoteCommitStatus(
	record,
	status,
	transactionHash = record.transactionHash || '',
	nonce = record.nonce
) {
	return createVoteCommitRecord({
		context: record,
		vote: record.vote,
		salt: record.salt,
		hash: record.hash,
		createdAt: record.createdAt,
		status,
		transactionHash,
		nonce
	});
}

export function serializeVoteCommit(record) {
	return JSON.stringify(record);
}

export function parseVoteCommit(serialized, expectedContext, expectedHash = '') {
	if (!serialized) return null;

	try {
		const parsed = JSON.parse(serialized);
		if (!VALID_STATUSES.has(parsed.status)) return null;
		const record = createVoteCommitRecord({
			context: parsed,
			vote: parsed.vote,
			salt: parsed.salt,
				hash: parsed.hash,
				createdAt: parsed.createdAt,
				status: parsed.status,
				transactionHash: parsed.transactionHash || '',
				nonce: parsed.nonce
		});
		const expected = normalizeContext(expectedContext);

		if (parsed.version !== 4) return null;
		for (const field of ['chainId', 'daoAddress', 'account', 'gameId', 'disputeId']) {
			if (record[field] !== expected[field]) return null;
		}
		const normalizedExpectedHash = typeof expectedHash === 'string'
			? expectedHash.toLowerCase()
			: '';
		if (normalizedExpectedHash && normalizedExpectedHash !== ethers.constants.HashZero &&
			record.hash !== normalizedExpectedHash) return null;

		return record;
	} catch {
		return null;
	}
}

export function voteCommitRecordMatchesContext(record, expectedContext) {
	if (!record) return false;
	try {
		return Boolean(parseVoteCommit(serializeVoteCommit(record), expectedContext));
	} catch {
		return false;
	}
}

/**
 * Build an idempotent retry from an ambiguous backup. Reusing the original
 * vote and salt is safe even if an earlier transaction is still pending: both
 * transactions carry the same commitment, so they cannot create conflicting
 * reveal data.
 */
export function getVoteCommitRetryPayload(record, expectedContext, onChainHash) {
	if (typeof onChainHash !== 'string' || !BYTES32_PATTERN.test(onChainHash)) {
		throw new Error('Invalid on-chain vote commitment');
	}
	if (onChainHash.toLowerCase() !== ethers.constants.HashZero) {
		throw new Error('A vote commitment already exists on-chain');
	}

	const restored = parseVoteCommit(
		serializeVoteCommit(record),
		expectedContext,
		ethers.constants.HashZero
	);
	if (!restored) {
		throw new Error('Saved vote commitment does not match the active dispute context');
	}

	return {
		disputeId: restored.disputeId,
		vote: restored.vote,
		salt: restored.salt,
		hash: restored.hash
	};
}

export const VoteCommitReconciliation = {
	Committed: 'committed',
	TerminallyNotCommitted: 'terminally-not-committed',
	Ambiguous: 'ambiguous',
	ConflictingCommit: 'conflicting-commit'
};

const COMMIT_VOTE_INTERFACE = new ethers.utils.Interface([
	'function commitVote(uint256 disputeId, bytes32 commitHash)'
]);

function normalizedTransactionHash(value) {
	return typeof value === 'string' && BYTES32_PATTERN.test(value)
		? value.toLowerCase()
		: '';
}

function normalizedTransactionData(value) {
	return typeof value === 'string' && /^0x(?:[0-9a-fA-F]{2})*$/.test(value)
		? value.toLowerCase()
		: '';
}

async function receiptIsFinalized(provider, receipt) {
	const blockNumber = Number(receipt?.blockNumber);
	if (!provider?.getBlock || !Number.isSafeInteger(blockNumber) || blockNumber < 0) {
		return false;
	}

	try {
		const finalizedBlock = await provider.getBlock('finalized');
		const finalizedNumber = Number(finalizedBlock?.number);
		if (!Number.isSafeInteger(finalizedNumber) || finalizedNumber < blockNumber) return false;

		// If the receipt includes its block hash, ensure the finalized canonical
		// block still has that hash. This keeps a cached receipt from being treated
		// as proof after a shallow reorg.
		const receiptBlockHash = normalizedTransactionHash(receipt.blockHash);
		if (!receiptBlockHash) return false;
		const canonicalBlock = await provider.getBlock(blockNumber);
		if (normalizedTransactionHash(canonicalBlock?.hash) !== receiptBlockHash) return false;
		return true;
	} catch {
		// Providers that do not expose the finalized tag cannot prove finality.
		return false;
	}
}

function replacementTransactionMatchesRecord(replacement, receipt, record) {
	const transaction = replacement?.transaction || replacement;
	if (!transaction || typeof transaction !== 'object') return null;

	const transactionHash = normalizedTransactionHash(transaction.hash || transaction.transactionHash);
	const receiptHash = normalizedTransactionHash(receipt?.transactionHash || receipt?.hash);
	if (!transactionHash || !receiptHash || transactionHash !== receiptHash) return null;

	const nonce = Number(transaction.nonce);
	if (!Number.isSafeInteger(nonce) || nonce !== record.nonce) return null;

	let from;
	try {
		from = normalizeAddress(transaction.from);
	} catch {
		return null;
	}
	if (from !== normalizeAddress(record.account)) return null;

	let to;
	try {
		to = normalizeAddress(transaction.to);
	} catch {
		return null;
	}
	const data = normalizedTransactionData(transaction.data || transaction.input);
	if (!data) return null;

	const expectedData = COMMIT_VOTE_INTERFACE.encodeFunctionData('commitVote', [
		record.disputeId,
		record.hash
	]).toLowerCase();

	return {
		isSameCommit: to === normalizeAddress(record.daoAddress) && data === expectedData
	};
}

export async function reconcileVoteCommitRecord({
	record,
	onChainHash,
	provider,
	knownReceipt = null,
	knownReplacement = null
}) {
	if (!record || typeof record.hash !== 'string' || !BYTES32_PATTERN.test(record.hash)) {
		throw new Error('Invalid vote commit record');
	}
	if (typeof onChainHash !== 'string' || !BYTES32_PATTERN.test(onChainHash)) {
		throw new Error('Invalid on-chain vote commitment');
	}

	const normalizedOnChainHash = onChainHash.toLowerCase();
	if (normalizedOnChainHash === record.hash.toLowerCase()) {
		return { status: VoteCommitReconciliation.Committed };
	}
	if (normalizedOnChainHash !== ethers.constants.HashZero) {
		return { status: VoteCommitReconciliation.ConflictingCommit };
	}
	if (!record.transactionHash || record.nonce === undefined || record.nonce === null || !provider) {
		return { status: VoteCommitReconciliation.Ambiguous };
	}

	let receipt = knownReceipt;
	if (!receipt) {
		try {
			receipt = await provider.getTransactionReceipt(record.transactionHash);
		} catch {
			return { status: VoteCommitReconciliation.Ambiguous };
		}
	}

	if (receipt) {
		const receiptHash = normalizedTransactionHash(receipt.transactionHash || receipt.hash);
		const savedHash = record.transactionHash.toLowerCase();
		const finalized = await receiptIsFinalized(provider, receipt);

		if (receiptHash === savedHash) {
			// A successful receipt with a zero on-chain commitment is contradictory
			// (stale RPC, wrong fork, or reorg), so it must never discard the salt.
			if (Number(receipt.status) === 0 && finalized) {
				return { status: VoteCommitReconciliation.TerminallyNotCommitted };
			}
			return { status: VoteCommitReconciliation.Ambiguous };
		}

		if (receiptHash) {
			// A TRANSACTION_REPLACED error can carry the replacement response. A
			// receipt hash alone does not prove which nonce, sender, target, or
			// calldata was mined. Preserve the secret unless all metadata is
			// coherent and the replacement receipt is finalized.
			const replacement = replacementTransactionMatchesRecord(
				knownReplacement,
				receipt,
				record
			);
			if (!finalized || !replacement || replacement.isSameCommit) {
				return { status: VoteCommitReconciliation.Ambiguous };
			}
			if (Number(receipt.status) === 0 || Number(receipt.status) === 1) {
				return { status: VoteCommitReconciliation.TerminallyNotCommitted };
			}
		}
		return { status: VoteCommitReconciliation.Ambiguous };
	}

	try {
		const latestNonce = Number(await provider.getTransactionCount(record.account, 'latest'));
		if (Number.isSafeInteger(latestNonce) && latestNonce > record.nonce) {
			// A nonce advance does not identify the transaction that consumed this
			// nonce and can disagree across RPC replicas. It is never proof that the
			// commitment is absent; retain the exact vote and salt for recovery.
			return { status: VoteCommitReconciliation.Ambiguous };
		}
	} catch {
		// A provider failure cannot prove that the saved transaction is dead.
	}

	return { status: VoteCommitReconciliation.Ambiguous };
}
