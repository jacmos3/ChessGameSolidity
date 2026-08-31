import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import { createServer } from 'vite';

const TOKEN = '0x1111111111111111111111111111111111111111';
const ACCOUNT = '0x2222222222222222222222222222222222222222';
const DELEGATEE = '0x3333333333333333333333333333333333333333';
const OTHER = '0x4444444444444444444444444444444444444444';
const GOVERNOR = '0x5555555555555555555555555555555555555555';
const TIMELOCK = '0x6666666666666666666666666666666666666666';
const DESCRIPTION_HASH = `0x${'77'.repeat(32)}`;
const TOKEN_INTERFACE = new ethers.utils.Interface(['function delegate(address delegatee)']);
const GOVERNOR_INTERFACE = new ethers.utils.Interface([
	'function token() view returns (address)',
	'function timelock() view returns (address)',
	'function propose(address[] targets,uint256[] values,bytes[] calldatas,string description)',
	'function castVote(uint256 proposalId,uint8 support)',
	'function queue(address[] targets,uint256[] values,bytes[] calldatas,bytes32 descriptionHash)',
	'function execute(address[] targets,uint256[] values,bytes[] calldatas,bytes32 descriptionHash) payable'
]);

const METHOD_ARGS = {
	propose: [[OTHER], [0], ['0x1234'], 'Upgrade documented component'],
	castVote: [42, 1],
	queue: [[OTHER], [0], ['0x1234'], DESCRIPTION_HASH],
	execute: [[OTHER], [0], ['0x1234'], DESCRIPTION_HASH]
};

let vite;
let sendBoundDelegateTransaction;
let sendBoundGovernorTransaction;
let createGovernanceReadEpoch;

before(async () => {
	vite = await createServer({
		server: { middlewareMode: true },
		appType: 'custom',
		logLevel: 'silent'
	});
	({ sendBoundDelegateTransaction, sendBoundGovernorTransaction, createGovernanceReadEpoch } =
		await vite.ssrLoadModule('/src/lib/stores/governance.js'));
});

after(async () => {
	await vite?.close();
});

function canonicalFixture({ mutateAfterPopulate, requestOverrides = {} } = {}) {
	let chainId = 84532;
	let signerAddress = ACCOUNT;
	let linkedToken = TOKEN;
	let linkedTimelock = TIMELOCK;
	const code = new Map([
		[TOKEN.toLowerCase(), '0x60006000'],
		[GOVERNOR.toLowerCase(), '0x60006000'],
		[TIMELOCK.toLowerCase(), '0x60006000']
	]);
	const populatedOverrides = [];
	const sent = [];
	const events = [];
	const provider = {
		async getNetwork() { return { chainId }; },
		async getCode(address) { return code.get(address.toLowerCase()) || '0x'; }
	};
	const signer = {
		async getAddress() { return signerAddress; },
		async sendTransaction(request) {
			events.push('send');
			sent.push(request);
			return { hash: `0x${'aa'.repeat(32)}` };
		}
	};
	const mutationControls = {
		setChainId: value => { chainId = value; },
		setSignerAddress: value => { signerAddress = value; },
		setCode: (address, value) => { code.set(address.toLowerCase(), value); },
		setLinkedToken: value => { linkedToken = value; },
		setLinkedTimelock: value => { linkedTimelock = value; }
	};
	const governor = {
		address: GOVERNOR,
		interface: GOVERNOR_INTERFACE,
		async token() { return linkedToken; },
		async timelock() { return linkedTimelock; },
		populateTransaction: {}
	};
	for (const [method, expectedArgs] of Object.entries(METHOD_ARGS)) {
		governor.populateTransaction[method] = async (...received) => {
			const overrides = received.pop();
			events.push('populate');
			assert.deepEqual(received, expectedArgs);
			populatedOverrides.push(overrides);
			if (mutateAfterPopulate) mutateAfterPopulate(mutationControls);
			return {
				to: GOVERNOR,
				data: GOVERNOR_INTERFACE.encodeFunctionData(method, expectedArgs),
				value: overrides.value,
				...requestOverrides
			};
		};
	}
	const token = {
		populateTransaction: {
			async delegate(delegatee, overrides) {
				events.push('populate');
				populatedOverrides.push(overrides);
				if (mutateAfterPopulate) mutateAfterPopulate(mutationControls);
				return {
					to: TOKEN,
					data: TOKEN_INTERFACE.encodeFunctionData('delegate', [delegatee]),
					...requestOverrides
				};
			}
		}
	};

	return { provider, signer, token, governor, populatedOverrides, sent, events };
}

