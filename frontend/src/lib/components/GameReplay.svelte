<script>
	import { createEventDispatcher } from 'svelte';
	import ChessBoard from './ChessBoard.svelte';

	export let moveHistory = [];
	export let playerRole = 'white';

	const dispatch = createEventDispatcher();

	// Initial board state
	const INITIAL_BOARD = [
		[-4, -2, -3, -5, -6, -3, -2, -4],
		[-1, -1, -1, -1, -1, -1, -1, -1],
		[0, 0, 0, 0, 0, 0, 0, 0],
		[0, 0, 0, 0, 0, 0, 0, 0],
		[0, 0, 0, 0, 0, 0, 0, 0],
		[0, 0, 0, 0, 0, 0, 0, 0],
		[1, 1, 1, 1, 1, 1, 1, 1],
		[4, 2, 3, 5, 6, 3, 2, 4]
	];

	let currentMoveIndex = -1; // -1 means initial position
	let isPlaying = false;
	let playInterval = null;
	let playSpeed = 1500; // ms between moves

	// Calculate board state at current move
	$: boardStates = calculateBoardStates();
	$: currentBoard = boardStates[currentMoveIndex + 1] || INITIAL_BOARD.map(r => [...r]);
	$: lastMove = currentMoveIndex >= 0 ? getMoveCoords(currentMoveIndex) : null;
	$: isCheck = currentMoveIndex >= 0 && (moveHistory[currentMoveIndex]?.notation?.includes('+') || moveHistory[currentMoveIndex]?.notation?.includes('#'));
	$: currentPlayerIsWhite = currentMoveIndex < 0 || !moveHistory[currentMoveIndex]?.isWhite;

	function calculateBoardStates() {
		const states = [INITIAL_BOARD.map(r => [...r])];
		let board = INITIAL_BOARD.map(r => [...r]);

		for (const move of moveHistory) {
			board = applyMove(board, move);
			states.push(board.map(r => [...r]));
		}

		return states;
	}

	function applyMove(board, move) {
		const newBoard = board.map(r => [...r]);
		const from = parseSquare(move.from);
		const to = parseSquare(move.to);

		if (!from || !to) return newBoard;

		const piece = newBoard[from.row][from.col];
		newBoard[to.row][to.col] = piece;
		newBoard[from.row][from.col] = 0;

		// Handle castling
		if (move.notation === 'O-O') {
			const row = move.isWhite ? 7 : 0;
			newBoard[row][5] = newBoard[row][7];
			newBoard[row][7] = 0;
		} else if (move.notation === 'O-O-O') {
			const row = move.isWhite ? 7 : 0;
			newBoard[row][3] = newBoard[row][0];
			newBoard[row][0] = 0;
		}

		// Handle en passant
		if (Math.abs(piece) === 1 && from.col !== to.col && board[to.row][to.col] === 0) {
			const captureRow = piece > 0 ? to.row + 1 : to.row - 1;
			newBoard[captureRow][to.col] = 0;
		}

		// Handle promotion (piece changes)
		if (move.notation.includes('=')) {
			const promotionPiece = move.notation.match(/=([QRBN])/);
			if (promotionPiece) {
				const pieceMap = { Q: 5, R: 4, B: 3, N: 2 };
				const value = pieceMap[promotionPiece[1]] || 5;
				newBoard[to.row][to.col] = piece > 0 ? value : -value;
			}
		}

		return newBoard;
	}

	function parseSquare(sq) {
		if (!sq || sq.length < 2) return null;
		const files = { a: 0, b: 1, c: 2, d: 3, e: 4, f: 5, g: 6, h: 7 };
		const col = files[sq[0]];
		const row = 8 - parseInt(sq[1]);
		if (isNaN(col) || isNaN(row) || row < 0 || row > 7) return null;
		return { row, col };
	}

	function getMoveCoords(index) {
		const move = moveHistory[index];
		if (!move) return null;
		const from = parseSquare(move.from);
		const to = parseSquare(move.to);
		if (!from || !to) return null;
		return { from, to };
	}

	function goToStart() {
		stopPlayback();
		currentMoveIndex = -1;
	}

	function goToEnd() {
		stopPlayback();
		currentMoveIndex = moveHistory.length - 1;
	}

	function goToPrev() {
		stopPlayback();
		if (currentMoveIndex > -1) {
			currentMoveIndex--;
		}
	}

	function goToNext() {
		if (currentMoveIndex < moveHistory.length - 1) {
			currentMoveIndex++;
		} else {
			stopPlayback();
		}
	}

	function togglePlayback() {
		if (isPlaying) {
			stopPlayback();
		} else {
			startPlayback();
		}
	}

	function startPlayback() {
		if (currentMoveIndex >= moveHistory.length - 1) {
			currentMoveIndex = -1;
		}
		isPlaying = true;
		playInterval = setInterval(() => {
			if (currentMoveIndex < moveHistory.length - 1) {
				currentMoveIndex++;
			} else {
				stopPlayback();
			}
		}, playSpeed);
	}

	function stopPlayback() {
		isPlaying = false;
		if (playInterval) {
			clearInterval(playInterval);
			playInterval = null;
		}
	}

	function goToMove(index) {
		stopPlayback();
		currentMoveIndex = index;
	}

	function close() {
		stopPlayback();
		dispatch('close');
	}
