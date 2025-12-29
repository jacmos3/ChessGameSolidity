<script>
	import { createEventDispatcher } from 'svelte';

	export let board = [];
	export let orientation = 'white';
	export let interactive = false;

	const dispatch = createEventDispatcher();

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
	let draggedPiece = null;
	let dragPos = { x: 0, y: 0 };

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

	function handleSquareClick(displayRow, displayCol) {
		if (!interactive) return;

		const coords = getActualCoords(displayRow, displayCol);
		const piece = board[coords.row][coords.col];

		if (selectedSquare) {
			// Make move
			if (selectedSquare.row !== coords.row || selectedSquare.col !== coords.col) {
				dispatch('move', {
					from: selectedSquare,
					to: coords
				});
			}
			selectedSquare = null;
		} else if (piece !== 0) {
			// Select piece
			selectedSquare = coords;
		}
	}

	function handleDragStart(e, displayRow, displayCol) {
		if (!interactive) return;

		const coords = getActualCoords(displayRow, displayCol);
		const piece = board[coords.row][coords.col];

		if (piece === 0) return;

		draggedPiece = { ...coords, piece };
		selectedSquare = coords;

		// Set drag image to transparent (we'll render our own)
		const img = new Image();
		img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
		e.dataTransfer.setDragImage(img, 0, 0);
	}

	function handleDrag(e) {
		if (draggedPiece && e.clientX && e.clientY) {
			dragPos = { x: e.clientX, y: e.clientY };
		}
	}

	function handleDrop(e, displayRow, displayCol) {
		if (!draggedPiece) return;

		const coords = getActualCoords(displayRow, displayCol);

		if (draggedPiece.row !== coords.row || draggedPiece.col !== coords.col) {
			dispatch('move', {
				from: { row: draggedPiece.row, col: draggedPiece.col },
				to: coords
			});
		}

		draggedPiece = null;
		selectedSquare = null;
	}

	function handleDragEnd() {
		draggedPiece = null;
		selectedSquare = null;
	}

	function isSelected(displayRow, displayCol) {
		if (!selectedSquare) return false;
		const coords = getActualCoords(displayRow, displayCol);
		return coords.row === selectedSquare.row && coords.col === selectedSquare.col;
	}
</script>

<div class="relative select-none">
	<div
		class="grid grid-cols-8 rounded-lg overflow-hidden shadow-2xl"
		style="width: min(100%, 480px); aspect-ratio: 1;"
	>
		{#each displayBoard as row, displayRow}
			{#each row as piece, displayCol}
				{@const isLight = (displayRow + displayCol) % 2 === 0}
				{@const pieceData = PIECES[piece]}
				{@const selected = isSelected(displayRow, displayCol)}

				<button
					class="aspect-square flex items-center justify-center text-4xl md:text-5xl transition-colors relative
						{isLight ? 'bg-[#f0d9b5]' : 'bg-[#b58863]'}
						{selected ? 'ring-4 ring-chess-accent ring-inset' : ''}
						{interactive && piece !== 0 ? 'cursor-grab active:cursor-grabbing' : ''}
						{interactive && piece === 0 ? 'cursor-pointer' : ''}"
					on:click={() => handleSquareClick(displayRow, displayCol)}
					on:dragstart={(e) => handleDragStart(e, displayRow, displayCol)}
					on:drag={handleDrag}
					on:dragover|preventDefault
					on:drop|preventDefault={(e) => handleDrop(e, displayRow, displayCol)}
					on:dragend={handleDragEnd}
					draggable={interactive && piece !== 0}
					disabled={!interactive}
				>
					{#if pieceData && !(draggedPiece && draggedPiece.row === getActualCoords(displayRow, displayCol).row && draggedPiece.col === getActualCoords(displayRow, displayCol).col)}
						<span
							class="drop-shadow-lg transition-transform hover:scale-110
								{pieceData.color === 'white' ? 'text-white' : 'text-gray-900'}"
							style="text-shadow: {pieceData.color === 'white' ? '1px 1px 2px rgba(0,0,0,0.5)' : '1px 1px 2px rgba(255,255,255,0.3)'};"
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

	<!-- Dragged piece overlay -->
	{#if draggedPiece && PIECES[draggedPiece.piece]}
		<div
			class="fixed pointer-events-none text-5xl z-50"
			style="left: {dragPos.x - 30}px; top: {dragPos.y - 30}px; text-shadow: 2px 2px 4px rgba(0,0,0,0.5);"
		>
			<span class="{PIECES[draggedPiece.piece].color === 'white' ? 'text-white' : 'text-gray-900'}">
				{PIECES[draggedPiece.piece].char}
			</span>
		</div>
	{/if}
</div>

<style>
	button:disabled {
		cursor: default;
	}
</style>
