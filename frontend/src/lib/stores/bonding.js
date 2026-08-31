import { writable, derived, get } from 'svelte/store';
import { wallet, contractAddress } from './wallet.js';
import { ethers } from 'ethers';
import { loadContractAbi } from '../contracts/loadAbi.js';
import { getTransactionFeeOverrides } from '../utils/transactionFees.js';
import { isExactTokenAllowance, parseExactTokenAllowance } from '../utils/tokenAllowance.js';
import {
	bindTransactionToVerifiedAccount,
	createGenerationGuard,
	sendBoundContractTransaction,
	verifiedBondingContextMatches,
	verifyCanonicalBondingContext
} from '../utils/gameVerification.js';

const BONDING_MANAGER_ADDRESSES = {
	1337: import.meta.env.VITE_BONDING_MANAGER_LOCAL || '',
	5777: import.meta.env.VITE_BONDING_MANAGER_LOCAL || '',
	84532: import.meta.env.VITE_BONDING_MANAGER_BASE_SEPOLIA || '',
	8453: import.meta.env.VITE_BONDING_MANAGER_BASE || ''
};

const CHESS_TOKEN_ADDRESSES = {
	1337: import.meta.env.VITE_CHESS_TOKEN_LOCAL || '',
	5777: import.meta.env.VITE_CHESS_TOKEN_LOCAL || '',
	84532: import.meta.env.VITE_CHESS_TOKEN_BASE_SEPOLIA || '',
	8453: import.meta.env.VITE_CHESS_TOKEN_BASE || ''
};

const getBondingManagerAbi = () => loadContractAbi('BondingManager');
const getChessTokenAbi = () => loadContractAbi('ChessToken');

function getConfiguredAddress(addresses, chainId) {
	const configured = addresses[Number(chainId)] || '';
	if (!ethers.utils.isAddress(configured)) return null;
	const normalized = ethers.utils.getAddress(configured);
	return normalized === ethers.constants.AddressZero ? null : normalized;
}

function parseTokenAmountOrZero(amount) {
	const normalized = String(amount ?? '').trim();
	return ethers.utils.parseEther(normalized === '' ? '0' : normalized);
}

