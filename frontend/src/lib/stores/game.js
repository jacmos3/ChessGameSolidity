import { writable, derived, get } from 'svelte/store';
import { wallet, contractAddress } from './wallet.js';
import { ethers } from 'ethers';
import { loadContractAbi } from '../contracts/loadAbi.js';
import { getTransactionFeeOverrides } from '../utils/transactionFees.js';
import {
	bindTransactionToVerifiedAccount,
	createGenerationGuard,
	sendBoundContractTransaction,
	verifiedFactoryContextMatches,
	verifiedGameContextMatches,
	verifiedGameMutationContextMatches,
	verifyCanonicalFactory,
	verifyRegisteredGame
} from '../utils/gameVerification.js';

// Game states mapping — matches getGameState() (1-indexed), not the raw GameState enum
export const GAME_STATES = {
	1: { text: 'Waiting', color: 'blue', canJoin: true, isActive: false },
	2: { text: 'In Progress', color: 'success', canJoin: false, isActive: true },
	3: { text: 'Draw', color: 'gray', canJoin: false, isActive: false },
	4: { text: 'White Wins', color: 'accent', canJoin: false, isActive: false },
	5: { text: 'Black Wins', color: 'purple', canJoin: false, isActive: false },
	6: { text: 'Cancelled', color: 'gray', canJoin: false, isActive: false }
};

// GameStateChanged emits the Solidity enum (NotStarted=0 … BlackWins=4)
const RAW_GAME_STATE_TO_UI = {
	0: 1,
	1: 2,
	2: 3,
	3: 4,
	4: 5
};

function mapRawGameState(rawState) {
	const raw = Number(rawState);
	return RAW_GAME_STATE_TO_UI[raw] ?? raw;
}

function collectErrorBlob(err) {
	const parts = [];
	let current = err;
	for (let i = 0; i < 6 && current; i++) {
		if (typeof current.message === 'string') parts.push(current.message);
		if (typeof current.data === 'string') parts.push(current.data);
		if (typeof current.error?.data === 'string') parts.push(current.error.data);
		if (typeof current.error?.data?.data === 'string') parts.push(current.error.data.data);
		current = current.error;
	}
	return parts.join(' ');
}

function isCustomError(err, signature) {
	const selector = ethers.utils.id(signature).slice(0, 10);
	const blob = collectErrorBlob(err);
	return blob.includes(selector) || blob.includes(selector.slice(2));
}

function signedPromotionPiece(movingPiece, promotionPiece) {
	const promo = Math.abs(Number(promotionPiece));
	if (!promo) return Number(movingPiece);
	return Number(movingPiece) < 0 ? -promo : promo;
}

const getChessFactoryAbi = () => loadContractAbi('ChessFactory');
const getChessCoreAbi = () => loadContractAbi('ChessCore');
const LOBBY_PAGE_SIZE = 50;

async function fetchRecentGameAddresses(factory, alreadyLoaded = 0) {
	if (typeof factory.getDeployedChessGameCount === 'function') {
		const count = Number(await factory.getDeployedChessGameCount());
		const remaining = count - alreadyLoaded;
		if (remaining <= 0) {
			return { addresses: [], hasMore: false };
		}
		const take = Math.min(LOBBY_PAGE_SIZE, remaining);
		const offset = remaining - take;
		const page = await factory.getDeployedChessGamesPage(offset, take);
		return {
			addresses: [...page].reverse(),
			hasMore: offset > 0
		};
	}

	const all = await factory.getDeployedChessGames();
	const newestFirst = [...all].reverse();
	return {
		addresses: newestFirst.slice(alreadyLoaded, alreadyLoaded + LOBBY_PAGE_SIZE),
		hasMore: newestFirst.length > alreadyLoaded + LOBBY_PAGE_SIZE
	};
}

async function loadGameSummaries(addresses, chessCoreAbi, signer, account) {
	const summaries = await Promise.all(addresses.map(async (addr) => {
		try {
			const game = new ethers.Contract(addr, chessCoreAbi, signer);
			const [players, currentPlayer, state, betting] = await Promise.all([
				game.getPlayers(),
				game.currentPlayer(),
				game.getGameState(),
				game.betting()
			]);

			return {
				address: addr,
				whitePlayer: players[0],
				blackPlayer: players[1],
				currentPlayer,
				isMyTurn: currentPlayer?.toLowerCase?.() === account?.toLowerCase(),
				state: Number(state),
				stateInfo: GAME_STATES[Number(state)] || GAME_STATES[1],
				betting: ethers.utils.formatEther(betting),
				image: ''
			};
		} catch (err) {
			console.error(`Error loading game ${addr}:`, err);
			return null;
		}
	}));

	return summaries.filter(Boolean);
}