function commonOptions(fixture) {
	return {
		provider: fixture.provider,
		signer: fixture.signer,
		account: ACCOUNT,
		chainId: 84532,
		tokenAddress: TOKEN,
		governorAddress: GOVERNOR,
		timelockAddress: TIMELOCK,
		governor: fixture.governor,
		overrides: {
			maxFeePerGas: 10,
			from: OTHER,
			chainId: 1,
			to: OTHER,
			data: '0xdeadbeef',
			value: 99
		}
	};
}

function sendDelegate(fixture, options = {}) {
	return sendBoundDelegateTransaction({
		...commonOptions(fixture),
		delegatee: DELEGATEE,
		token: fixture.token,
		...options
	});
}

function sendGovernor(fixture, method, options = {}) {
	return sendBoundGovernorTransaction({
		...commonOptions(fixture),
		method,
		args: METHOD_ARGS[method],
		...options
	});
}

test('governance delegation binds canonical contracts, sender and exact calldata', async () => {
	const fixture = canonicalFixture();
	await sendDelegate(fixture, {
		assertCurrentContext: () => fixture.events.push('context')
	});

	assert.deepEqual(fixture.events.slice(0, 2), ['populate', 'context']);
	assert.equal(fixture.events.at(-1), 'send');
	assert.deepEqual(fixture.populatedOverrides, [{ maxFeePerGas: 10 }]);
	assert.equal(fixture.sent.length, 1);
	assert.equal(fixture.sent[0].to, TOKEN);
	assert.equal(fixture.sent[0].from, ethers.utils.getAddress(ACCOUNT));
	assert.equal(fixture.sent[0].chainId, 84532);
	assert.equal(fixture.sent[0].value, 0);
	assert.equal(
		fixture.sent[0].data,
		TOKEN_INTERFACE.encodeFunctionData('delegate', [DELEGATEE])
	);
});

test('governance delegation fails closed on wallet, bytecode, link and live-context races', async (t) => {
	const races = [
		['network', ({ setChainId }) => setChainId(8453), /network changed/],
		['signer', ({ setSignerAddress }) => setSignerAddress(OTHER), /account changed/],
		['token bytecode', ({ setCode }) => setCode(TOKEN, '0x'), /ChessToken is not a contract/],
		['governor bytecode', ({ setCode }) => setCode(GOVERNOR, '0x'), /ChessGovernor is not a contract/],
		['timelock bytecode', ({ setCode }) => setCode(TIMELOCK, '0x'), /ChessTimelock is not a contract/],
		['token link', ({ setLinkedToken }) => setLinkedToken(OTHER), /token does not match/],
		['timelock link', ({ setLinkedTimelock }) => setLinkedTimelock(OTHER), /timelock does not match/]
	];

	for (const [name, mutation, expectedError] of races) {
		await t.test(name, async () => {
			const fixture = canonicalFixture({ mutateAfterPopulate: mutation });
			await assert.rejects(sendDelegate(fixture), expectedError);
			assert.equal(fixture.sent.length, 0);
		});
	}

	await t.test('wallet store context', async () => {
		const fixture = canonicalFixture();
		await assert.rejects(
			sendDelegate(fixture, {
				assertCurrentContext: () => {
					throw new Error('Wallet governance context changed before transaction');
				}
			}),
			/context changed/
		);
		assert.equal(fixture.sent.length, 0);
	});
});