</script>

<div class="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex flex-col">
	<!-- Header -->
	<div class="flex items-center justify-between p-4 border-b border-chess-accent/10">
		<h2 class="font-display text-xl">Game Replay</h2>
		<button
			class="p-2 rounded-lg hover:bg-chess-accent/20 transition-colors"
			on:click={close}
		>
			<span class="text-xl">✕</span>
		</button>
	</div>

	<!-- Main content -->
	<div class="flex-1 flex flex-col lg:flex-row overflow-hidden p-4 gap-4">
		<!-- Board -->
		<div class="flex-1 flex items-center justify-center">
			<ChessBoard
				board={currentBoard}
				orientation={playerRole === 'black' ? 'black' : 'white'}
				interactive={false}
				{lastMove}
				{isCheck}
				{currentPlayerIsWhite}
			/>
		</div>

		<!-- Move list sidebar -->
		<div class="lg:w-64 bg-chess-darker rounded-lg p-4 overflow-hidden flex flex-col">
			<h3 class="font-display text-sm mb-3 text-chess-gray">Move History</h3>
			<div class="flex-1 overflow-y-auto text-sm font-mono">
				{#each moveHistory as move, i}
					{#if move.isWhite}
						<button
							class="flex gap-2 py-1 px-2 w-full text-left rounded hover:bg-chess-accent/10 transition-colors
								{currentMoveIndex === i ? 'bg-chess-accent/20' : ''}
								{currentMoveIndex === i + 1 && !moveHistory[i + 1]?.isWhite ? '' : ''}"
							on:click={() => goToMove(i)}
						>
							<span class="text-chess-gray w-6 flex-shrink-0">{move.moveNumber}.</span>
							<span class="w-14 flex-shrink-0 {currentMoveIndex === i ? 'text-chess-accent' : ''}">{move.notation}</span>
							{#if moveHistory[i + 1] && !moveHistory[i + 1].isWhite}
								<button
									class="w-14 flex-shrink-0 {currentMoveIndex === i + 1 ? 'text-chess-accent' : ''}"
									on:click|stopPropagation={() => goToMove(i + 1)}
								>
									{moveHistory[i + 1].notation}
								</button>
							{/if}
						</button>
					{/if}
				{/each}
			</div>
		</div>
	</div>

	<!-- Controls -->
	<div class="p-4 border-t border-chess-accent/10 bg-chess-darker">
		<div class="flex items-center justify-center gap-4">
			<button
				class="p-3 rounded-lg bg-chess-dark hover:bg-chess-accent/20 transition-colors disabled:opacity-50"
				on:click={goToStart}
				disabled={currentMoveIndex === -1}
				title="Go to start"
			>
				⏮
			</button>
			<button
				class="p-3 rounded-lg bg-chess-dark hover:bg-chess-accent/20 transition-colors disabled:opacity-50"
				on:click={goToPrev}
				disabled={currentMoveIndex === -1}
				title="Previous move"
			>
				◀
			</button>
			<button
				class="p-4 rounded-lg bg-chess-accent hover:bg-chess-accent/80 transition-colors text-chess-darker font-bold"
				on:click={togglePlayback}
				title={isPlaying ? 'Pause' : 'Play'}
			>
				{isPlaying ? '⏸' : '▶'}
			</button>
			<button
				class="p-3 rounded-lg bg-chess-dark hover:bg-chess-accent/20 transition-colors disabled:opacity-50"
				on:click={goToNext}
				disabled={currentMoveIndex === moveHistory.length - 1}
				title="Next move"
			>
				▶
			</button>
			<button
				class="p-3 rounded-lg bg-chess-dark hover:bg-chess-accent/20 transition-colors disabled:opacity-50"
				on:click={goToEnd}
				disabled={currentMoveIndex === moveHistory.length - 1}
				title="Go to end"
			>
				⏭
			</button>
		</div>

		<div class="text-center mt-3 text-chess-gray text-sm">
			Move {currentMoveIndex + 1} of {moveHistory.length}
		</div>
	</div>
</div>
