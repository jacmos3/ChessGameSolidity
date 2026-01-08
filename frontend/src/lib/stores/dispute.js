import { writable, derived, get } from 'svelte/store';
import { wallet } from './wallet.js';
import { ethers } from 'ethers';

// Import ABIs
import DisputeDAOABI from '../contracts/DisputeDAO.json';
import ArbitratorRegistryABI from '../contracts/ArbitratorRegistry.json';
import ChessTokenABI from '../contracts/ChessToken.json';

// Contract addresses per network
const DISPUTE_DAO_ADDRESSES = {
	1337: import.meta.env.VITE_DISPUTE_DAO_LOCAL || '',
	5777: import.meta.env.VITE_DISPUTE_DAO_LOCAL || '',
	84532: import.meta.env.VITE_DISPUTE_DAO_BASE_SEPOLIA || '',
	8453: import.meta.env.VITE_DISPUTE_DAO_BASE || ''
};

const ARBITRATOR_REGISTRY_ADDRESSES = {
	1337: import.meta.env.VITE_ARBITRATOR_REGISTRY_LOCAL || '',
	5777: import.meta.env.VITE_ARBITRATOR_REGISTRY_LOCAL || '',
	84532: import.meta.env.VITE_ARBITRATOR_REGISTRY_BASE_SEPOLIA || '',
	8453: import.meta.env.VITE_ARBITRATOR_REGISTRY_BASE || ''
};

const CHESS_TOKEN_ADDRESSES = {
	1337: import.meta.env.VITE_CHESS_TOKEN_LOCAL || '',
	5777: import.meta.env.VITE_CHESS_TOKEN_LOCAL || '',
	84532: import.meta.env.VITE_CHESS_TOKEN_BASE_SEPOLIA || '',
	8453: import.meta.env.VITE_CHESS_TOKEN_BASE || ''
};

// Dispute states enum (matches contract)
export const DisputeState = {
	None: 0,
	Pending: 1,      // Challenge window open
	Challenged: 2,   // In commit phase
	Revealing: 3,    // In reveal phase
	Resolved: 4,     // Decision made
	Escalated: 5     // Needs higher-level review
};

// Vote enum (matches contract)
export const Vote = {
	None: 0,
	Legit: 1,
	Cheat: 2,
	Abstain: 3
};

