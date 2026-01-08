<script>
	import { createEventDispatcher, onMount } from 'svelte';
	import { games } from '$lib/stores/game.js';
	import { bonding, bondingAvailable } from '$lib/stores/bonding.js';
	import { wallet } from '$lib/stores/wallet.js';

	const dispatch = createEventDispatcher();

	let betAmount = '0.01';
	let timeoutPreset = 2; // Default to Nakamoto
	let gameMode = 1; // Default to Friendly (safer for casual players)
	let creating = false;
	let error = null;
	let bondCheck = null;

	// Timeout presets matching contract constants (named after crypto pioneers)
	const timeoutOptions = [
		{ value: 0, name: 'Finney', blocks: 300, time: '~1 ora', description: 'Partite veloci' },
		{ value: 1, name: 'Buterin', blocks: 2100, time: '~7 ore', description: 'Ritmo moderato' },
		{ value: 2, name: 'Nakamoto', blocks: 50400, time: '~7 giorni', description: 'Partite rilassate' }
	];

	// Game mode options
	const gameModeOptions = [
		{ value: 0, name: 'Tournament', icon: '🏆', description: 'Mosse illegali = sconfitta' },
		{ value: 1, name: 'Friendly', icon: '🤝', description: 'Mosse illegali rifiutate' }
	];

	// Check bond requirements when bet amount changes
	$: if ($wallet.connected && $bondingAvailable && betAmount) {
		checkBondRequirements();
	}

	async function checkBondRequirements() {
		const amount = parseFloat(betAmount);
		if (isNaN(amount) || amount <= 0) {
			bondCheck = null;
			return;
		}

		const hasBond = await bonding.hasSufficientBond(amount);
		const required = await bonding.calculateRequiredBond(amount);

		bondCheck = {
			sufficient: hasBond,
			required
		};
	}

	async function handleCreate() {
		creating = true;
		error = null;

		// Pre-check bond requirements
		if ($bondingAvailable && bondCheck && !bondCheck.sufficient) {
			error = `Insufficient bond. You need ${parseFloat(bondCheck.required?.chessRequired || 0).toFixed(0)} CHESS + ${parseFloat(bondCheck.required?.ethRequired || 0).toFixed(4)} ETH deposited. Go to Profile > Bond Management to deposit.`;
			creating = false;
			return;
		}

		try {
			await games.createGame(betAmount, timeoutPreset, gameMode);
			await games.fetchGames();
			dispatch('close');
		} catch (err) {
			// Parse error message for user-friendly display
			let message = err.message || 'Failed to create game';
			if (message.includes('UNPREDICTABLE_GAS_LIMIT') || message.includes('execution reverted')) {
				message = 'Transaction failed. This usually means insufficient bond. Go to Profile > Bond Management to deposit CHESS and ETH.';
			} else if (message.includes('insufficient funds')) {
				message = 'Insufficient ETH balance for bet + gas fees.';
			}
			error = message;
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

			<!-- Bond Requirement Status -->
			{#if $bondingAvailable && bondCheck}
				<div class="p-3 rounded-lg {bondCheck.sufficient ? 'bg-chess-success/10 border border-chess-success/30' : 'bg-chess-danger/10 border border-chess-danger/30'}">
					<div class="flex items-center gap-2 text-sm {bondCheck.sufficient ? 'text-chess-success' : 'text-chess-danger'}">
						<span>{bondCheck.sufficient ? '✓' : '✗'}</span>
						<span>{bondCheck.sufficient ? 'Bond OK' : 'Insufficient Bond'}</span>
					</div>
					{#if bondCheck.required}
						<p class="text-xs mt-1 {bondCheck.sufficient ? 'text-chess-gray' : 'text-chess-danger/80'}">
							Required: {parseFloat(bondCheck.required.chessRequired || 0).toFixed(0)} CHESS + {parseFloat(bondCheck.required.ethRequired || 0).toFixed(4)} ETH
						</p>
						{#if !bondCheck.sufficient}
							<a href="/profile" class="text-xs text-chess-accent hover:underline mt-1 block">
								→ Go to Profile to deposit bond
							</a>
						{/if}
					{/if}
				</div>
			{/if}

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
				disabled={creating || ($bondingAvailable && bondCheck && !bondCheck.sufficient)}
			>
				{creating ? 'Creating...' : `Create (${betAmount} ETH)`}
			</button>
		</div>
	</div>
</div>
