import { writable, derived, get } from 'svelte/store';
import { wallet } from './wallet.js';
import { ethers } from 'ethers';
import { loadContractAbi } from '../contracts/loadAbi.js';
import { getTransactionFeeOverrides } from '../utils/transactionFees.js';

// Contract addresses per network
const GOVERNOR_ADDRESSES = {
	1337: import.meta.env.VITE_CHESS_GOVERNOR_LOCAL || '',
	5777: import.meta.env.VITE_CHESS_GOVERNOR_LOCAL || '',
	84532: import.meta.env.VITE_CHESS_GOVERNOR_BASE_SEPOLIA || ''
};

const TIMELOCK_ADDRESSES = {
	1337: import.meta.env.VITE_CHESS_TIMELOCK_LOCAL || '',
	5777: import.meta.env.VITE_CHESS_TIMELOCK_LOCAL || '',
	84532: import.meta.env.VITE_CHESS_TIMELOCK_BASE_SEPOLIA || ''
};

const CHESS_TOKEN_ADDRESSES = {
	1337: import.meta.env.VITE_CHESS_TOKEN_LOCAL || '',
	5777: import.meta.env.VITE_CHESS_TOKEN_LOCAL || '',
	84532: import.meta.env.VITE_CHESS_TOKEN_BASE_SEPOLIA || ''
};

const getChessGovernorAbi = () => loadContractAbi('ChessGovernor');
const getChessTimelockAbi = () => loadContractAbi('ChessTimelock');
const getChessTokenAbi = () => loadContractAbi('ChessToken');

const DELEGATE_INTERFACE = new ethers.utils.Interface([
	'function delegate(address delegatee)'
]);

const GOVERNOR_WRITE_METHODS = new Set(['propose', 'castVote', 'queue', 'execute']);

function normalizeGovernanceAddress(value, label) {
	if (!value || !ethers.utils.isAddress(value)) {
		throw new Error(`${label} is not a valid address`);
	}
	return ethers.utils.getAddress(value);
}

function hasContractCode(code) {
	return typeof code === 'string' && !/^0x0*$/i.test(code);
}

export async function verifyCanonicalGovernanceContext({
	provider,
	signer,
	account,
	chainId,
	tokenAddress,
	governorAddress,
	timelockAddress,
	governor
}) {
	if (!provider?.getNetwork || !provider?.getCode || !signer?.getAddress) {
		throw new Error('Wallet provider is not available');
	}
	if (!governor?.token || !governor?.timelock) {
		throw new Error('ChessGovernor does not expose its token and timelock links');
	}
	const normalizedChainId = Number(chainId);
	if (!Number.isSafeInteger(normalizedChainId) || normalizedChainId <= 0) {
		throw new Error('Governance network is not valid');
	}
	const normalizedAccount = normalizeGovernanceAddress(account, 'Wallet account');
	const normalizedTokenAddress = normalizeGovernanceAddress(tokenAddress, 'ChessToken');
	const normalizedGovernorAddress = normalizeGovernanceAddress(governorAddress, 'ChessGovernor');
	const normalizedTimelockAddress = normalizeGovernanceAddress(timelockAddress, 'ChessTimelock');
	if (governor.address &&
		normalizeGovernanceAddress(governor.address, 'Governor contract') !== normalizedGovernorAddress) {
		throw new Error('Governor instance does not match the configured ChessGovernor');
	}

	const [
		network,
		signerAddress,
		tokenCode,
		governorCode,
		timelockCode,
		linkedToken,
		linkedTimelock
	] = await Promise.all([
		provider.getNetwork(),
		signer.getAddress(),
		provider.getCode(normalizedTokenAddress),
		provider.getCode(normalizedGovernorAddress),
		provider.getCode(normalizedTimelockAddress),
		governor.token(),
		governor.timelock()
	]);
	if (Number(network?.chainId) !== normalizedChainId) {
		throw new Error('Wallet network changed before governance transaction');
	}
	if (normalizeGovernanceAddress(signerAddress, 'Signer account') !== normalizedAccount) {
		throw new Error('Wallet account changed before governance transaction');
	}
	if (!hasContractCode(tokenCode)) {
		throw new Error('Configured ChessToken is not a contract on this network');
	}
	if (!hasContractCode(governorCode)) {
		throw new Error('Configured ChessGovernor is not a contract on this network');
	}
	if (!hasContractCode(timelockCode)) {
		throw new Error('Configured ChessTimelock is not a contract on this network');
	}
	if (normalizeGovernanceAddress(linkedToken, 'Governor token') !== normalizedTokenAddress) {
		throw new Error('ChessGovernor token does not match the configured ChessToken');
	}
	if (normalizeGovernanceAddress(linkedTimelock, 'Governor timelock') !== normalizedTimelockAddress) {
		throw new Error('ChessGovernor timelock does not match the configured ChessTimelock');
	}

	return {
		chainId: normalizedChainId,
		account: normalizedAccount,
		tokenAddress: normalizedTokenAddress,
		governorAddress: normalizedGovernorAddress,
		timelockAddress: normalizedTimelockAddress
	};
}