// Dispute store
function createDisputeStore() {
	const { subscribe, set, update } = writable({
		loading: false,
		error: null,
		// Current dispute data
		currentDispute: null,
		// DAO parameters
		challengeWindow: 0,
		commitPeriod: 0,
		revealPeriod: 0,
		challengeDeposit: '0',
		quorum: 0,
		supermajority: 0,
		// User's active challenges count
		activeChallenges: 0
	});

	return {
		subscribe,

		/**
		 * Fetch DAO parameters
		 */
		async fetchParams() {
			const $wallet = get(wallet);
			if (!$wallet.signer || !$wallet.chainId) return;

			const daoAddress = DISPUTE_DAO_ADDRESSES[$wallet.chainId];
			if (!daoAddress) return;

			try {
				const dao = new ethers.Contract(daoAddress, DisputeDAOABI.abi, $wallet.signer);

				const [
					challengeWindow,
					commitPeriod,
					revealPeriod,
					challengeDeposit,
					quorum,
					supermajority,
					activeChallenges
				] = await Promise.all([
					dao.challengeWindow(),
					dao.commitPeriod(),
					dao.revealPeriod(),
					dao.challengeDeposit(),
					dao.quorum(),
					dao.supermajority(),
					dao.activeChallenges($wallet.account)
				]);

				update(s => ({
					...s,
					challengeWindow: challengeWindow.toNumber(),
					commitPeriod: commitPeriod.toNumber(),
					revealPeriod: revealPeriod.toNumber(),
					challengeDeposit: ethers.utils.formatEther(challengeDeposit),
					quorum: quorum.toNumber(),
					supermajority: supermajority.toNumber(),
					activeChallenges: activeChallenges.toNumber()
				}));
			} catch (err) {
				console.error('Error fetching dispute params:', err);
			}
		},

		/**
		 * Get dispute by game ID
		 */
		async getDisputeByGame(gameId) {
			const $wallet = get(wallet);
			if (!$wallet.signer || !$wallet.chainId) return null;

			const daoAddress = DISPUTE_DAO_ADDRESSES[$wallet.chainId];
			if (!daoAddress) return null;

			try {
				const dao = new ethers.Contract(daoAddress, DisputeDAOABI.abi, $wallet.signer);
				const disputeId = await dao.gameToDispute(gameId);

				if (disputeId.eq(0)) return null;

				return await this.getDispute(disputeId.toNumber());
			} catch (err) {
				console.error('Error getting dispute by game:', err);
				return null;
			}
		},

		/**
		 * Get dispute details
		 */
		async getDispute(disputeId) {
			const $wallet = get(wallet);
			if (!$wallet.signer || !$wallet.chainId) return null;

			const daoAddress = DISPUTE_DAO_ADDRESSES[$wallet.chainId];
			if (!daoAddress) return null;

			update(s => ({ ...s, loading: true, error: null }));

			try {
				const dao = new ethers.Contract(daoAddress, DisputeDAOABI.abi, $wallet.signer);

				const [disputeData, arbitrators] = await Promise.all([
					dao.getDispute(disputeId),
					dao.getSelectedArbitrators(disputeId)
				]);

				// Also get timing info from disputes mapping
				const fullDispute = await dao.disputes(disputeId);

				const dispute = {
					id: disputeId,
					gameId: disputeData.gameId.toNumber(),
					challenger: disputeData.challenger,
					accusedPlayer: disputeData.accusedPlayer,
					state: disputeData.state,
					legitVotes: disputeData.legitVotes.toNumber(),
					cheatVotes: disputeData.cheatVotes.toNumber(),
					finalDecision: disputeData.finalDecision,
					escalationLevel: disputeData.escalationLevel.toNumber(),
					arbitrators,
					// Timing
					challengedAt: fullDispute.challengedAt.toNumber(),
					commitDeadline: fullDispute.commitDeadline.toNumber(),
					revealDeadline: fullDispute.revealDeadline.toNumber(),
					gameStake: ethers.utils.formatEther(fullDispute.gameStake)
				};

				update(s => ({ ...s, loading: false, currentDispute: dispute }));
				return dispute;
			} catch (err) {
				console.error('Error getting dispute:', err);
				update(s => ({ ...s, loading: false, error: err.message }));
				return null;
			}
		},

		/**
		 * Challenge a game
		 */
		async challenge(gameId, accusedPlayer) {
			const $wallet = get(wallet);
			if (!$wallet.signer || !$wallet.chainId) {
				throw new Error('Wallet not connected');
			}

			const daoAddress = DISPUTE_DAO_ADDRESSES[$wallet.chainId];
			const tokenAddress = CHESS_TOKEN_ADDRESSES[$wallet.chainId];
			if (!daoAddress || !tokenAddress) {
				throw new Error('Dispute system not available on this network');
			}

			update(s => ({ ...s, loading: true, error: null }));

			try {
				const dao = new ethers.Contract(daoAddress, DisputeDAOABI.abi, $wallet.signer);
				const token = new ethers.Contract(tokenAddress, ChessTokenABI.abi, $wallet.signer);

				// Check allowance and approve if needed
				const challengeDeposit = await dao.challengeDeposit();
				const allowance = await token.allowance($wallet.account, daoAddress);

				if (allowance.lt(challengeDeposit)) {
					const approveTx = await token.approve(daoAddress, challengeDeposit);
					await approveTx.wait();
				}

				// Submit challenge
				const tx = await dao.challenge(gameId, accusedPlayer);
				await tx.wait();

				update(s => ({ ...s, loading: false }));
				return true;
			} catch (err) {
				console.error('Error challenging game:', err);
				update(s => ({ ...s, loading: false, error: err.message }));
				throw err;
			}
		},

		/**
		 * Commit a vote (must store salt locally!)
		 */
		async commitVote(disputeId, vote, salt) {
			const $wallet = get(wallet);
			if (!$wallet.signer || !$wallet.chainId) {
				throw new Error('Wallet not connected');
			}

			const daoAddress = DISPUTE_DAO_ADDRESSES[$wallet.chainId];
			if (!daoAddress) {
				throw new Error('Dispute system not available');
			}

			update(s => ({ ...s, loading: true, error: null }));

			try {
				const dao = new ethers.Contract(daoAddress, DisputeDAOABI.abi, $wallet.signer);

				// Create commit hash: keccak256(abi.encodePacked(vote, salt, msg.sender))
				const commitHash = ethers.utils.solidityKeccak256(
					['uint8', 'bytes32', 'address'],
					[vote, salt, $wallet.account]
				);

				const tx = await dao.commitVote(disputeId, commitHash);
				await tx.wait();

				update(s => ({ ...s, loading: false }));
				return commitHash;
			} catch (err) {
				console.error('Error committing vote:', err);
				update(s => ({ ...s, loading: false, error: err.message }));
				throw err;
			}
		},

		/**
		 * Reveal a previously committed vote
		 */
		async revealVote(disputeId, vote, salt) {
			const $wallet = get(wallet);
			if (!$wallet.signer || !$wallet.chainId) {
				throw new Error('Wallet not connected');
			}

			const daoAddress = DISPUTE_DAO_ADDRESSES[$wallet.chainId];
			if (!daoAddress) {
				throw new Error('Dispute system not available');
			}

			update(s => ({ ...s, loading: true, error: null }));

			try {
				const dao = new ethers.Contract(daoAddress, DisputeDAOABI.abi, $wallet.signer);

				const tx = await dao.revealVote(disputeId, vote, salt);
				await tx.wait();

				update(s => ({ ...s, loading: false }));
				return true;
			} catch (err) {
				console.error('Error revealing vote:', err);
				update(s => ({ ...s, loading: false, error: err.message }));
				throw err;
			}
		},

		/**
		 * Resolve dispute after reveal period
		 */
		async resolveDispute(disputeId) {
			const $wallet = get(wallet);
			if (!$wallet.signer || !$wallet.chainId) {
				throw new Error('Wallet not connected');
			}

			const daoAddress = DISPUTE_DAO_ADDRESSES[$wallet.chainId];
			if (!daoAddress) {
				throw new Error('Dispute system not available');
			}

			update(s => ({ ...s, loading: true, error: null }));

			try {
				const dao = new ethers.Contract(daoAddress, DisputeDAOABI.abi, $wallet.signer);

				const tx = await dao.resolveDispute(disputeId);
				await tx.wait();

				update(s => ({ ...s, loading: false }));
				return true;
			} catch (err) {
				console.error('Error resolving dispute:', err);
				update(s => ({ ...s, loading: false, error: err.message }));
				throw err;
			}
		},

		/**
		 * Get vote status for an arbitrator
		 */
		async getVoteStatus(disputeId, arbitrator) {
			const $wallet = get(wallet);
			if (!$wallet.signer || !$wallet.chainId) return null;

			const daoAddress = DISPUTE_DAO_ADDRESSES[$wallet.chainId];
			if (!daoAddress) return null;

			try {
				const dao = new ethers.Contract(daoAddress, DisputeDAOABI.abi, $wallet.signer);
				const status = await dao.getVoteStatus(disputeId, arbitrator);

				return {
					hasCommitted: status.hasCommitted,
					hasRevealed: status.hasRevealed,
					revealedVote: status.revealedVote
				};
			} catch (err) {
				console.error('Error getting vote status:', err);
				return null;
			}
		},

		/**
		 * Generate random salt for commit-reveal
		 */
		generateSalt() {
			return ethers.utils.hexlify(ethers.utils.randomBytes(32));
		},

		/**
		 * Clear store
		 */
		clear() {
			set({
				loading: false,
				error: null,
				currentDispute: null,
				challengeWindow: 0,
				commitPeriod: 0,
				revealPeriod: 0,
				challengeDeposit: '0',
				quorum: 0,
				supermajority: 0,
				activeChallenges: 0
			});
		}
	};
}

