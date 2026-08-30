import test from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import {
	isExactFormattedTokenAllowance,
	isExactTokenAllowance,
	isPositiveTokenAmount,
	isValidNonNegativeTokenAmount,
	parseExactTokenAllowance
} from '../src/lib/utils/tokenAllowance.js';

test('CHESS approvals use the exact requested token amount', () => {
	const exact = parseExactTokenAllowance('125.5');
	assert.equal(exact.toString(), ethers.utils.parseEther('125.5').toString());
	assert.notEqual(exact.toString(), ethers.constants.MaxUint256.toString());
	assert.equal(isExactTokenAllowance(exact, ethers.utils.parseEther('125.5')), true);
});

test('CHESS approvals reject zero and negative amounts', () => {
	assert.throws(() => parseExactTokenAllowance('0'), /greater than zero/);
	assert.throws(() => parseExactTokenAllowance('-1'), /greater than zero/);
});

test('a zero allowance is represented and verified as an explicit revocation', () => {
	assert.equal(isExactTokenAllowance(ethers.constants.Zero, 0), true);
	assert.equal(isExactTokenAllowance(ethers.constants.One, 0), false);
});

test('18-decimal user input remains an exact string amount', () => {
	const value = '0.100000000000000013';
	assert.equal(parseExactTokenAllowance(value).toString(), '100000000000000013');
	assert.equal(isPositiveTokenAmount(value), true);
	assert.equal(isExactFormattedTokenAllowance(value, value), true);
	assert.equal(isExactFormattedTokenAllowance('1', value), false);
	assert.equal(isValidNonNegativeTokenAmount(''), true);
	assert.equal(isValidNonNegativeTokenAmount('0'), true);
	assert.equal(isValidNonNegativeTokenAmount('-1'), false);
	assert.equal(isValidNonNegativeTokenAmount('0.1234567890123456789'), false);
});