function sanitizeGovernanceOverrides(overrides = {}) {
	const safeOverrides = { ...overrides };
	delete safeOverrides.from;
	delete safeOverrides.chainId;
	delete safeOverrides.to;
	delete safeOverrides.data;
	delete safeOverrides.value;
	return safeOverrides;
}

function captureGovernanceWriteContext(walletState) {
	if (!walletState?.provider || !walletState?.signer ||
		!walletState?.account || !walletState?.chainId) {
		throw new Error('Wallet not connected');
	}
	const chainId = Number(walletState.chainId);
	if (!Number.isSafeInteger(chainId) || chainId <= 0) {
		throw new Error('Governance network is not valid');
	}
	const tokenAddress = CHESS_TOKEN_ADDRESSES[chainId];
	const governorAddress = GOVERNOR_ADDRESSES[chainId];
	const timelockAddress = TIMELOCK_ADDRESSES[chainId];
	if (!tokenAddress || !governorAddress || !timelockAddress) {
		throw new Error('Governance contracts are not available on this network');
	}
	return {
		provider: walletState.provider,
		signer: walletState.signer,
		account: normalizeGovernanceAddress(walletState.account, 'Wallet account'),
		chainId,
		tokenAddress: normalizeGovernanceAddress(tokenAddress, 'ChessToken'),
		governorAddress: normalizeGovernanceAddress(governorAddress, 'ChessGovernor'),
		timelockAddress: normalizeGovernanceAddress(timelockAddress, 'ChessTimelock')
	};
}

function tryCaptureGovernanceReadContext(walletState) {
	try {
		return captureGovernanceWriteContext(walletState);
	} catch {
		return null;
	}
}

function governanceReadContextsEqual(left, right) {
	if (left === null || right === null) return left === right;
	return left.provider === right.provider && left.signer === right.signer &&
		left.account === right.account && left.chainId === right.chainId &&
		left.tokenAddress === right.tokenAddress &&
		left.governorAddress === right.governorAddress &&
		left.timelockAddress === right.timelockAddress;
}

/**
 * Track every wallet governance-context transition, including A -> B -> A.
 * A simple equality check at response time misses that round trip and can let an
 * old RPC result overwrite newer UI state. The monotonically increasing epoch
 * makes every captured read ticket invalid as soon as the context changes.
 */
export function createGovernanceReadEpoch(initialContext = null) {
	let context = initialContext;
	let generation = 0;

	return {
		sync(nextContext) {
			if (!governanceReadContextsEqual(context, nextContext)) {
				context = nextContext;
				generation++;
			}
			return generation;
		},
		capture(nextContext) {
			this.sync(nextContext);
			return { generation, context: nextContext };
		},
		isCurrent(ticket, nextContext) {
			this.sync(nextContext);
			return ticket?.generation === generation &&
				governanceReadContextsEqual(ticket?.context ?? null, nextContext);
		},
		invalidate() {
			generation++;
		}
	};
}

