import { writable, derived, get } from 'svelte/store';
import { wallet, getConfiguredFactoryAddress } from './wallet.js';
import { ethers } from 'ethers';
import { loadContractAbi } from '../contracts/loadAbi.js';
import { getTransactionFeeOverrides } from '../utils/transactionFees.js';
import { computeVoteCommitHash } from '../utils/voteCommit.js';
import { Vote, getVoteLabel } from '../utils/disputeModel.js';
import {
	TRANSACTION_BROADCAST,
	assertExactChallengeTerms,
	createDisputeContextGuard,
	ensureExactTokenAllowance,
	getWholeGameChallengeArguments,
	normalizeDisputeGameId,
	normalizeDisputeId,
	readPanelActiveStake,
	readDisputeChallengeEconomics,
	readDisputeIdForGame,
	readWholeGameChallengeTerms,
	sendBoundContractTransaction,
	verifiedDisputeContextMatches,
	verifiedDisputeRecordContextMatches,
	verifyCanonicalDisputeContext,
	verifyCanonicalDisputeGame
} from '../utils/disputeVerification.js';

const DISPUTE_DAO_ADDRESSES = {
	1337: import.meta.env.VITE_DISPUTE_DAO_LOCAL || '',
	5777: import.meta.env.VITE_DISPUTE_DAO_LOCAL || '',
	84532: import.meta.env.VITE_DISPUTE_DAO_BASE_SEPOLIA || '',
	8453: import.meta.env.VITE_DISPUTE_DAO_BASE || ''
};

const BONDING_MANAGER_ADDRESSES = {
	1337: import.meta.env.VITE_BONDING_MANAGER_LOCAL || '',
	5777: import.meta.env.VITE_BONDING_MANAGER_LOCAL || '',
	84532: import.meta.env.VITE_BONDING_MANAGER_BASE_SEPOLIA || '',
	8453: import.meta.env.VITE_BONDING_MANAGER_BASE || ''
};

const ARBITRATOR_REGISTRY_ADDRESSES = {
	1337: import.meta.env.VITE_ARBITRATOR_REGISTRY_LOCAL || '',
	5777: import.meta.env.VITE_ARBITRATOR_REGISTRY_LOCAL || '',
	84532: import.meta.env.VITE_ARBITRATOR_REGISTRY_BASE_SEPOLIA || '',
	8453: import.meta.env.VITE_ARBITRATOR_REGISTRY_BASE || ''
};

const CHESS_TOKEN_ADDRESSES = {
	1337: import.meta.env.VITE_CHESS_TOKEN_LOCAL || '',
	5777: import.meta.env.VITE_CHESS_TOKEN_LOCAL || '',
	84532: import.meta.env.VITE_CHESS_TOKEN_BASE_SEPOLIA || '',
	8453: import.meta.env.VITE_CHESS_TOKEN_BASE || ''
};

function getConfiguredAddress(addresses, chainId) {
	const configured = addresses[Number(chainId)] || '';
	if (!ethers.utils.isAddress(configured)) return null;
	const normalized = ethers.utils.getAddress(configured);
	return normalized === ethers.constants.AddressZero ? null : normalized;
}

export function getDisputeDaoAddress(chainId) {
	return getConfiguredAddress(DISPUTE_DAO_ADDRESSES, chainId) || '';
}

const getDisputeDaoAbi = () => loadContractAbi('DisputeDAO');
const getArbitratorRegistryAbi = () => loadContractAbi('ArbitratorRegistry');
const getChessTokenAbi = () => loadContractAbi('ChessToken');

function formatVotingPower(value) {
	const [whole, fraction = ''] = ethers.utils.formatEther(value).split('.');
	const trimmedFraction = fraction.slice(0, 2).replace(/0+$/, '');
	return trimmedFraction ? `${whole}.${trimmedFraction}` : whole;
}

function asNumber(value) {
	return ethers.BigNumber.isBigNumber(value) ? value.toNumber() : Number(value);
}

function staleDisputeReadError() {
	const error = new Error('Dispute read was superseded by a newer wallet or game context');
	error.code = 'DISPUTE_READ_STALE';
	return error;
}

function configuredContext(walletSnapshot = get(wallet)) {
	return {
		factoryAddress: getConfiguredFactoryAddress(walletSnapshot.chainId),
		daoAddress: getConfiguredAddress(DISPUTE_DAO_ADDRESSES, walletSnapshot.chainId),
		bondingAddress: getConfiguredAddress(BONDING_MANAGER_ADDRESSES, walletSnapshot.chainId),
		tokenAddress: getConfiguredAddress(CHESS_TOKEN_ADDRESSES, walletSnapshot.chainId),
		registryAddress: getConfiguredAddress(ARBITRATOR_REGISTRY_ADDRESSES, walletSnapshot.chainId)
	};
}

