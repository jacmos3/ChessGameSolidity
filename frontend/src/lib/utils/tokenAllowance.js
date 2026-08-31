import { ethers } from 'ethers';

export function parseExactTokenAllowance(amount) {
	const allowance = ethers.utils.parseEther(String(amount).trim());
	if (allowance.lte(0)) throw new Error('Approval amount must be greater than zero');
	return allowance;
}

export function isPositiveTokenAmount(amount) {
	try {
		return parseExactTokenAllowance(amount).gt(0);
	} catch {
		return false;
	}
}

export function isValidNonNegativeTokenAmount(amount) {
	const normalized = String(amount ?? '').trim();
	if (normalized === '') return true;
	try {
		return ethers.utils.parseEther(normalized).gte(0);
	} catch {
		return false;
	}
}

export function isExactTokenAllowance(actual, expected) {
	return ethers.BigNumber.from(actual).eq(ethers.BigNumber.from(expected));
}

export function isExactFormattedTokenAllowance(actual, expected) {
	try {
		return ethers.utils.parseEther(String(actual).trim()).eq(
			ethers.utils.parseEther(String(expected).trim())
		);
	} catch {
		return false;
	}
}