function assertCurrentGovernanceContext(expected) {
	let current;
	try {
		current = captureGovernanceWriteContext(get(wallet));
	} catch {
		throw new Error('Wallet governance context changed before transaction');
	}
	if (current.provider !== expected.provider || current.signer !== expected.signer ||
		current.account !== expected.account || current.chainId !== expected.chainId ||
		current.tokenAddress !== expected.tokenAddress ||
		current.governorAddress !== expected.governorAddress ||
		current.timelockAddress !== expected.timelockAddress) {
		throw new Error('Wallet governance context changed before transaction');
	}
}

export function assertBoundDelegateTransaction({ request, tokenAddress, delegatee }) {
	if (!request || typeof request !== 'object') {
		throw new Error('ChessToken did not populate a delegation transaction');
	}
	const expectedToken = normalizeGovernanceAddress(tokenAddress, 'ChessToken');
	const expectedDelegatee = normalizeGovernanceAddress(delegatee, 'Delegatee');
	const actualTarget = normalizeGovernanceAddress(request.to, 'Delegation target');
	if (actualTarget !== expectedToken) {
		throw new Error('Delegation transaction target does not match the configured ChessToken');
	}
	const expectedData = DELEGATE_INTERFACE.encodeFunctionData('delegate', [expectedDelegatee]);
	if (typeof request.data !== 'string' || request.data.toLowerCase() !== expectedData.toLowerCase()) {
		throw new Error('Delegation transaction calldata does not match the requested delegatee');
	}
	if (request.value !== undefined && !ethers.BigNumber.from(request.value).isZero()) {
		throw new Error('Delegation transaction must not transfer value');
	}
}

export async function sendBoundDelegateTransaction({
	provider,
	signer,
	account,
	chainId,
	tokenAddress,
	governorAddress,
	timelockAddress,
	delegatee,
	token,
	governor,
	overrides = {},
	assertCurrentContext
}) {
	if (!token?.populateTransaction?.delegate) {
		throw new Error('ChessToken does not expose delegation');
	}
	const normalizedDelegatee = normalizeGovernanceAddress(delegatee, 'Delegatee');
	const safeOverrides = sanitizeGovernanceOverrides(overrides);

	const request = await token.populateTransaction.delegate(normalizedDelegatee, safeOverrides);
	if (assertCurrentContext) await assertCurrentContext();
	const verified = await verifyCanonicalGovernanceContext({
		provider,
		signer,
		account,
		chainId,
		tokenAddress,
		governorAddress,
		timelockAddress,
		governor
	});
	assertBoundDelegateTransaction({
		request,
		tokenAddress: verified.tokenAddress,
		delegatee: normalizedDelegatee
	});

	return signer.sendTransaction({
		...safeOverrides,
		to: verified.tokenAddress,
		data: DELEGATE_INTERFACE.encodeFunctionData('delegate', [normalizedDelegatee]),
		value: 0,
		from: verified.account,
		chainId: verified.chainId
	});
}

export function assertBoundGovernorTransaction({
	request,
	governorAddress,
	governorInterface,
	method,
	args,
	expectedValue = 0
}) {
	if (!request || typeof request !== 'object') {
		throw new Error('ChessGovernor did not populate a governance transaction');
	}
	if (!GOVERNOR_WRITE_METHODS.has(method)) {
		throw new Error('Unsupported ChessGovernor write method');
	}
	if (!governorInterface?.encodeFunctionData) {
		throw new Error('ChessGovernor interface is not available');
	}
	const expectedGovernor = normalizeGovernanceAddress(governorAddress, 'ChessGovernor');
	const actualTarget = normalizeGovernanceAddress(request.to, 'Governance target');
	if (actualTarget !== expectedGovernor) {
		throw new Error('Governance transaction target does not match the configured ChessGovernor');
	}
	const expectedData = governorInterface.encodeFunctionData(method, args);
	if (typeof request.data !== 'string' || request.data.toLowerCase() !== expectedData.toLowerCase()) {
		throw new Error('Governance transaction calldata does not match the requested operation');
	}
	const actualValue = ethers.BigNumber.from(request.value ?? 0);
	const normalizedExpectedValue = ethers.BigNumber.from(expectedValue);
	if (!actualValue.eq(normalizedExpectedValue)) {
		throw new Error('Governance transaction value does not match the requested operation');
	}
	return { data: expectedData, value: normalizedExpectedValue };
}