function readContextKey(target = '') {
	const walletSnapshot = get(wallet);
	const configured = configuredContext(walletSnapshot);
	return [
		walletSnapshot.chainId ?? '',
		walletSnapshot.account?.toLowerCase() || '',
		configured.factoryAddress || '',
		configured.daoAddress || '',
		configured.bondingAddress || '',
		configured.tokenAddress || '',
		configured.registryAddress || '',
		target
	].join(':');
}

function assertCurrentContext(verification) {
	const currentWallet = get(wallet);
	const current = {
		verified: true,
		chainId: currentWallet.chainId,
		account: currentWallet.account,
		...configuredContext(currentWallet)
	};
	if (!verifiedDisputeContextMatches(verification, current)) {
		throw new Error('Wallet or dispute context changed while preparing the transaction');
	}
}

async function getVerifiedContracts({ includeFees = false } = {}) {
	const walletSnapshot = get(wallet);
	const configured = configuredContext(walletSnapshot);
	if (!walletSnapshot.provider || !walletSnapshot.signer || !walletSnapshot.account) {
		throw new Error('Wallet not connected');
	}
	if (Object.values(configured).some((address) => !address)) {
		throw new Error('Dispute system not available on this network');
	}

	const [disputeDaoAbi, arbitratorRegistryAbi, chessTokenAbi] = await Promise.all([
		getDisputeDaoAbi(),
		getArbitratorRegistryAbi(),
		getChessTokenAbi()
	]);
	const verification = await verifyCanonicalDisputeContext({
		provider: walletSnapshot.provider,
		signer: walletSnapshot.signer,
		account: walletSnapshot.account,
		chainId: walletSnapshot.chainId,
		...configured
	});
	assertCurrentContext(verification);

	const feeOverrides = includeFees
		? await getTransactionFeeOverrides(walletSnapshot.provider, verification.chainId)
		: {};
	assertCurrentContext(verification);

	return {
		wallet: walletSnapshot,
		verification,
		feeOverrides,
		dao: new ethers.Contract(verification.daoAddress, disputeDaoAbi, walletSnapshot.signer),
		registry: new ethers.Contract(verification.registryAddress, arbitratorRegistryAbi, walletSnapshot.signer),
		token: new ethers.Contract(verification.tokenAddress, chessTokenAbi, walletSnapshot.signer)
	};
}

async function getSameVerifiedContracts(reference, options) {
	const fresh = await getVerifiedContracts(options);
	if (!verifiedDisputeContextMatches(reference.verification, fresh.verification)) {
		throw new Error('Wallet or dispute context changed during the operation');
	}
	return fresh;
}

function assertExpectedRecordContext(verification, expectedContext, gameId, disputeId) {
	if (!expectedContext?.verified) {
		throw new Error('The dispute action is not bound to verified loaded data');
	}
	const actual = {
		...verification,
		gameId: normalizeDisputeGameId(gameId),
		...(disputeId === undefined ? {} : { disputeId: normalizeDisputeId(disputeId) })
	};
	if (!verifiedDisputeRecordContextMatches(actual, expectedContext)) {
		throw new Error('Loaded dispute context no longer matches this transaction');
	}
}

async function verifyExpectedGame(bundle, expectedContext, gameId) {
	if (!expectedContext?.verified || !expectedContext?.gameAddress) {
		throw new Error('The dispute action is not bound to a verified loaded game');
	}
	const verifiedGame = await verifyCanonicalDisputeGame({
		provider: bundle.wallet.provider,
		verification: bundle.verification,
		gameId,
		gameAddress: expectedContext.gameAddress
	});
	assertExpectedRecordContext(verifiedGame, expectedContext, gameId);
	return verifiedGame;
}

async function sendWrite(bundle, contract, method, args, callbacks = {}) {
	assertCurrentContext(bundle.verification);
	const {
		assertBoundContext,
		assertCurrentContext: _ignoredContextOverride,
		...transactionCallbacks
	} = callbacks;
	const transaction = await sendBoundContractTransaction({
		contract,
		method,
		args,
		overrides: bundle.feeOverrides,
		provider: bundle.wallet.provider,
		signer: bundle.wallet.signer,
		verification: bundle.verification,
		assertCurrentContext: async (verification) => {
			assertCurrentContext(verification);
			// Protocol links are mutable governance state. Re-read them after
			// transaction population so a stale DAO/registry/token can never reach
			// the wallet merely because the local route still looks unchanged.
			const freshBundle = await getSameVerifiedContracts(bundle);
			if (assertBoundContext) await assertBoundContext(freshBundle);
		},
		...transactionCallbacks
	});
	try {
		return await transaction.wait();
	} catch (error) {
		if (error?.transactionTransmission) throw error;
		try {
			error.transactionTransmission = TRANSACTION_BROADCAST;
			throw error;
		} catch (markedError) {
			if (markedError === error && markedError?.transactionTransmission) throw markedError;
			const wrapped = new Error(error?.message || String(error), { cause: error });
			wrapped.transactionTransmission = TRANSACTION_BROADCAST;
			throw wrapped;
		}
	}
}

