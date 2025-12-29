<script>
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { wallet, isSupported, contractAddress, truncateAddress } from '$lib/stores/wallet.js';
	import { games } from '$lib/stores/game.js';
	import CreateGameModal from '$lib/components/CreateGameModal.svelte';

	let showCreateModal = false;
	let stakeFilter = 'all';
	let statusFilter = 'open';
	let sortBy = 'recent';

	// Check URL params
	$: if ($page.url.searchParams.get('action') === 'create') {
		showCreateModal = true;
	}
	$: if ($page.url.searchParams.get('filter') === 'active') {
		statusFilter = 'active';
	}

	// Fetch games
	$: if ($wallet.connected && $isSupported && $contractAddress) {
		games.fetchGames();
	}

	// Filter and sort games
	$: filteredGames = $games.games
		.filter(g => {
			// Status filter
			if (statusFilter === 'open' && g.state !== 0) return false;
			if (statusFilter === 'active' && g.state !== 1 && g.state !== 2) return false;
			if (statusFilter === 'finished' && g.state < 3) return false;

			// Stake filter
			const stake = parseFloat(g.betting);
			if (stakeFilter === 'low' && stake > 0.1) return false;
			if (stakeFilter === 'medium' && (stake <= 0.1 || stake > 0.5)) return false;
			if (stakeFilter === 'high' && stake <= 0.5) return false;

			return true;
		})
		.sort((a, b) => {
			if (sortBy === 'stake-high') return parseFloat(b.betting) - parseFloat(a.betting);
			if (sortBy === 'stake-low') return parseFloat(a.betting) - parseFloat(b.betting);
			return 0; // recent - keep original order
		});

	function closeModal() {
		showCreateModal = false;
		// Remove action param from URL
		goto('/lobby', { replaceState: true });
	}

	const stakeRanges = {
		all: 'All Stakes',
		low: '0 - 0.1 ETH',
		medium: '0.1 - 0.5 ETH',
		high: '0.5+ ETH'
	};

	const statusOptions = {
		open: 'Open Games',
		active: 'In Progress',
		finished: 'Completed'
	};
</script>

<svelte:head>
	<title>Game Lobby - Solidity Chess</title>
</svelte:head>

