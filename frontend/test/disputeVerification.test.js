import test from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import {
	TRANSACTION_BROADCAST_UNKNOWN,
	TRANSACTION_NOT_BROADCAST,
	assertExactChallengeTerms,
	createDisputeContextGuard,
	ensureExactTokenAllowance,
	getWholeGameChallengeArguments,
	readPanelActiveStake,
	readDisputeChallengeEconomics,
	readDisputeIdForGame,
	readWholeGameChallengeTerms,
	sendBoundContractTransaction,
	verifiedDisputeRecordContextMatches,
	verifyCanonicalDisputeContext,
	verifyCanonicalDisputeGame
} from '../src/lib/utils/disputeVerification.js';

const addresses = {
	factoryAddress: '0x1111111111111111111111111111111111111111',
	daoAddress: '0x2222222222222222222222222222222222222222',
	bondingAddress: '0x3333333333333333333333333333333333333333',
	tokenAddress: '0x4444444444444444444444444444444444444444',
	registryAddress: '0x5555555555555555555555555555555555555555',
	account: '0x6666666666666666666666666666666666666666',
	gameAddress: '0x7777777777777777777777777777777777777777'
};

function verificationHarness({ links = {}, missingCode = '' } = {}) {
	let chainId = 84532;
	let account = addresses.account;
	const provider = {
		async getNetwork() { return { chainId }; },
		async getCode(address) {
			return address.toLowerCase() === missingCode.toLowerCase() ? '0x' : '0x60006000';
		}
	};
	const signer = {
		async getAddress() { return account; }
	};
	const contractFactories = {
		factory: () => ({
			isDeployedGame: async () => false,
			disputeDAO: async () => links.factoryDao || addresses.daoAddress,
			bondingManager: async () => links.factoryBonding || addresses.bondingAddress
		}),
		dao: () => ({
			chessFactory: async () => links.daoFactory || addresses.factoryAddress,
			bondingManager: async () => links.daoBonding || addresses.bondingAddress,
			chessToken: async () => links.daoToken || addresses.tokenAddress,
			arbitratorRegistry: async () => links.daoRegistry || addresses.registryAddress
		}),
		bonding: () => ({
			chessToken: async () => links.bondingToken || addresses.tokenAddress
		}),
		registry: () => ({
			chessToken: async () => links.registryToken || addresses.tokenAddress
		})
	};
	return {
		provider,
		signer,
		contractFactories,
		setChainId(value) { chainId = value; },
		setAccount(value) { account = value; }
	};
}

function verifyWith(harness) {
	return verifyCanonicalDisputeContext({
		provider: harness.provider,
		signer: harness.signer,
		chainId: 84532,
		...addresses,
		contractFactories: harness.contractFactories
	});
}

test('accepts only a bytecode-backed, mutually linked canonical dispute deployment', async () => {
	const verified = await verifyWith(verificationHarness());
	assert.equal(verified.verified, true);
	assert.equal(verified.daoAddress, ethers.utils.getAddress(addresses.daoAddress));

	await assert.rejects(
		verifyWith(verificationHarness({
			links: { factoryDao: '0x7777777777777777777777777777777777777777' }
		})),
		/DisputeDAO does not match the canonical ChessFactory/
	);
	await assert.rejects(
		verifyWith(verificationHarness({
			links: { daoFactory: '0x7777777777777777777777777777777777777777' }
		})),
		/point back to the canonical ChessFactory/
	);
	await assert.rejects(
		verifyWith(verificationHarness({
			links: { registryToken: '0x8888888888888888888888888888888888888888' }
		})),
		/ArbitratorRegistry does not use the canonical ChessToken/
	);
	await assert.rejects(
		verifyWith(verificationHarness({ missingCode: addresses.registryAddress })),
		/ArbitratorRegistry is not a contract/
	);
});

test('accepts game id zero and propagates an RPC failure instead of reporting not-found', async () => {
	let receivedGameId = null;
	const found = await readDisputeIdForGame({
		async gameToDispute(gameId) {
			receivedGameId = gameId;
			return 9;
		}
	}, 0);
	assert.equal(receivedGameId, 0);
	assert.equal(found.toNumber(), 9);

	const missing = await readDisputeIdForGame({ gameToDispute: async () => 0 }, 0);
	assert.equal(missing, null);
	await assert.rejects(
		readDisputeIdForGame({ gameToDispute: async () => { throw new Error('rpc unavailable'); } }, 0),
		/rpc unavailable/
	);
});

