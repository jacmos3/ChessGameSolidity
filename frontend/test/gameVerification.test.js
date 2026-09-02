import test from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import {
	assertSupportedGameContext,
	bindTransactionToVerifiedAccount,
	createGenerationGuard,
	sendBoundContractTransaction,
	verifiedBondingContextMatches,
	verifiedFactoryContextMatches,
	verifiedGameContextMatches,
	verifiedGameMutationContextMatches,
	verifyCanonicalBondingContext,
	verifyCanonicalFactory,
	verifyRegisteredGame
} from '../src/lib/utils/gameVerification.js';

const FACTORY = '0x00000000000000000000000000000000000000F1';
const GAME = '0x00000000000000000000000000000000000000A1';
const ACCOUNT = '0x00000000000000000000000000000000000000B1';
const BONDING = '0x00000000000000000000000000000000000000C1';
const TOKEN = '0x00000000000000000000000000000000000000D1';

function verificationHarness({
	providerChainId = 84532,
	factoryCode = '0x6000',
	gameCode = '0x6001',
	registered = true,
	registryError = null,
	signerAddress = ACCOUNT
} = {}) {
	const provider = {
		async getNetwork() {
			return { chainId: providerChainId };
		},
		async getCode(address) {
			return address.toLowerCase() === FACTORY.toLowerCase() ? factoryCode : gameCode;
		}
	};
	const signer = { getAddress: async () => signerAddress };
	const registryFactory = () => ({
		async isDeployedGame(address) {
			if (registryError) throw registryError;
			if (address === '0x0000000000000000000000000000000000000000') return false;
			return registered;
		},
		async bondingManager() { return BONDING; }
	});

	return { provider, signer, registryFactory };
}

test('supported game context rejects unknown networks and malformed addresses', () => {
	assert.throws(
		() => assertSupportedGameContext({ chainId: 1, factoryAddress: FACTORY, gameAddress: GAME }),
		/Unsupported network/
	);
	assert.throws(
		() => assertSupportedGameContext({ chainId: 8453, factoryAddress: FACTORY, gameAddress: GAME }),
		/Unsupported network/
	);
	assert.throws(
		() => assertSupportedGameContext({ chainId: 84532, factoryAddress: '', gameAddress: GAME }),
		/ChessFactory is not configured/
	);
	assert.throws(
		() => assertSupportedGameContext({ chainId: 84532, factoryAddress: FACTORY, gameAddress: 'not-an-address' }),
		/Game contract is not configured/
	);
});

test('canonical factory capability is required before payable factory calls', async () => {
	const canonical = await verifyCanonicalFactory({
		...verificationHarness(),
		account: ACCOUNT,
		chainId: 84532,
		factoryAddress: FACTORY
	});
	assert.equal(canonical.verified, true);
	assert.equal(verifiedFactoryContextMatches(canonical, { ...canonical }), true);
	const boundTransaction = bindTransactionToVerifiedAccount(
		{ maxFeePerGas: 1, chainId: 1, from: GAME },
		canonical
	);
	assert.equal(boundTransaction.from, ACCOUNT);
	assert.equal('chainId' in boundTransaction, false);

	await assert.rejects(
		verifyCanonicalFactory({
			...verificationHarness({ factoryCode: '0x' }),
			account: ACCOUNT,
			chainId: 84532,
			factoryAddress: FACTORY
		}),
		/ChessFactory is not a contract/
	);
	await assert.rejects(
		verifyCanonicalFactory({
			...verificationHarness({ registryError: new Error('missing getter') }),
			account: ACCOUNT,
			chainId: 84532,
			factoryAddress: FACTORY
		}),
		/does not support canonical game verification/
	);
});

test('bound contract sends add chainId only after ethers Contract population', async () => {
	const contract = new ethers.Contract(
		GAME,
		['function mutate(uint256 value)'],
	);
	const sent = [];
	const provider = { getNetwork: async () => ({ chainId: 84532 }) };
	const signer = {
		getAddress: async () => ACCOUNT,
		async sendTransaction(request) {
			sent.push(request);
			return { hash: '0x01' };
		}
	};
	const verification = {
		verified: true,
		chainId: 84532,
		factoryAddress: FACTORY,
		gameAddress: GAME,
		account: ACCOUNT
	};

	await sendBoundContractTransaction({
		contract,
		method: 'mutate',
		args: [7],
		overrides: { maxFeePerGas: 10 },
		provider,
		signer,
		verification
	});

	assert.equal(sent.length, 1);
	assert.equal(sent[0].chainId, 84532);
	assert.equal(sent[0].from, ACCOUNT);
	assert.equal(sent[0].to, GAME);
	assert.equal(sent[0].data, contract.interface.encodeFunctionData('mutate', [7]));
});

