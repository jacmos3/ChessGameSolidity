import { writable, derived, get } from 'svelte/store';
import { wallet } from './wallet.js';
import { ethers } from 'ethers';

// Import ABI
import PlayerRatingABI from '../contracts/PlayerRating.json';

// Contract addresses per network
const RATING_ADDRESSES = {
	1337: import.meta.env.VITE_PLAYER_RATING_LOCAL || '',
	5777: import.meta.env.VITE_PLAYER_RATING_LOCAL || '',
	11155111: import.meta.env.VITE_PLAYER_RATING_SEPOLIA || '',
	17000: import.meta.env.VITE_PLAYER_RATING_HOLESKY || '',
	59141: import.meta.env.VITE_PLAYER_RATING_LINEA || ''
};

// Rating store
function createRatingStore() {
	const { subscribe, set, update } = writable({
		loading: false,
		error: null,
		// Current user's stats
		rating: 1200,
		gamesPlayed: 0,
		wins: 0,
		losses: 0,
		draws: 0,
		peakRating: 1200,
		winRate: 0,
		isProvisional: true,
		// Leaderboard
		topPlayers: [],
		totalPlayers: 0
	});

	return {
		subscribe,

		/**
		 * Fetch current user's rating and stats
		 */
		async fetchPlayerStats(playerAddress = null) {
			const $wallet = get(wallet);
			if (!$wallet.signer || !$wallet.chainId) return;

			const ratingAddress = RATING_ADDRESSES[$wallet.chainId];
			if (!ratingAddress) return;

			const address = playerAddress || $wallet.account;

			update(s => ({ ...s, loading: true, error: null }));

			try {
				const contract = new ethers.Contract(ratingAddress, PlayerRatingABI.abi, $wallet.signer);

				const [stats, winRate, provisional] = await Promise.all([
					contract.getPlayerStats(address),
					contract.getWinRate(address),
					contract.isProvisional(address)
				]);

				update(s => ({
					...s,
					loading: false,
					rating: Number(stats.rating),
					gamesPlayed: Number(stats.gamesPlayed),
					wins: Number(stats.wins),
					losses: Number(stats.losses),
					draws: Number(stats.draws),
					peakRating: Number(stats.peakRating),
					winRate: Number(winRate) / 100, // Convert from percentage * 100
					isProvisional: provisional
				}));
			} catch (err) {
				console.error('Error fetching player stats:', err);
				update(s => ({ ...s, loading: false, error: err.message }));
			}
		},

		/**
		 * Get stats for a specific player
		 */
		async getPlayerStats(playerAddress) {
			const $wallet = get(wallet);
			if (!$wallet.signer || !$wallet.chainId) return null;

			const ratingAddress = RATING_ADDRESSES[$wallet.chainId];
			if (!ratingAddress) return null;

			try {
				const contract = new ethers.Contract(ratingAddress, PlayerRatingABI.abi, $wallet.signer);

				const [stats, winRate, provisional] = await Promise.all([
					contract.getPlayerStats(playerAddress),
					contract.getWinRate(playerAddress),
					contract.isProvisional(playerAddress)
				]);

				return {
					rating: Number(stats.rating),
					gamesPlayed: Number(stats.gamesPlayed),
					wins: Number(stats.wins),
					losses: Number(stats.losses),
					draws: Number(stats.draws),
					peakRating: Number(stats.peakRating),
					winRate: Number(winRate) / 100,
					isProvisional: provisional
				};
			} catch (err) {
				console.error('Error fetching player stats:', err);
				return null;
			}
		},

		/**
		 * Fetch leaderboard (top players)
		 */
		async fetchLeaderboard(offset = 0, limit = 20) {
			const $wallet = get(wallet);
			if (!$wallet.signer || !$wallet.chainId) return;

			const ratingAddress = RATING_ADDRESSES[$wallet.chainId];
			if (!ratingAddress) return;

			update(s => ({ ...s, loading: true, error: null }));

			try {
				const contract = new ethers.Contract(ratingAddress, PlayerRatingABI.abi, $wallet.signer);

				const [totalPlayers, topPlayersData] = await Promise.all([
					contract.getRankedPlayerCount(),
					contract.getTopPlayers(offset, limit)
				]);

				// Combine addresses and ratings
				const topPlayers = [];
				for (let i = 0; i < topPlayersData.addresses.length; i++) {
					topPlayers.push({
						address: topPlayersData.addresses[i],
						rating: Number(topPlayersData.ratings[i])
					});
				}

				// Sort by rating (descending)
				topPlayers.sort((a, b) => b.rating - a.rating);

				update(s => ({
					...s,
					loading: false,
					topPlayers,
					totalPlayers: Number(totalPlayers)
				}));
			} catch (err) {
				console.error('Error fetching leaderboard:', err);
				update(s => ({ ...s, loading: false, error: err.message }));
			}
		},

		/**
		 * Clear store
		 */
		clear() {
			set({
				loading: false,
				error: null,
				rating: 1200,
				gamesPlayed: 0,
				wins: 0,
				losses: 0,
				draws: 0,
				peakRating: 1200,
				winRate: 0,
				isProvisional: true,
				topPlayers: [],
				totalPlayers: 0
			});
		}
	};
}

export const rating = createRatingStore();

// Derived store to check if rating is available
export const ratingAvailable = derived(wallet, $wallet => {
	if (!$wallet.chainId) return false;
	return !!RATING_ADDRESSES[$wallet.chainId];
});

// Helper function to get rating tier/title
export function getRatingTier(rating) {
	if (rating >= 2400) return { name: 'Grandmaster', color: 'text-yellow-400' };
	if (rating >= 2200) return { name: 'Master', color: 'text-purple-400' };
	if (rating >= 2000) return { name: 'Expert', color: 'text-blue-400' };
	if (rating >= 1800) return { name: 'Class A', color: 'text-green-400' };
	if (rating >= 1600) return { name: 'Class B', color: 'text-teal-400' };
	if (rating >= 1400) return { name: 'Class C', color: 'text-chess-gray' };
	if (rating >= 1200) return { name: 'Class D', color: 'text-chess-gray' };
	return { name: 'Beginner', color: 'text-chess-gray' };
}

// Format rating with provisional marker
export function formatRating(rating, isProvisional) {
	return isProvisional ? `${rating}?` : `${rating}`;
}
