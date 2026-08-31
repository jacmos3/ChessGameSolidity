import { ethers } from 'ethers';
import {
	SUPPORTED_GAME_CHAIN_IDS,
	normalizeProtocolAddress
} from './gameVerification.js';

const FACTORY_SECURITY_ABI = [
	'function isDeployedGame(address game) view returns (bool)',
	'function deployedChessGames(uint256 gameId) view returns (address)',
	'function disputeDAO() view returns (address)',
	'function bondingManager() view returns (address)'
];

const GAME_SECURITY_ABI = [
	'function gameId() view returns (uint256)',
	'function disputeDAO() view returns (address)'
];

const DAO_SECURITY_ABI = [
	'function chessFactory() view returns (address)',
	'function bondingManager() view returns (address)',
	'function chessToken() view returns (address)',
	'function arbitratorRegistry() view returns (address)'
];

const BONDING_SECURITY_ABI = [
	'function chessToken() view returns (address)'
];

const REGISTRY_SECURITY_ABI = [
	'function chessToken() view returns (address)'
];

export const TRANSACTION_NOT_BROADCAST = 'not-broadcast';
export const TRANSACTION_BROADCAST_UNKNOWN = 'broadcast-unknown';
export const TRANSACTION_BROADCAST = 'broadcast';

function hasContractCode(code) {
	return typeof code === 'string' && !/^0x0*$/i.test(code);
}

function normalizeChainId(chainId) {
	const normalized = Number(chainId);
	if (!Number.isSafeInteger(normalized) || !SUPPORTED_GAME_CHAIN_IDS.has(normalized)) {
		throw new Error(`Unsupported network (${chainId ?? 'unknown'})`);
	}
	return normalized;
}

export function normalizeDisputeGameId(gameId) {
	const normalized = Number(gameId);
	if (!Number.isSafeInteger(normalized) || normalized < 0) {
		throw new Error('Invalid game id');
	}
	return normalized;
}

export function normalizeDisputeId(disputeId) {
	const normalized = Number(disputeId);
	if (!Number.isSafeInteger(normalized) || normalized <= 0) {
		throw new Error('Invalid dispute id');
	}
	return normalized;
}

export function getWholeGameChallengeArguments(gameId) {
	return [normalizeDisputeGameId(gameId)];
}

function assertWholeGameChallengeCapability(dao) {
	if (!dao?.interface?.getFunction ||
		typeof dao.gameWhitePlayer !== 'function' ||
		typeof dao.gameBlackPlayer !== 'function') {
		throw new Error('Configured DisputeDAO does not support whole-game challenges');
	}
	try {
		dao.interface.getFunction('challenge(uint256)');
	} catch {
		throw new Error('Configured DisputeDAO does not support whole-game challenges');
	}
}

export async function readWholeGameParticipants({ dao, gameId, account }) {
	const normalizedGameId = normalizeDisputeGameId(gameId);
	assertWholeGameChallengeCapability(dao);

	let values;
	try {
		values = await Promise.all([
			dao.gameWhitePlayer(normalizedGameId),
			dao.gameBlackPlayer(normalizedGameId)
		]);
	} catch {
		throw new Error('Unable to verify whole-game participants on-chain');
	}

	try {
		const [whiteValue, blackValue] = values;
		const whitePlayer = normalizeProtocolAddress(whiteValue, 'Registered White player');
		const blackPlayer = normalizeProtocolAddress(blackValue, 'Registered Black player');

		if (account !== undefined) {
			const normalizedAccount = normalizeProtocolAddress(account, 'Wallet account');
			if (normalizedAccount !== whitePlayer && normalizedAccount !== blackPlayer) {
				throw new Error('Only a participant in this game may request review');
			}
		}

		return { whitePlayer, blackPlayer };
	} catch (error) {
		if (error?.message === 'Only a participant in this game may request review') throw error;
		throw new Error('DisputeDAO returned invalid whole-game participants');
	}
}

