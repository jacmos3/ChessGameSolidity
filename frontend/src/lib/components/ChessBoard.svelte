<script>
	import { createEventDispatcher, onMount } from 'svelte';

	export let board = [];
	export let orientation = 'white';
	export let interactive = false;
	export let pendingMove = null; // { from: {row, col}, to: {row, col}, piece: number }
	export let lastMove = null; // { from: {row, col}, to: {row, col} }
	export let isCheck = false; // true if current player's king is in check
	export let currentPlayerIsWhite = true; // whose turn it is
	export let animateMove = null; // { from: {row, col}, to: {row, col}, piece: number } - for animating incoming moves

	const dispatch = createEventDispatcher();

	// Animation state
	let animatingPiece = null;
	let animationStyle = '';

	// Watch for animateMove prop changes to trigger animation
	$: if (animateMove) {
		startAnimation(animateMove);
	}

	function startAnimation(move) {
		if (!move) return;

		const { from, to, piece } = move;

		// Calculate pixel offset (each square is ~12.5% of board)
		const squareSize = 12.5; // percentage
		const fromX = from.col * squareSize;
		const fromY = from.row * squareSize;
		const toX = to.col * squareSize;
		const toY = to.row * squareSize;

		// Adjust for orientation
		const adjustedFromX = orientation === 'black' ? (7 - from.col) * squareSize : fromX;
		const adjustedFromY = orientation === 'black' ? (7 - from.row) * squareSize : fromY;
		const adjustedToX = orientation === 'black' ? (7 - to.col) * squareSize : toX;
		const adjustedToY = orientation === 'black' ? (7 - to.row) * squareSize : toY;

		animatingPiece = {
			piece,
			startX: adjustedFromX,
			startY: adjustedFromY,
			endX: adjustedToX,
			endY: adjustedToY
		};

		// Start animation
		animationStyle = `left: ${adjustedFromX}%; top: ${adjustedFromY}%; transition: none;`;

		// Force reflow then animate
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				animationStyle = `left: ${adjustedToX}%; top: ${adjustedToY}%; transition: left 0.3s ease-out, top 0.3s ease-out;`;

				// Clear animation after it completes
				setTimeout(() => {
					animatingPiece = null;
					animationStyle = '';
				}, 300);
			});
		});
	}

	// Global pointer move listener for drag
	onMount(() => {
		const handleGlobalPointerMove = (e) => {
			if (isDragging && draggedPiece) {
				const dx = Math.abs(e.clientX - startPos.x);
				const dy = Math.abs(e.clientY - startPos.y);
				if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
					hasMoved = true;
				}
				if (hasMoved) {
					dragPos = { x: e.clientX, y: e.clientY };
				}
			}
		};

		window.addEventListener('pointermove', handleGlobalPointerMove);
		return () => window.removeEventListener('pointermove', handleGlobalPointerMove);
	});

	// Piece mappings
	const PIECES = {
		1: { char: '♙', name: 'pawn', color: 'white' },
		2: { char: '♘', name: 'knight', color: 'white' },
		3: { char: '♗', name: 'bishop', color: 'white' },
		4: { char: '♖', name: 'rook', color: 'white' },
		5: { char: '♕', name: 'queen', color: 'white' },
		6: { char: '♔', name: 'king', color: 'white' },
		'-1': { char: '♟', name: 'pawn', color: 'black' },
		'-2': { char: '♞', name: 'knight', color: 'black' },
		'-3': { char: '♝', name: 'bishop', color: 'black' },
		'-4': { char: '♜', name: 'rook', color: 'black' },
		'-5': { char: '♛', name: 'queen', color: 'black' },
		'-6': { char: '♚', name: 'king', color: 'black' }
	};

	let selectedSquare = null;
	let isDragging = false;
	let hasMoved = false; // Track if pointer moved significantly (to distinguish click vs drag)
	let draggedPiece = null;
	let dragPos = { x: -1000, y: -1000 };
	let startPos = { x: 0, y: 0 };
	const DRAG_THRESHOLD = 5; // Pixels to move before considering it a drag

	// Generate board display based on orientation
	$: displayBoard = orientation === 'black'
		? board.slice().reverse().map(row => row.slice().reverse())
		: board;

	$: files = orientation === 'black'
		? ['h', 'g', 'f', 'e', 'd', 'c', 'b', 'a']
		: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

	$: ranks = orientation === 'black'
		? ['1', '2', '3', '4', '5', '6', '7', '8']
		: ['8', '7', '6', '5', '4', '3', '2', '1'];

	function getActualCoords(displayRow, displayCol) {
		if (orientation === 'black') {
			return { row: 7 - displayRow, col: 7 - displayCol };
		}
		return { row: displayRow, col: displayCol };
	}

	function handlePointerDown(e, displayRow, displayCol) {
		if (!interactive) return;

		const coords = getActualCoords(displayRow, displayCol);
		const piece = board[coords.row][coords.col];

		// Store start position to detect drag vs click
		startPos = { x: e.clientX, y: e.clientY };
		hasMoved = false;

		// If clicking on a piece, prepare for potential drag
		if (piece !== 0) {
			isDragging = true;
			draggedPiece = { ...coords, piece };
			dragPos = { x: e.clientX, y: e.clientY };
		}
	}

	function handlePointerUp(e, displayRow, displayCol) {
		if (!interactive) {
			isDragging = false;
			draggedPiece = null;
			hasMoved = false;
			return;
		}

		const coords = getActualCoords(displayRow, displayCol);

		if (isDragging && draggedPiece && hasMoved) {
			// It was a drag - make the move if destination is different
			if (draggedPiece.row !== coords.row || draggedPiece.col !== coords.col) {
				dispatch('move', {
					from: { row: draggedPiece.row, col: draggedPiece.col },
					to: coords
				});
			}
			selectedSquare = null;
		}
		// Click is handled separately by handleSquareClick

		// Reset drag state
		isDragging = false;
		draggedPiece = null;
		hasMoved = false;
		dragPos = { x: -1000, y: -1000 };
	}

	function handleSquareClick(displayRow, displayCol) {
		if (!interactive) return;
		if (hasMoved) return; // Was a drag, not a click

		const coords = getActualCoords(displayRow, displayCol);
		const piece = board[coords.row][coords.col];

		if (selectedSquare) {
			// A piece is already selected
			if (selectedSquare.row === coords.row && selectedSquare.col === coords.col) {
				// Clicked same square - deselect
				selectedSquare = null;
			} else {
				// Clicked different square - make move
				dispatch('move', {
					from: selectedSquare,
					to: coords
				});
				selectedSquare = null;
			}
		} else if (piece !== 0) {
			// No piece selected yet - select this one
			selectedSquare = coords;
		}
	}

	function handlePointerCancel() {
		isDragging = false;
		draggedPiece = null;
		hasMoved = false;
		dragPos = { x: -1000, y: -1000 };
	}

	// Check if a square is the pending move source (hide piece)
	function isPendingFrom(row, col) {
		return pendingMove && pendingMove.from.row === row && pendingMove.from.col === col;
	}

	// Check if a square is the pending move destination (show pending piece)
	function isPendingTo(row, col) {
		return pendingMove && pendingMove.to.row === row && pendingMove.to.col === col;
	}

	function isSelected(displayRow, displayCol) {
		if (!selectedSquare) return false;
		const coords = getActualCoords(displayRow, displayCol);
		return coords.row === selectedSquare.row && coords.col === selectedSquare.col;
	}

	// Check if square is part of last move
	function isLastMoveSquare(row, col) {
		if (!lastMove) return false;
		return (lastMove.from.row === row && lastMove.from.col === col) ||
			   (lastMove.to.row === row && lastMove.to.col === col);
	}

	// Find king position
	function findKing(isWhite) {
		const kingValue = isWhite ? 6 : -6;
		for (let r = 0; r < 8; r++) {
			for (let c = 0; c < 8; c++) {
				if (board[r] && board[r][c] === kingValue) {
					return { row: r, col: c };
				}
			}
		}
		return null;
	}

	// Check if square has the king in check
	function isKingInCheck(row, col) {
		if (!isCheck) return false;
		const kingPos = findKing(currentPlayerIsWhite);
		return kingPos && kingPos.row === row && kingPos.col === col;
	}

	// Calculate legal moves for selected piece (simplified - actual validation on chain)
	function getLegalMoves(fromRow, fromCol) {
		if (!board[fromRow]) return [];
		const piece = board[fromRow][fromCol];
		if (piece === 0) return [];

		const moves = [];
		const isWhitePiece = piece > 0;
		const pieceType = Math.abs(piece);

		// Helper to check if square is valid and not occupied by same color
		const canMoveTo = (r, c) => {
			if (r < 0 || r > 7 || c < 0 || c > 7) return false;
			const target = board[r][c];
			if (target === 0) return true;
			return (target > 0) !== isWhitePiece; // Can capture opposite color
		};

		const isEmpty = (r, c) => {
			if (r < 0 || r > 7 || c < 0 || c > 7) return false;
			return board[r][c] === 0;
		};

		// Add sliding moves (for bishop, rook, queen)
		const addSlidingMoves = (directions) => {
			for (const [dr, dc] of directions) {
				for (let i = 1; i < 8; i++) {
					const r = fromRow + dr * i;
					const c = fromCol + dc * i;
					if (r < 0 || r > 7 || c < 0 || c > 7) break;
					const target = board[r][c];
					if (target === 0) {
						moves.push({ row: r, col: c });
					} else {
						if ((target > 0) !== isWhitePiece) moves.push({ row: r, col: c });
						break;
					}
				}
			}
		};

		switch (pieceType) {
			case 1: // Pawn
				const dir = isWhitePiece ? -1 : 1;
				const startRow = isWhitePiece ? 6 : 1;
				// Forward
				if (isEmpty(fromRow + dir, fromCol)) {
					moves.push({ row: fromRow + dir, col: fromCol });
					// Double move from start
					if (fromRow === startRow && isEmpty(fromRow + dir * 2, fromCol)) {
						moves.push({ row: fromRow + dir * 2, col: fromCol });
					}
				}
				// Captures
				for (const dc of [-1, 1]) {
					const r = fromRow + dir;
					const c = fromCol + dc;
					if (r >= 0 && r <= 7 && c >= 0 && c <= 7) {
						const target = board[r][c];
						if (target !== 0 && (target > 0) !== isWhitePiece) {
							moves.push({ row: r, col: c });
						}
						// En passant (simplified - just show the square)
						if (target === 0 && lastMove) {
							const epRow = isWhitePiece ? 3 : 4;
							if (fromRow === epRow) {
								moves.push({ row: r, col: c });
							}
						}
					}
				}
				break;

			case 2: // Knight
				const knightMoves = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
				for (const [dr, dc] of knightMoves) {
					if (canMoveTo(fromRow + dr, fromCol + dc)) {
						moves.push({ row: fromRow + dr, col: fromCol + dc });
					}
				}
				break;

			case 3: // Bishop
				addSlidingMoves([[-1,-1],[-1,1],[1,-1],[1,1]]);
				break;

			case 4: // Rook
				addSlidingMoves([[-1,0],[1,0],[0,-1],[0,1]]);
				break;

			case 5: // Queen
				addSlidingMoves([[-1,-1],[-1,1],[1,-1],[1,1],[-1,0],[1,0],[0,-1],[0,1]]);
				break;

			case 6: // King
				const kingMoves = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
				for (const [dr, dc] of kingMoves) {
					if (canMoveTo(fromRow + dr, fromCol + dc)) {
						moves.push({ row: fromRow + dr, col: fromCol + dc });
					}
				}
				// Castling (simplified display)
				if (fromCol === 4) {
					const row = isWhitePiece ? 7 : 0;
					if (fromRow === row) {
						// Kingside
						if (isEmpty(row, 5) && isEmpty(row, 6)) {
							moves.push({ row: row, col: 6 });
						}
						// Queenside
						if (isEmpty(row, 3) && isEmpty(row, 2) && isEmpty(row, 1)) {
							moves.push({ row: row, col: 2 });
						}
					}
				}
				break;
		}

		return moves;
	}

	// Computed legal moves for selected piece
	$: legalMoves = selectedSquare ? getLegalMoves(selectedSquare.row, selectedSquare.col) : [];

	function isLegalMove(row, col) {
		return legalMoves.some(m => m.row === row && m.col === col);
	}
