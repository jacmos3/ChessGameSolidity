<script>
	import { createEventDispatcher } from 'svelte';
	import { games } from '$lib/stores/game.js';

	const dispatch = createEventDispatcher();

	let betAmount = '0.01';
	let timeoutPreset = 2; // Default to Classical
	let gameMode = 1; // Default to Friendly (safer for casual players)
	let creating = false;
	let error = null;

	// Timeout presets matching contract constants
	const timeoutOptions = [
		{ value: 0, name: 'Blitz', blocks: 300, time: '~1 ora', description: 'Partite veloci' },
		{ value: 1, name: 'Rapid', blocks: 2100, time: '~7 ore', description: 'Ritmo moderato' },
		{ value: 2, name: 'Classical', blocks: 50400, time: '~7 giorni', description: 'Partite rilassate' }
	];

	// Game mode options
	const gameModeOptions = [
		{ value: 0, name: 'Tournament', icon: '🏆', description: 'Mosse illegali = sconfitta' },
		{ value: 1, name: 'Friendly', icon: '🤝', description: 'Mosse illegali rifiutate' }
	];

	async function handleCreate() {
		creating = true;
		error = null;

		try {
			await games.createGame(betAmount, timeoutPreset, gameMode);
			await games.fetchGames();
			dispatch('close');
		} catch (err) {
			error = err.message || 'Failed to create game';
		}

		creating = false;
	}

	function handleKeydown(e) {
		if (e.key === 'Escape') dispatch('close');
	}
</script>

<svelte:window on:keydown={handleKeydown} />

<!-- Backdrop -->
<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
<div
	class="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
	on:click|self={() => dispatch('close')}
>
	<!-- Modal -->
	<div class="card max-w-md w-full !p-0 overflow-hidden">
		<div class="p-6 border-b border-chess-accent/10">
			<h3 class="font-display text-xl">Create New Game</h3>
		</div>

		<div class="p-6 space-y-5">
			<!-- Bet Amount -->
			<div>
				<label for="bet" class="block text-sm font-medium mb-2">
					Bet Amount (ETH)
				</label>
				<input
					id="bet"
					type="number"
					step="0.001"
					min="0.001"
					max="100"
					bind:value={betAmount}
					class="input"
					placeholder="0.01"
				/>
				<p class="text-xs text-chess-gray mt-2">
					Your opponent will need to match this bet to join (min 0.001, max 100 ETH).
				</p>
			</div>

			<!-- Time Control -->
			<div role="group" aria-labelledby="time-control-label">
				<span id="time-control-label" class="block text-sm font-medium mb-3">
					Time Control
				</span>
				<div class="grid grid-cols-3 gap-2">
					{#each timeoutOptions as option}
						<button
							type="button"
							class="p-3 rounded-lg border transition-all text-center
								{timeoutPreset === option.value
									? 'border-chess-accent bg-chess-accent/10'
									: 'border-chess-accent/20 hover:border-chess-accent/50 bg-chess-darker'}"
							on:click={() => timeoutPreset = option.value}
						>
							<div class="font-display text-sm {timeoutPreset === option.value ? 'text-chess-accent' : ''}">
								{option.name}
							</div>
							<div class="text-xs text-chess-gray mt-1">{option.time}</div>
						</button>
					{/each}
				</div>
				<p class="text-xs text-chess-gray mt-2">
					{timeoutOptions[timeoutPreset].description} -
					{timeoutOptions[timeoutPreset].blocks} blocchi per mossa
				</p>
			</div>

			<!-- Game Mode -->
			<div role="group" aria-labelledby="game-mode-label">
				<span id="game-mode-label" class="block text-sm font-medium mb-3">
					Game Mode
				</span>
				<div class="grid grid-cols-2 gap-2">
					{#each gameModeOptions as option}
						<button
							type="button"
							class="p-3 rounded-lg border transition-all text-center
								{gameMode === option.value
									? 'border-chess-accent bg-chess-accent/10'
									: 'border-chess-accent/20 hover:border-chess-accent/50 bg-chess-darker'}"
							on:click={() => gameMode = option.value}
						>
							<div class="text-xl mb-1">{option.icon}</div>
							<div class="font-display text-sm {gameMode === option.value ? 'text-chess-accent' : ''}">
								{option.name}
							</div>
							<div class="text-xs text-chess-gray mt-1">{option.description}</div>
						</button>
					{/each}
				</div>
			</div>

			{#if error}
				<div class="bg-chess-danger/10 border border-chess-danger/30 text-chess-danger rounded-lg p-3 text-sm">
					{error}
				</div>
			{/if}
		</div>

		<div class="p-6 bg-chess-darker/50 flex justify-end gap-3">
			<button
				class="btn btn-secondary"
				on:click={() => dispatch('close')}
				disabled={creating}
			>
				Cancel
			</button>
			<button
				class="btn btn-primary"
				on:click={handleCreate}
				disabled={creating}
			>
				{creating ? 'Creating...' : `Create (${betAmount} ETH)`}
			</button>
		</div>
	</div>
</div>