test('governance delegation rejects populated target, calldata and value tampering', async (t) => {
	const tampering = [
		['target', { to: OTHER }, /target does not match/],
		['calldata', { data: TOKEN_INTERFACE.encodeFunctionData('delegate', [OTHER]) }, /calldata does not match/],
		['value', { value: 1 }, /must not transfer value/]
	];

	for (const [name, requestOverrides, expectedError] of tampering) {
		await t.test(name, async () => {
			const fixture = canonicalFixture({ requestOverrides });
			await assert.rejects(sendDelegate(fixture), expectedError);
			assert.equal(fixture.sent.length, 0);
		});
	}
});

test('proposal, vote, queue and execute bind the canonical Governor and exact operation', async (t) => {
	for (const method of Object.keys(METHOD_ARGS)) {
		await t.test(method, async () => {
			const fixture = canonicalFixture();
			await sendGovernor(fixture, method);

			assert.deepEqual(fixture.populatedOverrides, [{ maxFeePerGas: 10, value: 0 }]);
			assert.equal(fixture.sent.length, 1);
			assert.equal(fixture.sent[0].to, GOVERNOR);
			assert.equal(fixture.sent[0].from, ethers.utils.getAddress(ACCOUNT));
			assert.equal(fixture.sent[0].chainId, 84532);
			assert.equal(ethers.BigNumber.from(fixture.sent[0].value).toString(), '0');
			assert.equal(
				fixture.sent[0].data,
				GOVERNOR_INTERFACE.encodeFunctionData(method, METHOD_ARGS[method])
			);
		});
	}
});

test('Governor writes reject populated target, calldata, value and canonical-link tampering', async (t) => {
	const tampering = [
		['target', { to: OTHER }, null, /target does not match/],
		['calldata', { data: GOVERNOR_INTERFACE.encodeFunctionData('castVote', [43, 0]) }, null, /calldata does not match/],
		['value', { value: 1 }, null, /value does not match/],
		['token link', {}, ({ setLinkedToken }) => setLinkedToken(OTHER), /token does not match/],
		['timelock link', {}, ({ setLinkedTimelock }) => setLinkedTimelock(OTHER), /timelock does not match/]
	];

	for (const [name, requestOverrides, mutation, expectedError] of tampering) {
		await t.test(name, async () => {
			const fixture = canonicalFixture({ requestOverrides, mutateAfterPopulate: mutation });
			await assert.rejects(sendGovernor(fixture, 'castVote'), expectedError);
			assert.equal(fixture.sent.length, 0);
		});
	}
});

test('governance read epochs reject delayed results across account/network round trips and clear', async () => {
	const providerA = {};
	const signerA = {};
	const providerB = {};
	const signerB = {};
	const contextA = {
		provider: providerA,
		signer: signerA,
		account: ACCOUNT,
		chainId: 84532,
		tokenAddress: TOKEN,
		governorAddress: GOVERNOR,
		timelockAddress: TIMELOCK
	};
	const contextB = {
		provider: providerB,
		signer: signerB,
		account: OTHER,
		chainId: 8453,
		tokenAddress: TOKEN,
		governorAddress: GOVERNOR,
		timelockAddress: TIMELOCK
	};
	const epoch = createGovernanceReadEpoch(contextA);
	let currentContext = contextA;
	const staleTicket = epoch.capture(currentContext);
	let resolveSlow;
	const slowRpc = new Promise(resolve => { resolveSlow = resolve; });
	const guardedSlowResult = slowRpc.then(value =>
		epoch.isCurrent(staleTicket, currentContext) ? value : null
	);

	currentContext = contextB;
	epoch.sync(currentContext);
	const freshTicket = epoch.capture(currentContext);
	assert.equal(epoch.isCurrent(freshTicket, currentContext), true);

	// Returning to an equal-looking A context must not revive the old A ticket.
	currentContext = contextA;
	epoch.sync(currentContext);
	resolveSlow('stale-A-result');
	assert.equal(await guardedSlowResult, null);

	const postSwitchTicket = epoch.capture(currentContext);
	assert.equal(epoch.isCurrent(postSwitchTicket, currentContext), true);
	epoch.invalidate();
	assert.equal(epoch.isCurrent(postSwitchTicket, currentContext), false);
});
