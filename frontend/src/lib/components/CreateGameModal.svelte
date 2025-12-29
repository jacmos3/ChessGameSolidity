<script>
	import { createEventDispatcher } from 'svelte';
	import { games } from '$lib/stores/game.js';

	const dispatch = createEventDispatcher();

	let betAmount = '0.01';
	let creating = false;
	let error = null;

	async function handleCreate() {
		creating = true;
		error = null;

		try {
			await games.createGame(betAmount);
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

		<div class="p-6 space-y-4">
			<div>
				<label for="bet" class="block text-sm font-medium mb-2">
					Bet Amount (ETH)
				</label>
				<input
					id="bet"
					type="number"
					step="0.001"
					min="0"
					bind:value={betAmount}
					class="input"
					placeholder="0.01"
				/>
				<p class="text-xs text-chess-gray mt-2">
					Your opponent will need to match this bet to join.
					Set to 0 for a friendly game.
				</p>
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