test('bound contract send fails before broadcast when the live chain changed', async () => {
	const contract = new ethers.Contract(GAME, ['function mutate()']);
	let sent = false;
	await assert.rejects(
		sendBoundContractTransaction({
			contract,
			method: 'mutate',
			provider: { getNetwork: async () => ({ chainId: 8453 }) },
			signer: {
				getAddress: async () => ACCOUNT,
				sendTransaction: async () => { sent = true; }
			},
			verification: {
				verified: true,
				chainId: 84532,
				factoryAddress: FACTORY,
				gameAddress: GAME,
				account: ACCOUNT
			}
		}),
		/network changed/
	);
	assert.equal(sent, false);
});

test('bound contract send fails before broadcast when the verified route context changed', async () => {
	const contract = new ethers.Contract(GAME, ['function mutate()']);
	let sent = false;
	await assert.rejects(
		sendBoundContractTransaction({
			contract,
			method: 'mutate',
			provider: { getNetwork: async () => ({ chainId: 84532 }) },
			signer: {
				getAddress: async () => ACCOUNT,
				sendTransaction: async () => { sent = true; }
			},
			verification: {
				verified: true,
				chainId: 84532,
				factoryAddress: FACTORY,
				gameAddress: GAME,
				account: ACCOUNT
			},
			assertCurrentContext: () => {
				throw new Error('game route changed');
			}
		}),
		/game route changed/
	);
	assert.equal(sent, false);
});

test('bonding context is linked to the canonical factory and token', async () => {
	const provider = {
		async getNetwork() { return { chainId: 84532 }; },
		async getCode() { return '0x6000'; }
	};
	const signer = { getAddress: async () => ACCOUNT };
	const registryFactory = () => ({
		isDeployedGame: async () => false,
		bondingManager: async () => BONDING
	});
	const bondingFactory = () => ({ chessToken: async () => TOKEN });
	const context = await verifyCanonicalBondingContext({
		provider,
		signer,
		account: ACCOUNT,
		chainId: 84532,
		factoryAddress: FACTORY,
		bondingAddress: BONDING,
		tokenAddress: TOKEN,
		registryFactory,
		bondingFactory
	});
	assert.equal(verifiedBondingContextMatches(context, { ...context }), true);

	await assert.rejects(
		verifyCanonicalBondingContext({
			provider,
			signer,
			account: ACCOUNT,
			chainId: 84532,
			factoryAddress: FACTORY,
			bondingAddress: BONDING,
			tokenAddress: TOKEN,
			registryFactory: () => ({
				isDeployedGame: async () => false,
				bondingManager: async () => GAME
			}),
			bondingFactory
		}),
		/does not match the canonical ChessFactory/
	);
	await assert.rejects(
		verifyCanonicalBondingContext({
			provider,
			signer,
			account: ACCOUNT,
			chainId: 84532,
			factoryAddress: FACTORY,
			bondingAddress: BONDING,
			tokenAddress: TOKEN,
			registryFactory,
			bondingFactory: () => ({ chessToken: async () => GAME })
		}),
		/does not match the canonical BondingManager/
	);
});

test('canonical factory registration is required', async () => {
	const harness = verificationHarness({ registered: false });
	await assert.rejects(
		verifyRegisteredGame({
			...harness,
			account: ACCOUNT,
			chainId: 84532,
			factoryAddress: FACTORY,
			gameAddress: GAME
		}),
		/Unverified game contract/
	);
});

test('an ABI-compatible but unregistered game never reaches signer.sendTransaction', async () => {
	const harness = verificationHarness({ registered: false });
	let sent = false;
	const signer = {
		...harness.signer,
		async sendTransaction() {
			sent = true;
			return { hash: '0x01' };
		}
	};
	const lookalike = new ethers.Contract(GAME, ['function joinGameAsBlack() payable']);

	await assert.rejects(
		(async () => {
			const verification = await verifyRegisteredGame({
				provider: harness.provider,
				signer,
				account: ACCOUNT,
				chainId: 84532,
				factoryAddress: FACTORY,
				gameAddress: GAME,
				registryFactory: harness.registryFactory
			});
			return sendBoundContractTransaction({
				contract: lookalike,
				method: 'joinGameAsBlack',
				overrides: { value: 1 },
				provider: harness.provider,
				signer,
				verification
			});
		})(),
		/Unverified game contract/
	);
	assert.equal(sent, false);
});

