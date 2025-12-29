<script>
	import { onMount } from 'svelte';
	import { wallet, isSupported, contractAddress } from '$lib/stores/wallet.js';
	import { games } from '$lib/stores/game.js';
	import GameCard from '$lib/components/GameCard.svelte';
	import CreateGameModal from '$lib/components/CreateGameModal.svelte';
	import GameView from '$lib/components/GameView.svelte';

	let showCreateModal = false;
	let selectedGame = null;

	// Fetch games when wallet connects
	$: if ($wallet.connected && $isSupported && $contractAddress) {
		games.fetchGames();
	}

	function selectGame(game) {
		selectedGame = game.address;
	}

	function closeGame() {
		selectedGame = null;
		games.fetchGames();
	}
</script>

<svelte:head>
	<title>Solidity Chess - On-Chain Chess Game</title>
</svelte:head>

<!-- Hero Section -->
<section class="relative min-h-[80vh] flex items-center justify-center overflow-hidden">
	<!-- Background pattern -->
	<div class="absolute inset-0 bg-gradient-to-br from-chess-dark via-[#16213e] to-chess-darker"></div>
	<div class="absolute inset-0 opacity-[0.03]" style="background-image: linear-gradient(#e4a853 1px, transparent 1px), linear-gradient(90deg, #e4a853 1px, transparent 1px); background-size: 60px 60px;"></div>

	<div class="relative z-10 text-center px-4 max-w-3xl">
		<div class="text-7xl mb-6 filter drop-shadow-[0_4px_20px_rgba(228,168,83,0.3)]">♞</div>
		<h1 class="font-display text-5xl md:text-6xl font-bold mb-4">
			Solidity <span class="text-chess-accent">Chess</span>
		</h1>
		<p class="text-chess-gray text-xl mb-6">100% On-Chain Chess Game</p>
		<p class="text-chess-gray/80 text-lg mb-10 max-w-xl mx-auto leading-relaxed">
			Play chess on the blockchain. Every move is recorded on-chain.
			Bet ETH, challenge opponents, and claim victory.
		</p>

		<!-- Features -->
		<div class="flex flex-wrap justify-center gap-4 mb-10">
			<div class="card !p-4 flex items-center gap-3">
				<span class="text-2xl">♟</span>
				<span class="text-chess-gray">On-Chain Moves</span>
			</div>
			<div class="card !p-4 flex items-center gap-3">
				<span class="text-2xl">◆</span>
				<span class="text-chess-gray">ETH Betting</span>
			</div>
			<div class="card !p-4 flex items-center gap-3">
				<span class="text-2xl">🏆</span>
				<span class="text-chess-gray">NFT Games</span>
			</div>
		</div>

		<div class="flex flex-wrap justify-center gap-4">
			<a href="#games" class="btn btn-primary">Play Now</a>
			<a
				href="https://github.com/jacmos3/ChessGameSolidity"
				target="_blank"
				rel="noopener noreferrer"
				class="btn btn-secondary"
			>
				View Code
			</a>
		</div>
	</div>

	<!-- Scroll indicator -->
	<div class="absolute bottom-8 left-1/2 -translate-x-1/2 text-chess-gray text-sm flex flex-col items-center gap-2 animate-bounce">
		<span>Scroll to play</span>
		<span>↓</span>
	</div>
</section>

<!-- Games Section -->
<section id="games" class="py-20 px-4">
	<div class="max-w-6xl mx-auto">
		<h2 class="font-display text-3xl text-center mb-2">Chess Arena</h2>
		<div class="w-16 h-1 bg-chess-accent mx-auto rounded mb-12"></div>

		{#if !$wallet.connected}
			<!-- Not connected -->
			<div class="card max-w-md mx-auto text-center">
				<div class="text-5xl text-chess-accent mb-4">♞</div>
				<p class="text-lg mb-6">Connect your wallet to play</p>
				<button class="btn btn-primary" on:click={wallet.connect}>
					Connect Wallet
				</button>
			</div>

		{:else if !$isSupported}
			<!-- Wrong network -->
			<div class="card max-w-md mx-auto text-center">
				<div class="text-5xl text-yellow-500 mb-4">⚠</div>
				<p class="text-lg mb-4">Network not supported</p>
				<p class="text-chess-gray text-sm mb-6">
					Please switch to Sepolia, Holesky, or Localhost
				</p>
				<div class="flex flex-wrap justify-center gap-2">
					<span class="px-3 py-1 rounded bg-chess-accent/10 text-chess-accent text-sm">Sepolia</span>
					<span class="px-3 py-1 rounded bg-chess-accent/10 text-chess-accent text-sm">Holesky</span>
					<span class="px-3 py-1 rounded bg-chess-accent/10 text-chess-accent text-sm">Localhost</span>
				</div>
			</div>

		{:else if !$contractAddress}
			<!-- No contract -->
			<div class="card max-w-md mx-auto text-center">
				<div class="text-5xl text-chess-danger mb-4">✕</div>
				<p class="text-lg mb-2">No contract configured</p>
				<p class="text-chess-gray text-sm">
					Check your .env file for this network
				</p>
			</div>

		{:else if selectedGame}
			<!-- Game view -->
			<GameView address={selectedGame} on:close={closeGame} />

		{:else}
			<!-- Games list -->
			<div class="flex justify-between items-center mb-8">
				<p class="text-chess-gray">
					{$games.games.length} game{$games.games.length !== 1 ? 's' : ''} found
				</p>
				<div class="flex gap-3">
					<button
						class="btn btn-primary"
						on:click={() => showCreateModal = true}
						disabled={$games.loading}
					>
						+ Create Game
					</button>
					<button
						class="btn btn-secondary"
						on:click={games.fetchGames}
						disabled={$games.loading}
					>
						{$games.loading ? 'Loading...' : 'Refresh'}
					</button>
				</div>
			</div>

			{#if $games.error}
				<div class="card bg-chess-danger/10 border-chess-danger/30 text-center mb-6">
					<p class="text-chess-danger">{$games.error}</p>
				</div>
			{/if}

			{#if $games.loading && $games.games.length === 0}
				<div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
					{#each Array(4) as _}
						<div class="card animate-pulse">
							<div class="aspect-square bg-white/5 rounded-lg mb-3"></div>
							<div class="h-4 bg-white/5 rounded w-3/4 mb-2"></div>
							<div class="h-3 bg-white/5 rounded w-1/2"></div>
						</div>
					{/each}
				</div>
			{:else if $games.games.length === 0}
				<div class="text-center py-16">
					<div class="text-5xl mb-4">♟</div>
					<p class="text-chess-gray text-lg">No games found</p>
					<p class="text-chess-gray/60 text-sm mt-2">Create one to get started!</p>
				</div>
			{:else}
				<div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
					{#each $games.games as game (game.address)}
						<GameCard
							{game}
							currentAccount={$wallet.account}
							on:click={() => selectGame(game)}
						/>
					{/each}
				</div>
			{/if}
		{/if}
	</div>
</section>

{#if showCreateModal}
	<CreateGameModal on:close={() => showCreateModal = false} />
{/if}
