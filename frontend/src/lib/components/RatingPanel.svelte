<script>
	import { onMount } from 'svelte';
	import { wallet, truncateAddress } from '$lib/stores/wallet.js';
	import { rating, ratingAvailable, getRatingTier, formatRating } from '$lib/stores/rating.js';

	let activeTab = 'stats'; // 'stats' | 'leaderboard'

	onMount(async () => {
		if ($wallet.connected && $ratingAvailable) {
			await rating.fetchPlayerStats();
		}
	});

	$: if ($wallet.connected && $ratingAvailable) {
		rating.fetchPlayerStats();
	}

	async function loadLeaderboard() {
		activeTab = 'leaderboard';
		await rating.fetchLeaderboard(0, 20);
	}

	$: tier = getRatingTier($rating.rating);
</script>

<div class="card">
	<div class="p-4 border-b border-chess-accent/10">
		<div class="flex items-center justify-between">
			<h3 class="font-display text-lg flex items-center gap-2">
				<span class="text-chess-accent">ELO</span>
				Rating
			</h3>
			{#if $rating.gamesPlayed > 0}
				<span class="px-2 py-1 {tier.color} bg-chess-darker text-xs rounded font-medium">
					{tier.name}
				</span>
			{/if}
		</div>
	</div>

	{#if !$ratingAvailable}
		<div class="p-6 text-center text-chess-gray">
			<p>Rating system is not available on this network.</p>
		</div>
	{:else if $rating.loading && $rating.gamesPlayed === 0}
		<div class="p-6 text-center text-chess-gray">
			<div class="animate-pulse">Loading rating data...</div>
		</div>
	{:else}
		<!-- Rating Display -->
		<div class="p-4 bg-chess-darker/30 border-b border-chess-accent/10">
			<div class="flex items-center justify-center gap-8">
				<div class="text-center">
					<div class="text-4xl font-display {tier.color}">
						{formatRating($rating.rating, $rating.isProvisional)}
					</div>
					<div class="text-xs text-chess-gray uppercase tracking-wide mt-1">
						{$rating.isProvisional ? 'Provisional' : 'Established'}
					</div>
				</div>

				{#if $rating.peakRating > $rating.rating}
					<div class="text-center">
						<div class="text-xl font-display text-chess-gray">
							{$rating.peakRating}
						</div>
						<div class="text-xs text-chess-gray uppercase tracking-wide mt-1">
							Peak
						</div>
					</div>
				{/if}
			</div>
		</div>

		<!-- Tabs -->
		<div class="flex border-b border-chess-accent/10">
			<button
				class="flex-1 py-3 text-sm font-medium transition-colors
					{activeTab === 'stats' ? 'text-chess-accent border-b-2 border-chess-accent' : 'text-chess-gray hover:text-chess-light'}"
				on:click={() => { activeTab = 'stats'; }}
			>
				Stats
			</button>
			<button
				class="flex-1 py-3 text-sm font-medium transition-colors
					{activeTab === 'leaderboard' ? 'text-chess-accent border-b-2 border-chess-accent' : 'text-chess-gray hover:text-chess-light'}"
				on:click={loadLeaderboard}
			>
				Leaderboard
			</button>
		</div>

		<!-- Tab Content -->
		<div class="p-4">
			{#if activeTab === 'stats'}
				<div class="space-y-4">
					<!-- Record -->
					<div class="grid grid-cols-3 gap-4 text-center">
						<div class="bg-chess-darker/50 rounded-lg p-3">
							<div class="text-2xl font-display text-chess-success">{$rating.wins}</div>
							<div class="text-xs text-chess-gray">Wins</div>
						</div>
						<div class="bg-chess-darker/50 rounded-lg p-3">
							<div class="text-2xl font-display text-chess-danger">{$rating.losses}</div>
							<div class="text-xs text-chess-gray">Losses</div>
						</div>
						<div class="bg-chess-darker/50 rounded-lg p-3">
							<div class="text-2xl font-display text-chess-gray">{$rating.draws}</div>
							<div class="text-xs text-chess-gray">Draws</div>
						</div>
					</div>

					<!-- Additional Stats -->
					<div class="bg-chess-darker/50 rounded-lg p-4 space-y-2">
						<div class="flex justify-between text-sm">
							<span class="text-chess-gray">Games Played:</span>
							<span>{$rating.gamesPlayed}</span>
						</div>
						<div class="flex justify-between text-sm">
							<span class="text-chess-gray">Win Rate:</span>
							<span class="{$rating.winRate >= 50 ? 'text-chess-success' : 'text-chess-danger'}">
								{$rating.winRate.toFixed(1)}%
							</span>
						</div>
						<div class="flex justify-between text-sm">
							<span class="text-chess-gray">Status:</span>
							<span>
								{$rating.isProvisional ? 'Provisional (< 30 games)' : 'Established'}
							</span>
						</div>
					</div>

					<!-- Rating Tiers Info -->
					<div class="text-xs text-chess-gray">
						<h4 class="font-medium mb-2">Rating Tiers</h4>
						<div class="grid grid-cols-2 gap-1">
							<span class="text-yellow-400">2400+ Grandmaster</span>
							<span class="text-purple-400">2200+ Master</span>
							<span class="text-blue-400">2000+ Expert</span>
							<span class="text-green-400">1800+ Class A</span>
							<span class="text-teal-400">1600+ Class B</span>
							<span>1400+ Class C</span>
						</div>
					</div>
				</div>

			{:else if activeTab === 'leaderboard'}
				<div class="space-y-2">
					{#if $rating.topPlayers.length === 0}
						<div class="text-center py-8">
							<div class="text-4xl mb-4 opacity-50">-</div>
							<p class="text-chess-gray">No rated players yet</p>
						</div>
					{:else}
						{#each $rating.topPlayers as player, index}
							{@const playerTier = getRatingTier(player.rating)}
							<div class="flex items-center gap-3 p-3 rounded-lg bg-chess-darker/50 hover:bg-chess-darker transition-colors">
								<div class="w-8 h-8 rounded-full bg-chess-accent/20 flex items-center justify-center text-sm font-medium">
									{index + 1}
								</div>
								<div class="flex-1 min-w-0">
									<div class="font-mono text-sm truncate">
										{truncateAddress(player.address)}
									</div>
									<div class="text-xs {playerTier.color}">
										{playerTier.name}
									</div>
								</div>
								<div class="text-lg font-display {playerTier.color}">
									{player.rating}
								</div>
							</div>
						{/each}
					{/if}

					{#if $rating.totalPlayers > 20}
						<div class="text-center text-xs text-chess-gray mt-4">
							Showing top 20 of {$rating.totalPlayers} players
						</div>
					{/if}
				</div>
			{/if}
		</div>
	{/if}
</div>