async function setExactAllowance(reference, spender, amount, assertBoundContext) {
	await ensureExactTokenAllowance({
		expectedAmount: amount,
		readAllowance: async () => {
			const bundle = await getSameVerifiedContracts(reference);
			return bundle.token.allowance(bundle.verification.account, spender);
		},
		setAllowance: async (value) => {
			const bundle = await getSameVerifiedContracts(reference, { includeFees: true });
			await sendWrite(bundle, bundle.token, 'approve', [spender, value], { assertBoundContext });
		}
	});
}

async function verifyDisputeTarget(bundle, expectedContext, disputeId) {
	const normalizedDisputeId = normalizeDisputeId(disputeId);
	if (expectedContext?.disputeId === undefined ||
		normalizeDisputeId(expectedContext.disputeId) !== normalizedDisputeId) {
		throw new Error('The dispute action is not bound to the loaded dispute id');
	}
	const data = await bundle.dao.getDispute(normalizedDisputeId);
	const verifiedGame = await verifyExpectedGame(bundle, expectedContext, asNumber(data.gameId));
	assertExpectedRecordContext(verifiedGame, expectedContext, asNumber(data.gameId), normalizedDisputeId);
	return normalizedDisputeId;
}

async function executeDisputeWrite(
	method,
	args,
	disputeId,
	expectedContext,
	assertBoundContext,
	callbacks = {}
) {
	if (assertBoundContext) await assertBoundContext();
	const initial = await getVerifiedContracts();
	const normalizedDisputeId = await verifyDisputeTarget(initial, expectedContext, disputeId);
	const finalBundle = await getSameVerifiedContracts(initial, { includeFees: true });
	await verifyDisputeTarget(finalBundle, expectedContext, normalizedDisputeId);
	const assertFreshTarget = async (freshBundle) => {
		if (assertBoundContext) await assertBoundContext();
		await verifyDisputeTarget(freshBundle, expectedContext, normalizedDisputeId);
	};
	await sendWrite(finalBundle, finalBundle.dao, method, args, {
		...callbacks,
		assertBoundContext: assertFreshTarget
	});
}

export const DisputeState = {
	None: 0,
	Pending: 1,
	Challenged: 2,
	Revealing: 3,
	Resolved: 4,
	Escalated: 5,
	Selecting: 6,
	Unresolved: 7
};

export { Vote, getVoteLabel };

const disputeInitialState = {
	loading: false,
	error: null,
	currentDispute: null,
	verification: null,
	challengeWindow: 0,
	commitPeriod: 0,
	revealPeriod: 0,
	challengeDeposit: '0',
	quorumPercentage: 0,
	supermajority: 0,
	activeChallenges: 0
};