<section class="py-8 px-4">
	<div class="max-w-6xl mx-auto">
		<!-- Header -->
		<div class="flex items-center justify-between mb-8">
			<div>
				<h1 class="font-display text-3xl mb-1">Game Lobby</h1>
				<p class="text-chess-gray">Find and join chess matches</p>
			</div>
			<button
				class="btn btn-primary"
				on:click={() => showCreateModal = true}
			>
				+ Create Game
			</button>
		</div>

		<!-- Filters -->
		<div class="card !p-4 mb-6">
			<div class="flex flex-wrap items-center gap-4">
				<!-- Status Filter -->
				<div class="flex items-center gap-2">
					<span class="text-chess-gray text-sm">Status:</span>
					<div class="flex rounded-lg overflow-hidden border border-chess-accent/20">
						{#each Object.entries(statusOptions) as [value, label]}
							<button
								class="px-3 py-1.5 text-sm transition-colors
									{statusFilter === value ? 'bg-chess-accent text-chess-darker' : 'hover:bg-chess-accent/10'}"
								on:click={() => statusFilter = value}
							>
								{label}
							</button>
						{/each}
					</div>
				</div>

				<!-- Stake Filter -->
				<div class="flex items-center gap-2">
					<span class="text-chess-gray text-sm">Stake:</span>
					<select
						bind:value={stakeFilter}
						class="bg-chess-darker border border-chess-accent/20 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-chess-accent"
					>
						{#each Object.entries(stakeRanges) as [value, label]}
							<option {value}>{label}</option>
						{/each}
					</select>
				</div>

				<!-- Sort -->
				<div class="flex items-center gap-2">
					<span class="text-chess-gray text-sm">Sort:</span>
					<select
						bind:value={sortBy}
						class="bg-chess-darker border border-chess-accent/20 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-chess-accent"
					>
						<option value="recent">Most Recent</option>
						<option value="stake-high">Highest Stake</option>
						<option value="stake-low">Lowest Stake</option>
					</select>
				</div>

				<!-- Refresh -->
				<button
					class="ml-auto btn btn-secondary !py-1.5 !px-3 text-sm"
					on:click={() => games.fetchGames()}
					disabled={$games.loading}
				>
					{$games.loading ? 'Loading...' : 'Refresh'}
				</button>
			</div>
		</div>

		<!-- Results count -->
		<div class="flex items-center justify-between mb-4">
			<p class="text-chess-gray text-sm">
				{filteredGames.length} game{filteredGames.length !== 1 ? 's' : ''} found
			</p>
		</div>

		<!-- Games Grid -->
		{#if $games.loading && $games.games.length === 0}
			<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
				{#each Array(8) as _}
					<div class="card animate-pulse">
						<div class="aspect-square bg-white/5 rounded-lg mb-3"></div>
						<div class="h-4 bg-white/5 rounded w-3/4 mb-2"></div>
						<div class="h-3 bg-white/5 rounded w-1/2"></div>
					</div>
				{/each}
			</div>

		{:else if filteredGames.length === 0}
			<div class="card text-center py-16">
				<div class="text-5xl mb-4 opacity-50">♟</div>
				<p class="text-chess-gray text-lg mb-2">No games found</p>
				<p class="text-chess-gray/60 text-sm mb-6">Try adjusting your filters or create a new game</p>
				<button class="btn btn-primary" on:click={() => showCreateModal = true}>
					Create Game
				</button>
			</div>

		{:else}
			<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
				{#each filteredGames as game (game.address)}
					{@const isMyGame = game.whitePlayer?.toLowerCase() === $wallet.account?.toLowerCase() || game.blackPlayer?.toLowerCase() === $wallet.account?.toLowerCase()}
					{@const canJoin = game.state === 1 && !isMyGame}

					<a href="/game/{game.address}" class="card group hover:border-chess-accent/50 cursor-pointer !p-0 overflow-hidden">
						<!-- Mini board preview placeholder -->
						<div class="aspect-square bg-gradient-to-br from-[#f0d9b5] to-[#b58863] relative">
							<div class="absolute inset-0 flex items-center justify-center">
								<span class="text-6xl opacity-30">♞</span>
							</div>

							<!-- Status badge -->
							<div class="absolute top-2 right-2">
								{#if game.state === 1}
									<span class="bg-chess-blue text-white text-xs px-2 py-1 rounded">Open</span>
								{:else if game.state === 2}
									<span class="bg-chess-success text-white text-xs px-2 py-1 rounded">In Progress</span>
								{:else if game.state === 3}
									<span class="bg-chess-gray text-white text-xs px-2 py-1 rounded">Draw</span>
								{:else}
									<span class="bg-chess-purple text-white text-xs px-2 py-1 rounded">Finished</span>
								{/if}
							</div>

							{#if isMyGame}
								<div class="absolute top-2 left-2">
									<span class="bg-chess-accent text-chess-darker text-xs px-2 py-1 rounded">Your Game</span>
								</div>
							{/if}
						</div>

						<div class="p-4">
							<!-- Players -->
							<div class="flex items-center justify-between mb-2">
								<div class="flex items-center gap-2">
									<span class="text-lg">♔</span>
									<span class="text-sm truncate max-w-[100px]">{truncateAddress(game.whitePlayer)}</span>
								</div>
								<span class="text-chess-gray text-sm">vs</span>
								<div class="flex items-center gap-2">
									{#if game.blackPlayer === '0x0000000000000000000000000000000000000000'}
										<span class="text-chess-gray text-sm italic">Waiting...</span>
									{:else}
										<span class="text-sm truncate max-w-[100px]">{truncateAddress(game.blackPlayer)}</span>
									{/if}
									<span class="text-lg">♚</span>
								</div>
							</div>

							<!-- Stake -->
							<div class="flex items-center justify-between">
								<span class="text-chess-accent font-display text-lg">{game.betting} ETH</span>
								{#if canJoin}
									<span class="text-chess-success text-sm group-hover:underline">Join →</span>
								{:else if isMyGame}
									<span class="text-chess-accent text-sm group-hover:underline">Play →</span>
								{:else}
									<span class="text-chess-gray text-sm group-hover:underline">View →</span>
								{/if}
							</div>
						</div>
					</a>
				{/each}
			</div>
		{/if}
	</div>
</section>

{#if showCreateModal}
	<CreateGameModal on:close={closeModal} />
{/if}
