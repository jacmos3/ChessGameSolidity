import { writable, get } from 'svelte/store';
import { wallet, contractAddress } from './wallet.js';
import { ethers } from 'ethers';
import ChessFactoryABI from '../contracts/ChessFactory.json';
import ChessCoreABI from '../contracts/ChessCore.json';

// Leaderboard store
function createLeaderboardStore() {
	const { subscribe, set, update } = writable({
		players: [],
		loading: false,
		error: null,
		lastUpdated: null
	});

	return {
		subscribe,

		async fetchLeaderboard() {
			const $wallet = get(wallet);
			const $contractAddress = get(contractAddress);

			if (!$wallet.signer || !$contractAddress) return;

			update(s => ({ ...s, loading: true, error: null }));

			try {
				const factory = new ethers.Contract(
					$contractAddress,
					ChessFactoryABI.abi,
					$wallet.signer
				);

				const gameAddresses = await factory.getDeployedChessGames();

				// Stats per player: { address: { wins: 0, losses: 0, draws: 0, totalBet: 0 }}
				const playerStats = new Map();

				// Helper to ensure player exists in map
				const ensurePlayer = (addr) => {
					if (!addr || addr === '0x0000000000000000000000000000000000000000') return null;
					const key = addr.toLowerCase();
					if (!playerStats.has(key)) {
						playerStats.set(key, {
							address: addr,
							wins: 0,
							losses: 0,
							draws: 0,
							totalBet: ethers.BigNumber.from(0),
							gamesPlayed: 0
						});
					}
					return playerStats.get(key);
				};

				// Fetch all game states in parallel (batches of 10)
				const batchSize = 10;
				for (let i = 0; i < gameAddresses.length; i += batchSize) {
					const batch = gameAddresses.slice(i, i + batchSize);

					const results = await Promise.all(
						batch.map(async (addr) => {
							try {
								const game = new ethers.Contract(addr, ChessCoreABI.abi, $wallet.provider);
								const [players, state, betting] = await Promise.all([
									game.getPlayers(),
									game.getGameState(),
									game.betting()
								]);
								return { players, state: Number(state), betting };
							} catch {
								return null;
							}
						})
					);

					// Process results
					for (const result of results) {
						if (!result) continue;

						const { players, state, betting } = result;
						const whitePlayer = players[0];
						const blackPlayer = players[1];

						// Skip games that haven't started or are still in progress
						if (state < 3) continue;

						const white = ensurePlayer(whitePlayer);
						const black = ensurePlayer(blackPlayer);

						// Update stats based on game state
						// State 3 = Draw, 4 = WhiteWins, 5 = BlackWins
						if (state === 3) { // Draw
							if (white) {
								white.draws++;
								white.gamesPlayed++;
								white.totalBet = white.totalBet.add(betting);
							}
							if (black) {
								black.draws++;
								black.gamesPlayed++;
								black.totalBet = black.totalBet.add(betting);
							}
						} else if (state === 4) { // White wins
							if (white) {
								white.wins++;
								white.gamesPlayed++;
								white.totalBet = white.totalBet.add(betting);
							}
							if (black) {
								black.losses++;
								black.gamesPlayed++;
								black.totalBet = black.totalBet.add(betting);
							}
						} else if (state === 5) { // Black wins
							if (white) {
								white.losses++;
								white.gamesPlayed++;
								white.totalBet = white.totalBet.add(betting);
							}
							if (black) {
								black.wins++;
								black.gamesPlayed++;
								black.totalBet = black.totalBet.add(betting);
							}
						}
					}
				}

				// Convert to array and sort by wins (then by win ratio)
				const players = Array.from(playerStats.values())
					.map(p => ({
						...p,
						totalBetEth: ethers.utils.formatEther(p.totalBet),
						winRatio: p.gamesPlayed > 0 ? (p.wins / p.gamesPlayed * 100).toFixed(1) : '0.0'
					}))
					.filter(p => p.gamesPlayed > 0) // Only show players with finished games
					.sort((a, b) => {
						// Sort by wins first
						if (b.wins !== a.wins) return b.wins - a.wins;
						// Then by win ratio
						return parseFloat(b.winRatio) - parseFloat(a.winRatio);
					})
					.slice(0, 20); // Top 20

				set({
					players,
					loading: false,
					error: null,
					lastUpdated: new Date()
				});

			} catch (err) {
				console.error('Leaderboard fetch error:', err);
				update(s => ({ ...s, loading: false, error: err.message }));
			}
		},

		clear() {
			set({ players: [], loading: false, error: null, lastUpdated: null });
		}
	};
}

export const leaderboard = createLeaderboardStore();
