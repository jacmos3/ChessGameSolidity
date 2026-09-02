import { ethers } from 'ethers';

export const DEFAULT_BASE_MAX_PRIORITY_FEE_PER_GAS_WEI = '1000000';
// Base priority fees are normally a small fraction of one gwei. These hard caps
// prevent a compromised build variable or RPC response from authorizing an
// economically unreasonable fee.
export const MAX_BASE_PRIORITY_FEE_PER_GAS_WEI = '100000000'; // 0.1 gwei
export const MAX_BASE_MAX_FEE_PER_GAS_WEI = '5000000000'; // 5 gwei total max fee

const BASE_CHAIN_IDS = new Set([84532]);

export function parseBaseMaxPriorityFeePerGas(rawValue) {
	const normalized = rawValue === undefined || rawValue === null || String(rawValue).trim() === ''
		? DEFAULT_BASE_MAX_PRIORITY_FEE_PER_GAS_WEI
		: String(rawValue).trim();

	if (!/^\d+$/.test(normalized)) {
		throw new Error('VITE_BASE_MAX_PRIORITY_FEE_PER_GAS_WEI must be a positive integer');
	}

	const value = ethers.BigNumber.from(normalized);
	if (value.isZero()) {
		throw new Error('VITE_BASE_MAX_PRIORITY_FEE_PER_GAS_WEI must be a positive integer');
	}
	if (value.gt(MAX_BASE_PRIORITY_FEE_PER_GAS_WEI)) {
		throw new Error('Configured Base priority fee exceeds the 0.1 gwei safety cap');
	}

	return value;
}

export function buildBaseFeeOverrides(baseFeePerGas, rawPriorityFee) {
	const baseFee = ethers.BigNumber.from(baseFeePerGas);
	const maxPriorityFeePerGas = parseBaseMaxPriorityFeePerGas(rawPriorityFee);

	if (baseFee.lte(0)) {
		throw new Error('Base provider returned an invalid base fee');
	}

	const maxFeePerGas = baseFee.mul(2).add(maxPriorityFeePerGas);
	if (maxFeePerGas.gt(MAX_BASE_MAX_FEE_PER_GAS_WEI)) {
		throw new Error('Calculated Base max fee exceeds the 5 gwei safety cap');
	}

	return {
		maxPriorityFeePerGas,
		maxFeePerGas
	};
}

export async function getTransactionFeeOverrides(provider, chainId, rawPriorityFee) {
	if (!BASE_CHAIN_IDS.has(Number(chainId))) return {};
	if (!provider) throw new Error('Wallet provider not available');

	const block = await provider.getBlock('latest');
	if (!block?.baseFeePerGas) {
		throw new Error('Base provider did not return EIP-1559 fee data');
	}

	return buildBaseFeeOverrides(
		block.baseFeePerGas,
		rawPriorityFee ?? import.meta.env?.VITE_BASE_MAX_PRIORITY_FEE_PER_GAS_WEI
	);
}
