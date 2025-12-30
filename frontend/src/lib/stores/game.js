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

		async createGame(betAmount, timeoutPreset = 2) {
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

			// TimeoutPreset: 0=Blitz (~1h), 1=Rapid (~7h), 2=Classical (~7d)
			const tx = await factory.createChessGame(timeoutPreset, {
				value: ethers.utils.parseEther(betAmount)
			});

			await tx.wait();
		}
	};
}

export const games = createGamesStore();

// Piece symbols for algebraic notation
const PIECE_SYMBOLS = {
	1: '', // pawn - no symbol
	2: 'N', // knight
	3: 'B', // bishop
	4: 'R', // rook
	5: 'Q', // queen
	6: 'K', // king
	'-1': '',
	'-2': 'N',
	'-3': 'B',
	'-4': 'R',
	'-5': 'Q',
	'-6': 'K'
};

// Convert coordinates to algebraic notation
function toAlgebraic(col, row) {
	const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
	const ranks = ['8', '7', '6', '5', '4', '3', '2', '1'];
	return files[col] + ranks[row];
}

// Active game store
function createActiveGameStore() {
	const { subscribe, set, update } = writable({
		address: null,
		loading: false,
		error: null,
		data: null
	});

	let currentGameContract = null;
	let moveMadeListener = null;
	let gameStateListener = null;

	// Cleanup event listeners
	function cleanupListeners() {
		if (currentGameContract) {
			if (moveMadeListener) {
				currentGameContract.off('MoveMade', moveMadeListener);
				moveMadeListener = null;
			}
			if (gameStateListener) {
				currentGameContract.off('GameStateChanged', gameStateListener);
				gameStateListener = null;
			}
			currentGameContract = null;
		}
	}

	// Handle incoming move from blockchain event
	function handleMoveMade(player, fromRow, fromCol, toRow, toCol, piece, capturedPiece, promotionPiece, isCheck, isMate, isCastling, isEnPassant) {
		update(s => {
			if (!s.data) return s;

			const $wallet = get(wallet);
			const isMyMove = player.toLowerCase() === $wallet.account?.toLowerCase();

			// Skip if this is our own move (we already updated optimistically)
			if (isMyMove) return s;

			// Create new board with the move applied
			const newBoard = s.data.board.map(row => [...row]);
			const pieceValue = Number(piece);
			const promoValue = Number(promotionPiece);

			// Apply move
			newBoard[Number(toRow)][Number(toCol)] = promoValue !== 0 ? promoValue : pieceValue;
			newBoard[Number(fromRow)][Number(fromCol)] = 0;

			// Handle en passant capture
			if (isEnPassant) {
				const captureRow = pieceValue > 0 ? Number(toRow) + 1 : Number(toRow) - 1;
				newBoard[captureRow][Number(toCol)] = 0;
			}

			// Handle castling rook movement
			if (isCastling) {
				const row = Number(fromRow);
				if (Number(toCol) === 6) { // Kingside
					newBoard[row][5] = newBoard[row][7];
					newBoard[row][7] = 0;
				} else if (Number(toCol) === 2) { // Queenside
					newBoard[row][3] = newBoard[row][0];
					newBoard[row][0] = 0;
				}
			}

			// Build notation
			const pieceSymbols = { 1: '', 2: 'N', 3: 'B', 4: 'R', 5: 'Q', 6: 'K' };
			const symbol = pieceSymbols[Math.abs(pieceValue)] || '';
			const from = toAlgebraic(Number(fromCol), Number(fromRow));
			const to = toAlgebraic(Number(toCol), Number(toRow));

			let notation = symbol + to;
			if (Number(capturedPiece) !== 0) {
				notation = symbol + (symbol === '' ? from[0] : '') + 'x' + to;
			}
			if (isCastling) {
				notation = Number(toCol) === 6 ? 'O-O' : 'O-O-O';
			}
			if (isCheck) notation += '+';
			if (isMate) notation += '#';

			const newMove = {
				moveNumber: Math.floor(s.data.moveHistory.length / 2) + 1,
				isWhite: pieceValue > 0,
				notation,
				from,
				to
			};

			// Store animation data for the ChessBoard component
			const animatingMove = {
				from: { row: Number(fromRow), col: Number(fromCol) },
				to: { row: Number(toRow), col: Number(toCol) },
				piece: pieceValue
			};

			// Clear animation after a delay
			setTimeout(() => {
				update(state => {
					if (!state.data) return state;
					return {
						...state,
						data: {
							...state.data,
							animatingMove: null
						}
					};
				});
			}, 350);

			return {
				...s,
				data: {
					...s.data,
					board: newBoard,
					currentPlayer: $wallet.account, // Now it's our turn
					isMyTurn: true,
					moveHistory: [...s.data.moveHistory, newMove],
					animatingMove
				}
			};
		});
	}

	// Handle game state changes
	function handleGameStateChanged(newState) {
		const stateNum = Number(newState);
		update(s => {
			if (!s.data) return s;
			return {
				...s,
				data: {
					...s.data,
					state: stateNum,
					stateInfo: GAME_STATES[stateNum] || GAME_STATES[1],
					drawOfferedBy: null // Clear draw offer on state change
				}
			};
		});
	}

	// Handle draw offer events
	function handleDrawOffered(player) {
		update(s => {
			if (!s.data) return s;
			return {
				...s,
				data: {
					...s.data,
					drawOfferedBy: player
				}
			};
		});
	}

	function handleDrawDeclined(player) {
		update(s => {
			if (!s.data) return s;
			return {
				...s,
				data: {
					...s.data,
					drawOfferedBy: null
				}
			};
		});
	}

	return {
		subscribe,

		async load(address) {
			const $wallet = get(wallet);
			if (!$wallet.signer) return;

			update(s => ({ ...s, address, loading: true, error: null }));

			try {
				const game = new ethers.Contract(address, ChessCoreABI.abi, $wallet.signer);

				const [players, currentPlayer, state, betting, boardState, timeoutStatus, drawOfferStatus, timeoutBlocks] = await Promise.all([
					game.getPlayers(),
					game.currentPlayer(),
					game.getGameState(),
					game.betting(),
					game.getBoardState(), // Single call instead of 64!
					game.getTimeoutStatus().catch(() => null), // May not exist on older contracts
					game.getDrawOfferStatus().catch(() => null), // May not exist on older contracts
					game.timeoutBlocks().catch(() => 300) // Default to 300 blocks
				]);

				// Convert board state from contract format
				const board = boardState.map(row => row.map(cell => Number(cell)));

				// Fetch move history from events
				let moveHistory = [];
				try {
					const filter = game.filters.Debug();
					const events = await game.queryFilter(filter, 0, 'latest');

					moveHistory = events.map((event, index) => {
						const { player, startX, startY, endX, endY, comment } = event.args;
						const isWhite = Number(player) > 0;
						const from = toAlgebraic(Number(startY), Number(startX));
						const to = toAlgebraic(Number(endY), Number(endX));

						// Get piece symbol from comment or use generic
						let pieceSymbol = '';
						if (comment) {
							const lowerComment = comment.toLowerCase();
							if (lowerComment.includes('knight')) pieceSymbol = 'N';
							else if (lowerComment.includes('bishop')) pieceSymbol = 'B';
							else if (lowerComment.includes('rook')) pieceSymbol = 'R';
							else if (lowerComment.includes('queen')) pieceSymbol = 'Q';
							else if (lowerComment.includes('king')) pieceSymbol = 'K';
							// pawn has no symbol
						}

						// Check for special moves
						let notation = pieceSymbol + to;
						if (comment && comment.toLowerCase().includes('capture')) {
							notation = pieceSymbol + (pieceSymbol === '' ? from[0] : '') + 'x' + to;
						}
						if (comment && comment.toLowerCase().includes('castl')) {
							if (Number(endY) === 6) notation = 'O-O'; // kingside
							else if (Number(endY) === 2) notation = 'O-O-O'; // queenside
						}
						if (comment && comment.toLowerCase().includes('check')) {
							notation += '+';
						}
						if (comment && comment.toLowerCase().includes('mate')) {
							notation += '#';
						}

						return {
							moveNumber: Math.floor(index / 2) + 1,
							isWhite,
							notation,
							from,
							to,
							comment,
							blockNumber: event.blockNumber,
							transactionHash: event.transactionHash
						};
					});
				} catch (eventErr) {
					console.warn('Could not fetch move history:', eventErr);
				}

				const stateNum = Number(state);
				const playerRole =
					players[0].toLowerCase() === $wallet.account.toLowerCase() ? 'white' :
					players[1].toLowerCase() === $wallet.account.toLowerCase() ? 'black' : 'spectator';

				const isMyTurn = currentPlayer.toLowerCase() === $wallet.account.toLowerCase();

				// Parse timeout status
				let timeout = null;
				if (timeoutStatus) {
					timeout = {
						whiteBlocksRemaining: Number(timeoutStatus.whiteBlocksRemaining),
						blackBlocksRemaining: Number(timeoutStatus.blackBlocksRemaining),
						currentPlayerIsWhite: timeoutStatus.currentPlayerIsWhite,
						timeoutBlocks: Number(timeoutBlocks)
					};
				}

				// Parse draw offer status (returns just the address now)
				let drawOfferedBy = null;
				if (drawOfferStatus && drawOfferStatus !== '0x0000000000000000000000000000000000000000') {
					drawOfferedBy = drawOfferStatus;
				}

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
						isMyTurn,
						moveHistory,
						timeout,
						drawOfferedBy
					}
				});

				// Setup real-time event listeners for opponent moves
				cleanupListeners();
				currentGameContract = game;

				// Listen for MoveMade events
				moveMadeListener = handleMoveMade;
				game.on('MoveMade', moveMadeListener);

				// Listen for GameStateChanged events
				gameStateListener = handleGameStateChanged;
				game.on('GameStateChanged', gameStateListener);

				// Listen for draw offer events
				game.on('DrawOffered', handleDrawOffered);
				game.on('DrawOfferDeclined', handleDrawDeclined);
				game.on('DrawAccepted', handleGameStateChanged);

			} catch (err) {
				update(s => ({ ...s, loading: false, error: err.message }));
			}
		},

		// Estimate gas for a move
		async estimateGas(fromRow, fromCol, toRow, toCol, promotionPiece = 0) {
			const $wallet = get(wallet);
			const $state = get({ subscribe });

			if (!$wallet.signer || !$state.address) {
				return null;
			}

			try {
				const game = new ethers.Contract($state.address, ChessCoreABI.abi, $wallet.signer);
				let gasEstimate;

				if (promotionPiece !== 0) {
					gasEstimate = await game.estimateGas.makeMoveWithPromotion(fromRow, fromCol, toRow, toCol, promotionPiece);
				} else {
					gasEstimate = await game.estimateGas.makeMove(fromRow, fromCol, toRow, toCol);
				}

				const gasPrice = await $wallet.provider.getGasPrice();
				const gasCost = gasEstimate.mul(gasPrice);

				return {
					gasLimit: gasEstimate.toString(),
					gasPrice: ethers.utils.formatUnits(gasPrice, 'gwei'),
					gasCostWei: gasCost.toString(),
					gasCostEth: ethers.utils.formatEther(gasCost)
				};
			} catch (err) {
				console.warn('Gas estimation failed:', err);
				return null;
			}
		},

		async makeMove(fromRow, fromCol, toRow, toCol, promotionPiece = 0) {
			const $wallet = get(wallet);
			const $state = get({ subscribe });

			if (!$wallet.signer || !$state.address) {
				throw new Error('No game loaded');
			}

			// Optimistic update - apply move immediately to UI
			const piece = $state.data?.board[fromRow]?.[fromCol];
			if ($state.data) {
				update(s => {
					const newBoard = s.data.board.map(row => [...row]);
					const movedPiece = promotionPiece !== 0 ? promotionPiece : piece;
					newBoard[toRow][toCol] = movedPiece;
					newBoard[fromRow][fromCol] = 0;

					// Handle en passant
					const isPawn = Math.abs(piece) === 1;
					const isDiagonal = fromCol !== toCol;
					const targetEmpty = s.data.board[toRow][toCol] === 0;
					if (isPawn && isDiagonal && targetEmpty) {
						const captureRow = piece > 0 ? toRow + 1 : toRow - 1;
						newBoard[captureRow][toCol] = 0;
					}

					// Handle castling
					const isKing = Math.abs(piece) === 6;
					if (isKing && Math.abs(toCol - fromCol) === 2) {
						if (toCol === 6) { // Kingside
							newBoard[fromRow][5] = newBoard[fromRow][7];
							newBoard[fromRow][7] = 0;
						} else if (toCol === 2) { // Queenside
							newBoard[fromRow][3] = newBoard[fromRow][0];
							newBoard[fromRow][0] = 0;
						}
					}

					return {
						...s,
						data: {
							...s.data,
							board: newBoard,
							isMyTurn: false
						}
					};
				});
			}

			try {
				const game = new ethers.Contract($state.address, ChessCoreABI.abi, $wallet.signer);
				let tx;
				if (promotionPiece !== 0) {
					tx = await game.makeMoveWithPromotion(fromRow, fromCol, toRow, toCol, promotionPiece);
				} else {
					tx = await game.makeMove(fromRow, fromCol, toRow, toCol);
				}
				await tx.wait();
			} catch (err) {
				// Revert optimistic update on error
				await this.load($state.address);
				throw err;
			}
		},

		// Check if a move is a pawn promotion
		isPawnPromotion(fromRow, fromCol, toRow) {
			const $state = get({ subscribe });
			if (!$state.data) return false;

			const piece = $state.data.board[fromRow]?.[fromCol];
			if (!piece) return false;

			const isPawn = Math.abs(piece) === 1;
			const isWhitePawn = piece === 1;
			const isBlackPawn = piece === -1;

			// White pawn promoting (reaching row 0)
			if (isWhitePawn && toRow === 0) return true;
			// Black pawn promoting (reaching row 7)
			if (isBlackPawn && toRow === 7) return true;

			return false;
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

		async offerDraw() {
			const $wallet = get(wallet);
			const $state = get({ subscribe });

			if (!$wallet.signer || !$state.address) {
				throw new Error('No game loaded');
			}

			const game = new ethers.Contract($state.address, ChessCoreABI.abi, $wallet.signer);
			const tx = await game.offerDraw();
			await tx.wait();

			// Optimistically update local state
			update(s => ({
				...s,
				data: s.data ? { ...s.data, drawOfferedBy: $wallet.account } : null
			}));
		},

		async acceptDraw() {
			const $wallet = get(wallet);
			const $state = get({ subscribe });

			if (!$wallet.signer || !$state.address) {
				throw new Error('No game loaded');
			}

			const game = new ethers.Contract($state.address, ChessCoreABI.abi, $wallet.signer);
			const tx = await game.acceptDraw();
			await tx.wait();
		},

		async declineDraw() {
			const $wallet = get(wallet);
			const $state = get({ subscribe });

			if (!$wallet.signer || !$state.address) {
				throw new Error('No game loaded');
			}

			const game = new ethers.Contract($state.address, ChessCoreABI.abi, $wallet.signer);
			const tx = await game.declineDraw();
			await tx.wait();

			// Optimistically update local state
			update(s => ({
				...s,
				data: s.data ? { ...s.data, drawOfferedBy: null } : null
			}));
		},

		async cancelDrawOffer() {
			const $wallet = get(wallet);
			const $state = get({ subscribe });

			if (!$wallet.signer || !$state.address) {
				throw new Error('No game loaded');
			}

			const game = new ethers.Contract($state.address, ChessCoreABI.abi, $wallet.signer);
			const tx = await game.cancelDrawOffer();
			await tx.wait();

			// Optimistically update local state
			update(s => ({
				...s,
				data: s.data ? { ...s.data, drawOfferedBy: null } : null
			}));
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
			cleanupListeners();
			set({ address: null, loading: false, error: null, data: null });
		}
	};
}

export const activeGame = createActiveGameStore();
