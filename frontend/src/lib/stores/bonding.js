import { writable, derived, get } from 'svelte/store';
import { wallet } from './wallet.js';
import { ethers } from 'ethers';

// Import ABIs
import BondingManagerABI from '../contracts/BondingManager.json';
import ChessTokenABI from '../contracts/ChessToken.json';

// BondingManager contract addresses per network
const BONDING_MANAGER_ADDRESSES = {
	1337: import.meta.env.VITE_BONDING_MANAGER_LOCAL || '',
	5777: import.meta.env.VITE_BONDING_MANAGER_LOCAL || '',
	84532: import.meta.env.VITE_BONDING_MANAGER_BASE_SEPOLIA || '',
	8453: import.meta.env.VITE_BONDING_MANAGER_BASE || ''
};

// ChessToken contract addresses per network
const CHESS_TOKEN_ADDRESSES = {
	1337: import.meta.env.VITE_CHESS_TOKEN_LOCAL || '',
	5777: import.meta.env.VITE_CHESS_TOKEN_LOCAL || '',
	84532: import.meta.env.VITE_CHESS_TOKEN_BASE_SEPOLIA || '',
	8453: import.meta.env.VITE_CHESS_TOKEN_BASE || ''
};

// Bonding state store
function createBondingStore() {
	const { subscribe, set, update } = writable({
		loading: false,
		error: null,
		// User's bond balances
		chessDeposited: '0',
		ethDeposited: '0',
		chessLocked: '0',
		ethLocked: '0',
		chessAvailable: '0',
		ethAvailable: '0',
		// Token balances
		chessBalance: '0',
		chessAllowance: '0',
		// Current CHESS/ETH price
		chessPrice: '0',
		// Requirements
		chessMultiplier: '0',
		ethMultiplier: '0',
		minBondEthValue: '0',
		// System paused status
		isPaused: false
	});

	return {
		subscribe,

		/**
		 * Fetch all bonding data for the connected user
		 */
		async fetchBondData() {
			const $wallet = get(wallet);
			if (!$wallet.signer || !$wallet.chainId) return;

			const bondingAddress = BONDING_MANAGER_ADDRESSES[$wallet.chainId];
			const tokenAddress = CHESS_TOKEN_ADDRESSES[$wallet.chainId];

			if (!bondingAddress || !tokenAddress) {
				update(s => ({ ...s, error: 'Bonding not available on this network' }));
				return;
			}

			update(s => ({ ...s, loading: true, error: null }));

			try {
				const bondingManager = new ethers.Contract(
					bondingAddress,
					BondingManagerABI.abi,
					$wallet.signer
				);
				const chessToken = new ethers.Contract(
					tokenAddress,
					ChessTokenABI.abi,
					$wallet.signer
				);

				// Fetch all data in parallel
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
					bondingManager.bonds($wallet.account),
					bondingManager.getAvailableBond($wallet.account),
					chessToken.balanceOf($wallet.account),
					chessToken.allowance($wallet.account, bondingAddress),
					bondingManager.chessEthPrice(),
					bondingManager.chessMultiplier(),
					bondingManager.ethMultiplier(),
					bondingManager.minBondEthValue(),
					bondingManager.paused()
				]);

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
					isPaused
				});

			} catch (err) {
				console.error('Error fetching bond data:', err);
				update(s => ({ ...s, loading: false, error: err.message }));
			}
		},

		/**
		 * Calculate required bond for a given bet amount
		 */
		async calculateRequiredBond(betAmountEth) {
			const $wallet = get(wallet);
			if (!$wallet.signer || !$wallet.chainId) return null;

			const bondingAddress = BONDING_MANAGER_ADDRESSES[$wallet.chainId];
			if (!bondingAddress) return null;

			try {
				const bondingManager = new ethers.Contract(
					bondingAddress,
					BondingManagerABI.abi,
					$wallet.signer
				);

				const betWei = ethers.utils.parseEther(betAmountEth.toString());
				const required = await bondingManager.calculateRequiredBond(betWei);

				return {
					chessRequired: ethers.utils.formatEther(required.chessRequired),
					ethRequired: ethers.utils.formatEther(required.ethRequired)
				};
			} catch (err) {
				console.error('Error calculating required bond:', err);
				return null;
			}
		},

		/**
		 * Check if user has sufficient bond for a bet amount
		 */
		async hasSufficientBond(betAmountEth) {
			const $wallet = get(wallet);
			if (!$wallet.signer || !$wallet.chainId) return false;

			const bondingAddress = BONDING_MANAGER_ADDRESSES[$wallet.chainId];
			if (!bondingAddress) return true; // No bonding on this network

			try {
				const bondingManager = new ethers.Contract(
					bondingAddress,
					BondingManagerABI.abi,
					$wallet.signer
				);

				const betWei = ethers.utils.parseEther(betAmountEth.toString());
				return await bondingManager.hasSufficientBond($wallet.account, betWei);
			} catch (err) {
				console.error('Error checking bond sufficiency:', err);
				return false;
			}
		},

		/**
		 * Approve CHESS token spending (approves max for convenience)
		 */
		async approveChess(amount) {
			const $wallet = get(wallet);
			if (!$wallet.signer || !$wallet.chainId) {
				throw new Error('Wallet not connected');
			}

			const bondingAddress = BONDING_MANAGER_ADDRESSES[$wallet.chainId];
			const tokenAddress = CHESS_TOKEN_ADDRESSES[$wallet.chainId];

			if (!bondingAddress || !tokenAddress) {
				throw new Error('Bonding not available on this network');
			}

			console.log('Approving CHESS tokens...');
			console.log('ChessToken address:', tokenAddress);
			console.log('BondingManager address (spender):', bondingAddress);
			console.log('User address:', $wallet.account);

			const chessToken = new ethers.Contract(
				tokenAddress,
				ChessTokenABI.abi,
				$wallet.signer
			);

			// Check current allowance before approval
			const currentAllowance = await chessToken.allowance($wallet.account, bondingAddress);
			console.log('Current allowance before approval:', ethers.utils.formatEther(currentAllowance));

			// Approve max amount for convenience (no need to re-approve each time)
			const maxAmount = ethers.constants.MaxUint256;
			console.log('Sending approval transaction for MaxUint256...');

			const tx = await chessToken.approve(bondingAddress, maxAmount);
			console.log('Transaction submitted:', tx.hash);

			const receipt = await tx.wait();
			console.log('Transaction confirmed in block:', receipt.blockNumber);

			// Verify the approval actually worked
			const newAllowance = await chessToken.allowance($wallet.account, bondingAddress);
			console.log('New allowance after approval:', ethers.utils.formatEther(newAllowance));

			if (newAllowance.isZero()) {
				throw new Error('Approval transaction confirmed but allowance is still 0. This should not happen - please check the console logs and report this issue.');
			}

			// Refresh data
			await this.fetchBondData();
		},

		/**
		 * Deposit bond (CHESS and/or ETH)
		 */
		async depositBond(chessAmount, ethAmount) {
			const $wallet = get(wallet);
			if (!$wallet.signer || !$wallet.chainId) {
				throw new Error('Wallet not connected');
			}

			const bondingAddress = BONDING_MANAGER_ADDRESSES[$wallet.chainId];
			const tokenAddress = CHESS_TOKEN_ADDRESSES[$wallet.chainId];
			if (!bondingAddress) {
				throw new Error('Bonding not available on this network');
			}

			console.log('Depositing bond...');
			console.log('BondingManager address:', bondingAddress);
			console.log('ChessToken address:', tokenAddress);

			const chessWei = ethers.utils.parseEther(chessAmount.toString());
			const ethWei = ethers.utils.parseEther(ethAmount.toString());

			console.log('CHESS to deposit:', chessAmount, '(', chessWei.toString(), 'wei)');
			console.log('ETH to deposit:', ethAmount, '(', ethWei.toString(), 'wei)');

			// Pre-check allowance if depositing CHESS
			if (chessWei.gt(0)) {
				const chessToken = new ethers.Contract(
					tokenAddress,
					ChessTokenABI.abi,
					$wallet.signer
				);

				const allowance = await chessToken.allowance($wallet.account, bondingAddress);
				console.log('Current CHESS allowance:', ethers.utils.formatEther(allowance));

				if (allowance.lt(chessWei)) {
					throw new Error(`Insufficient CHESS allowance. You have approved ${ethers.utils.formatEther(allowance)} CHESS but trying to deposit ${chessAmount} CHESS. Please click "Approve CHESS" first.`);
				}

				const balance = await chessToken.balanceOf($wallet.account);
				console.log('CHESS balance:', ethers.utils.formatEther(balance));

				if (balance.lt(chessWei)) {
					throw new Error(`Insufficient CHESS balance. You have ${ethers.utils.formatEther(balance)} CHESS but trying to deposit ${chessAmount} CHESS.`);
				}
			}

			const bondingManager = new ethers.Contract(
				bondingAddress,
				BondingManagerABI.abi,
				$wallet.signer
			);

			console.log('Sending deposit transaction...');
			const tx = await bondingManager.depositBond(chessWei, { value: ethWei });
			console.log('Transaction submitted:', tx.hash);

			await tx.wait();
			console.log('Deposit confirmed!');

			// Refresh data
			await this.fetchBondData();
		},

		/**
		 * Withdraw CHESS from bond
		 */
		async withdrawChess(amount) {
			const $wallet = get(wallet);
			if (!$wallet.signer || !$wallet.chainId) {
				throw new Error('Wallet not connected');
			}

			const bondingAddress = BONDING_MANAGER_ADDRESSES[$wallet.chainId];
			if (!bondingAddress) {
				throw new Error('Bonding not available on this network');
			}

			const bondingManager = new ethers.Contract(
				bondingAddress,
				BondingManagerABI.abi,
				$wallet.signer
			);

			const amountWei = ethers.utils.parseEther(amount.toString());
			const tx = await bondingManager.withdrawChess(amountWei);
			await tx.wait();

			// Refresh data
			await this.fetchBondData();
		},

		/**
		 * Withdraw ETH from bond
		 */
		async withdrawEth(amount) {
			const $wallet = get(wallet);
			if (!$wallet.signer || !$wallet.chainId) {
				throw new Error('Wallet not connected');
			}

			const bondingAddress = BONDING_MANAGER_ADDRESSES[$wallet.chainId];
			if (!bondingAddress) {
				throw new Error('Bonding not available on this network');
			}

			const bondingManager = new ethers.Contract(
				bondingAddress,
				BondingManagerABI.abi,
				$wallet.signer
			);

			const amountWei = ethers.utils.parseEther(amount.toString());
			const tx = await bondingManager.withdrawEth(amountWei);
			await tx.wait();

			// Refresh data
			await this.fetchBondData();
		},

		/**
		 * Mint test CHESS tokens (admin only - for testnet)
		 */
		async mintTestTokens(amount) {
			const $wallet = get(wallet);
			if (!$wallet.signer || !$wallet.chainId) {
				throw new Error('Wallet not connected');
			}

			const tokenAddress = CHESS_TOKEN_ADDRESSES[$wallet.chainId];
			if (!tokenAddress) {
				throw new Error('ChessToken not available on this network');
			}

			const chessToken = new ethers.Contract(
				tokenAddress,
				ChessTokenABI.abi,
				$wallet.signer
			);

			const amountWei = ethers.utils.parseEther(amount.toString());
			const tx = await chessToken.mintTreasury($wallet.account, amountWei);
			await tx.wait();

			// Refresh data
			await this.fetchBondData();
		},

		/**
		 * Clear store state
		 */
		clear() {
			set({
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
				isPaused: false
			});
		}
	};
}

export const bonding = createBondingStore();

// Derived store for bonding manager address
export const bondingManagerAddress = derived(wallet, $wallet => {
	if (!$wallet.chainId) return null;
	return BONDING_MANAGER_ADDRESSES[$wallet.chainId] || null;
});

// Derived store for CHESS token address
export const chessTokenAddress = derived(wallet, $wallet => {
	if (!$wallet.chainId) return null;
	return CHESS_TOKEN_ADDRESSES[$wallet.chainId] || null;
});

// Derived store to check if bonding is available on current network
export const bondingAvailable = derived(wallet, $wallet => {
	if (!$wallet.chainId) return false;
	return !!BONDING_MANAGER_ADDRESSES[$wallet.chainId];
});

// Helper to format CHESS amount with symbol
export function formatChess(amount) {
	const num = parseFloat(amount);
	if (num >= 1000000) {
		return (num / 1000000).toFixed(2) + 'M CHESS';
	} else if (num >= 1000) {
		return (num / 1000).toFixed(2) + 'K CHESS';
	}
	return num.toFixed(2) + ' CHESS';
}