// Arbitrator store
function createArbitratorStore() {
	const { subscribe, set, update } = writable({
		loading: false,
		error: null,
		// User's arbitrator info
		isArbitrator: false,
		stakedAmount: '0',
		votingPower: '0',
		reputation: 0,
		tier: 0,
		canVoteNow: false,
		// Registry stats
		tierCounts: { t1: 0, t2: 0, t3: 0 },
		totalStaked: '0',
		totalArbitrators: 0,
		// Tier requirements
		tier1Min: '1000',
		tier2Min: '5000',
		tier3Min: '20000'
	});

	return {
		subscribe,

		/**
		 * Fetch arbitrator data for connected user
		 */
		async fetchData() {
			const $wallet = get(wallet);
			if (!$wallet.signer || !$wallet.chainId) return;

			const registryAddress = ARBITRATOR_REGISTRY_ADDRESSES[$wallet.chainId];
			if (!registryAddress) return;

			update(s => ({ ...s, loading: true, error: null }));

			try {
				const registry = new ethers.Contract(
					registryAddress,
					ArbitratorRegistryABI.abi,
					$wallet.signer
				);

				const [info, tierCounts, totalStaked, totalArbitrators] = await Promise.all([
					registry.getArbitratorInfo($wallet.account),
					registry.getTierCounts(),
					registry.totalStaked(),
					registry.totalArbitrators()
				]);

				set({
					loading: false,
					error: null,
					isArbitrator: info.isActive,
					stakedAmount: ethers.utils.formatEther(info.stakedAmount),
					votingPower: ethers.utils.formatEther(info.votingPower),
					reputation: info.reputation.toNumber(),
					tier: info.tier,
					canVoteNow: info.canVoteNow,
					tierCounts: {
						t1: tierCounts.t1.toNumber(),
						t2: tierCounts.t2.toNumber(),
						t3: tierCounts.t3.toNumber()
					},
					totalStaked: ethers.utils.formatEther(totalStaked),
					totalArbitrators: totalArbitrators.toNumber(),
					tier1Min: '1000',
					tier2Min: '5000',
					tier3Min: '20000'
				});
			} catch (err) {
				console.error('Error fetching arbitrator data:', err);
				update(s => ({ ...s, loading: false, error: err.message }));
			}
		},

		/**
		 * Stake CHESS to become arbitrator
		 */
		async stake(amount) {
			const $wallet = get(wallet);
			if (!$wallet.signer || !$wallet.chainId) {
				throw new Error('Wallet not connected');
			}

			const registryAddress = ARBITRATOR_REGISTRY_ADDRESSES[$wallet.chainId];
			const tokenAddress = CHESS_TOKEN_ADDRESSES[$wallet.chainId];
			if (!registryAddress || !tokenAddress) {
				throw new Error('Arbitrator registry not available');
			}

			update(s => ({ ...s, loading: true, error: null }));

			try {
				const registry = new ethers.Contract(
					registryAddress,
					ArbitratorRegistryABI.abi,
					$wallet.signer
				);
				const token = new ethers.Contract(tokenAddress, ChessTokenABI.abi, $wallet.signer);

				const amountWei = ethers.utils.parseEther(amount.toString());

				// Check allowance
				const allowance = await token.allowance($wallet.account, registryAddress);
				if (allowance.lt(amountWei)) {
					const approveTx = await token.approve(registryAddress, amountWei);
					await approveTx.wait();
				}

				// Stake
				const tx = await registry.stake(amountWei);
				await tx.wait();

				// Refresh data
				await this.fetchData();

				update(s => ({ ...s, loading: false }));
				return true;
			} catch (err) {
				console.error('Error staking:', err);
				update(s => ({ ...s, loading: false, error: err.message }));
				throw err;
			}
		},

		/**
		 * Unstake CHESS
		 */
		async unstake(amount) {
			const $wallet = get(wallet);
			if (!$wallet.signer || !$wallet.chainId) {
				throw new Error('Wallet not connected');
			}

			const registryAddress = ARBITRATOR_REGISTRY_ADDRESSES[$wallet.chainId];
			if (!registryAddress) {
				throw new Error('Arbitrator registry not available');
			}

			update(s => ({ ...s, loading: true, error: null }));

			try {
				const registry = new ethers.Contract(
					registryAddress,
					ArbitratorRegistryABI.abi,
					$wallet.signer
				);

				const amountWei = ethers.utils.parseEther(amount.toString());
				const tx = await registry.unstake(amountWei);
				await tx.wait();

				// Refresh data
				await this.fetchData();

				update(s => ({ ...s, loading: false }));
				return true;
			} catch (err) {
				console.error('Error unstaking:', err);
				update(s => ({ ...s, loading: false, error: err.message }));
				throw err;
			}
		},

		/**
		 * Clear store
		 */
		clear() {
			set({
				loading: false,
				error: null,
				isArbitrator: false,
				stakedAmount: '0',
				votingPower: '0',
				reputation: 0,
				tier: 0,
				canVoteNow: false,
				tierCounts: { t1: 0, t2: 0, t3: 0 },
				totalStaked: '0',
				totalArbitrators: 0,
				tier1Min: '1000',
				tier2Min: '5000',
				tier3Min: '20000'
			});
		}
	};
}