// Games list store
function createGamesStore() {
	const { subscribe, set, update } = writable({
		games: [],
		loading: false,
		loadingMore: false,
		hasMore: false,
		error: null
	});
	const requestGuard = createGenerationGuard();

	return {
		subscribe,

		async fetchGames() {
			const $wallet = get(wallet);
			const $contractAddress = get(contractAddress);

			if (!$wallet.signer || !$contractAddress) return;

			const generation = requestGuard.begin();
			update(s => ({ ...s, loading: true, error: null }));

			try {
				const [factoryAbi, chessCoreAbi] = await Promise.all([
					getChessFactoryAbi(),
					getChessCoreAbi()
				]);
				const verification = await verifyCanonicalFactory({
					provider: $wallet.provider,
					signer: $wallet.signer,
					account: $wallet.account,
					chainId: $wallet.chainId,
					factoryAddress: $contractAddress
				});
				if (!requestGuard.isCurrent(generation)) return;
				const factory = new ethers.Contract(
					verification.factoryAddress,
					factoryAbi,
					$wallet.signer
				);

				const { addresses, hasMore } = await fetchRecentGameAddresses(factory, 0);
				const games = await loadGameSummaries(
					addresses,
					chessCoreAbi,
					$wallet.signer,
					$wallet.account
				);
				if (!requestGuard.isCurrent(generation)) return;

				set({ games, loading: false, loadingMore: false, hasMore, error: null });
			} catch (err) {
				if (!requestGuard.isCurrent(generation)) return;
				update(s => ({ ...s, loading: false, loadingMore: false, error: err.message }));
			}
		},

		async loadMore() {
			const $wallet = get(wallet);
			const $contractAddress = get(contractAddress);
			const current = get({ subscribe });

			if (!$wallet.signer || !$contractAddress || current.loadingMore || !current.hasMore) return;

			const generation = requestGuard.begin();
			update(s => ({ ...s, loadingMore: true, error: null }));

			try {
				const [factoryAbi, chessCoreAbi] = await Promise.all([
					getChessFactoryAbi(),
					getChessCoreAbi()
				]);
				const verification = await verifyCanonicalFactory({
					provider: $wallet.provider,
					signer: $wallet.signer,
					account: $wallet.account,
					chainId: $wallet.chainId,
					factoryAddress: $contractAddress
				});
				if (!requestGuard.isCurrent(generation)) return;
				const factory = new ethers.Contract(
					verification.factoryAddress,
					factoryAbi,
					$wallet.signer
				);

				const { addresses, hasMore } = await fetchRecentGameAddresses(factory, current.games.length);
				const moreGames = await loadGameSummaries(
					addresses,
					chessCoreAbi,
					$wallet.signer,
					$wallet.account
				);
				if (!requestGuard.isCurrent(generation)) return;
				const seen = new Set(current.games.map(game => game.address.toLowerCase()));

				update(s => ({
					...s,
					games: [...s.games, ...moreGames.filter(game => !seen.has(game.address.toLowerCase()))],
					loadingMore: false,
					hasMore
				}));
			} catch (err) {
				if (!requestGuard.isCurrent(generation)) return;
				update(s => ({ ...s, loadingMore: false, error: err.message }));
			}
		},

		async createGame(betAmount, timeoutPreset = 2, gameMode = 0) {
			const $wallet = get(wallet);
			const $contractAddress = get(contractAddress);

			if (!$wallet.signer || !$contractAddress) {
				throw new Error('Wallet not connected');
			}

			const [factoryAbi, feeOverrides] = await Promise.all([
				getChessFactoryAbi(),
				getTransactionFeeOverrides($wallet.provider, $wallet.chainId)
			]);
			const verification = await verifyCanonicalFactory({
				provider: $wallet.provider,
				signer: $wallet.signer,
				account: $wallet.account,
				chainId: $wallet.chainId,
				factoryAddress: $contractAddress
			});
			const currentWallet = get(wallet);
			const currentContext = {
				verified: true,
				chainId: currentWallet.chainId,
				factoryAddress: get(contractAddress),
				account: currentWallet.account
			};
			if (!verifiedFactoryContextMatches(verification, currentContext)) {
				throw new Error('Wallet or factory context changed before creating the game');
			}
			const factory = new ethers.Contract(
				verification.factoryAddress,
				factoryAbi,
				$wallet.signer
			);

			// TimeoutPreset: 0=Finney (~1h), 1=Buterin (~7h), 2=Nakamoto (~7d)
			// GameMode: 0=Tournament (strict), 1=Friendly (relaxed)
			const tx = await sendBoundContractTransaction({
				contract: factory,
				method: 'createChessGame',
				args: [timeoutPreset, gameMode],
				overrides: {
					...feeOverrides,
					value: ethers.utils.parseEther(String(betAmount).trim())
				},
				provider: $wallet.provider,
				signer: $wallet.signer,
				verification,
				assertCurrentContext: () => {
					const liveWallet = get(wallet);
					const liveContext = {
						verified: true,
						chainId: liveWallet.chainId,
						factoryAddress: get(contractAddress),
						account: liveWallet.account
					};
					if (!verifiedFactoryContextMatches(verification, liveContext)) {
						throw new Error('Wallet or factory context changed before sending the transaction');
					}
				}
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
		data: null,
		verification: null
	});
	const loadGuard = createGenerationGuard();

	let currentGameContract = null;
	let moveMadeListener = null;
	let gameStateListener = null;
	let drawOfferedListener = null;
	let drawDeclinedListener = null;
	let drawAcceptedListener = null;

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
			if (drawOfferedListener) {
				currentGameContract.off('DrawOffered', drawOfferedListener);
				drawOfferedListener = null;
			}
			if (drawDeclinedListener) {
				currentGameContract.off('DrawOfferDeclined', drawDeclinedListener);
				drawDeclinedListener = null;
			}
			if (drawAcceptedListener) {
				currentGameContract.off('DrawAccepted', drawAcceptedListener);
				drawAcceptedListener = null;
			}
			currentGameContract = null;
		}
	}

	async function getVerifiedGameForMutation({ requireData = false, includeFees = true } = {}) {
		const walletSnapshot = get(wallet);
		const stateSnapshot = get({ subscribe });
		const factorySnapshot = get(contractAddress);

		if (!walletSnapshot.signer || !walletSnapshot.provider || !walletSnapshot.account || !stateSnapshot.address) {
			throw new Error('No game loaded');
		}
		if (requireData && !stateSnapshot.data) throw new Error('No game loaded');

		const expectedContext = {
			verified: true,
			chainId: walletSnapshot.chainId,
			factoryAddress: factorySnapshot,
			gameAddress: stateSnapshot.address,
			account: walletSnapshot.account
		};
		if (!verifiedGameContextMatches(stateSnapshot.verification, expectedContext)) {
			throw new Error('Game verification is stale; reload the game before sending a transaction');
		}

		const [chessCoreAbi, feeOverrides] = await Promise.all([
			getChessCoreAbi(),
			includeFees
				? getTransactionFeeOverrides(walletSnapshot.provider, walletSnapshot.chainId)
				: Promise.resolve({})
		]);
		const verifiedContext = await verifyRegisteredGame({
			provider: walletSnapshot.provider,
			signer: walletSnapshot.signer,
			account: walletSnapshot.account,
			chainId: walletSnapshot.chainId,
			factoryAddress: factorySnapshot,
			gameAddress: stateSnapshot.address
		});
		const currentWallet = get(wallet);
		const currentState = get({ subscribe });
		const currentFactory = get(contractAddress);
		const currentContext = {
			verified: true,
			chainId: currentWallet.chainId,
			factoryAddress: currentFactory,
			gameAddress: currentState.address,
			account: currentWallet.account
		};
		if (!verifiedGameContextMatches(verifiedContext, currentContext) ||
			!verifiedGameContextMatches(currentState.verification, verifiedContext)) {
			throw new Error('Wallet or game context changed while verifying the transaction');
		}

		return {
			game: new ethers.Contract(verifiedContext.gameAddress, chessCoreAbi, walletSnapshot.signer),
			wallet: walletSnapshot,
			state: stateSnapshot,
			verification: verifiedContext,
			transactionOverrides: bindTransactionToVerifiedAccount(feeOverrides, verifiedContext)
		};
	}

	function sendVerifiedGameTransaction(context, method, args = [], extraOverrides = {}) {
		return sendBoundContractTransaction({
			contract: context.game,
			method,
			args,
			overrides: { ...context.transactionOverrides, ...extraOverrides },
			provider: context.wallet.provider,
			signer: context.wallet.signer,
			verification: context.verification,
			assertCurrentContext: () => {
				const currentWallet = get(wallet);
				const currentState = get({ subscribe });
				const currentContext = {
					verified: true,
					chainId: currentWallet.chainId,
					factoryAddress: get(contractAddress),
					gameAddress: currentState.address,
					account: currentWallet.account
				};
				if (!verifiedGameContextMatches(context.verification, currentContext) ||
					!verifiedGameContextMatches(currentState.verification, context.verification)) {
					throw new Error('Wallet, factory, or game route changed before sending the transaction');
				}
			}
		});
	}

	// Handle incoming move from blockchain event
	function handleMoveMade(player, fromRow, fromCol, toRow, toCol, piece, capturedPiece, promotionPiece, isCheck, isMate, isCastling, isEnPassant) {
		update(s => {
			// Skip if no data or listeners were cleared (account switched)
			if (!s.data || !currentGameContract) return s;

			const $wallet = get(wallet);
			const isMyMove = player.toLowerCase() === $wallet.account?.toLowerCase();

			// Skip if this is our own move (we already updated optimistically)
			if (isMyMove) return s;

			// Create new board with the move applied
			const newBoard = s.data.board.map(row => [...row]);
			const pieceValue = Number(piece);
			const promoValue = Number(promotionPiece);

			// Only use promotionPiece if it's an actual pawn promotion
			// (pawn reaching the last rank). Otherwise use the actual piece.
			const isPawn = Math.abs(pieceValue) === 1;
			const isPromotion = isPawn && (Number(toRow) === 0 || Number(toRow) === 7);
			const finalPiece = isPromotion ? signedPromotionPiece(pieceValue, promoValue) : pieceValue;

			// Apply move
			newBoard[Number(toRow)][Number(toCol)] = finalPiece;
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
			const fromSquare = toAlgebraic(Number(fromCol), Number(fromRow));
			const toSquare = toAlgebraic(Number(toCol), Number(toRow));

			let notation = symbol + toSquare;
			if (Number(capturedPiece) !== 0) {
				notation = symbol + (symbol === '' ? fromSquare[0] : '') + 'x' + toSquare;
			}
			if (isCastling) {
				notation = Number(toCol) === 6 ? 'O-O' : 'O-O-O';
			}
			if (isCheck) notation += '+';
			if (isMate) notation += '#';

			// Check for duplicate - if move with same from/to already exists, skip
			const isDuplicate = s.data.moveHistory.some(m =>
				m.from === fromSquare && m.to === toSquare
			);
			if (isDuplicate) return s;

			const newMove = {
				moveNumber: Math.floor(s.data.moveHistory.length / 2) + 1,
				isWhite: pieceValue > 0,
				notation,
				from: fromSquare,
				to: toSquare
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

		refreshDrawRules();
	}

	async function refreshDrawRules() {
		if (!currentGameContract) return;
		try {
			const status = await currentGameContract.getDrawRuleStatus();
			update(s => {
				if (!s.data) return s;
				return {
					...s,
					data: {
						...s.data,
						drawRules: {
							halfMoves: Number(status.halfMoves ?? status[0] ?? 0),
							maxRepetitions: Number(status.maxRepetitions ?? status[1] ?? 0)
						}
					}
				};
			});
		} catch {
			// Older games may not expose draw-rule views.
		}
	}

	// Handle game state changes
	function handleGameStateChanged(newState) {
		const stateNum = mapRawGameState(newState);
		update(s => {
			if (!s.data || !currentGameContract) return s;
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

	function handleDrawAccepted() {
		update(s => {
			if (!s.data || !currentGameContract) return s;
			return {
				...s,
				data: {
					...s.data,
					state: 3,
					stateInfo: GAME_STATES[3],
					drawOfferedBy: null
				}
			};
		});
	}

	// Handle draw offer events
	function handleDrawOffered(player) {
		update(s => {
			if (!s.data || !currentGameContract) return s;
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
			if (!s.data || !currentGameContract) return s;
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
			const $contractAddress = get(contractAddress);
			if (!$wallet.signer || !$wallet.provider || !$wallet.account) return;

			const generation = loadGuard.begin();
			cleanupListeners();
			set({ address, loading: true, error: null, data: null, verification: null });

			try {
				const verification = await verifyRegisteredGame({
					provider: $wallet.provider,
					signer: $wallet.signer,
					account: $wallet.account,
					chainId: $wallet.chainId,
					factoryAddress: $contractAddress,
					gameAddress: address
				});
				if (!loadGuard.isCurrent(generation)) return;

				const chessCoreAbi = await getChessCoreAbi();
				const game = new ethers.Contract(verification.gameAddress, chessCoreAbi, $wallet.signer);

				const [players, currentPlayer, state, betting, boardState, timeoutStatus, drawOfferStatus, timeoutSeconds, gameMode, gameId, canCancelUnjoinedGame, cancelUnjoinedRemaining, drawRuleStatus] = await Promise.all([
					game.getPlayers(),
					game.currentPlayer(),
					game.getGameState(),
					game.betting(),
					game.getBoardState(), // Single call instead of 64!
					game.getTimeoutStatus().catch(() => null), // May not exist on older contracts
					game.getDrawOfferStatus().catch(() => null), // May not exist on older contracts
					game.timeoutSeconds().catch(() => 3600), // Default to one hour
					game.gameMode().catch(() => 0), // Default to Tournament if not available
					game.gameId(),
					game.canCancelUnjoinedGame($wallet.account || ethers.constants.AddressZero).catch(() => false),
					game.getCancelUnjoinedRemaining().catch(() => 0),
					game.getDrawRuleStatus().catch(() => null)
				]);
				if (!loadGuard.isCurrent(generation)) return;

				// Convert board state from contract format
				const board = boardState.map(row => row.map(cell => Number(cell)));

				// Fetch move history from MoveMade events (has isCheck/isMate flags)
				let moveHistory = [];
				try {
					const filter = game.filters.MoveMade();
					const events = await game.queryFilter(filter, 0, 'latest');

					moveHistory = events.map((event, index) => {
						const { player, fromRow, fromCol, toRow, toCol, piece, capturedPiece, isCheck, isMate, isCastling } = event.args;
						const pieceValue = Number(piece);
						const isWhite = pieceValue > 0;
						const from = toAlgebraic(Number(fromCol), Number(fromRow));
						const to = toAlgebraic(Number(toCol), Number(toRow));

						// Get piece symbol
						const pieceSymbols = { 1: '', 2: 'N', 3: 'B', 4: 'R', 5: 'Q', 6: 'K' };
						const symbol = pieceSymbols[Math.abs(pieceValue)] || '';

						// Build notation
						let notation = symbol + to;
						if (Number(capturedPiece) !== 0) {
							notation = symbol + (symbol === '' ? from[0] : '') + 'x' + to;
						}
						if (isCastling) {
							notation = Number(toCol) === 6 ? 'O-O' : 'O-O-O';
						}
						if (isCheck) notation += '+';
						if (isMate) notation += '#';

						return {
							moveNumber: Math.floor(index / 2) + 1,
							isWhite,
							notation,
							from,
							to,
							isCheck,
							isMate,
							blockNumber: event.blockNumber,
							transactionHash: event.transactionHash
						};
					});
				} catch (eventErr) {
					console.warn('Could not fetch move history:', eventErr);
				}
				if (!loadGuard.isCurrent(generation)) return;

				const finalVerification = await verifyRegisteredGame({
					provider: $wallet.provider,
					signer: $wallet.signer,
					account: $wallet.account,
					chainId: $wallet.chainId,
					factoryAddress: $contractAddress,
					gameAddress: verification.gameAddress
				});
				if (!loadGuard.isCurrent(generation)) return;
				const currentWallet = get(wallet);
				const currentContext = {
					verified: true,
					chainId: currentWallet.chainId,
					factoryAddress: get(contractAddress),
					gameAddress: address,
					account: currentWallet.account
				};
				if (!verifiedGameContextMatches(verification, finalVerification) ||
					!verifiedGameContextMatches(finalVerification, currentContext)) {
					throw new Error('Wallet or game context changed while loading the game');
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
						whiteSecondsRemaining: Number(timeoutStatus.whiteSecondsRemaining),
						blackSecondsRemaining: Number(timeoutStatus.blackSecondsRemaining),
						currentPlayerIsWhite: timeoutStatus.currentPlayerIsWhite,
						timeoutSeconds: Number(timeoutSeconds)
					};
				}

				// Parse draw offer status (returns just the address now)
				let drawOfferedBy = null;
				if (drawOfferStatus && drawOfferStatus !== '0x0000000000000000000000000000000000000000') {
					drawOfferedBy = drawOfferStatus;
				}

				set({
					address: finalVerification.gameAddress,
					loading: false,
					error: null,
					verification: finalVerification,
					data: {
						gameId: Number(gameId),
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
						drawOfferedBy,
						drawRules: {
							halfMoves: Number(drawRuleStatus?.halfMoves ?? drawRuleStatus?.[0] ?? 0),
							maxRepetitions: Number(drawRuleStatus?.maxRepetitions ?? drawRuleStatus?.[1] ?? 0)
						},
						gameMode: Number(gameMode), // 0=Tournament, 1=Friendly
						canCancelUnjoinedGame: Boolean(canCancelUnjoinedGame),
						cancelUnjoinedRemaining: Number(cancelUnjoinedRemaining)
					}
				});

				// Setup real-time event listeners for opponent moves
				if (!loadGuard.isCurrent(generation)) return;
				currentGameContract = game;

				// Listen for MoveMade events
				moveMadeListener = handleMoveMade;
				game.on('MoveMade', moveMadeListener);

				// Listen for GameStateChanged events
				gameStateListener = handleGameStateChanged;
				game.on('GameStateChanged', gameStateListener);

				// Listen for draw offer events
				drawOfferedListener = handleDrawOffered;
				drawDeclinedListener = handleDrawDeclined;
				drawAcceptedListener = handleDrawAccepted;
				game.on('DrawOffered', drawOfferedListener);
				game.on('DrawOfferDeclined', drawDeclinedListener);
				game.on('DrawAccepted', drawAcceptedListener);

			} catch (err) {
				if (!loadGuard.isCurrent(generation)) return;
				cleanupListeners();
				set({ address, loading: false, error: err.message, data: null, verification: null });
			}
		},

		// Estimate gas for a move
		async estimateGas(fromRow, fromCol, toRow, toCol, promotionPiece = 0) {
			try {
				const {
					game,
					wallet: $wallet,
					transactionOverrides
				} = await getVerifiedGameForMutation();
				let gasEstimate;

				if (promotionPiece !== 0) {
					gasEstimate = await game.estimateGas.makeMoveWithPromotion(
						fromRow,
						fromCol,
						toRow,
						toCol,
						promotionPiece,
						transactionOverrides
					);
				} else {
					gasEstimate = await game.estimateGas.makeMove(
						fromRow,
						fromCol,
						toRow,
						toCol,
						transactionOverrides
					);
				}

				const gasPrice = transactionOverrides.maxFeePerGas || await $wallet.provider.getGasPrice();
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
			const context = await getVerifiedGameForMutation({ requireData: true });
			const $state = context.state;

			// Optimistic update - apply move immediately to UI
			const piece = $state.data?.board[fromRow]?.[fromCol];
			if ($state.data) {
				update(s => {
					const newBoard = s.data.board.map(row => [...row]);
					const movedPiece = promotionPiece !== 0 ? signedPromotionPiece(piece, promotionPiece) : piece;
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
				const tx = promotionPiece !== 0
					? await sendVerifiedGameTransaction(
						context,
						'makeMoveWithPromotion',
						[fromRow, fromCol, toRow, toCol, promotionPiece]
					)
					: await sendVerifiedGameTransaction(
						context,
						'makeMove',
						[fromRow, fromCol, toRow, toCol]
					);
				await tx.wait();
			} catch (err) {
				// Reload the optimistic board only while the exact wallet/factory/game
				// context that initiated the move is still active. A late revert from
				// route A must never overwrite a newer route B load.
				const currentWallet = get(wallet);
				const currentState = get({ subscribe });
				const currentContext = {
					verified: true,
					chainId: currentWallet.chainId,
					factoryAddress: get(contractAddress),
					gameAddress: currentState.address,
					account: currentWallet.account
				};
				if (verifiedGameMutationContextMatches(
					context.verification,
					currentState.verification,
					currentContext
				)) {
					await this.load(context.verification.gameAddress);
				}
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
			const { game, state: $state } = await getVerifiedGameForMutation({
				requireData: true,
				includeFees: false
			});
			const value = ethers.utils.parseEther($state.data.betting.toString());
			const customized = await game.boardCustomized();
			const setupHash = customized ? await game.getBoardSetupHash() : null;
			const submission = await getVerifiedGameForMutation({ requireData: true });
			const tx = customized
				? await sendVerifiedGameTransaction(
					submission,
					'joinGameAsBlackConfirmingBoard',
					[setupHash],
					{ value }
				)
				: await sendVerifiedGameTransaction(submission, 'joinGameAsBlack', [], { value });
			await tx.wait();
		},

		async cancelUnjoinedGame() {
			const context = await getVerifiedGameForMutation();
			const tx = await sendVerifiedGameTransaction(context, 'cancelUnjoinedGame');
			await tx.wait();
		},

		async resign() {
			const context = await getVerifiedGameForMutation();
			const tx = await sendVerifiedGameTransaction(context, 'resign');
			await tx.wait();
		},

		async claimVictoryByTimeout() {
			const context = await getVerifiedGameForMutation();
			const tx = await sendVerifiedGameTransaction(context, 'claimVictoryByTimeout');
			await tx.wait();
		},

		async offerDraw() {
			const context = await getVerifiedGameForMutation();
			const tx = await sendVerifiedGameTransaction(context, 'offerDraw');
			await tx.wait();

			// Optimistically update local state
			update(s => ({
				...s,
				data: s.data ? { ...s.data, drawOfferedBy: context.wallet.account } : null
			}));
		},

		async acceptDraw() {
			const context = await getVerifiedGameForMutation();
			const tx = await sendVerifiedGameTransaction(context, 'acceptDraw');
			await tx.wait();
		},

		async declineDraw() {
			const context = await getVerifiedGameForMutation();
			const tx = await sendVerifiedGameTransaction(context, 'declineDraw');
			await tx.wait();

			// Optimistically update local state
			update(s => ({
				...s,
				data: s.data ? { ...s.data, drawOfferedBy: null } : null
			}));
		},

		async cancelDrawOffer() {
			const context = await getVerifiedGameForMutation();
			const tx = await sendVerifiedGameTransaction(context, 'cancelDrawOffer');
			await tx.wait();

			// Optimistically update local state
			update(s => ({
				...s,
				data: s.data ? { ...s.data, drawOfferedBy: null } : null
			}));
		},

		async claimDrawByRepetition() {
			const context = await getVerifiedGameForMutation();
			const tx = await sendVerifiedGameTransaction(context, 'claimDrawByRepetition');
			await tx.wait();
		},

		async claimDrawByFiftyMoveRule() {
			const context = await getVerifiedGameForMutation();
			const tx = await sendVerifiedGameTransaction(context, 'claimDrawByFiftyMoveRule');
			await tx.wait();
		},

		async claimPrize() {
			const initial = await getVerifiedGameForMutation({ includeFees: false });
			const pending = await initial.game.pendingPrize(initial.verification.account);
			if (pending.gt(0)) {
				const withdrawal = await getVerifiedGameForMutation();
				if (!verifiedGameContextMatches(initial.verification, withdrawal.verification)) {
					throw new Error('Wallet or game context changed before withdrawing the prize');
				}
				const tx = await sendVerifiedGameTransaction(withdrawal, 'withdrawPrize');
				await tx.wait();
				return;
			}

			try {
				const finalization = await getVerifiedGameForMutation();
				if (!verifiedGameContextMatches(initial.verification, finalization.verification)) {
					throw new Error('Wallet or game context changed before finalizing prizes');
				}
				const finalizeTx = await sendVerifiedGameTransaction(finalization, 'finalizePrizes');
				await finalizeTx.wait();
			} catch (err) {
				if (!isCustomError(err, 'PrizeAlreadyClaimed()')) {
					throw err;
				}
			}

			const withdrawal = await getVerifiedGameForMutation();
			if (!verifiedGameContextMatches(initial.verification, withdrawal.verification)) {
				throw new Error('Wallet or game context changed before withdrawing the prize');
			}
			const tx = await sendVerifiedGameTransaction(withdrawal, 'withdrawPrize');
			await tx.wait();
		},

		clear() {
			loadGuard.invalidate();
			cleanupListeners();
			set({ address: null, loading: false, error: null, data: null, verification: null });
		}
	};
}

export const activeGame = createActiveGameStore();