function createBondingStore() {
	const initialState = {
		loading: false,
		error: null,
		chessDeposited: '0',
		ethDeposited: '0',
		chessLocked: '0',
		ethLocked: '0',
		chessAvailable: '0',
		ethAvailable: '0',
		chessBalance: '0',
		chessAllowance: '0',
		chessPrice: '0',
		chessMultiplier: '0',
		ethMultiplier: '0',
		minBondEthValue: '0',
		isPaused: false,
		verification: null
	};
	const { subscribe, set, update } = writable(initialState);
	const requestGuard = createGenerationGuard();

	function configuredContext(walletSnapshot = get(wallet)) {
		return {
			factoryAddress: get(contractAddress),
			bondingAddress: getConfiguredAddress(BONDING_MANAGER_ADDRESSES, walletSnapshot.chainId),
			tokenAddress: getConfiguredAddress(CHESS_TOKEN_ADDRESSES, walletSnapshot.chainId)
		};
	}

	async function getVerifiedContracts({ includeFees = false } = {}) {
		const walletSnapshot = get(wallet);
		const configured = configuredContext(walletSnapshot);
		if (!walletSnapshot.provider || !walletSnapshot.signer || !walletSnapshot.account) {
			throw new Error('Wallet not connected');
		}
		if (!configured.factoryAddress || !configured.bondingAddress || !configured.tokenAddress) {
			throw new Error('Bonding not available on this network');
		}

		const [bondingManagerAbi, chessTokenAbi, feeOverrides] = await Promise.all([
			getBondingManagerAbi(),
			getChessTokenAbi(),
			includeFees
				? getTransactionFeeOverrides(walletSnapshot.provider, walletSnapshot.chainId)
				: Promise.resolve({})
		]);
		const verification = await verifyCanonicalBondingContext({
			provider: walletSnapshot.provider,
			signer: walletSnapshot.signer,
			account: walletSnapshot.account,
			chainId: walletSnapshot.chainId,
			factoryAddress: configured.factoryAddress,
			bondingAddress: configured.bondingAddress,
			tokenAddress: configured.tokenAddress
		});

		const currentWallet = get(wallet);
		const currentConfigured = configuredContext(currentWallet);
		const currentContext = {
			verified: true,
			chainId: currentWallet.chainId,
			account: currentWallet.account,
			...currentConfigured
		};
		if (!verifiedBondingContextMatches(verification, currentContext)) {
			throw new Error('Wallet or bonding context changed while verifying the transaction');
		}

		return {
			wallet: walletSnapshot,
			verification,
			bondingManager: new ethers.Contract(
				verification.bondingAddress,
				bondingManagerAbi,
				walletSnapshot.signer
			),
			chessToken: new ethers.Contract(
				verification.tokenAddress,
				chessTokenAbi,
				walletSnapshot.signer
			),
			transactionOverrides: bindTransactionToVerifiedAccount(feeOverrides, verification)
		};
	}

	function requireSameOperationContext(initial, current) {
		if (!verifiedBondingContextMatches(initial.verification, current.verification)) {
			throw new Error('Wallet or bonding context changed during the operation');
		}
	}

	function sendVerifiedBondingTransaction(context, contract, method, args = [], extraOverrides = {}) {
		return sendBoundContractTransaction({
			contract,
			method,
			args,
			overrides: { ...context.transactionOverrides, ...extraOverrides },
			provider: context.wallet.provider,
			signer: context.wallet.signer,
			verification: context.verification,
			assertCurrentContext: () => {
				const currentWallet = get(wallet);
				const liveContext = {
					verified: true,
					chainId: currentWallet.chainId,
					account: currentWallet.account,
					...configuredContext(currentWallet)
				};
				if (!verifiedBondingContextMatches(context.verification, liveContext)) {
					throw new Error('Wallet or bonding context changed before sending the transaction');
				}
			}
		});
	}

	return {
		subscribe,

		async fetchBondData() {
			const generation = requestGuard.begin();
			update(state => ({ ...state, loading: true, error: null }));

			try {
				const initial = await getVerifiedContracts();
				const account = initial.verification.account;
				const [
					bond,
					available,
					chessBalance,
					chessAllowance,
					chessPrice,
					chessMultiplier,
					ethMultiplier,
					minBondEthValue,
					isPaused
				] = await Promise.all([
					initial.bondingManager.bonds(account),
					initial.bondingManager.getAvailableBond(account),
					initial.chessToken.balanceOf(account),
					initial.chessToken.allowance(account, initial.verification.bondingAddress),
					initial.bondingManager.chessEthPrice(),
					initial.bondingManager.chessMultiplier(),
					initial.bondingManager.ethMultiplier(),
					initial.bondingManager.minBondEthValue(),
					initial.bondingManager.paused()
				]);
				if (!requestGuard.isCurrent(generation)) return;

				const finalContext = await getVerifiedContracts();
				requireSameOperationContext(initial, finalContext);
				if (!requestGuard.isCurrent(generation)) return;

				set({
					loading: false,
					error: null,
					chessDeposited: ethers.utils.formatEther(bond.chessAmount),
					ethDeposited: ethers.utils.formatEther(bond.ethAmount),
					chessLocked: ethers.utils.formatEther(bond.lockedChess || bond.chessLocked || 0),
					ethLocked: ethers.utils.formatEther(bond.lockedEth || bond.ethLocked || 0),
					chessAvailable: ethers.utils.formatEther(available.chess || available[0] || 0),
					ethAvailable: ethers.utils.formatEther(available.eth || available[1] || 0),
					chessBalance: ethers.utils.formatEther(chessBalance),
					chessAllowance: ethers.utils.formatEther(chessAllowance),
					chessPrice: ethers.utils.formatEther(chessPrice),
					chessMultiplier: chessMultiplier.toString(),
					ethMultiplier: ethMultiplier.toString(),
					minBondEthValue: ethers.utils.formatEther(minBondEthValue),
					isPaused,
					verification: finalContext.verification
				});
			} catch (error) {
				if (!requestGuard.isCurrent(generation)) return;
				set({ ...initialState, error: error.message });
			}
		},

		async calculateRequiredBond(betAmountEth) {
			try {
				const initial = await getVerifiedContracts();
				const betWei = ethers.utils.parseEther(String(betAmountEth).trim());
				const required = await initial.bondingManager.calculateRequiredBond(betWei);
				const finalContext = await getVerifiedContracts();
				requireSameOperationContext(initial, finalContext);
				return {
					chessRequired: ethers.utils.formatEther(required.chessRequired),
					ethRequired: ethers.utils.formatEther(required.ethRequired)
				};
			} catch (error) {
				console.error('Error calculating required bond:', error);
				return null;
			}
		},

		async hasSufficientBond(betAmountEth) {
			try {
				const initial = await getVerifiedContracts();
				const betWei = ethers.utils.parseEther(String(betAmountEth).trim());
				const result = await initial.bondingManager.hasSufficientBond(
					initial.verification.account,
					betWei
				);
				const finalContext = await getVerifiedContracts();
				requireSameOperationContext(initial, finalContext);
				return result;
			} catch (error) {
				console.error('Error checking bond sufficiency:', error);
				return false;
			}
		},

		async approveChess(amount) {
			const exactAmount = parseExactTokenAllowance(amount);
			const initial = await getVerifiedContracts();
			const account = initial.verification.account;
			const spender = initial.verification.bondingAddress;
			const currentAllowance = await initial.chessToken.allowance(account, spender);

			if (isExactTokenAllowance(currentAllowance, exactAmount)) {
				await this.fetchBondData();
				return;
			}

			if (!currentAllowance.isZero()) {
				const revocation = await getVerifiedContracts({ includeFees: true });
				requireSameOperationContext(initial, revocation);
				const revokeTx = await sendVerifiedBondingTransaction(
					revocation,
					revocation.chessToken,
					'approve',
					[spender, ethers.constants.Zero]
				);
				await revokeTx.wait();

				const revoked = await getVerifiedContracts();
				requireSameOperationContext(initial, revoked);
				const revokedAllowance = await revoked.chessToken.allowance(account, spender);
				if (!revokedAllowance.isZero()) {
					throw new Error('Approval reset confirmed but the previous allowance is still active.');
				}
			}

			const approval = await getVerifiedContracts({ includeFees: true });
			requireSameOperationContext(initial, approval);
			const tx = await sendVerifiedBondingTransaction(
				approval,
				approval.chessToken,
				'approve',
				[spender, exactAmount]
			);
			await tx.wait();

			const confirmed = await getVerifiedContracts();
			requireSameOperationContext(initial, confirmed);
			const newAllowance = await confirmed.chessToken.allowance(account, spender);
			if (!isExactTokenAllowance(newAllowance, exactAmount)) {
				throw new Error('Approval transaction confirmed but the exact requested allowance was not set.');
			}
			await this.fetchBondData();
		},

		async revokeChessApproval() {
			const initial = await getVerifiedContracts({ includeFees: true });
			const account = initial.verification.account;
			const spender = initial.verification.bondingAddress;
			const tx = await sendVerifiedBondingTransaction(
				initial,
				initial.chessToken,
				'approve',
				[spender, ethers.constants.Zero]
			);
			await tx.wait();

			const confirmed = await getVerifiedContracts();
			requireSameOperationContext(initial, confirmed);
			const newAllowance = await confirmed.chessToken.allowance(account, spender);
			if (!newAllowance.isZero()) {
				throw new Error('Revocation transaction confirmed but the allowance is still active.');
			}
			await this.fetchBondData();
		},

		async depositBond(chessAmount, ethAmount) {
			const chessWei = parseTokenAmountOrZero(chessAmount);
			const ethWei = parseTokenAmountOrZero(ethAmount);
			if (chessWei.lt(0) || ethWei.lt(0)) throw new Error('Deposit amounts cannot be negative');
			if (chessWei.isZero() && ethWei.isZero()) throw new Error('Must deposit something');

			const initial = await getVerifiedContracts();
			const account = initial.verification.account;
			const spender = initial.verification.bondingAddress;
			if (chessWei.gt(0)) {
				const [allowance, balance] = await Promise.all([
					initial.chessToken.allowance(account, spender),
					initial.chessToken.balanceOf(account)
				]);
				if (!allowance.eq(chessWei)) {
					throw new Error(
						`CHESS allowance must exactly match the deposit. Current allowance: ${ethers.utils.formatEther(allowance)} CHESS.`
					);
				}
				if (balance.lt(chessWei)) {
					throw new Error(`Insufficient CHESS balance. You have ${ethers.utils.formatEther(balance)} CHESS.`);
				}
			}

			const submission = await getVerifiedContracts({ includeFees: true });
			requireSameOperationContext(initial, submission);
			if (chessWei.gt(0)) {
				const finalAllowance = await submission.chessToken.allowance(account, spender);
				if (!finalAllowance.eq(chessWei)) {
					throw new Error('CHESS allowance changed before deposit; approve the exact amount again.');
				}
			}
			const tx = await sendVerifiedBondingTransaction(
				submission,
				submission.bondingManager,
				'depositBond',
				[chessWei],
				{ value: ethWei }
			);
			await tx.wait();
			await this.fetchBondData();
		},

		async withdrawChess(amount) {
			const amountWei = parseExactTokenAllowance(amount);
			const context = await getVerifiedContracts({ includeFees: true });
			const tx = await sendVerifiedBondingTransaction(
				context,
				context.bondingManager,
				'withdrawBond',
				[amountWei, 0]
			);
			await tx.wait();
			await this.fetchBondData();
		},

		async withdrawEth(amount) {
			const amountWei = parseExactTokenAllowance(amount);
			const context = await getVerifiedContracts({ includeFees: true });
			const tx = await sendVerifiedBondingTransaction(
				context,
				context.bondingManager,
				'withdrawBond',
				[0, amountWei]
			);
			await tx.wait();
			await this.fetchBondData();
		},

		async mintTestTokens(amount) {
			const amountWei = parseExactTokenAllowance(amount);
			const context = await getVerifiedContracts({ includeFees: true });
			const tx = await sendVerifiedBondingTransaction(
				context,
				context.chessToken,
				'mintTreasury',
				[context.verification.account, amountWei]
			);
			await tx.wait();
			await this.fetchBondData();
		},

		clear() {
			requestGuard.invalidate();
			set({ ...initialState });
		}
	};
}

export const bonding = createBondingStore();

export const bondingManagerAddress = derived(wallet, $wallet =>
	getConfiguredAddress(BONDING_MANAGER_ADDRESSES, $wallet.chainId)
);

export const chessTokenAddress = derived(wallet, $wallet =>
	getConfiguredAddress(CHESS_TOKEN_ADDRESSES, $wallet.chainId)
);

export const bondingAvailable = derived(
	[wallet, contractAddress],
	([$wallet, $factoryAddress]) => Boolean(
		$factoryAddress &&
		getConfiguredAddress(BONDING_MANAGER_ADDRESSES, $wallet.chainId) &&
		getConfiguredAddress(CHESS_TOKEN_ADDRESSES, $wallet.chainId)
	)
);

export function formatChess(amount) {
	const num = parseFloat(amount);
	if (num >= 1000000) return (num / 1000000).toFixed(2) + 'M CHESS';
	if (num >= 1000) return (num / 1000).toFixed(2) + 'K CHESS';
	return num.toFixed(2) + ' CHESS';
}
