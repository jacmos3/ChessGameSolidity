import { writable, get } from 'svelte/store';
import { wallet, contractAddress } from './wallet.js';
import { ethers } from 'ethers';
import { loadContractAbi } from '../contracts/loadAbi.js';

const RATING_ADDRESSES = {
	1337: import.meta.env.VITE_PLAYER_RATING_LOCAL || '',
	5777: import.meta.env.VITE_PLAYER_RATING_LOCAL || '',
	84532: import.meta.env.VITE_PLAYER_RATING_BASE_SEPOLIA || '',
	8453: import.meta.env.VITE_PLAYER_RATING_BASE || ''
};

const getChessFactoryAbi = () => loadContractAbi('ChessFactory');
const getChessCoreAbi = () => loadContractAbi('ChessCore');
const getPlayerRatingAbi = () => loadContractAbi('PlayerRating');
const LEADERBOARD_SAMPLE = 50;

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
				const ratingAddress = RATING_ADDRESSES[$wallet.chainId];
				if (ratingAddress) {
					const players = await fetchFromRating($wallet.signer, ratingAddress);
					set({
						players,
						loading: false,
						error: null,
						lastUpdated: new Date()
					});
					return;
				}

				const players = await fetchFromRecentGames($wallet, $contractAddress);
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

async function fetchFromRating(signer, ratingAddress) {
	const playerRatingAbi = await getPlayerRatingAbi();
	const contract = new ethers.Contract(ratingAddress, playerRatingAbi, signer);
	const [count, page] = await Promise.all([
		contract.getRankedPlayerCount(),
		contract.getTopPlayers(0, LEADERBOARD_SAMPLE)
	]);

	if (Number(count) === 0) return [];

	const addresses = page.addresses || page[0] || [];
	const stats = await Promise.all(addresses.map(async (address) => {
		try {
			const player = await contract.getPlayerStats(address);
			const gamesPlayed = Number(player.gamesPlayed);
			if (gamesPlayed === 0) return null;
			const wins = Number(player.wins);
			const losses = Number(player.losses);
			return {
				address,
				wins,
				losses,
				draws: Number(player.draws),
				gamesPlayed,
				rating: Number(player.rating),
				winRatio: ((wins / gamesPlayed) * 100).toFixed(1)
			};
		} catch {
			return null;
		}
	}));

	return stats
		.filter(Boolean)
		.sort((a, b) => {
			if (b.rating !== a.rating) return b.rating - a.rating;
			if (b.wins !== a.wins) return b.wins - a.wins;
			return parseFloat(b.winRatio) - parseFloat(a.winRatio);
		})
		.slice(0, 20);
}

async function fetchFromRecentGames($wallet, factoryAddress) {
	const [factoryAbi, chessCoreAbi] = await Promise.all([
		getChessFactoryAbi(),
		getChessCoreAbi()
	]);
	const factory = new ethers.Contract(factoryAddress, factoryAbi, $wallet.signer);

	let gameAddresses = [];
	if (typeof factory.getDeployedChessGameCount === 'function') {
		const count = Number(await factory.getDeployedChessGameCount());
		const take = Math.min(LEADERBOARD_SAMPLE, count);
		const offset = count - take;
		const page = take > 0 ? await factory.getDeployedChessGamesPage(offset, take) : [];
		gameAddresses = [...page];
	} else {
		const all = await factory.getDeployedChessGames();
		gameAddresses = all.slice(Math.max(0, all.length - LEADERBOARD_SAMPLE));
	}

	const playerStats = new Map();
	const ensurePlayer = (addr) => {
		if (!addr || addr === ethers.constants.AddressZero) return null;
		const key = addr.toLowerCase();
		if (!playerStats.has(key)) {
			playerStats.set(key, {
				address: addr,
				wins: 0,
				losses: 0,
				draws: 0,
				gamesPlayed: 0
			});
		}
		return playerStats.get(key);
	};

	for (let i = 0; i < gameAddresses.length; i += 10) {
		const batch = gameAddresses.slice(i, i + 10);
		const results = await Promise.all(batch.map(async (addr) => {
			try {
				const game = new ethers.Contract(addr, chessCoreAbi, $wallet.provider);
				const [players, state] = await Promise.all([
					game.getPlayers(),
					game.getGameState()
				]);
				return { players, state: Number(state) };
			} catch {
				return null;
			}
		}));

		for (const result of results) {
			if (!result || result.state < 3 || result.state > 5) continue;
			const white = ensurePlayer(result.players[0]);
			const black = ensurePlayer(result.players[1]);
			if (result.state === 3) {
				if (white) { white.draws++; white.gamesPlayed++; }
				if (black) { black.draws++; black.gamesPlayed++; }
			} else if (result.state === 4) {
				if (white) { white.wins++; white.gamesPlayed++; }
				if (black) { black.losses++; black.gamesPlayed++; }
			} else if (result.state === 5) {
				if (white) { white.losses++; white.gamesPlayed++; }
				if (black) { black.wins++; black.gamesPlayed++; }
			}
		}
	}

	return Array.from(playerStats.values())
		.filter(p => p.gamesPlayed > 0)
		.map(p => ({
			...p,
			winRatio: ((p.wins / p.gamesPlayed) * 100).toFixed(1)
		}))
		.sort((a, b) => {
			if (b.wins !== a.wins) return b.wins - a.wins;
			return parseFloat(b.winRatio) - parseFloat(a.winRatio);
		})
		.slice(0, 20);
}

export const leaderboard = createLeaderboardStore();
