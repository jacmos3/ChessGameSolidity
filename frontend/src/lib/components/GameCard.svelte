<script>
	import { truncateAddress } from '$lib/stores/wallet.js';
	import { createEventDispatcher } from 'svelte';

	export let game;
	export let currentAccount;

	const dispatch = createEventDispatcher();

	$: canJoin = game.stateInfo.canJoin && game.whitePlayer.toLowerCase() !== currentAccount?.toLowerCase();

	const colorMap = {
		blue: 'text-chess-blue',
		success: 'text-chess-success',
		gray: 'text-chess-gray',
		accent: 'text-chess-accent',
		purple: 'text-chess-purple'
	};
</script>

<button
	class="card cursor-pointer text-left w-full"
	on:click={() => dispatch('click', game)}
>
	<!-- Board preview -->
	{#if game.image}
		<div class="aspect-square rounded-lg overflow-hidden mb-3 bg-chess-darker">
			<img src={game.image} alt="Chess board" class="w-full h-full object-cover" />
		</div>
	{:else}
		<div class="aspect-square rounded-lg mb-3 bg-chess-darker flex items-center justify-center">
			<span class="text-4xl opacity-30">♟</span>
		</div>
	{/if}

	<!-- Game info -->
	<div class="space-y-2">
		<div class="flex items-center justify-between">
			<span class="text-sm text-chess-gray">
				{truncateAddress(game.address)}
			</span>
		</div>

		<div class="flex items-center justify-between">
			<span class="text-sm font-medium {colorMap[game.stateInfo.color] || 'text-chess-gray'}">
				{game.stateInfo.text}
			</span>
			<span class="text-sm text-chess-gray">
				{game.betting} ETH
			</span>
		</div>

		{#if canJoin}
			<div class="pt-1">
				<span class="text-xs bg-chess-blue/20 text-chess-blue px-2 py-1 rounded">
					Join Game
				</span>
			</div>
		{/if}
	</div>
</button>
