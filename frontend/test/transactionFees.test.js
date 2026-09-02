import test from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import {
	DEFAULT_BASE_MAX_PRIORITY_FEE_PER_GAS_WEI,
	MAX_BASE_MAX_FEE_PER_GAS_WEI,
	MAX_BASE_PRIORITY_FEE_PER_GAS_WEI,
	buildBaseFeeOverrides,
	getTransactionFeeOverrides,
	parseBaseMaxPriorityFeePerGas
} from '../src/lib/utils/transactionFees.js';

test('Base priority fee uses the project default', () => {
	assert.equal(
		parseBaseMaxPriorityFeePerGas().toString(),
		DEFAULT_BASE_MAX_PRIORITY_FEE_PER_GAS_WEI
	);
});

test('Base priority fee accepts an explicit positive integer', () => {
	assert.equal(parseBaseMaxPriorityFeePerGas(' 2500000 ').toString(), '2500000');
	assert.equal(
		parseBaseMaxPriorityFeePerGas(MAX_BASE_PRIORITY_FEE_PER_GAS_WEI).toString(),
		MAX_BASE_PRIORITY_FEE_PER_GAS_WEI
	);
});

test('Base priority fee rejects zero, negative, decimal and malformed values', () => {
	for (const value of ['0', '00', '-1', '1.5', 'nope']) {
		assert.throws(
			() => parseBaseMaxPriorityFeePerGas(value),
			/VITE_BASE_MAX_PRIORITY_FEE_PER_GAS_WEI must be a positive integer/
		);
	}
});

test('Base priority fee fails closed above the economic safety cap', () => {
	assert.throws(
		() => parseBaseMaxPriorityFeePerGas('100000001'),
		/priority fee exceeds the 0.1 gwei safety cap/
	);
});

test('Base fee overrides use EIP-1559 values with headroom', () => {
	const overrides = buildBaseFeeOverrides(ethers.BigNumber.from('5000000'), '1000000');

	assert.equal(overrides.maxPriorityFeePerGas.toString(), '1000000');
	assert.equal(overrides.maxFeePerGas.toString(), '11000000');
});

test('Base max fee fails closed above the economic safety cap', () => {
	const cap = ethers.BigNumber.from(MAX_BASE_MAX_FEE_PER_GAS_WEI);
	assert.throws(
		() => buildBaseFeeOverrides(cap.div(2), '1'),
		/max fee exceeds the 5 gwei safety cap/
	);
});

test('non-Base networks keep provider-managed fees', async () => {
	let providerCalled = false;
	const provider = {
		async getBlock() {
			providerCalled = true;
			return null;
		}
	};

	assert.deepEqual(await getTransactionFeeOverrides(provider, 1337), {});
	assert.deepEqual(await getTransactionFeeOverrides(provider, 8453), {});
	assert.equal(providerCalled, false);
});

test('Base fee overrides are derived from the latest block', async () => {
	const provider = {
		async getBlock(tag) {
			assert.equal(tag, 'latest');
			return { baseFeePerGas: ethers.BigNumber.from('5000000') };
		}
	};

	const overrides = await getTransactionFeeOverrides(provider, 84532, '2000000');
	assert.equal(overrides.maxPriorityFeePerGas.toString(), '2000000');
	assert.equal(overrides.maxFeePerGas.toString(), '12000000');
});

test('Base Sepolia transactions fail closed when EIP-1559 data is unavailable', async () => {
	const provider = { getBlock: async () => ({ baseFeePerGas: null }) };

	await assert.rejects(
		getTransactionFeeOverrides(provider, 84532),
		/Base provider did not return EIP-1559 fee data/
	);
});