async function loadDisputeDetails(bundle, disputeId, context = {}) {
	const normalizedDisputeId = normalizeDisputeId(disputeId);
	const [disputeData, arbitrators, effectiveQuorum, panelSecurity, selectionBlock,
		selectionScheduledAt, panelSelectionTimeout, selectionSequence, nextSelectionSequence,
		voteCommit, arbitratorInfo, fullDispute] = await Promise.all([
		bundle.dao.getDispute(normalizedDisputeId),
		bundle.dao.getSelectedArbitrators(normalizedDisputeId),
		bundle.dao.getEffectiveQuorum(normalizedDisputeId),
		bundle.dao.getPanelSecurity(normalizedDisputeId),
		bundle.dao.panelSelectionBlock(normalizedDisputeId),
		bundle.dao.panelSelectionScheduledAt(normalizedDisputeId),
		bundle.dao.PANEL_SELECTION_TIMEOUT(),
		bundle.dao.panelSelectionSequence(normalizedDisputeId),
		bundle.dao.nextSelectionSequence(),
		bundle.dao.votes(normalizedDisputeId, bundle.verification.account),
		bundle.registry.getArbitratorInfo(bundle.verification.account),
		bundle.dao.disputes(normalizedDisputeId)
	]);

	const resolvedGameId = asNumber(disputeData.gameId);
	if (context.gameId !== undefined && normalizeDisputeGameId(context.gameId) !== resolvedGameId) {
		throw new Error('Dispute mapping returned a record for a different game');
	}
	const commitHash = voteCommit[0];
	if (!ethers.utils.isHexString(commitHash, 32)) {
		throw new Error('Dispute DAO returned an invalid vote commitment');
	}
	const gameVerification = await verifyCanonicalDisputeGame({
		provider: bundle.wallet.provider,
		verification: bundle.verification,
		gameId: resolvedGameId,
		gameAddress: context.gameVerification?.gameAddress || context.gameAddress
	});
	const disputeState = asNumber(disputeData.state);
	const challengeEconomics = await readDisputeChallengeEconomics({
		dao: bundle.dao,
		gameId: resolvedGameId,
		disputeId: normalizedDisputeId,
		state: disputeState
	});
	const { panelActiveStake, requiredPanelActiveStake } = readPanelActiveStake(panelSecurity);

	const verification = {
		...gameVerification,
		gameId: resolvedGameId,
		disputeId: normalizedDisputeId,
		verified: true
	};
	return {
		id: normalizedDisputeId,
		gameId: resolvedGameId,
		challenger: disputeData.challenger,
		whitePlayer: challengeEconomics.whitePlayer,
		blackPlayer: challengeEconomics.blackPlayer,
		state: disputeState,
		legitVotes: formatVotingPower(disputeData.legitVotes),
		whiteCheatVotes: formatVotingPower(disputeData.whiteCheatVotes),
		blackCheatVotes: formatVotingPower(disputeData.blackCheatVotes),
		abstainVotes: formatVotingPower(fullDispute.abstainVotes),
		hasAbstainVotes: !fullDispute.abstainVotes.isZero(),
		totalVotes: asNumber(panelSecurity.revealedArbitrators),
		finalDecision: asNumber(disputeData.finalDecision),
		escalationLevel: asNumber(disputeData.escalationLevel),
		arbitrators,
		panelSize: arbitrators.length,
		effectiveQuorum: asNumber(effectiveQuorum),
		panelSelectionBlock: asNumber(selectionBlock),
		panelSelectionScheduledAt: asNumber(selectionScheduledAt),
		panelSelectionTimeout: asNumber(panelSelectionTimeout),
		panelSelectionSequence: asNumber(selectionSequence),
		nextSelectionSequence: asNumber(nextSelectionSequence),
		panelSelectionIsHead: !selectionSequence.isZero() && selectionSequence.eq(nextSelectionSequence),
		totalPanelVotingPower: formatVotingPower(panelSecurity.totalVotingPower),
		requiredVotingPower: formatVotingPower(panelSecurity.minimumRevealedVotingPower),
		revealedVotingPower: formatVotingPower(panelSecurity.revealedPower),
		panelActiveStake: formatVotingPower(panelActiveStake),
		requiredActiveStakeCoverage: formatVotingPower(requiredPanelActiveStake),
		registeredAt: asNumber(fullDispute.registeredAt),
		challengedAt: asNumber(fullDispute.challengedAt),
		commitDeadline: asNumber(fullDispute.commitDeadline),
		revealDeadline: asNumber(fullDispute.revealDeadline),
		gameStake: ethers.utils.formatEther(fullDispute.gameStake),
		requiredChallengeDeposit: challengeEconomics.requiredDeposit
			? ethers.utils.formatEther(challengeEconomics.requiredDeposit)
			: null,
		escrowedChallengeDeposit: ethers.utils.formatEther(challengeEconomics.escrowedDeposit),
		challengeWindowOpen: Boolean(context.challengeWindowOpen),
		challengeWindowRemaining: context.challengeWindowRemaining ?? 0,
		context: verification,
		user: {
			isSelectedArbitrator: arbitrators.some(
				(address) => address.toLowerCase() === bundle.verification.account.toLowerCase()
			),
			isArbitrator: Boolean(arbitratorInfo.isActive),
			canVoteNow: Boolean(arbitratorInfo.canVoteNow),
			hasCommitted: commitHash.toLowerCase() !== ethers.constants.HashZero,
			hasRevealed: Boolean(voteCommit[1]),
			revealedVote: asNumber(voteCommit[2]),
			commitHash: commitHash.toLowerCase()
		}
	};
}