export async function sendBoundGovernorTransaction({
	provider,
	signer,
	account,
	chainId,
	tokenAddress,
	governorAddress,
	timelockAddress,
	governor,
	method,
	args,
	expectedValue = 0,
	overrides = {},
	assertCurrentContext
}) {
	if (!GOVERNOR_WRITE_METHODS.has(method) ||
		!governor?.populateTransaction?.[method]) {
		throw new Error('ChessGovernor does not expose the requested write method');
	}
	const safeOverrides = sanitizeGovernanceOverrides(overrides);
	const request = await governor.populateTransaction[method](...args, {
		...safeOverrides,
		value: expectedValue
	});
	if (assertCurrentContext) await assertCurrentContext();
	const verified = await verifyCanonicalGovernanceContext({
		provider,
		signer,
		account,
		chainId,
		tokenAddress,
		governorAddress,
		timelockAddress,
		governor
	});
	const bound = assertBoundGovernorTransaction({
		request,
		governorAddress: verified.governorAddress,
		governorInterface: governor.interface,
		method,
		args,
		expectedValue
	});

	return signer.sendTransaction({
		...safeOverrides,
		to: verified.governorAddress,
		data: bound.data,
		value: bound.value,
		from: verified.account,
		chainId: verified.chainId
	});
}

function findGovernorEvent(receipt, governorInterface, eventName) {
	const parsedEvent = receipt?.events?.find(event => event.event === eventName);
	if (parsedEvent) return parsedEvent;
	for (const log of receipt?.logs || []) {
		try {
			const parsed = governorInterface.parseLog(log);
			if (parsed?.name === eventName) return parsed;
		} catch {
			// Ignore logs emitted by proposal targets or other contracts.
		}
	}
	return null;
}

// Proposal states (from Governor contract)
export const ProposalState = {
	Pending: 0,
	Active: 1,
	Canceled: 2,
	Defeated: 3,
	Succeeded: 4,
	Queued: 5,
	Expired: 6,
	Executed: 7
};

// Vote types
export const VoteType = {
	Against: 0,
	For: 1,
	Abstain: 2
};