test('generation guard rejects an older response even when both reads use the same context', () => {
	const guard = createDisputeContextGuard();
	const first = guard.begin('84532:account:game:0');
	const second = guard.begin('84532:account:game:0');
	assert.equal(guard.isCurrent(first), false);
	assert.equal(guard.isCurrent(second), true);
	guard.invalidate();
	assert.equal(guard.isCurrent(second), false);
});

test('record context binding rejects a route switch with the same account and protocol', () => {
	const protocol = {
		...addresses,
		chainId: 84532,
		verified: true,
		gameId: 0,
		disputeId: 3
	};
	assert.equal(verifiedDisputeRecordContextMatches(protocol, { ...protocol }), true);
	assert.equal(
		verifiedDisputeRecordContextMatches(protocol, { ...protocol, gameId: 1 }),
		false
	);
	assert.equal(
		verifiedDisputeRecordContextMatches(protocol, { ...protocol, disputeId: 4 }),
		false
	);
});

test('binds a dispute game id to the indexed Core address and its DAO', async () => {
	const protocolHarness = verificationHarness();
	const verification = await verifyWith(protocolHarness);
	const canonical = await verifyCanonicalDisputeGame({
		provider: protocolHarness.provider,
		verification,
		gameId: 0,
		gameAddress: addresses.gameAddress,
		contractFactories: {
			factory: () => ({
				deployedChessGames: async (gameId) => {
					assert.equal(gameId, 0);
					return addresses.gameAddress;
				},
				isDeployedGame: async () => true
			}),
			game: () => ({
				gameId: async () => 0,
				disputeDAO: async () => addresses.daoAddress
			})
		}
	});
	assert.equal(canonical.gameId, 0);
	assert.equal(canonical.gameAddress, ethers.utils.getAddress(addresses.gameAddress));

	await assert.rejects(
		verifyCanonicalDisputeGame({
			provider: protocolHarness.provider,
			verification,
			gameId: 0,
			gameAddress: addresses.gameAddress,
			contractFactories: {
				factory: () => ({
					deployedChessGames: async () => '0x8888888888888888888888888888888888888888',
					isDeployedGame: async () => true
				}),
				game: () => ({ gameId: async () => 0, disputeDAO: async () => addresses.daoAddress })
			}
		}),
		/canonical factory game id/
	);
	await assert.rejects(
		verifyCanonicalDisputeGame({
			provider: protocolHarness.provider,
			verification,
			gameId: 0,
			gameAddress: addresses.gameAddress,
			contractFactories: {
				factory: () => ({
					deployedChessGames: async () => addresses.gameAddress,
					isDeployedGame: async () => true
				}),
				game: () => ({
					gameId: async () => 0,
					disputeDAO: async () => addresses.bondingAddress
				})
			}
		}),
		/does not use the configured DisputeDAO/
	);
});

test('reads renamed panel active-stake outputs and supports positional decoding', () => {
	const renamed = Object.assign([1, 2, 3, 4, 5, 6, 7], {
		panelActiveStake: ethers.BigNumber.from(6),
		requiredPanelActiveStake: ethers.BigNumber.from(7)
	});
	assert.equal(readPanelActiveStake(renamed).panelActiveStake.toString(), '6');
	assert.equal(readPanelActiveStake([1, 2, 3, 4, 5, 8, 9]).requiredPanelActiveStake, 9);
});

test('exact allowance revokes a pre-existing approval, sets only the requested amount, and verifies it', async () => {
	let allowance = ethers.constants.MaxUint256;
	const writes = [];
	await ensureExactTokenAllowance({
		expectedAmount: 50,
		readAllowance: async () => allowance,
		setAllowance: async (value) => {
			writes.push(ethers.BigNumber.from(value).toString());
			allowance = ethers.BigNumber.from(value);
		}
	});
	assert.deepEqual(writes, ['0', '50']);
	assert.equal(allowance.toString(), '50');

	let dishonestAllowance = ethers.BigNumber.from(7);
	await assert.rejects(
		ensureExactTokenAllowance({
			expectedAmount: 10,
			readAllowance: async () => dishonestAllowance,
			setAllowance: async (value) => {
				dishonestAllowance = ethers.BigNumber.from(value).isZero()
					? ethers.constants.Zero
					: ethers.BigNumber.from(9);
			}
		}),
		/exact requested allowance was not set/
	);
});

test('challenge submission fails closed if the live deposit or exact allowance changes', () => {
	assert.doesNotThrow(() => assertExactChallengeTerms(50, 50, 50));
	assert.throws(
		() => assertExactChallengeTerms(50, 49, 50),
		/Challenge deposit changed before submission/
	);
	assert.throws(
		() => assertExactChallengeTerms(50, 50, 51),
		/Exact challenge allowance changed before submission/
	);
});