function createDisputeStore() {
	const { subscribe, set, update } = writable(disputeInitialState);
	const paramsGuard = createDisputeContextGuard();
	const disputeGuard = createDisputeContextGuard();
	let activeLoadedContext = null;

	function assertActiveLoadedContext(expectedContext) {
		if (!activeLoadedContext ||
			!verifiedDisputeRecordContextMatches(activeLoadedContext, expectedContext)) {
			throw new Error('The loaded game or dispute changed while preparing the transaction');
		}
	}

	async function fetchParams() {
		const key = readContextKey('params');
		const token = paramsGuard.begin(key);
		try {
			const bundle = await getVerifiedContracts();
			const values = await Promise.all([
				bundle.dao.challengeWindow(), bundle.dao.commitPeriod(), bundle.dao.revealPeriod(),
				bundle.dao.challengeDeposit(), bundle.dao.quorumPercentage(), bundle.dao.supermajority(),
				bundle.dao.activeChallenges(bundle.verification.account)
			]);
			if (!paramsGuard.isCurrent(token, readContextKey('params'))) return null;
			update((state) => ({
				...state,
				error: null,
				challengeWindow: asNumber(values[0]),
				commitPeriod: asNumber(values[1]),
				revealPeriod: asNumber(values[2]),
				challengeDeposit: ethers.utils.formatEther(values[3]),
				quorumPercentage: asNumber(values[4]),
				supermajority: asNumber(values[5]),
				activeChallenges: asNumber(values[6])
			}));
			return true;
		} catch (error) {
			if (paramsGuard.isCurrent(token, readContextKey('params'))) {
				update((state) => ({ ...state, error: error.message }));
			}
			throw error;
		}
	}

	async function getDisputeByGame(gameId, gameAddress) {
		const normalizedGameId = normalizeDisputeGameId(gameId);
		const target = `game:${normalizedGameId}:${String(gameAddress || '').toLowerCase()}`;
		const key = readContextKey(target);
		const token = disputeGuard.begin(key);
		activeLoadedContext = null;
		update((state) => ({ ...state, loading: true, error: null }));
		try {
			const bundle = await getVerifiedContracts();
			const gameVerification = await verifyCanonicalDisputeGame({
				provider: bundle.wallet.provider,
				verification: bundle.verification,
				gameId: normalizedGameId,
				gameAddress
			});
			const disputeId = await readDisputeIdForGame(bundle.dao, normalizedGameId);
			if (disputeId === null) {
				if (!disputeGuard.isCurrent(token, readContextKey(target))) throw staleDisputeReadError();
				activeLoadedContext = { ...gameVerification, gameId: normalizedGameId, verified: true };
				update((state) => ({
					...state,
					loading: false,
					currentDispute: null,
					verification: activeLoadedContext
				}));
				return null;
			}
			const [challengeWindowOpen, challengeWindowRemaining] = await Promise.all([
				bundle.dao.isChallengeWindowOpen(normalizedGameId),
				bundle.dao.getChallengeWindowRemaining(normalizedGameId)
			]);
			const loaded = await loadDisputeDetails(bundle, disputeId, {
				gameId: normalizedGameId,
				gameAddress: gameVerification.gameAddress,
				gameVerification,
				challengeWindowOpen,
				challengeWindowRemaining: asNumber(challengeWindowRemaining)
			});
			if (!disputeGuard.isCurrent(token, readContextKey(target))) throw staleDisputeReadError();
			activeLoadedContext = loaded.context;
			update((state) => ({
				...state, loading: false, error: null, currentDispute: loaded, verification: loaded.context
			}));
			return loaded;
		} catch (error) {
			if (disputeGuard.isCurrent(token, readContextKey(target))) {
				update((state) => ({ ...state, loading: false, error: error.message }));
			}
			throw error;
		}
	}

	async function getDispute(disputeId, context = {}) {
		const normalizedDisputeId = normalizeDisputeId(disputeId);
		const target = `dispute:${normalizedDisputeId}`;
		const token = disputeGuard.begin(readContextKey(target));
		activeLoadedContext = null;
		update((state) => ({ ...state, loading: true, error: null }));
		try {
			const bundle = await getVerifiedContracts();
			const loaded = await loadDisputeDetails(bundle, normalizedDisputeId, context);
			if (!disputeGuard.isCurrent(token, readContextKey(target))) throw staleDisputeReadError();
			activeLoadedContext = loaded.context;
			update((state) => ({
				...state, loading: false, currentDispute: loaded, verification: loaded.context
			}));
			return loaded;
		} catch (error) {
			if (disputeGuard.isCurrent(token, readContextKey(target))) {
				update((state) => ({ ...state, loading: false, error: error.message }));
			}
			throw error;
		}
	}

	async function runAction(action) {
		update((state) => ({ ...state, loading: true, error: null }));
		try {
			const result = await action();
			update((state) => ({ ...state, loading: false }));
			return result;
		} catch (error) {
			update((state) => ({ ...state, loading: false, error: error.message }));
			throw error;
		}
	}

	return {
		subscribe,
		fetchParams,
		getDisputeByGame,
		getDispute,
		async watchResolution(gameId, gameAddress, onResolved) {
			if (typeof onResolved !== 'function') {
				throw new Error('Resolution watcher callback is required');
			}
			const normalizedGameId = normalizeDisputeGameId(gameId);
			const target = `watch:${normalizedGameId}:${String(gameAddress || '').toLowerCase()}`;
			const expectedContextKey = readContextKey(target);
			const bundle = await getVerifiedContracts();
			await verifyCanonicalDisputeGame({
				provider: bundle.wallet.provider,
				verification: bundle.verification,
				gameId: normalizedGameId,
				gameAddress
			});
			const disputeId = await readDisputeIdForGame(bundle.dao, normalizedGameId);
			if (disputeId === null) return () => {};

			const filter = bundle.dao.filters.DisputeResolved(disputeId);
			const listener = (...args) => {
				const event = args.at(-1);
				if (readContextKey(target) !== expectedContextKey) return;
				Promise.resolve(onResolved({
					disputeId,
					event,
					removed: Boolean(event?.removed)
				})).catch(() => {});
			};
			bundle.dao.on(filter, listener);
			try {
				// Close the read-to-subscribe race: a resolution mined after the
				// panel snapshot but before `.on` is visible in this post-check.
				const current = await bundle.dao.getDispute(disputeId);
				if (asNumber(current.state ?? current[2]) === DisputeState.Resolved) {
					await onResolved({ disputeId, event: null, removed: false });
				}
			} catch (error) {
				bundle.dao.off(filter, listener);
				throw error;
			}
			return () => bundle.dao.off(filter, listener);
		},
		async getVoteCommitHash(disputeId, expectedContext) {
			const normalizedDisputeId = normalizeDisputeId(disputeId);
			const initial = await getVerifiedContracts();
			await verifyDisputeTarget(initial, expectedContext, normalizedDisputeId);
			const initialVote = await initial.dao.votes(
				normalizedDisputeId,
				initial.verification.account
			);
			const finalBundle = await getSameVerifiedContracts(initial);
			await verifyDisputeTarget(finalBundle, expectedContext, normalizedDisputeId);
			const finalVote = await finalBundle.dao.votes(
				normalizedDisputeId,
				finalBundle.verification.account
			);
			const initialHash = initialVote[0];
			const finalHash = finalVote[0];
			if (!ethers.utils.isHexString(initialHash, 32) || !ethers.utils.isHexString(finalHash, 32)) {
				throw new Error('Dispute DAO returned an invalid vote commitment');
			}
			if (initialHash.toLowerCase() !== finalHash.toLowerCase()) {
				throw new Error('Vote commitment changed while reconciling the transaction');
			}
			return finalHash.toLowerCase();
		},

		challenge(gameId, expectedContext) {
			return runAction(async () => {
				const normalizedGameId = normalizeDisputeGameId(gameId);
				const assertBoundContext = async (freshBundle) => {
					assertActiveLoadedContext(expectedContext);
					if (freshBundle) {
						await verifyExpectedGame(freshBundle, expectedContext, normalizedGameId);
					}
				};
				const readBoundChallengeTerms = async (bundle) => {
					await assertBoundContext(bundle);
					const terms = await readWholeGameChallengeTerms({
						dao: bundle.dao,
						gameId: normalizedGameId,
						account: bundle.verification.account
					});
					return terms.requiredDeposit;
				};
				await assertBoundContext();
				const initial = await getVerifiedContracts();
				let challengeDeposit = await readBoundChallengeTerms(initial);
				const assertApprovalAmount = (expectedDeposit) => async (freshBundle) => {
					const liveDeposit = await readBoundChallengeTerms(freshBundle);
					if (!liveDeposit.eq(expectedDeposit)) {
						throw new Error('Challenge deposit changed before approval');
					}
				};
				await setExactAllowance(
					initial,
					initial.verification.daoAddress,
					challengeDeposit,
					assertApprovalAmount(challengeDeposit)
				);

				let finalBundle = await getSameVerifiedContracts(initial, { includeFees: true });
				let finalDeposit = await readBoundChallengeTerms(finalBundle);
				if (!finalDeposit.eq(challengeDeposit)) {
					challengeDeposit = finalDeposit;
					await setExactAllowance(
						initial,
						initial.verification.daoAddress,
						challengeDeposit,
						assertApprovalAmount(challengeDeposit)
					);
					finalBundle = await getSameVerifiedContracts(initial, { includeFees: true });
					finalDeposit = await readBoundChallengeTerms(finalBundle);
					if (!finalDeposit.eq(challengeDeposit)) {
						throw new Error('Challenge deposit changed while preparing the transaction');
					}
				}
				const allowance = await finalBundle.token.allowance(
					finalBundle.verification.account, finalBundle.verification.daoAddress
				);
				if (!allowance.eq(finalDeposit)) {
					throw new Error('Exact challenge allowance changed before submission');
				}
				await sendWrite(
					finalBundle,
					finalBundle.dao,
					'challenge',
					getWholeGameChallengeArguments(normalizedGameId),
					{
						assertBoundContext: async (freshBundle) => {
							const liveDeposit = await readBoundChallengeTerms(freshBundle);
							const liveAllowance = await freshBundle.token.allowance(
								freshBundle.verification.account,
								freshBundle.verification.daoAddress
							);
							assertExactChallengeTerms(finalDeposit, liveDeposit, liveAllowance);
						}
					}
				);
				return true;
			});
		},

		finalizePanel(disputeId, expectedContext) {
			return runAction(async () => {
				await executeDisputeWrite(
					'finalizePanel',
					[normalizeDisputeId(disputeId)],
					disputeId,
					expectedContext,
					() => assertActiveLoadedContext(expectedContext)
				);
				return true;
			});
		},

		activatePanelSelection(disputeId, expectedContext) {
			return runAction(async () => {
				await executeDisputeWrite(
					'activatePanelSelection',
					[normalizeDisputeId(disputeId)],
					disputeId,
					expectedContext,
					() => assertActiveLoadedContext(expectedContext)
				);
				return true;
			});
		},

		refreshPanelSelection(disputeId, expectedContext) {
			return runAction(async () => {
				await executeDisputeWrite(
					'refreshPanelSelection',
					[normalizeDisputeId(disputeId)],
					disputeId,
					expectedContext,
					() => assertActiveLoadedContext(expectedContext)
				);
				return true;
			});
		},

		markPanelUnavailable(disputeId, expectedContext) {
			return runAction(async () => {
				await executeDisputeWrite(
					'markPanelUnavailable',
					[normalizeDisputeId(disputeId)],
					disputeId,
					expectedContext,
					() => assertActiveLoadedContext(expectedContext)
				);
				return true;
			});
		},

		commitVote(disputeId, vote, salt, options = {}) {
			return runAction(async () => {
				const normalizedDisputeId = normalizeDisputeId(disputeId);
				const normalizedVote = Number(vote);
				const assertBoundContext = async (freshBundle) => {
					assertActiveLoadedContext(options.expectedContext);
					if (freshBundle) {
						await verifyDisputeTarget(freshBundle, options.expectedContext, normalizedDisputeId);
					}
				};
				await assertBoundContext();
				const initial = await getVerifiedContracts();
				await verifyDisputeTarget(initial, options.expectedContext, normalizedDisputeId);
				const commitContext = {
					chainId: initial.verification.chainId,
					daoAddress: initial.verification.daoAddress,
					account: initial.verification.account,
					gameId: options.expectedContext.gameId,
					disputeId: normalizedDisputeId
				};
				const commitHash = computeVoteCommitHash({ context: commitContext, vote: normalizedVote, salt });
				const onChainHash = await initial.dao.computeVoteCommitment(
					normalizedDisputeId, normalizedVote, salt, initial.verification.account
				);
				if (onChainHash.toLowerCase() !== commitHash) {
					throw new Error('Dispute DAO vote commitment domain does not match this client');
				}

				const finalBundle = await getSameVerifiedContracts(initial, { includeFees: true });
				await verifyDisputeTarget(finalBundle, options.expectedContext, normalizedDisputeId);
				await sendWrite(finalBundle, finalBundle.dao, 'commitVote', [normalizedDisputeId, commitHash], {
					assertBoundContext,
					beforeBroadcast: options.beforeBroadcast
						? (payload) => options.beforeBroadcast({ ...payload, commitHash, context: commitContext })
						: undefined,
					onBroadcast: options.onBroadcast
						? (payload) => options.onBroadcast({ ...payload, commitHash, context: commitContext })
						: undefined
				});
				if (options.onConfirmed) await options.onConfirmed({ commitHash, context: commitContext });
				return commitHash;
			});
		},

		revealVote(disputeId, vote, salt, expectedContext) {
			return runAction(async () => {
				const normalizedDisputeId = normalizeDisputeId(disputeId);
				await executeDisputeWrite(
					'revealVote',
					[normalizedDisputeId, Number(vote), salt],
					normalizedDisputeId,
					expectedContext,
					() => assertActiveLoadedContext(expectedContext)
				);
				return true;
			});
		},

		resolveDispute(disputeId, expectedContext) {
			return runAction(async () => {
				await executeDisputeWrite(
					'resolveDispute',
					[normalizeDisputeId(disputeId)],
					disputeId,
					expectedContext,
					() => assertActiveLoadedContext(expectedContext)
				);
				return true;
			});
		},

		closeChallengeWindow(gameId, expectedContext) {
			return runAction(async () => {
				const normalizedGameId = normalizeDisputeGameId(gameId);
				const assertBoundContext = async (freshBundle) => {
					assertActiveLoadedContext(expectedContext);
					if (freshBundle) {
						await verifyExpectedGame(freshBundle, expectedContext, normalizedGameId);
					}
				};
				await assertBoundContext();
				const initial = await getVerifiedContracts();
				await verifyExpectedGame(initial, expectedContext, normalizedGameId);
				const finalBundle = await getSameVerifiedContracts(initial, { includeFees: true });
				await verifyExpectedGame(finalBundle, expectedContext, normalizedGameId);
				await sendWrite(
					finalBundle,
					finalBundle.dao,
					'closeChallengeWindow',
					[normalizedGameId],
					{ assertBoundContext }
				);
				return true;
			});
		},

		async getVoteStatus(disputeId, arbitratorAddress) {
			const bundle = await getVerifiedContracts();
			const status = await bundle.dao.getVoteStatus(
				normalizeDisputeId(disputeId), ethers.utils.getAddress(arbitratorAddress)
			);
			return {
				hasCommitted: status.hasCommitted,
				hasRevealed: status.hasRevealed,
				revealedVote: asNumber(status.revealedVote)
			};
		},

		generateSalt() {
			return ethers.utils.hexlify(ethers.utils.randomBytes(32));
		},

		invalidateContext() {
			disputeGuard.invalidate();
			activeLoadedContext = null;
			update((state) => ({
				...state,
				loading: false,
				currentDispute: null,
				verification: null
			}));
		},

		clear() {
			paramsGuard.invalidate();
			disputeGuard.invalidate();
			activeLoadedContext = null;
			set(disputeInitialState);
		}
	};
}

