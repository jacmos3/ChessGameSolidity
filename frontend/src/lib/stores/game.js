import { writable, derived, get } from 'svelte/store';
import { wallet, contractAddress } from './wallet.js';
import { ethers } from 'ethers';

// Import ABIs (will be copied from ethereum/build/contracts)
import ChessFactoryABI from '../contracts/ChessFactory.json';
import ChessCoreABI from '../contracts/ChessCore.json';

// Game states mapping
export const GAME_STATES = {
	1: { text: 'Waiting', color: 'blue', canJoin: true, isActive: false },
	2: { text: 'In Progress', color: 'success', canJoin: false, isActive: true },
	3: { text: 'Draw', color: 'gray', canJoin: false, isActive: false },
	4: { text: 'White Wins', color: 'accent', canJoin: false, isActive: false },
	5: { text: 'Black Wins', color: 'purple', canJoin: false, isActive: false }
};

// Games list store
function createGamesStore() {
	const { subscribe, set, update } = writable({
		games: [],
		loading: false,
		error: null
	});

	return {
		subscribe,

		async fetchGames() {
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
				const games = [];

				for (const addr of gameAddresses) {
					try {
						const game = new ethers.Contract(addr, ChessCoreABI.abi, $wallet.signer);

						const [players, state, betting, svgData] = await Promise.all([
							game.getPlayers(),
							game.getGameState(),
							game.betting(),
							game.printChessBoardLayoutSVG().catch(() => null)
						]);

						let image = '';
						if (svgData) {
							try {
								const json = JSON.parse(atob(svgData.split(',')[1]));
								image = json.image;
							} catch {}
						}

						games.push({
							address: addr,
							whitePlayer: players[0],
							blackPlayer: players[1],
							state: Number(state),
							stateInfo: GAME_STATES[Number(state)] || GAME_STATES[1],
							betting: ethers.utils.formatEther(betting),
							image
						});
					} catch (err) {
						console.error(`Error loading game ${addr}:`, err);
					}
				}

				set({ games, loading: false, error: null });
			} catch (err) {
				update(s => ({ ...s, loading: false, error: err.message }));
			}
		},

		async createGame(betAmount) {
			const $wallet = get(wallet);
			const $contractAddress = get(contractAddress);

			if (!$wallet.signer || !$contractAddress) {
				throw new Error('Wallet not connected');
			}

			const factory = new ethers.Contract(
				$contractAddress,
				ChessFactoryABI.abi,
				$wallet.signer
			);

			const tx = await factory.createChessGame({
				value: ethers.utils.parseEther(betAmount)
			});

			await tx.wait();
		}
	};
}

export const games = createGamesStore();

// Active game store
function createActiveGameStore() {
	const { subscribe, set, update } = writable({
		address: null,
		loading: false,
		error: null,
		data: null
	});

	return {
		subscribe,

		async load(address) {
			const $wallet = get(wallet);
			if (!$wallet.signer) return;

			update(s => ({ ...s, address, loading: true, error: null }));

			try {
				const game = new ethers.Contract(address, ChessCoreABI.abi, $wallet.signer);

				const [players, currentPlayer, state, betting] = await Promise.all([
					game.getPlayers(),
					game.currentPlayer(),
					game.getGameState(),
					game.betting()
				]);

				// Fetch board - batch if possible, or individual calls
				const board = [];
				for (let row = 0; row < 8; row++) {
					const rowData = [];
					for (let col = 0; col < 8; col++) {
						const piece = await game.board(row, col);
						rowData.push(Number(piece));
					}
					board.push(rowData);
				}

				const stateNum = Number(state);
				const playerRole =
					players[0].toLowerCase() === $wallet.account.toLowerCase() ? 'white' :
					players[1].toLowerCase() === $wallet.account.toLowerCase() ? 'black' : 'spectator';

				const isMyTurn = currentPlayer.toLowerCase() === $wallet.account.toLowerCase();

				set({
					address,
					loading: false,
					error: null,
					data: {
						whitePlayer: players[0],
						blackPlayer: players[1],
						currentPlayer,
						state: stateNum,
						stateInfo: GAME_STATES[stateNum] || GAME_STATES[1],
						betting: ethers.utils.formatEther(betting),
						board,
						playerRole,
						isMyTurn
					}
				});
			} catch (err) {
				update(s => ({ ...s, loading: false, error: err.message }));
			}
		},

		async makeMove(fromRow, fromCol, toRow, toCol) {
			const $wallet = get(wallet);
			const $state = get({ subscribe });

			if (!$wallet.signer || !$state.address) {
				throw new Error('No game loaded');
			}

			const game = new ethers.Contract($state.address, ChessCoreABI.abi, $wallet.signer);
			const tx = await game.makeMove(fromRow, fromCol, toRow, toCol);
			await tx.wait();
		},

		async joinGame() {
			const $wallet = get(wallet);
			const $state = get({ subscribe });

			if (!$wallet.signer || !$state.address || !$state.data) {
				throw new Error('No game loaded');
			}

			const game = new ethers.Contract($state.address, ChessCoreABI.abi, $wallet.signer);
			const tx = await game.joinGameAsBlack({
				value: ethers.utils.parseEther($state.data.betting)
			});
			await tx.wait();
		},

		async resign() {
			const $wallet = get(wallet);
			const $state = get({ subscribe });

			if (!$wallet.signer || !$state.address) {
				throw new Error('No game loaded');
			}

			const game = new ethers.Contract($state.address, ChessCoreABI.abi, $wallet.signer);
			const tx = await game.resign();
			await tx.wait();
		},

		async claimPrize() {
			const $wallet = get(wallet);
			const $state = get({ subscribe });

			if (!$wallet.signer || !$state.address) {
				throw new Error('No game loaded');
			}

			const game = new ethers.Contract($state.address, ChessCoreABI.abi, $wallet.signer);
			const tx = await game.claimPrize();
			await tx.wait();
		},

		clear() {
			set({ address: null, loading: false, error: null, data: null });
		}
	};
}

export const activeGame = createActiveGameStore();