async function readRequiredWholeGameChallengeDeposit(dao, gameId) {
	if (typeof dao?.getRequiredChallengeDepositForGame !== 'function') {
		throw new Error('Configured DisputeDAO does not support whole-game challenges');
	}
	const normalizedGameId = normalizeDisputeGameId(gameId);
	let requiredDepositValue;
	try {
		requiredDepositValue = await dao.getRequiredChallengeDepositForGame(normalizedGameId);
	} catch {
		// A pending challenge must fail closed if current bond-backed economics
		// cannot be verified. Historical records use their reserved escrow instead.
		throw new Error('Unable to verify whole-game challenge terms on-chain');
	}
	try {
		const requiredDeposit = ethers.BigNumber.from(requiredDepositValue);
		if (requiredDeposit.lte(0)) throw new Error('invalid challenge deposit');
		return requiredDeposit;
	} catch {
		throw new Error('DisputeDAO returned invalid whole-game challenge terms');
	}
}

export async function readWholeGameChallengeTerms({ dao, gameId, account }) {
	const normalizedGameId = normalizeDisputeGameId(gameId);
	const [participants, requiredDeposit] = await Promise.all([
		readWholeGameParticipants({ dao, gameId: normalizedGameId, account }),
		readRequiredWholeGameChallengeDeposit(dao, normalizedGameId)
	]);
	return { requiredDeposit, ...participants };
}

export async function readDisputeChallengeEconomics({ dao, gameId, disputeId, state }) {
	const participants = await readWholeGameParticipants({ dao, gameId });
	const normalizedState = Number(state);
	if (!Number.isSafeInteger(normalizedState) || normalizedState < 0) {
		throw new Error('Invalid dispute state');
	}

	// Pending is the only state in which opening a challenge still depends on
	// live game bonds. Once challenged, the exact deposit is already escrowed;
	// settlement may validly release or slash the underlying bonds.
	if (normalizedState === 1) {
		const requiredDeposit = await readRequiredWholeGameChallengeDeposit(dao, gameId);
		return {
			...participants,
			requiredDeposit,
			escrowedDeposit: ethers.constants.Zero
		};
	}

	if (typeof dao?.disputeDeposits !== 'function') {
		throw new Error('Configured DisputeDAO does not expose challenge escrow');
	}
	let escrowedDeposit;
	try {
		escrowedDeposit = ethers.BigNumber.from(
			await dao.disputeDeposits(normalizeDisputeId(disputeId))
		);
	} catch {
		throw new Error('Unable to verify challenge escrow on-chain');
	}
	return { ...participants, requiredDeposit: null, escrowedDeposit };
}

export function normalizeDisputeProtocolContext({
	chainId,
	factoryAddress,
	daoAddress,
	bondingAddress,
	tokenAddress,
	registryAddress,
	account
}) {
	return {
		chainId: normalizeChainId(chainId),
		factoryAddress: normalizeProtocolAddress(factoryAddress, 'ChessFactory'),
		daoAddress: normalizeProtocolAddress(daoAddress, 'DisputeDAO'),
		bondingAddress: normalizeProtocolAddress(bondingAddress, 'BondingManager'),
		tokenAddress: normalizeProtocolAddress(tokenAddress, 'ChessToken'),
		registryAddress: normalizeProtocolAddress(registryAddress, 'ArbitratorRegistry'),
		...(account === undefined
			? {}
			: { account: normalizeProtocolAddress(account, 'Wallet account') })
	};
}

export function verifiedDisputeContextMatches(left, right) {
	if (!left || !right || left.verified !== true || right.verified !== true) return false;
	try {
		const normalizedLeft = normalizeDisputeProtocolContext(left);
		const normalizedRight = normalizeDisputeProtocolContext(right);
		return normalizedLeft.chainId === normalizedRight.chainId &&
			normalizedLeft.factoryAddress === normalizedRight.factoryAddress &&
			normalizedLeft.daoAddress === normalizedRight.daoAddress &&
			normalizedLeft.bondingAddress === normalizedRight.bondingAddress &&
			normalizedLeft.tokenAddress === normalizedRight.tokenAddress &&
			normalizedLeft.registryAddress === normalizedRight.registryAddress &&
			normalizedLeft.account === normalizedRight.account;
	} catch {
		return false;
	}
}

export function verifiedDisputeRecordContextMatches(left, right) {
	if (!verifiedDisputeContextMatches(left, right)) return false;
	try {
		return normalizeProtocolAddress(left.gameAddress, 'Game contract') ===
				normalizeProtocolAddress(right.gameAddress, 'Game contract') &&
			normalizeDisputeGameId(left.gameId) === normalizeDisputeGameId(right.gameId) &&
			(left.disputeId === undefined || right.disputeId === undefined ||
				normalizeDisputeId(left.disputeId) === normalizeDisputeId(right.disputeId));
	} catch {
		return false;
	}
}