</script>

<div class="relative select-none flex justify-center">
	<div
		class="chess-board grid grid-cols-8 rounded-lg overflow-hidden shadow-2xl"
	>
		{#each displayBoard as row, displayRow}
			{#each row as piece, displayCol}
				{@const isLight = (displayRow + displayCol) % 2 === 0}
				{@const pieceData = PIECES[piece]}
				{@const selected = isSelected(displayRow, displayCol)}

				{@const coords = getActualCoords(displayRow, displayCol)}
				{@const isBeingDragged = hasMoved && draggedPiece && draggedPiece.row === coords.row && draggedPiece.col === coords.col}
				{@const isPendingSource = isPendingFrom(coords.row, coords.col)}
				{@const isPendingDest = isPendingTo(coords.row, coords.col)}
				{@const pendingPieceData = isPendingDest && pendingMove ? PIECES[pendingMove.piece] : null}
				{@const isLastMove = isLastMoveSquare(coords.row, coords.col)}
				{@const showLegalMove = isLegalMove(coords.row, coords.col)}
				{@const kingCheck = isKingInCheck(coords.row, coords.col)}

				<button
					class="aspect-square flex items-center justify-center text-4xl md:text-5xl transition-colors relative touch-none
						{interactive && piece !== 0 ? 'cursor-grab active:cursor-grabbing' : ''}
						{interactive && piece === 0 ? 'cursor-pointer' : ''}
						{isLastMove ? 'last-move-highlight' : ''}
						{kingCheck ? 'king-in-check' : ''}"
					style="background-color: {isLight ? (isLastMove ? '#f7ec8c' : '#f0d9b5') : (isLastMove ? '#d4c34a' : '#b58863')}; {selected ? 'box-shadow: inset 0 0 0 4px #e4a853;' : ''}"
					on:click={() => handleSquareClick(displayRow, displayCol)}
					on:pointerdown={(e) => handlePointerDown(e, displayRow, displayCol)}
					on:pointerup={(e) => handlePointerUp(e, displayRow, displayCol)}
					on:pointercancel={handlePointerCancel}
				>
					<!-- Legal move indicator (dot or ring for captures) -->
					{#if showLegalMove && !pieceData}
						<div class="legal-move-dot"></div>
					{:else if showLegalMove && pieceData}
						<div class="legal-move-capture"></div>
					{/if}

					<!-- Show pending piece at destination with pulsing effect -->
					{#if isPendingDest && pendingPieceData}
						<span class="pending-piece {pendingPieceData.color === 'white' ? 'piece-white' : 'piece-black'}">
							{pendingPieceData.char}
						</span>
					<!-- Show normal piece (hide if being dragged or is pending source) -->
					{:else if pieceData && !isBeingDragged && !isPendingSource}
						<span
							class="transition-transform hover:scale-110 {pieceData.color === 'white' ? 'piece-white' : 'piece-black'}"
						>
							{pieceData.char}
						</span>
					{/if}

					<!-- Coordinates -->
					{#if displayCol === 0}
						<span class="absolute left-1 top-1 text-xs font-medium {isLight ? 'text-[#b58863]' : 'text-[#f0d9b5]'}">
							{ranks[displayRow]}
						</span>
					{/if}
					{#if displayRow === 7}
						<span class="absolute right-1 bottom-1 text-xs font-medium {isLight ? 'text-[#b58863]' : 'text-[#f0d9b5]'}">
							{files[displayCol]}
						</span>
					{/if}
				</button>
			{/each}
		{/each}
	</div>

	<!-- Dragged piece overlay (only shown when actually dragging, not clicking) -->
	{#if isDragging && hasMoved && draggedPiece && PIECES[draggedPiece.piece]}
		<div
			class="fixed pointer-events-none text-5xl z-50 dragged-overlay"
			style="left: {dragPos.x}px; top: {dragPos.y}px;"
		>
			<span class="{PIECES[draggedPiece.piece].color === 'white' ? 'piece-white' : 'piece-black'}">
				{PIECES[draggedPiece.piece].char}
			</span>
		</div>
	{/if}

	<!-- Animated piece overlay (for opponent moves) -->
	{#if animatingPiece && PIECES[animatingPiece.piece]}
		<div
			class="absolute pointer-events-none text-4xl md:text-5xl z-40 flex items-center justify-center"
			style="width: 12.5%; height: 12.5%; {animationStyle}"
		>
			<span class="{PIECES[animatingPiece.piece].color === 'white' ? 'piece-white' : 'piece-black'}">
				{PIECES[animatingPiece.piece].char}
			</span>
		</div>
	{/if}
</div>

<style>
	/* Chess board container with fixed square dimensions */
	.chess-board {
		width: min(90vw, 480px);
		aspect-ratio: 1;
	}

	/* Reset button styles but preserve background */
	button {
		border: none !important;
		outline: none !important;
		padding: 0;
		margin: 0;
		-webkit-appearance: none;
		-moz-appearance: none;
		appearance: none;
		box-sizing: border-box;
	}

	button:focus {
		outline: none !important;
	}

	button:disabled {
		cursor: default;
	}

	/* White pieces: cream/ivory with soft dark glow for visibility */
	:global(.piece-white) {
		color: #f8f0e0;
		filter: drop-shadow(1px 1px 1px rgba(0, 0, 0, 0.4));
	}

	/* Black pieces: dark with soft light glow */
	:global(.piece-black) {
		color: #312e2b;
		filter: drop-shadow(1px 1px 1px rgba(255, 255, 255, 0.2));
	}

	/* Pending piece - pulsing animation to show transaction in progress */
	.pending-piece {
		animation: pulse-pending 1.5s ease-in-out infinite;
		opacity: 0.7;
	}

	@keyframes pulse-pending {
		0%, 100% {
			transform: scale(1);
			filter: drop-shadow(0 0 4px rgba(228, 168, 83, 0.6));
		}
		50% {
			transform: scale(1.05);
			filter: drop-shadow(0 0 12px rgba(228, 168, 83, 1));
		}
	}

	/* Dragged piece cursor style */
	.dragged-overlay {
		transform: translate(-50%, -50%);
	}

	/* Legal move indicator - dot for empty squares */
	.legal-move-dot {
		width: 28%;
		height: 28%;
		border-radius: 50%;
		background-color: rgba(0, 0, 0, 0.15);
		position: absolute;
		pointer-events: none;
	}

	/* Legal move indicator - ring for captures */
	.legal-move-capture {
		position: absolute;
		inset: 0;
		border-radius: 50%;
		border: 5px solid rgba(0, 0, 0, 0.15);
		pointer-events: none;
		box-sizing: border-box;
	}

	/* King in check - red radial gradient */
	.king-in-check {
		background: radial-gradient(circle at center,
			rgba(255, 0, 0, 0.8) 0%,
			rgba(255, 0, 0, 0.5) 25%,
			rgba(255, 0, 0, 0.25) 50%,
			transparent 70%) !important;
		animation: check-pulse 1s ease-in-out infinite;
	}

	@keyframes check-pulse {
		0%, 100% {
			box-shadow: inset 0 0 15px rgba(255, 0, 0, 0.5);
		}
		50% {
			box-shadow: inset 0 0 25px rgba(255, 0, 0, 0.8);
		}
	}
</style>