test('whole-game challenge terms require the exact ABI, dynamic deposit, and a live participant', async () => {
	assert.deepEqual(getWholeGameChallengeArguments(0), [0]);
	let requestedSignature = '';
	let requestedGameId = null;
	const dao = {
		interface: {
			getFunction(signature) {
				requestedSignature = signature;
				if (signature !== 'challenge(uint256)') throw new Error('wrong signature');
			}
		},
		async getRequiredChallengeDepositForGame(gameId) {
			requestedGameId = gameId;
			return ethers.utils.parseEther('75');
		},
		async gameWhitePlayer() { return addresses.account; },
		async gameBlackPlayer() { return addresses.gameAddress; }
	};

	const terms = await readWholeGameChallengeTerms({
		dao,
		gameId: 0,
		account: addresses.account
	});
	assert.equal(requestedSignature, 'challenge(uint256)');
	assert.equal(requestedGameId, 0);
	assert.equal(ethers.utils.formatEther(terms.requiredDeposit), '75.0');
	assert.equal(terms.whitePlayer, ethers.utils.getAddress(addresses.account));

	await assert.rejects(
		readWholeGameChallengeTerms({ dao, gameId: 0, account: addresses.registryAddress }),
		/Only a participant/
	);
	await assert.rejects(
		readWholeGameChallengeTerms({
			dao: {
				...dao,
				interface: { getFunction: () => { throw new Error('legacy challenge(uint256,address)'); } }
			},
			gameId: 0,
			account: addresses.account
		}),
		/does not support whole-game challenges/
	);
});

test('pending challenge economics fail closed when live bonds cannot price the deposit', async () => {
	const dao = {
		interface: { getFunction: () => ({ name: 'challenge' }) },
		gameWhitePlayer: async () => addresses.account,
		gameBlackPlayer: async () => addresses.gameAddress,
		getRequiredChallengeDepositForGame: async () => {
			throw new Error('Bond not available');
		},
		disputeDeposits: async () => 0
	};
	await assert.rejects(
		readDisputeChallengeEconomics({ dao, gameId: 0, disputeId: 3, state: 1 }),
		/Unable to verify whole-game challenge terms/
	);
});

test('resolved dispute remains readable after bonds disappear and uses zero escrow', async () => {
	let dynamicDepositReads = 0;
	const dao = {
		interface: { getFunction: () => ({ name: 'challenge' }) },
		gameWhitePlayer: async () => addresses.account,
		gameBlackPlayer: async () => addresses.gameAddress,
		getRequiredChallengeDepositForGame: async () => {
			dynamicDepositReads += 1;
			throw new Error('Bond already released or slashed');
		},
		disputeDeposits: async (disputeId) => {
			assert.equal(disputeId, 3);
			return 0;
		}
	};
	const economics = await readDisputeChallengeEconomics({
		dao,
		gameId: 0,
		disputeId: 3,
		state: 4
	});
	assert.equal(dynamicDepositReads, 0);
	assert.equal(economics.requiredDeposit, null);
	assert.equal(economics.escrowedDeposit.isZero(), true);
	assert.equal(economics.whitePlayer, ethers.utils.getAddress(addresses.account));
});

function boundTransactionFixture({ sendError } = {}) {
	let networkChainId = 84532;
	let signerAccount = addresses.account;
	const events = [];
	const populateOverrides = [];
	const sent = [];
	const provider = {
		async getNetwork() { return { chainId: networkChainId }; }
	};
	const signer = {
		async getAddress() { return signerAccount; },
		async sendTransaction(request) {
			events.push('send');
			sent.push(request);
			if (sendError) throw sendError;
			return { hash: `0x${'aa'.repeat(32)}`, nonce: 7 };
		}
	};
	const contract = {
		populateTransaction: {
			async commitVote(disputeId, hash, overrides) {
				events.push('populate');
				populateOverrides.push(overrides);
				return { to: addresses.daoAddress, data: '0x1234' };
			}
		}
	};
	const verification = { chainId: 84532, account: addresses.account, verified: true };
	return {
		provider, signer, contract, verification, events, populateOverrides, sent,
		setNetwork(value) { networkChainId = value; },
		setAccount(value) { signerAccount = value; }
	};
}

