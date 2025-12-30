<script>
	export let whiteBlocksRemaining = 0;
	export let blackBlocksRemaining = 0;
	export let currentPlayerIsWhite = true;
	export let isActive = true;
	export let timeoutBlocks = 300; // Default, should be passed from contract

	// Current player's blocks remaining
	$: currentBlocks = currentPlayerIsWhite ? whiteBlocksRemaining : blackBlocksRemaining;

	// Progress percentage (blocks remaining / total timeout blocks)
	$: progress = timeoutBlocks > 0 ? Math.min(100, Math.max(0, (currentBlocks / timeoutBlocks) * 100)) : 0;

	// Color based on blocks remaining
	function getColor(blocks) {
		if (blocks <= 10) return { text: 'text-red-500', bar: 'bg-red-500' };
		if (blocks <= 50) return { text: 'text-orange-500', bar: 'bg-orange-500' };
		if (blocks <= 100) return { text: 'text-yellow-500', bar: 'bg-yellow-500' };
		return { text: 'text-chess-accent', bar: 'bg-chess-accent' };
	}

	$: colors = getColor(currentBlocks);
</script>

{#if isActive && (whiteBlocksRemaining > 0 || blackBlocksRemaining > 0)}
	<div class="bg-chess-darker rounded-lg p-3">
		<!-- Current turn indicator -->
		<div class="flex items-center justify-between mb-2">
			<div class="flex items-center gap-2">
				<span class="text-xl">{currentPlayerIsWhite ? '♔' : '♚'}</span>
				<span class="text-sm text-chess-gray">
					{currentPlayerIsWhite ? 'White' : 'Black'} to move
				</span>
			</div>
			<div class="w-2 h-2 rounded-full bg-chess-accent animate-pulse"></div>
		</div>

		<!-- Blocks remaining -->
		<div class="flex items-center justify-between mb-2">
			<span class="text-xs text-chess-gray uppercase tracking-wider">Time remaining</span>
			<span class="text-lg font-mono font-bold {colors.text}">
				{currentBlocks} <span class="text-xs font-normal text-chess-gray">blocks</span>
			</span>
		</div>

		<!-- Progress bar -->
		<div class="h-2 bg-chess-dark rounded-full overflow-hidden">
			<div
				class="h-full transition-all duration-500 {colors.bar}"
				style="width: {progress}%"
			></div>
		</div>

		<!-- Warning message -->
		{#if currentBlocks <= 10 && currentBlocks > 0}
			<p class="text-xs text-red-500 text-center mt-2 animate-pulse">
				Low time! Opponent can claim timeout soon.
			</p>
		{/if}
	</div>
{:else if !isActive}
	<div class="bg-chess-darker rounded-lg p-3 text-center text-chess-gray text-sm">
		Game ended
	</div>
{/if}
