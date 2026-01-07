import { writable, derived, get } from 'svelte/store';
import { wallet } from './wallet.js';
import { ethers } from 'ethers';

// Import ABIs
import ChessGovernorABI from '../contracts/ChessGovernor.json';
import ChessTimelockABI from '../contracts/ChessTimelock.json';
import ChessTokenABI from '../contracts/ChessToken.json';

// Contract addresses per network
const GOVERNOR_ADDRESSES = {
	1337: import.meta.env.VITE_GOVERNOR_LOCAL || '',
	5777: import.meta.env.VITE_GOVERNOR_LOCAL || '',
	11155111: import.meta.env.VITE_GOVERNOR_SEPOLIA || '',
	17000: import.meta.env.VITE_GOVERNOR_HOLESKY || '',
	59141: import.meta.env.VITE_GOVERNOR_LINEA || ''
};

const TIMELOCK_ADDRESSES = {
	1337: import.meta.env.VITE_TIMELOCK_LOCAL || '',
	5777: import.meta.env.VITE_TIMELOCK_LOCAL || '',
	11155111: import.meta.env.VITE_TIMELOCK_SEPOLIA || '',
	17000: import.meta.env.VITE_TIMELOCK_HOLESKY || '',
	59141: import.meta.env.VITE_TIMELOCK_LINEA || ''
};

const CHESS_TOKEN_ADDRESSES = {
	1337: import.meta.env.VITE_CHESS_TOKEN_LOCAL || '',
	5777: import.meta.env.VITE_CHESS_TOKEN_LOCAL || '',
	11155111: import.meta.env.VITE_CHESS_TOKEN_SEPOLIA || '',
	17000: import.meta.env.VITE_CHESS_TOKEN_HOLESKY || '',
	59141: import.meta.env.VITE_CHESS_TOKEN_LINEA || ''
};

// Proposal states (from Governor contract)
export const ProposalState = {
	Pending: 0,
	Active: 1,
	Canceled: 2,
	Defeated: 3,
	Succeeded: 4,
	Queued: 5,
	Expired: 6,
	Executed: 7
};

// Vote types
export const VoteType = {
	Against: 0,
	For: 1,
	Abstain: 2
};