export const dispute = createDisputeStore();
export const arbitrator = createArbitratorStore();

// Derived stores for availability
export const disputeAvailable = derived(wallet, $wallet => {
	if (!$wallet.chainId) return false;
	return !!DISPUTE_DAO_ADDRESSES[$wallet.chainId];
});

export const arbitratorAvailable = derived(wallet, $wallet => {
	if (!$wallet.chainId) return false;
	return !!ARBITRATOR_REGISTRY_ADDRESSES[$wallet.chainId];
});

// Helper to format time remaining
export function formatTimeRemaining(deadline) {
	const now = Math.floor(Date.now() / 1000);
	const remaining = deadline - now;

	if (remaining <= 0) return 'Ended';

	const hours = Math.floor(remaining / 3600);
	const minutes = Math.floor((remaining % 3600) / 60);

	if (hours > 24) {
		const days = Math.floor(hours / 24);
		return `${days}d ${hours % 24}h`;
	}
	return `${hours}h ${minutes}m`;
}

// Helper to get state label
export function getStateLabel(state) {
	switch (state) {
		case DisputeState.None: return 'None';
		case DisputeState.Pending: return 'Challenge Window';
		case DisputeState.Challenged: return 'Voting (Commit)';
		case DisputeState.Revealing: return 'Voting (Reveal)';
		case DisputeState.Resolved: return 'Resolved';
		case DisputeState.Escalated: return 'Escalated';
		default: return 'Unknown';
	}
}

// Helper to get vote label
export function getVoteLabel(vote) {
	switch (vote) {
		case Vote.None: return 'No Vote';
		case Vote.Legit: return 'Legitimate';
		case Vote.Cheat: return 'Cheating';
		case Vote.Abstain: return 'Abstain';
		default: return 'Unknown';
	}
}