// Governance store
function createGovernanceStore() {
	const { subscribe, set, update } = writable({
		loading: false,
		error: null,
		// Governor parameters
		votingDelay: 0,      // blocks
		votingPeriod: 0,     // blocks
		proposalThreshold: '0',
		quorum: '0',
		// Timelock parameters
		timelockDelay: 0,    // seconds
		// User voting power
		votingPower: '0',
		delegates: '',
		// Proposals list
		proposals: []
	});
	const readEpoch = createGovernanceReadEpoch();
	let paramsRequestGeneration = 0;

	// The singleton store lives for the application lifetime. Only governance-
	// relevant identity changes advance the epoch; balance refreshes do not.
	wallet.subscribe(walletState => {
		readEpoch.sync(tryCaptureGovernanceReadContext(walletState));
	});

	function captureCurrentRead() {
		const context = tryCaptureGovernanceReadContext(get(wallet));
		return context ? readEpoch.capture(context) : null;
	}

	function isCurrentRead(ticket) {
		return !!ticket && readEpoch.isCurrent(
			ticket,
			tryCaptureGovernanceReadContext(get(wallet))
		);
	}

	return {
		subscribe,

		/**
		 * Fetch governance parameters
		 */
		async fetchParams() {
			const readTicket = captureCurrentRead();
			if (!readTicket) return;
			const expected = readTicket.context;
			const requestGeneration = ++paramsRequestGeneration;

			update(s => ({ ...s, loading: true, error: null }));

			try {
				const [chessGovernorAbi, chessTimelockAbi, chessTokenAbi] = await Promise.all([
					getChessGovernorAbi(),
					getChessTimelockAbi(),
					getChessTokenAbi()
				]);
				const governor = new ethers.Contract(
					expected.governorAddress,
					chessGovernorAbi,
					expected.signer
				);
				const timelock = new ethers.Contract(
					expected.timelockAddress,
					chessTimelockAbi,
					expected.signer
				);
				const token = new ethers.Contract(
					expected.tokenAddress,
					chessTokenAbi,
					expected.signer
				);

				const [
					votingDelay,
					votingPeriod,
					proposalThreshold,
					votingPower,
					delegates,
					timelockDelay
				] = await Promise.all([
					governor.votingDelay(),
					governor.votingPeriod(),
					governor.proposalThreshold(),
					token.getVotes(expected.account),
					token.delegates(expected.account),
					timelock.getMinDelay()
				]);

				// Get current block for quorum calculation
				const blockNumber = await expected.provider.getBlockNumber();
				let quorum = '0';
				try {
					quorum = await governor.quorum(blockNumber - 1);
				} catch {
					// Quorum might fail for very recent blocks
				}

				if (!isCurrentRead(readTicket) ||
					requestGeneration !== paramsRequestGeneration) return;

				update(s => ({
					...s,
					loading: false,
					votingDelay: votingDelay.toNumber(),
					votingPeriod: votingPeriod.toNumber(),
					proposalThreshold: ethers.utils.formatEther(proposalThreshold),
					quorum: ethers.utils.formatEther(quorum),
					votingPower: ethers.utils.formatEther(votingPower),
					delegates: delegates,
					timelockDelay: timelockDelay.toNumber()
				}));
			} catch (err) {
				if (!isCurrentRead(readTicket) ||
					requestGeneration !== paramsRequestGeneration) return;
				console.error('Error fetching governance params:', err);
				update(s => ({ ...s, loading: false, error: err.message }));
			}
		},

		/**
		 * Delegate voting power to an address
		 */
		async delegate(delegatee) {
			const $wallet = get(wallet);
			const expected = captureGovernanceWriteContext($wallet);

			update(s => ({ ...s, loading: true, error: null }));

			try {
				const [chessTokenAbi, chessGovernorAbi] = await Promise.all([
					getChessTokenAbi(),
					getChessGovernorAbi()
				]);
				const token = new ethers.Contract(expected.tokenAddress, chessTokenAbi, expected.signer);
				const governor = new ethers.Contract(
					expected.governorAddress,
					chessGovernorAbi,
					expected.signer
				);
				const feeOverrides = await getTransactionFeeOverrides(expected.provider, expected.chainId);
				const tx = await sendBoundDelegateTransaction({
					...expected,
					delegatee,
					token,
					governor,
					overrides: feeOverrides,
					assertCurrentContext: () => assertCurrentGovernanceContext(expected)
				});
				await tx.wait();

				await this.fetchParams();
				return true;
			} catch (err) {
				console.error('Error delegating:', err);
				update(s => ({ ...s, loading: false, error: err.message }));
				throw err;
			}
		},

		/**
		 * Self-delegate (activate voting power)
		 */
		async selfDelegate() {
			const $wallet = get(wallet);
			return this.delegate($wallet.account);
		},

		/**
		 * Create a proposal
		 * @param targets Array of target contract addresses
		 * @param values Array of ETH values (usually 0)
		 * @param calldatas Array of encoded function calls
		 * @param description Human-readable description
		 */
		async propose(targets, values, calldatas, description) {
			const $wallet = get(wallet);
			const expected = captureGovernanceWriteContext($wallet);

			update(s => ({ ...s, loading: true, error: null }));

			try {
				const chessGovernorAbi = await getChessGovernorAbi();
				const governor = new ethers.Contract(
					expected.governorAddress,
					chessGovernorAbi,
					expected.signer
				);
				const feeOverrides = await getTransactionFeeOverrides(expected.provider, expected.chainId);
				const tx = await sendBoundGovernorTransaction({
					...expected,
					governor,
					method: 'propose',
					args: [targets, values, calldatas, description],
					overrides: feeOverrides,
					assertCurrentContext: () => assertCurrentGovernanceContext(expected)
				});
				const receipt = await tx.wait();

				// Get proposal ID from event
				const event = findGovernorEvent(receipt, governor.interface, 'ProposalCreated');
				const proposalId = event?.args?.proposalId;

				update(s => ({ ...s, loading: false }));
				return proposalId?.toString();
			} catch (err) {
				console.error('Error creating proposal:', err);
				update(s => ({ ...s, loading: false, error: err.message }));
				throw err;
			}
		},

		/**
		 * Get proposal state
		 */
		async getProposalState(proposalId) {
			const readTicket = captureCurrentRead();
			if (!readTicket) return null;
			const expected = readTicket.context;

			try {
				const chessGovernorAbi = await getChessGovernorAbi();
				const governor = new ethers.Contract(
					expected.governorAddress,
					chessGovernorAbi,
					expected.signer
				);
				const state = await governor.state(proposalId);
				return isCurrentRead(readTicket) ? state : null;
			} catch (err) {
				if (!isCurrentRead(readTicket)) return null;
				console.error('Error getting proposal state:', err);
				return null;
			}
		},

		/**
		 * Cast a vote
		 * @param proposalId The proposal ID
		 * @param support 0=Against, 1=For, 2=Abstain
		 */
		async castVote(proposalId, support) {
			const $wallet = get(wallet);
			const expected = captureGovernanceWriteContext($wallet);

			update(s => ({ ...s, loading: true, error: null }));

			try {
				const chessGovernorAbi = await getChessGovernorAbi();
				const governor = new ethers.Contract(
					expected.governorAddress,
					chessGovernorAbi,
					expected.signer
				);
				const feeOverrides = await getTransactionFeeOverrides(expected.provider, expected.chainId);
				const tx = await sendBoundGovernorTransaction({
					...expected,
					governor,
					method: 'castVote',
					args: [proposalId, support],
					overrides: feeOverrides,
					assertCurrentContext: () => assertCurrentGovernanceContext(expected)
				});
				await tx.wait();

				update(s => ({ ...s, loading: false }));
				return true;
			} catch (err) {
				console.error('Error casting vote:', err);
				update(s => ({ ...s, loading: false, error: err.message }));
				throw err;
			}
		},

		/**
		 * Queue a successful proposal
		 */
		async queue(targets, values, calldatas, descriptionHash) {
			const $wallet = get(wallet);
			const expected = captureGovernanceWriteContext($wallet);

			update(s => ({ ...s, loading: true, error: null }));

			try {
				const chessGovernorAbi = await getChessGovernorAbi();
				const governor = new ethers.Contract(
					expected.governorAddress,
					chessGovernorAbi,
					expected.signer
				);
				const feeOverrides = await getTransactionFeeOverrides(expected.provider, expected.chainId);
				const tx = await sendBoundGovernorTransaction({
					...expected,
					governor,
					method: 'queue',
					args: [targets, values, calldatas, descriptionHash],
					overrides: feeOverrides,
					assertCurrentContext: () => assertCurrentGovernanceContext(expected)
				});
				await tx.wait();

				update(s => ({ ...s, loading: false }));
				return true;
			} catch (err) {
				console.error('Error queuing proposal:', err);
				update(s => ({ ...s, loading: false, error: err.message }));
				throw err;
			}
		},

		/**
		 * Execute a queued proposal
		 */
		async execute(targets, values, calldatas, descriptionHash) {
			const $wallet = get(wallet);
			const expected = captureGovernanceWriteContext($wallet);

			update(s => ({ ...s, loading: true, error: null }));

			try {
				const chessGovernorAbi = await getChessGovernorAbi();
				const governor = new ethers.Contract(
					expected.governorAddress,
					chessGovernorAbi,
					expected.signer
				);
				const feeOverrides = await getTransactionFeeOverrides(expected.provider, expected.chainId);
				const tx = await sendBoundGovernorTransaction({
					...expected,
					governor,
					method: 'execute',
					args: [targets, values, calldatas, descriptionHash],
					// Proposal values are funded by the timelock. The UI must never
					// silently transfer executor ETH while submitting an execution.
					expectedValue: 0,
					overrides: feeOverrides,
					assertCurrentContext: () => assertCurrentGovernanceContext(expected)
				});
				await tx.wait();

				update(s => ({ ...s, loading: false }));
				return true;
			} catch (err) {
				console.error('Error executing proposal:', err);
				update(s => ({ ...s, loading: false, error: err.message }));
				throw err;
			}
		},

		/**
		 * Get proposal votes
		 */
		async getProposalVotes(proposalId) {
			const readTicket = captureCurrentRead();
			if (!readTicket) return null;
			const expected = readTicket.context;

			try {
				const chessGovernorAbi = await getChessGovernorAbi();
				const governor = new ethers.Contract(
					expected.governorAddress,
					chessGovernorAbi,
					expected.signer
				);
				const votes = await governor.proposalVotes(proposalId);
				if (!isCurrentRead(readTicket)) return null;

				return {
					against: ethers.utils.formatEther(votes.againstVotes),
					for: ethers.utils.formatEther(votes.forVotes),
					abstain: ethers.utils.formatEther(votes.abstainVotes)
				};
			} catch (err) {
				if (!isCurrentRead(readTicket)) return null;
				console.error('Error getting proposal votes:', err);
				return null;
			}
		},

		/**
		 * Check if user has voted on a proposal
		 */
		async hasVoted(proposalId) {
			const readTicket = captureCurrentRead();
			if (!readTicket) return false;
			const expected = readTicket.context;

			try {
				const chessGovernorAbi = await getChessGovernorAbi();
				const governor = new ethers.Contract(
					expected.governorAddress,
					chessGovernorAbi,
					expected.signer
				);
				const voted = await governor.hasVoted(proposalId, expected.account);
				return isCurrentRead(readTicket) ? voted : false;
			} catch (err) {
				if (!isCurrentRead(readTicket)) return false;
				console.error('Error checking vote:', err);
				return false;
			}
		},

		/**
		 * Clear store
		 */
		clear() {
			paramsRequestGeneration++;
			readEpoch.invalidate();
			set({
				loading: false,
				error: null,
				votingDelay: 0,
				votingPeriod: 0,
				proposalThreshold: '0',
				quorum: '0',
				votingPower: '0',
				delegates: '',
				timelockDelay: 0,
				proposals: []
			});
		}
	};
}

