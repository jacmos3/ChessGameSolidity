<script>
	import { onMount, onDestroy } from 'svelte';

	export let whiteTimeRemaining = 0; // seconds
	export let blackTimeRemaining = 0; // seconds
	export let whiteBlocksRemaining = 0;
	export let blackBlocksRemaining = 0;
	export let currentPlayerIsWhite = true;
	export let isActive = true; // game in progress

	let whiteTime = whiteTimeRemaining;
	let blackTime = blackTimeRemaining;
	let interval = null;

	// Update initial values when props change
	$: {
		whiteTime = whiteTimeRemaining;
		blackTime = blackTimeRemaining;
	}

	// Format seconds to human readable
	function formatTime(seconds) {
		if (seconds <= 0) return '0:00';

		const days = Math.floor(seconds / 86400);
		const hours = Math.floor((seconds % 86400) / 3600);
		const minutes = Math.floor((seconds % 3600) / 60);
		const secs = Math.floor(seconds % 60);

		if (days > 0) {
			return `${days}d ${hours}h`;
		} else if (hours > 0) {
			return `${hours}h ${minutes}m`;
		} else if (minutes > 0) {
			return `${minutes}:${secs.toString().padStart(2, '0')}`;
		} else {
			return `0:${secs.toString().padStart(2, '0')}`;
		}
	}

	// Get progress percentage
	function getProgress(current, isWhite) {
		// Estimate max time based on blocks (assume classical = 50400 blocks)
		const maxBlocks = 50400;
		const blocks = isWhite ? whiteBlocksRemaining : blackBlocksRemaining;
		return Math.min(100, Math.max(0, (blocks / maxBlocks) * 100));
	}

	// Get color based on time remaining
	function getTimeColor(seconds) {
		if (seconds <= 60) return 'text-red-500'; // < 1 min
		if (seconds <= 300) return 'text-orange-500'; // < 5 min
		if (seconds <= 3600) return 'text-yellow-500'; // < 1 hour
		return 'text-chess-gray';
	}

	function getBarColor(seconds) {
		if (seconds <= 60) return 'bg-red-500';
		if (seconds <= 300) return 'bg-orange-500';
		if (seconds <= 3600) return 'bg-yellow-500';
		return 'bg-chess-accent';
	}

	// Countdown timer (local estimation, refreshes on load)
	onMount(() => {
		if (isActive) {
			interval = setInterval(() => {
				if (currentPlayerIsWhite && whiteTime > 0) {
					whiteTime -= 1;
				} else if (!currentPlayerIsWhite && blackTime > 0) {
					blackTime -= 1;
				}
			}, 1000);
		}
	});

	onDestroy(() => {
		if (interval) clearInterval(interval);
	});
</script>

<div class="flex flex-col gap-2">
	<!-- White Timer -->
	<div class="flex items-center gap-3 p-2 rounded-lg {currentPlayerIsWhite && isActive ? 'bg-chess-accent/10 ring-1 ring-chess-accent' : 'bg-chess-darker'}">
		<span class="text-xl">♔</span>
		<div class="flex-1 min-w-0">
			<div class="flex items-center justify-between mb-1">
				<span class="text-xs text-chess-gray">White</span>
				<span class="text-sm font-mono {getTimeColor(whiteTime)}">
					{formatTime(whiteTime)}
				</span>
			</div>
			<div class="h-1.5 bg-chess-dark rounded-full overflow-hidden">
				<div
					class="h-full transition-all duration-1000 {getBarColor(whiteTime)}"
					style="width: {getProgress(whiteTime, true)}%"
				></div>
			</div>
		</div>
		{#if currentPlayerIsWhite && isActive}
			<div class="w-2 h-2 rounded-full bg-chess-accent animate-pulse"></div>
		{/if}
	</div>

	<!-- Black Timer -->
	<div class="flex items-center gap-3 p-2 rounded-lg {!currentPlayerIsWhite && isActive ? 'bg-chess-accent/10 ring-1 ring-chess-accent' : 'bg-chess-darker'}">
		<span class="text-xl">♚</span>
		<div class="flex-1 min-w-0">
			<div class="flex items-center justify-between mb-1">
				<span class="text-xs text-chess-gray">Black</span>
				<span class="text-sm font-mono {getTimeColor(blackTime)}">
					{formatTime(blackTime)}
				</span>
			</div>
			<div class="h-1.5 bg-chess-dark rounded-full overflow-hidden">
				<div
					class="h-full transition-all duration-1000 {getBarColor(blackTime)}"
					style="width: {getProgress(blackTime, false)}%"
				></div>
			</div>
		</div>
		{#if !currentPlayerIsWhite && isActive}
			<div class="w-2 h-2 rounded-full bg-chess-accent animate-pulse"></div>
		{/if}
	</div>

	<!-- Blocks info -->
	<div class="text-xs text-chess-gray/60 text-center mt-1">
		Blocks: ♔ {whiteBlocksRemaining} | ♚ {blackBlocksRemaining}
	</div>
</div>
