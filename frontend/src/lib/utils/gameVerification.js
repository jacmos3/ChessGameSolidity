import { ethers } from 'ethers';

export const SUPPORTED_GAME_CHAIN_IDS = new Set([1337, 5777, 84532]);

const GAME_REGISTRY_ABI = [
	'function isDeployedGame(address game) view returns (bool)',
	'function bondingManager() view returns (address)'
];

const BONDING_SECURITY_ABI = [
	'function chessToken() view returns (address)'
];

export function normalizeProtocolAddress(value, label) {
	if (!value || !ethers.utils.isAddress(value)) {
		throw new Error(`${label} is not configured with a valid address`);
	}
	const normalized = ethers.utils.getAddress(value);
	if (normalized === ethers.constants.AddressZero) {
		throw new Error(`${label} is not configured with a valid address`);
	}
	return normalized;
}

function hasContractCode(code) {
	return typeof code === 'string' && !/^0x0*$/i.test(code);
}

export function assertSupportedFactoryContext({ chainId, factoryAddress }) {
	const normalizedChainId = Number(chainId);
	if (!Number.isSafeInteger(normalizedChainId) || !SUPPORTED_GAME_CHAIN_IDS.has(normalizedChainId)) {
		throw new Error(`Unsupported network (${chainId ?? 'unknown'})`);
	}

	return {
		chainId: normalizedChainId,
		factoryAddress: normalizeProtocolAddress(factoryAddress, 'ChessFactory')
	};
}

export function assertSupportedGameContext({ chainId, factoryAddress, gameAddress }) {
	return {
		...assertSupportedFactoryContext({ chainId, factoryAddress }),
		gameAddress: normalizeProtocolAddress(gameAddress, 'Game contract')
	};
}

export function verifiedFactoryContextMatches(left, right) {
	if (!left || !right) return false;
	return left.verified === true && right.verified === true &&
		Number(left.chainId) === Number(right.chainId) &&
		left.factoryAddress?.toLowerCase() === right.factoryAddress?.toLowerCase() &&
		left.account?.toLowerCase() === right.account?.toLowerCase();
}

export function verifiedGameContextMatches(left, right) {
	return verifiedFactoryContextMatches(left, right) &&
		left.gameAddress?.toLowerCase() === right.gameAddress?.toLowerCase();
}

export function verifiedBondingContextMatches(left, right) {
	return verifiedFactoryContextMatches(left, right) &&
		left.bondingAddress?.toLowerCase() === right.bondingAddress?.toLowerCase() &&
		left.tokenAddress?.toLowerCase() === right.tokenAddress?.toLowerCase();
}

export function verifiedGameMutationContextMatches(verification, currentVerification, currentContext) {
	return verifiedGameContextMatches(verification, currentContext) &&
		verifiedGameContextMatches(currentVerification, verification);
}

export function bindTransactionToVerifiedAccount(overrides, verification) {
	if (!verification?.verified) throw new Error('Transaction context is not verified');
	const chainId = Number(verification.chainId);
	if (!Number.isSafeInteger(chainId) || !SUPPORTED_GAME_CHAIN_IDS.has(chainId)) {
		throw new Error('Transaction chain is not verified');
	}
	const { chainId: _ignoredChainId, ...contractOverrides } = overrides || {};
	return {
		...contractOverrides,
		from: normalizeProtocolAddress(verification.account, 'Verified account')
	};
}

/**
 * Populate through Contract (which rejects chainId as a method override in
 * ethers v5), then bind chain and sender on the raw TransactionRequest passed
 * to the signer. The final live-context check happens after population and
 * immediately before the wallet request.
 */
export async function sendBoundContractTransaction({
	contract,
	method,
	args = [],
	overrides = {},
	provider,
	signer,
	verification,
	assertCurrentContext
}) {
	if (!contract?.populateTransaction ||
		typeof contract.populateTransaction[method] !== 'function') {
		throw new Error(`Contract method ${method} is not available`);
	}
	if (!provider || !signer) throw new Error('Wallet provider is not available');

	const chainId = Number(verification?.chainId);
	if (!verification?.verified || !Number.isSafeInteger(chainId) ||
		!SUPPORTED_GAME_CHAIN_IDS.has(chainId)) {
		throw new Error('Transaction context is not verified');
	}
	const account = normalizeProtocolAddress(verification.account, 'Verified account');
	const contractOverrides = bindTransactionToVerifiedAccount(overrides, verification);
	delete contractOverrides.chainId;

	const request = await contract.populateTransaction[method](...args, contractOverrides);
	await recheckWalletContext({ provider, signer, account, chainId });
	if (assertCurrentContext) await assertCurrentContext();

	return signer.sendTransaction({
		...request,
		from: account,
		chainId
	});
}

export function createGenerationGuard() {
	let generation = 0;
	return {
		begin() {
			generation += 1;
			return generation;
		},
		invalidate() {
			generation += 1;
		},
		isCurrent(candidate) {
			return candidate === generation;
		}
	};
}

async function verifyWalletContext({ provider, signer, account, chainId }) {
	if (!provider) throw new Error('Wallet provider not available');

	const network = await provider.getNetwork();
	if (Number(network.chainId) !== chainId) {
		throw new Error('Wallet network changed while verifying the protocol');
	}
	if (!account || !signer) throw new Error('Wallet account is not available');

	const normalizedAccount = normalizeProtocolAddress(account, 'Wallet account');
	const signerAddress = normalizeProtocolAddress(await signer.getAddress(), 'Signer account');
	if (signerAddress !== normalizedAccount) {
		throw new Error('Wallet account changed while verifying the protocol');
	}
	return normalizedAccount;
}