export const governance = createGovernanceStore();

// Derived stores
export const governanceAvailable = derived(wallet, $wallet => {
	if (!$wallet.chainId) return false;
	return !!GOVERNOR_ADDRESSES[$wallet.chainId];
});

// Helper functions
export function getProposalStateLabel(state) {
	switch (state) {
		case ProposalState.Pending: return 'Pending';
		case ProposalState.Active: return 'Active';
		case ProposalState.Canceled: return 'Canceled';
		case ProposalState.Defeated: return 'Defeated';
		case ProposalState.Succeeded: return 'Succeeded';
		case ProposalState.Queued: return 'Queued';
		case ProposalState.Expired: return 'Expired';
		case ProposalState.Executed: return 'Executed';
		default: return 'Unknown';
	}
}

export function getProposalStateColor(state) {
	switch (state) {
		case ProposalState.Pending: return 'text-chess-gray';
		case ProposalState.Active: return 'text-chess-blue';
		case ProposalState.Canceled: return 'text-chess-danger';
		case ProposalState.Defeated: return 'text-chess-danger';
		case ProposalState.Succeeded: return 'text-chess-success';
		case ProposalState.Queued: return 'text-chess-accent';
		case ProposalState.Expired: return 'text-chess-gray';
		case ProposalState.Executed: return 'text-chess-success';
		default: return 'text-chess-gray';
	}
}

export function formatTimelockDelay(seconds) {
	if (seconds < 3600) {
		return `${Math.floor(seconds / 60)} minutes`;
	} else if (seconds < 86400) {
		return `${Math.floor(seconds / 3600)} hours`;
	} else {
		return `${Math.floor(seconds / 86400)} days`;
	}
}

export function formatBlocks(blocks) {
	// Base / Base Sepolia produce ~2 second blocks
	const seconds = blocks * 2;
	if (seconds < 3600) {
		return `~${Math.floor(seconds / 60)} min`;
	} else if (seconds < 86400) {
		return `~${Math.floor(seconds / 3600)} hours`;
	} else {
		return `~${Math.floor(seconds / 86400)} days`;
	}
}