async function readWalletContext({ provider, signer, account, chainId }) {
	if (!provider) throw new Error('Wallet provider not available');
	if (!signer || !account) throw new Error('Wallet account is not available');

	const [network, signerAddress] = await Promise.all([
		provider.getNetwork(),
		signer.getAddress()
	]);
	if (Number(network.chainId) !== chainId) {
		throw new Error('Wallet network changed while verifying the dispute protocol');
	}

	const normalizedAccount = normalizeProtocolAddress(account, 'Wallet account');
	const normalizedSigner = normalizeProtocolAddress(signerAddress, 'Signer account');
	if (normalizedSigner !== normalizedAccount) {
		throw new Error('Wallet account changed while verifying the dispute protocol');
	}
	return normalizedAccount;
}

export async function recheckVerifiedDisputeWalletContext({ provider, signer, verification }) {
	if (!verification?.verified) throw new Error('Dispute transaction context is not verified');
	await readWalletContext({
		provider,
		signer,
		account: verification.account,
		chainId: normalizeChainId(verification.chainId)
	});
}

export async function verifyCanonicalDisputeContext({
	provider,
	signer,
	account,
	chainId,
	factoryAddress,
	daoAddress,
	bondingAddress,
	tokenAddress,
	registryAddress,
	contractFactories = {}
}) {
	const context = normalizeDisputeProtocolContext({
		chainId,
		factoryAddress,
		daoAddress,
		bondingAddress,
		tokenAddress,
		registryAddress
	});
	const normalizedAccount = await readWalletContext({
		provider,
		signer,
		account,
		chainId: context.chainId
	});

	const addresses = [
		context.factoryAddress,
		context.daoAddress,
		context.bondingAddress,
		context.tokenAddress,
		context.registryAddress
	];
	const codes = await Promise.all(addresses.map((address) => provider.getCode(address)));
	for (let index = 0; index < codes.length; index += 1) {
		if (!hasContractCode(codes[index])) {
			const labels = ['ChessFactory', 'DisputeDAO', 'BondingManager', 'ChessToken', 'ArbitratorRegistry'];
			throw new Error(`Configured ${labels[index]} is not a contract on this network`);
		}
	}

	const factoryFactory = contractFactories.factory ||
		((address, runner) => new ethers.Contract(address, FACTORY_SECURITY_ABI, runner));
	const daoFactory = contractFactories.dao ||
		((address, runner) => new ethers.Contract(address, DAO_SECURITY_ABI, runner));
	const bondingFactory = contractFactories.bonding ||
		((address, runner) => new ethers.Contract(address, BONDING_SECURITY_ABI, runner));
	const registryFactory = contractFactories.registry ||
		((address, runner) => new ethers.Contract(address, REGISTRY_SECURITY_ABI, runner));

	const factory = factoryFactory(context.factoryAddress, provider);
	const dao = daoFactory(context.daoAddress, provider);
	const bonding = bondingFactory(context.bondingAddress, provider);
	const registry = registryFactory(context.registryAddress, provider);

	let zeroRegistered;
	let links;
	try {
		[zeroRegistered, links] = await Promise.all([
			factory.isDeployedGame(ethers.constants.AddressZero),
			Promise.all([
				factory.disputeDAO(),
				factory.bondingManager(),
				dao.chessFactory(),
				dao.bondingManager(),
				dao.chessToken(),
				dao.arbitratorRegistry(),
				bonding.chessToken(),
				registry.chessToken()
			])
		]);
	} catch {
		throw new Error('Configured dispute contracts do not expose the required security linkage');
	}
	if (zeroRegistered !== false) {
		throw new Error('Configured ChessFactory returned an invalid canonical registry response');
	}

	const [
		factoryDao,
		factoryBonding,
		daoFactoryAddress,
		daoBonding,
		daoToken,
		daoRegistry,
		bondingToken,
		registryToken
	] = links.map((value) => normalizeProtocolAddress(value, 'Linked protocol contract'));

	const mismatches = [
		[factoryDao, context.daoAddress, 'DisputeDAO does not match the canonical ChessFactory'],
		[factoryBonding, context.bondingAddress, 'BondingManager does not match the canonical ChessFactory'],
		[daoFactoryAddress, context.factoryAddress, 'DisputeDAO does not point back to the canonical ChessFactory'],
		[daoBonding, context.bondingAddress, 'DisputeDAO does not use the canonical BondingManager'],
		[daoToken, context.tokenAddress, 'DisputeDAO does not use the canonical ChessToken'],
		[daoRegistry, context.registryAddress, 'DisputeDAO does not use the configured ArbitratorRegistry'],
		[bondingToken, context.tokenAddress, 'BondingManager does not use the canonical ChessToken'],
		[registryToken, context.tokenAddress, 'ArbitratorRegistry does not use the canonical ChessToken']
	];
	for (const [actual, expected, message] of mismatches) {
		if (actual !== expected) throw new Error(message);
	}

	await readWalletContext({
		provider,
		signer,
		account: normalizedAccount,
		chainId: context.chainId
	});

	return { ...context, account: normalizedAccount, verified: true };
}