const arbitratorInitialState = {
	loading: false,
	error: null,
	isArbitrator: false,
	stakedAmount: '0',
	votingPower: '0',
	reputation: 0,
	tier: 0,
	canVoteNow: false,
	tierCounts: { t1: 0, t2: 0, t3: 0 },
	totalStaked: '0',
	totalArbitrators: 0,
	tier1Min: '1000',
	tier2Min: '5000',
	tier3Min: '20000',
	verification: null
};

function createArbitratorStore() {
	const { subscribe, set, update } = writable(arbitratorInitialState);
	const requestGuard = createDisputeContextGuard();

	async function fetchData() {
		const key = readContextKey('arbitrator');
		const token = requestGuard.begin(key);
		update((state) => ({ ...state, loading: true, error: null }));
		try {
			const bundle = await getVerifiedContracts();
			const [info, tierCounts, totalStaked, totalArbitrators] = await Promise.all([
				bundle.registry.getArbitratorInfo(bundle.verification.account),
				bundle.registry.getTierCounts(),
				bundle.registry.totalStaked(),
				bundle.registry.totalArbitrators()
			]);
			if (!requestGuard.isCurrent(token, readContextKey('arbitrator'))) return null;
			set({
				loading: false,
				error: null,
				isArbitrator: Boolean(info.isActive),
				stakedAmount: ethers.utils.formatEther(info.stakedAmount),
				votingPower: ethers.utils.formatEther(info.votingPower),
				reputation: asNumber(info.reputation),
				tier: asNumber(info.tier),
				canVoteNow: Boolean(info.canVoteNow),
				tierCounts: { t1: asNumber(tierCounts.t1), t2: asNumber(tierCounts.t2), t3: asNumber(tierCounts.t3) },
				totalStaked: ethers.utils.formatEther(totalStaked),
				totalArbitrators: asNumber(totalArbitrators),
				tier1Min: '1000',
				tier2Min: '5000',
				tier3Min: '20000',
				verification: bundle.verification
			});
			return true;
		} catch (error) {
			if (requestGuard.isCurrent(token, readContextKey('arbitrator'))) {
				update((state) => ({ ...state, loading: false, error: error.message }));
			}
			return null;
		}
	}

	async function runAction(action) {
		update((state) => ({ ...state, loading: true, error: null }));
		try {
			const result = await action();
			update((state) => ({ ...state, loading: false }));
			return result;
		} catch (error) {
			update((state) => ({ ...state, loading: false, error: error.message }));
			throw error;
		}
	}

	return {
		subscribe,
		fetchData,

		stake(amount) {
			return runAction(async () => {
				const amountWei = ethers.utils.parseEther(String(amount).trim());
				if (amountWei.lte(0)) throw new Error('Stake amount must be greater than zero');
				const initial = await getVerifiedContracts();
				await setExactAllowance(initial, initial.verification.registryAddress, amountWei);
				const finalBundle = await getSameVerifiedContracts(initial, { includeFees: true });
				const allowance = await finalBundle.token.allowance(
					finalBundle.verification.account, finalBundle.verification.registryAddress
				);
				if (!allowance.eq(amountWei)) throw new Error('Exact staking allowance changed before submission');
				await sendWrite(finalBundle, finalBundle.registry, 'stake', [amountWei]);
				await fetchData();
				return true;
			});
		},

		unstake(amount) {
			return runAction(async () => {
				const amountWei = ethers.utils.parseEther(String(amount).trim());
				if (amountWei.lte(0)) throw new Error('Unstake amount must be greater than zero');
				const initial = await getVerifiedContracts();
				const finalBundle = await getSameVerifiedContracts(initial, { includeFees: true });
				await sendWrite(finalBundle, finalBundle.registry, 'unstake', [amountWei]);
				await fetchData();
				return true;
			});
		},

		clear() {
			requestGuard.invalidate();
			set(arbitratorInitialState);
		}
	};
}