// Governance store
function createGovernanceStore() {
	const { subscribe, set, update } = writable({
		loading: false,
		error: null,
		// Governor parameters
		votingDelay: 0,      // blocks
		votingPeriod: 0,     // blocks
		proposalThreshold: '0',
		quorum: '0',
		// Timelock parameters
		timelockDelay: 0,    // seconds
		// User voting power
		votingPower: '0',
		delegates: '',
		// Proposals list
		proposals: []
	});

	return {
		subscribe,

		/**
		 * Fetch governance parameters
		 */
		async fetchParams() {
			const $wallet = get(wallet);
			if (!$wallet.signer || !$wallet.chainId) return;

			const governorAddress = GOVERNOR_ADDRESSES[$wallet.chainId];
			const timelockAddress = TIMELOCK_ADDRESSES[$wallet.chainId];
			const tokenAddress = CHESS_TOKEN_ADDRESSES[$wallet.chainId];

			if (!governorAddress || !timelockAddress || !tokenAddress) return;

			update(s => ({ ...s, loading: true, error: null }));

			try {
				const governor = new ethers.Contract(governorAddress, ChessGovernorABI.abi, $wallet.signer);
				const timelock = new ethers.Contract(timelockAddress, ChessTimelockABI.abi, $wallet.signer);
				const token = new ethers.Contract(tokenAddress, ChessTokenABI.abi, $wallet.signer);

				const [
					votingDelay,
					votingPeriod,
					proposalThreshold,
					votingPower,
					delegates,
					timelockDelay
				] = await Promise.all([
					governor.votingDelay(),
					governor.votingPeriod(),
					governor.proposalThreshold(),
					token.getVotes($wallet.account),
					token.delegates($wallet.account),
					timelock.getMinDelay()
				]);

				// Get current block for quorum calculation
				const blockNumber = await $wallet.provider.getBlockNumber();
				let quorum = '0';
				try {
					quorum = await governor.quorum(blockNumber - 1);
				} catch {
					// Quorum might fail for very recent blocks
				}

				update(s => ({
					...s,
					loading: false,
					votingDelay: votingDelay.toNumber(),
					votingPeriod: votingPeriod.toNumber(),
					proposalThreshold: ethers.utils.formatEther(proposalThreshold),
					quorum: ethers.utils.formatEther(quorum),
					votingPower: ethers.utils.formatEther(votingPower),
					delegates: delegates,
					timelockDelay: timelockDelay.toNumber()
				}));
			} catch (err) {
				console.error('Error fetching governance params:', err);
				update(s => ({ ...s, loading: false, error: err.message }));
			}
		},

		/**
		 * Delegate voting power to an address
		 */
		async delegate(delegatee) {
			const $wallet = get(wallet);
			if (!$wallet.signer || !$wallet.chainId) {
				throw new Error('Wallet not connected');
			}

			const tokenAddress = CHESS_TOKEN_ADDRESSES[$wallet.chainId];
			if (!tokenAddress) throw new Error('Token not available');

			update(s => ({ ...s, loading: true, error: null }));

			try {
				const token = new ethers.Contract(tokenAddress, ChessTokenABI.abi, $wallet.signer);
				const tx = await token.delegate(delegatee);
				await tx.wait();

				await this.fetchParams();
				return true;
			} catch (err) {
				console.error('Error delegating:', err);
				update(s => ({ ...s, loading: false, error: err.message }));
				throw err;
			}
		},

		/**
		 * Self-delegate (activate voting power)
		 */
		async selfDelegate() {
			const $wallet = get(wallet);
			return this.delegate($wallet.account);
		},

		/**
		 * Create a proposal
		 * @param targets Array of target contract addresses
		 * @param values Array of ETH values (usually 0)
		 * @param calldatas Array of encoded function calls
		 * @param description Human-readable description
		 */
		async propose(targets, values, calldatas, description) {
			const $wallet = get(wallet);
			if (!$wallet.signer || !$wallet.chainId) {
				throw new Error('Wallet not connected');
			}

			const governorAddress = GOVERNOR_ADDRESSES[$wallet.chainId];
			if (!governorAddress) throw new Error('Governor not available');

			update(s => ({ ...s, loading: true, error: null }));

			try {
				const governor = new ethers.Contract(governorAddress, ChessGovernorABI.abi, $wallet.signer);
				const tx = await governor.propose(targets, values, calldatas, description);
				const receipt = await tx.wait();

				// Get proposal ID from event
				const event = receipt.events?.find(e => e.event === 'ProposalCreated');
				const proposalId = event?.args?.proposalId;

				update(s => ({ ...s, loading: false }));
				return proposalId?.toString();
			} catch (err) {
				console.error('Error creating proposal:', err);
				update(s => ({ ...s, loading: false, error: err.message }));
				throw err;
			}
		},

		/**
		 * Get proposal state
		 */
		async getProposalState(proposalId) {
			const $wallet = get(wallet);
			if (!$wallet.signer || !$wallet.chainId) return null;

			const governorAddress = GOVERNOR_ADDRESSES[$wallet.chainId];
			if (!governorAddress) return null;

			try {
				const governor = new ethers.Contract(governorAddress, ChessGovernorABI.abi, $wallet.signer);
				return await governor.state(proposalId);
			} catch (err) {
				console.error('Error getting proposal state:', err);
				return null;
			}
		},

		/**
		 * Cast a vote
		 * @param proposalId The proposal ID
		 * @param support 0=Against, 1=For, 2=Abstain
		 */
		async castVote(proposalId, support) {
			const $wallet = get(wallet);
			if (!$wallet.signer || !$wallet.chainId) {
				throw new Error('Wallet not connected');
			}

			const governorAddress = GOVERNOR_ADDRESSES[$wallet.chainId];
			if (!governorAddress) throw new Error('Governor not available');

			update(s => ({ ...s, loading: true, error: null }));

			try {
				const governor = new ethers.Contract(governorAddress, ChessGovernorABI.abi, $wallet.signer);
				const tx = await governor.castVote(proposalId, support);
				await tx.wait();

				update(s => ({ ...s, loading: false }));
				return true;
			} catch (err) {
				console.error('Error casting vote:', err);
				update(s => ({ ...s, loading: false, error: err.message }));
				throw err;
			}
		},

		/**
		 * Queue a successful proposal
		 */
		async queue(targets, values, calldatas, descriptionHash) {
			const $wallet = get(wallet);
			if (!$wallet.signer || !$wallet.chainId) {
				throw new Error('Wallet not connected');
			}

			const governorAddress = GOVERNOR_ADDRESSES[$wallet.chainId];
			if (!governorAddress) throw new Error('Governor not available');

			update(s => ({ ...s, loading: true, error: null }));

			try {
				const governor = new ethers.Contract(governorAddress, ChessGovernorABI.abi, $wallet.signer);
				const tx = await governor.queue(targets, values, calldatas, descriptionHash);
				await tx.wait();

				update(s => ({ ...s, loading: false }));
				return true;
			} catch (err) {
				console.error('Error queuing proposal:', err);
				update(s => ({ ...s, loading: false, error: err.message }));
				throw err;
			}
		},

		/**
		 * Execute a queued proposal
		 */
		async execute(targets, values, calldatas, descriptionHash) {
			const $wallet = get(wallet);
			if (!$wallet.signer || !$wallet.chainId) {
				throw new Error('Wallet not connected');
			}

			const governorAddress = GOVERNOR_ADDRESSES[$wallet.chainId];
			if (!governorAddress) throw new Error('Governor not available');

			update(s => ({ ...s, loading: true, error: null }));

			try {
				const governor = new ethers.Contract(governorAddress, ChessGovernorABI.abi, $wallet.signer);
				const tx = await governor.execute(targets, values, calldatas, descriptionHash);
				await tx.wait();

				update(s => ({ ...s, loading: false }));
				return true;
			} catch (err) {
				console.error('Error executing proposal:', err);
				update(s => ({ ...s, loading: false, error: err.message }));
				throw err;
			}
		},

		/**
		 * Get proposal votes
		 */
		async getProposalVotes(proposalId) {
			const $wallet = get(wallet);
			if (!$wallet.signer || !$wallet.chainId) return null;

			const governorAddress = GOVERNOR_ADDRESSES[$wallet.chainId];
			if (!governorAddress) return null;

			try {
				const governor = new ethers.Contract(governorAddress, ChessGovernorABI.abi, $wallet.signer);
				const votes = await governor.proposalVotes(proposalId);

				return {
					against: ethers.utils.formatEther(votes.againstVotes),
					for: ethers.utils.formatEther(votes.forVotes),
					abstain: ethers.utils.formatEther(votes.abstainVotes)
				};
			} catch (err) {
				console.error('Error getting proposal votes:', err);
				return null;
			}
		},

		/**
		 * Check if user has voted on a proposal
		 */
		async hasVoted(proposalId) {
			const $wallet = get(wallet);
			if (!$wallet.signer || !$wallet.chainId) return false;

			const governorAddress = GOVERNOR_ADDRESSES[$wallet.chainId];
			if (!governorAddress) return false;

			try {
				const governor = new ethers.Contract(governorAddress, ChessGovernorABI.abi, $wallet.signer);
				return await governor.hasVoted(proposalId, $wallet.account);
			} catch (err) {
				console.error('Error checking vote:', err);
				return false;
			}
		},

		/**
		 * Clear store
		 */
		clear() {
			set({
				loading: false,
				error: null,
				votingDelay: 0,
				votingPeriod: 0,
				proposalThreshold: '0',
				quorum: '0',
				votingPower: '0',
				delegates: '',
				timelockDelay: 0,
				proposals: []
			});
		}
	};
}