async function recheckWalletContext({ provider, signer, account, chainId }) {
	const finalNetwork = await provider.getNetwork();
	if (Number(finalNetwork.chainId) !== chainId) {
		throw new Error('Wallet network changed while verifying the protocol');
	}
	const finalSignerAddress = normalizeProtocolAddress(await signer.getAddress(), 'Signer account');
	if (finalSignerAddress !== account) {
		throw new Error('Wallet account changed while verifying the protocol');
	}
}

async function requireCanonicalFactoryCapability(factory) {
	let zeroRegistered;
	try {
		zeroRegistered = await factory.isDeployedGame(ethers.constants.AddressZero);
	} catch {
		throw new Error('Configured ChessFactory does not support canonical game verification');
	}
	if (zeroRegistered !== false) {
		throw new Error('Configured ChessFactory returned an invalid canonical registry response');
	}
}

export async function verifyCanonicalFactory({
	provider,
	signer,
	account,
	chainId,
	factoryAddress,
	registryFactory = (address, runner) => new ethers.Contract(address, GAME_REGISTRY_ABI, runner)
}) {
	const context = assertSupportedFactoryContext({ chainId, factoryAddress });
	const normalizedAccount = await verifyWalletContext({
		provider,
		signer,
		account,
		chainId: context.chainId
	});

	const factoryCode = await provider.getCode(context.factoryAddress);
	if (!hasContractCode(factoryCode)) {
		throw new Error('Configured ChessFactory is not a contract on this network');
	}

	await requireCanonicalFactoryCapability(registryFactory(context.factoryAddress, provider));
	await recheckWalletContext({
		provider,
		signer,
		account: normalizedAccount,
		chainId: context.chainId
	});

	return { ...context, account: normalizedAccount, verified: true };
}

export async function verifyCanonicalBondingContext({
	provider,
	signer,
	account,
	chainId,
	factoryAddress,
	bondingAddress,
	tokenAddress,
	registryFactory = (address, runner) => new ethers.Contract(address, GAME_REGISTRY_ABI, runner),
	bondingFactory = (address, runner) => new ethers.Contract(address, BONDING_SECURITY_ABI, runner)
}) {
	const context = {
		...assertSupportedFactoryContext({ chainId, factoryAddress }),
		bondingAddress: normalizeProtocolAddress(bondingAddress, 'BondingManager'),
		tokenAddress: normalizeProtocolAddress(tokenAddress, 'ChessToken')
	};
	const normalizedAccount = await verifyWalletContext({
		provider,
		signer,
		account,
		chainId: context.chainId
	});

	const [factoryCode, bondingCode, tokenCode] = await Promise.all([
		provider.getCode(context.factoryAddress),
		provider.getCode(context.bondingAddress),
		provider.getCode(context.tokenAddress)
	]);
	if (!hasContractCode(factoryCode)) {
		throw new Error('Configured ChessFactory is not a contract on this network');
	}
	if (!hasContractCode(bondingCode)) {
		throw new Error('Configured BondingManager is not a contract on this network');
	}
	if (!hasContractCode(tokenCode)) {
		throw new Error('Configured ChessToken is not a contract on this network');
	}

	const factory = registryFactory(context.factoryAddress, provider);
	await requireCanonicalFactoryCapability(factory);

	let canonicalBonding;
	let canonicalToken;
	try {
		canonicalBonding = normalizeProtocolAddress(await factory.bondingManager(), 'Factory BondingManager');
		canonicalToken = normalizeProtocolAddress(
			await bondingFactory(context.bondingAddress, provider).chessToken(),
			'BondingManager ChessToken'
		);
	} catch (error) {
		if (error?.message?.includes('is not configured with a valid address')) throw error;
		throw new Error('Configured bonding contracts do not expose the required security linkage');
	}
	if (canonicalBonding !== context.bondingAddress) {
		throw new Error('Configured BondingManager does not match the canonical ChessFactory');
	}
	if (canonicalToken !== context.tokenAddress) {
		throw new Error('Configured ChessToken does not match the canonical BondingManager');
	}

	await recheckWalletContext({
		provider,
		signer,
		account: normalizedAccount,
		chainId: context.chainId
	});

	return { ...context, account: normalizedAccount, verified: true };
}

export async function verifyRegisteredGame({
	provider,
	signer,
	account,
	chainId,
	factoryAddress,
	gameAddress,
	registryFactory = (address, runner) => new ethers.Contract(address, GAME_REGISTRY_ABI, runner)
}) {
	const context = assertSupportedGameContext({ chainId, factoryAddress, gameAddress });
	const normalizedAccount = await verifyWalletContext({
		provider,
		signer,
		account,
		chainId: context.chainId
	});

	const [factoryCode, gameCode] = await Promise.all([
		provider.getCode(context.factoryAddress),
		provider.getCode(context.gameAddress)
	]);
	if (!hasContractCode(factoryCode)) {
		throw new Error('Configured ChessFactory is not a contract on this network');
	}
	if (!hasContractCode(gameCode)) {
		throw new Error('Game address is not a contract on this network');
	}

	let registered;
	try {
		const registry = registryFactory(context.factoryAddress, provider);
		await requireCanonicalFactoryCapability(registry);
		registered = await registry.isDeployedGame(context.gameAddress);
	} catch (error) {
		if (error?.message?.includes('invalid canonical registry response')) throw error;
		throw new Error('Configured ChessFactory does not support canonical game verification');
	}
	if (registered !== true) {
		throw new Error('Unverified game contract: this address was not created by the configured ChessFactory');
	}

	await recheckWalletContext({
		provider,
		signer,
		account: normalizedAccount,
		chainId: context.chainId
	});

	return { ...context, account: normalizedAccount, verified: true };
}