export async function verifyCanonicalDisputeGame({
	provider,
	verification,
	gameId,
	gameAddress,
	contractFactories = {}
}) {
	if (!provider || !verification?.verified) {
		throw new Error('Dispute game context is not verified');
	}
	const protocol = normalizeDisputeProtocolContext(verification);
	const normalizedGameId = normalizeDisputeGameId(gameId);
	const expectedGameAddress = gameAddress === undefined || gameAddress === null || gameAddress === ''
		? null
		: normalizeProtocolAddress(gameAddress, 'Game contract');

	const factoryFactory = contractFactories.factory ||
		((address, runner) => new ethers.Contract(address, FACTORY_SECURITY_ABI, runner));
	const gameFactory = contractFactories.game ||
		((address, runner) => new ethers.Contract(address, GAME_SECURITY_ABI, runner));
	const factory = factoryFactory(protocol.factoryAddress, provider);

	let indexedGameAddress;
	try {
		indexedGameAddress = normalizeProtocolAddress(
			await factory.deployedChessGames(normalizedGameId),
			'Factory game'
		);
	} catch (error) {
		if (error?.message?.includes('is not configured with a valid address')) throw error;
		throw new Error('ChessFactory does not expose a canonical game for this id');
	}
	if (expectedGameAddress && indexedGameAddress !== expectedGameAddress) {
		throw new Error('Loaded game address does not match the canonical factory game id');
	}

	const canonicalGameAddress = expectedGameAddress || indexedGameAddress;
	const gameCode = await provider.getCode(canonicalGameAddress);
	if (!hasContractCode(gameCode)) {
		throw new Error('Canonical game address is not a contract on this network');
	}

	let registered;
	let reportedGameId;
	let reportedDao;
	try {
		[registered, reportedGameId, reportedDao] = await Promise.all([
			factory.isDeployedGame(canonicalGameAddress),
			gameFactory(canonicalGameAddress, provider).gameId(),
			gameFactory(canonicalGameAddress, provider).disputeDAO()
		]);
	} catch {
		throw new Error('Canonical game does not expose the required dispute linkage');
	}
	if (registered !== true) {
		throw new Error('Game is not registered by the canonical ChessFactory');
	}
	if (!ethers.BigNumber.from(reportedGameId).eq(normalizedGameId)) {
		throw new Error('Canonical game reports a different game id');
	}
	if (normalizeProtocolAddress(reportedDao, 'Game DisputeDAO') !== protocol.daoAddress) {
		throw new Error('Canonical game does not use the configured DisputeDAO');
	}

	return {
		...verification,
		...protocol,
		gameAddress: canonicalGameAddress,
		gameId: normalizedGameId,
		verified: true
	};
}

export function readPanelActiveStake(panelSecurity) {
	const panelActiveStake = panelSecurity?.panelActiveStake ??
		panelSecurity?.slashableCollateral ?? panelSecurity?.[5];
	const requiredPanelActiveStake = panelSecurity?.requiredPanelActiveStake ??
		panelSecurity?.requiredCollateral ?? panelSecurity?.[6];
	if (panelActiveStake === undefined || requiredPanelActiveStake === undefined) {
		throw new Error('Dispute DAO returned an invalid panel security response');
	}
	return { panelActiveStake, requiredPanelActiveStake };
}

export function createDisputeContextGuard() {
	let generation = 0;
	return {
		begin(contextKey) {
			generation += 1;
			return { generation, contextKey: String(contextKey) };
		},
		invalidate() {
			generation += 1;
		},
		isCurrent(token, contextKey = token?.contextKey) {
			return Boolean(token) && token.generation === generation &&
				token.contextKey === String(contextKey);
		}
	};
}