export const governance = createGovernanceStore();

// Derived stores
export const governanceAvailable = derived(wallet, $wallet => {
	if (!$wallet.chainId) return false;
	return !!GOVERNOR_ADDRESSES[$wallet.chainId];
});

// Helper functions
export function getProposalStateLabel(state) {
	switch (state) {
		case ProposalState.Pending: return 'Pending';
		case ProposalState.Active: return 'Active';
		case ProposalState.Canceled: return 'Canceled';
		case ProposalState.Defeated: return 'Defeated';
		case ProposalState.Succeeded: return 'Succeeded';
		case ProposalState.Queued: return 'Queued';
		case ProposalState.Expired: return 'Expired';
		case ProposalState.Executed: return 'Executed';
		default: return 'Unknown';
	}
}

export function getProposalStateColor(state) {
	switch (state) {
		case ProposalState.Pending: return 'text-chess-gray';
		case ProposalState.Active: return 'text-chess-blue';
		case ProposalState.Canceled: return 'text-chess-danger';
		case ProposalState.Defeated: return 'text-chess-danger';
		case ProposalState.Succeeded: return 'text-chess-success';
		case ProposalState.Queued: return 'text-chess-accent';
		case ProposalState.Expired: return 'text-chess-gray';
		case ProposalState.Executed: return 'text-chess-success';
		default: return 'text-chess-gray';
	}
}

export function formatTimelockDelay(seconds) {
	if (seconds < 3600) {
		return `${Math.floor(seconds / 60)} minutes`;
	} else if (seconds < 86400) {
		return `${Math.floor(seconds / 3600)} hours`;
	} else {
		return `${Math.floor(seconds / 86400)} days`;
	}
}

export function formatBlocks(blocks) {
	// Assuming ~12 seconds per block
	const seconds = blocks * 12;
	if (seconds < 3600) {
		return `~${Math.floor(seconds / 60)} min`;
	} else if (seconds < 86400) {
		return `~${Math.floor(seconds / 3600)} hours`;
	} else {
		return `~${Math.floor(seconds / 86400)} days`;
	}
}