export const dispute = createDisputeStore();
export const arbitrator = createArbitratorStore();

export const disputeAvailable = derived(wallet, ($wallet) => {
	if (!$wallet.chainId) return false;
	return Object.values(configuredContext($wallet)).every(Boolean);
});

export const arbitratorAvailable = derived(wallet, ($wallet) => {
	if (!$wallet.chainId) return false;
	return Object.values(configuredContext($wallet)).every(Boolean);
});

export function formatTimeRemaining(deadline) {
	const now = Math.floor(Date.now() / 1000);
	const remaining = deadline - now;
	if (remaining <= 0) return 'Ended';
	const hours = Math.floor(remaining / 3600);
	const minutes = Math.floor((remaining % 3600) / 60);
	if (hours > 24) {
		const days = Math.floor(hours / 24);
		return `${days}d ${hours % 24}h`;
	}
	return `${hours}h ${minutes}m`;
}

export function getStateLabel(state) {
	switch (state) {
		case DisputeState.None: return 'None';
		case DisputeState.Pending: return 'Challenge Window';
		case DisputeState.Challenged: return 'Voting (Commit)';
		case DisputeState.Revealing: return 'Voting (Reveal)';
		case DisputeState.Resolved: return 'Resolved';
		case DisputeState.Escalated: return 'Escalated';
		case DisputeState.Selecting: return 'Selecting Panel';
		case DisputeState.Unresolved: return 'Governance Backstop Required';
		default: return 'Unknown';
	}
}