export async function readDisputeIdForGame(dao, gameId) {
	const normalizedGameId = normalizeDisputeGameId(gameId);
	const disputeId = ethers.BigNumber.from(await dao.gameToDispute(normalizedGameId));
	return disputeId.isZero() ? null : disputeId;
}

function markTransmission(error, status) {
	const normalized = error instanceof Error ? error : new Error(String(error));
	try {
		normalized.transactionTransmission = status;
		return normalized;
	} catch {
		const wrapped = new Error(normalized.message, { cause: normalized });
		wrapped.transactionTransmission = status;
		return wrapped;
	}
}

function isExplicitWalletRejection(error) {
	const codes = [error?.code, error?.error?.code, error?.data?.code];
	return codes.includes('ACTION_REJECTED') || codes.includes(4001) ||
		/user rejected|user denied/i.test(error?.message || '');
}

export async function sendBoundContractTransaction({
	contract,
	method,
	args = [],
	overrides = {},
	provider,
	signer,
	verification,
	assertCurrentContext,
	beforeBroadcast,
	onBroadcast
}) {
	let sendAttempted = false;
	try {
		if (!contract?.populateTransaction?.[method]) {
			throw new Error(`Contract method ${method} is not available`);
		}
		await recheckVerifiedDisputeWalletContext({ provider, signer, verification });
		if (assertCurrentContext) await assertCurrentContext(verification);

		const safeOverrides = { ...overrides };
		delete safeOverrides.from;
		delete safeOverrides.chainId;
		const populated = await contract.populateTransaction[method](...args, safeOverrides);

		await recheckVerifiedDisputeWalletContext({ provider, signer, verification });
		if (assertCurrentContext) await assertCurrentContext(verification);
		if (beforeBroadcast) {
			await beforeBroadcast({
				verification,
				transaction: {
					...populated,
					from: verification.account,
					chainId: verification.chainId
				}
			});
		}
		await recheckVerifiedDisputeWalletContext({ provider, signer, verification });
		if (assertCurrentContext) await assertCurrentContext(verification);

		sendAttempted = true;
		const transaction = await signer.sendTransaction({
			...populated,
			from: verification.account,
			chainId: verification.chainId
		});
		if (!transaction?.hash) {
			throw markTransmission(new Error('Wallet did not return a transaction hash'), TRANSACTION_BROADCAST_UNKNOWN);
		}
		if (onBroadcast) {
			try {
				await onBroadcast({ verification, transaction });
			} catch (error) {
				throw markTransmission(error, TRANSACTION_BROADCAST);
			}
		}
		return transaction;
	} catch (error) {
		if (error?.transactionTransmission) throw error;
		if (!sendAttempted || isExplicitWalletRejection(error)) {
			throw markTransmission(error, TRANSACTION_NOT_BROADCAST);
		}
		throw markTransmission(error, TRANSACTION_BROADCAST_UNKNOWN);
	}
}

export async function ensureExactTokenAllowance({
	expectedAmount,
	readAllowance,
	setAllowance
}) {
	const exact = ethers.BigNumber.from(expectedAmount);
	if (exact.lte(0)) throw new Error('Exact allowance must be greater than zero');

	let current = ethers.BigNumber.from(await readAllowance());
	if (current.eq(exact)) return { changed: false };

	if (!current.isZero()) {
		await setAllowance(ethers.constants.Zero);
		current = ethers.BigNumber.from(await readAllowance());
		if (!current.isZero()) {
			throw new Error('Approval reset confirmed but the previous allowance is still active');
		}
	}

	await setAllowance(exact);
	current = ethers.BigNumber.from(await readAllowance());
	if (!current.eq(exact)) {
		throw new Error('Approval confirmed but the exact requested allowance was not set');
	}
	return { changed: true };
}

export function assertExactChallengeTerms(expectedDeposit, liveDeposit, liveAllowance) {
	const expected = ethers.BigNumber.from(expectedDeposit);
	if (!ethers.BigNumber.from(liveDeposit).eq(expected)) {
		throw new Error('Challenge deposit changed before submission');
	}
	if (!ethers.BigNumber.from(liveAllowance).eq(expected)) {
		throw new Error('Exact challenge allowance changed before submission');
	}
}