test('legacy factories without the registry getter fail closed', async () => {
	const harness = verificationHarness({ registryError: new Error('missing revert data') });
	await assert.rejects(
		verifyRegisteredGame({
			...harness,
			account: ACCOUNT,
			chainId: 84532,
			factoryAddress: FACTORY,
			gameAddress: GAME
		}),
		/does not support canonical game verification/
	);
});

test('verification rejects chain, signer and bytecode changes', async () => {
	for (const [options, expected] of [
		[{ providerChainId: 8453 }, /network changed/],
		[{ signerAddress: GAME }, /account changed/],
		[{ factoryCode: '0x' }, /ChessFactory is not a contract/],
		[{ gameCode: '0x' }, /Game address is not a contract/]
	]) {
		const harness = verificationHarness(options);
		await assert.rejects(
			verifyRegisteredGame({
				...harness,
				account: ACCOUNT,
				chainId: 84532,
				factoryAddress: FACTORY,
				gameAddress: GAME
			}),
			expected
		);
	}
});

test('verification rejects a wallet context that changes during asynchronous registry reads', async () => {
	let networkReads = 0;
	let signerReads = 0;
	const harness = verificationHarness();
	harness.provider.getNetwork = async () => ({
		chainId: ++networkReads === 1 ? 84532 : 8453
	});
	harness.signer.getAddress = async () => {
		signerReads += 1;
		return ACCOUNT;
	};

	await assert.rejects(
		verifyRegisteredGame({
			...harness,
			account: ACCOUNT,
			chainId: 84532,
			factoryAddress: FACTORY,
			gameAddress: GAME
		}),
		/network changed/
	);
	assert.equal(networkReads, 2);
	assert.equal(signerReads, 1);
});

test('verification rejects a signer that changes after the registry check', async () => {
	let signerReads = 0;
	const harness = verificationHarness();
	harness.signer.getAddress = async () => (++signerReads === 1 ? ACCOUNT : GAME);

	await assert.rejects(
		verifyCanonicalFactory({
			...harness,
			account: ACCOUNT,
			chainId: 84532,
			factoryAddress: FACTORY
		}),
		/account changed/
	);
	assert.equal(signerReads, 2);
});

test('verified context binds chain, factory, game and account', async () => {
	const context = await verifyRegisteredGame({
		...verificationHarness(),
		account: ACCOUNT,
		chainId: 84532,
		factoryAddress: FACTORY,
		gameAddress: GAME
	});

	assert.equal(context.chainId, 84532);
	assert.equal(context.verified, true);
	assert.equal(context.factoryAddress.toLowerCase(), FACTORY.toLowerCase());
	assert.equal(context.gameAddress.toLowerCase(), GAME.toLowerCase());
	assert.equal(context.account.toLowerCase(), ACCOUNT.toLowerCase());
	assert.equal(verifiedGameContextMatches(context, { ...context }), true);
	assert.equal(verifiedGameContextMatches(context, { ...context, verified: false }), false);
	assert.equal(verifiedGameContextMatches(context, { ...context, chainId: 8453 }), false);
});

test('generation guard invalidates stale asynchronous loads', () => {
	const guard = createGenerationGuard();
	const first = guard.begin();
	const second = guard.begin();

	assert.equal(guard.isCurrent(first), false);
	assert.equal(guard.isCurrent(second), true);
	guard.invalidate();
	assert.equal(guard.isCurrent(second), false);
});

test('late revert from game A cannot reload over a newer game B route', () => {
	const gameA = {
		verified: true,
		chainId: 84532,
		factoryAddress: FACTORY,
		gameAddress: GAME,
		account: ACCOUNT
	};
	const gameBAddress = '0x00000000000000000000000000000000000000A2';
	const gameB = { ...gameA, gameAddress: gameBAddress };

	assert.equal(verifiedGameMutationContextMatches(gameA, gameA, { ...gameA }), true);
	assert.equal(verifiedGameMutationContextMatches(gameA, gameB, { ...gameB }), false);
	assert.equal(
		verifiedGameMutationContextMatches(gameA, null, { ...gameA, gameAddress: gameBAddress }),
		false
	);
});
