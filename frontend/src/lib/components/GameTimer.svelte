<script>
	import { onMount } from 'svelte';

	export let whiteSecondsRemaining = 0;
	export let blackSecondsRemaining = 0;
	export let currentPlayerIsWhite = true;
	export let isActive = true;
	export let timeoutSeconds = 3600;

	let displayedSeconds = 0;
	let lastSyncKey = '';

	$: sourceSeconds = currentPlayerIsWhite ? whiteSecondsRemaining : blackSecondsRemaining;
	$: {
		const syncKey = `${currentPlayerIsWhite}:${sourceSeconds}`;
		if (syncKey !== lastSyncKey) {
			lastSyncKey = syncKey;
			displayedSeconds = sourceSeconds;
		}
	}

	$: progress = timeoutSeconds > 0
		? Math.min(100, Math.max(0, (displayedSeconds / timeoutSeconds) * 100))
		: 0;

	function getColor(percentage) {
		if (percentage <= 5) return { text: 'text-red-500', bar: 'bg-red-500' };
		if (percentage <= 15) return { text: 'text-orange-500', bar: 'bg-orange-500' };
		if (percentage <= 30) return { text: 'text-yellow-500', bar: 'bg-yellow-500' };
		return { text: 'text-chess-accent', bar: 'bg-chess-accent' };
	}

	function formatDuration(totalSeconds) {
		if (totalSeconds <= 0) return 'Expired';

		const days = Math.floor(totalSeconds / 86400);
		const hours = Math.floor((totalSeconds % 86400) / 3600);
		const minutes = Math.floor((totalSeconds % 3600) / 60);
		const seconds = totalSeconds % 60;

		if (days > 0) return `${days}d ${hours}h`;
		if (hours > 0) return `${hours}h ${minutes}m`;
		return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
	}

	$: colors = getColor(progress);

	onMount(() => {
		const timer = window.setInterval(() => {
			if (isActive && displayedSeconds > 0) {
				displayedSeconds -= 1;
			}
		}, 1000);

		return () => window.clearInterval(timer);
	});
</script>

{#if isActive}
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

		<!-- Time remaining -->
		<div class="flex items-center justify-between mb-2">
			<span class="text-xs text-chess-gray uppercase tracking-wider">Time remaining</span>
			<span class="text-lg font-mono font-bold {colors.text}">
				{formatDuration(displayedSeconds)}
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
		{#if displayedSeconds <= 300}
			<p class="text-xs text-red-500 text-center mt-2 animate-pulse">
				{displayedSeconds > 0 ? 'Low time! Opponent can claim timeout soon.' : 'Move deadline expired.'}
			</p>
		{/if}
	</div>
{:else if !isActive}
	<div class="bg-chess-darker rounded-lg p-3 text-center text-chess-gray text-sm">
		Game ended
	</div>
{/if}