test('persists the reveal backup before raw broadcast and never passes chainId to Contract.populate', async () => {
	const fixture = boundTransactionFixture();
	let backup = null;
	await sendBoundContractTransaction({
		contract: fixture.contract,
		method: 'commitVote',
		args: [3, `0x${'bb'.repeat(32)}`],
		overrides: { chainId: 1, from: addresses.registryAddress, gasLimit: 123 },
		provider: fixture.provider,
		signer: fixture.signer,
		verification: fixture.verification,
		beforeBroadcast: async () => {
			fixture.events.push('backup');
			backup = { status: 'pending' };
		},
		onBroadcast: async ({ transaction }) => {
			fixture.events.push('broadcast');
			backup = { status: 'broadcast', transactionHash: transaction.hash };
		}
	});
	assert.deepEqual(fixture.events, ['populate', 'backup', 'send', 'broadcast']);
	assert.deepEqual(fixture.populateOverrides, [{ gasLimit: 123 }]);
	assert.equal(fixture.sent[0].chainId, 84532);
	assert.equal(fixture.sent[0].from, ethers.utils.getAddress(addresses.account));
	assert.equal(backup.status, 'broadcast');
});

test('final route/context check after populate prevents a stale transaction from reaching the wallet', async () => {
	const fixture = boundTransactionFixture();
	let routeIsCurrent = true;
	const originalPopulate = fixture.contract.populateTransaction.commitVote;
	fixture.contract.populateTransaction.commitVote = async (...args) => {
		const request = await originalPopulate(...args);
		routeIsCurrent = false;
		return request;
	};
	await assert.rejects(
		sendBoundContractTransaction({
			contract: fixture.contract,
			method: 'commitVote',
			args: [3, `0x${'bb'.repeat(32)}`],
			provider: fixture.provider,
			signer: fixture.signer,
			verification: fixture.verification,
			assertCurrentContext: async () => {
				if (!routeIsCurrent) throw new Error('route changed');
			}
		}),
		(error) => error.message === 'route changed' &&
			error.transactionTransmission === TRANSACTION_NOT_BROADCAST
	);
	assert.equal(fixture.sent.length, 0);
});

test('final canonical linkage check after populate prevents a stale DAO write', async () => {
	const links = {};
	const protocolHarness = verificationHarness({ links });
	const canonical = await verifyWith(protocolHarness);
	const fixture = boundTransactionFixture();
	fixture.verification = canonical;
	const originalPopulate = fixture.contract.populateTransaction.commitVote;
	fixture.contract.populateTransaction.commitVote = async (...args) => {
		const request = await originalPopulate(...args);
		links.factoryDao = '0x8888888888888888888888888888888888888888';
		return request;
	};

	await assert.rejects(
		sendBoundContractTransaction({
			contract: fixture.contract,
			method: 'commitVote',
			args: [3, `0x${'bb'.repeat(32)}`],
			provider: fixture.provider,
			signer: fixture.signer,
			verification: fixture.verification,
			assertCurrentContext: async () => {
				await verifyWith(protocolHarness);
			}
		}),
		(error) => /does not match the canonical ChessFactory/.test(error.message) &&
			error.transactionTransmission === TRANSACTION_NOT_BROADCAST
	);
	assert.equal(fixture.sent.length, 0);
});

test('account/chain races fail before send, while ambiguous send failures retain broadcast-unknown', async () => {
	const race = boundTransactionFixture();
	const originalPopulate = race.contract.populateTransaction.commitVote;
	race.contract.populateTransaction.commitVote = async (...args) => {
		const request = await originalPopulate(...args);
		race.setNetwork(8453);
		return request;
	};
	await assert.rejects(
		sendBoundContractTransaction({
			contract: race.contract,
			method: 'commitVote',
			provider: race.provider,
			signer: race.signer,
			verification: race.verification
		}),
		(error) => error.transactionTransmission === TRANSACTION_NOT_BROADCAST
	);
	assert.equal(race.sent.length, 0);

	const accountRace = boundTransactionFixture();
	const accountPopulate = accountRace.contract.populateTransaction.commitVote;
	accountRace.contract.populateTransaction.commitVote = async (...args) => {
		const request = await accountPopulate(...args);
		accountRace.setAccount('0x9999999999999999999999999999999999999999');
		return request;
	};
	await assert.rejects(
		sendBoundContractTransaction({
			contract: accountRace.contract,
			method: 'commitVote',
			provider: accountRace.provider,
			signer: accountRace.signer,
			verification: accountRace.verification
		}),
		(error) => error.transactionTransmission === TRANSACTION_NOT_BROADCAST
	);
	assert.equal(accountRace.sent.length, 0);

	const ambiguous = boundTransactionFixture({ sendError: new Error('provider disconnected') });
	await assert.rejects(
		sendBoundContractTransaction({
			contract: ambiguous.contract,
			method: 'commitVote',
			provider: ambiguous.provider,
			signer: ambiguous.signer,
			verification: ambiguous.verification
		}),
		(error) => error.transactionTransmission === TRANSACTION_BROADCAST_UNKNOWN
	);
});
