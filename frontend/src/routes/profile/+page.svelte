<script>
	import { wallet, truncateAddress, isSupported, contractAddress } from '$lib/stores/wallet.js';
	import { games } from '$lib/stores/game.js';
	import BondingPanel from '$lib/components/BondingPanel.svelte';
	import ArbitratorPanel from '$lib/components/ArbitratorPanel.svelte';
	import GovernancePanel from '$lib/components/GovernancePanel.svelte';
	import RatingPanel from '$lib/components/RatingPanel.svelte';

	// Fetch games
	$: if ($wallet.connected && $isSupported && $contractAddress) {
		games.fetchGames();
	}

	// Calculate stats
	$: myGames = $games.games.filter(g =>
		g.whitePlayer?.toLowerCase() === $wallet.account?.toLowerCase() ||
		g.blackPlayer?.toLowerCase() === $wallet.account?.toLowerCase()
	);

	$: wins = myGames.filter(g =>
		(g.state === 4 && g.whitePlayer?.toLowerCase() === $wallet.account?.toLowerCase()) ||
		(g.state === 5 && g.blackPlayer?.toLowerCase() === $wallet.account?.toLowerCase())
	).length;

	$: losses = myGames.filter(g =>
		(g.state === 5 && g.whitePlayer?.toLowerCase() === $wallet.account?.toLowerCase()) ||
		(g.state === 4 && g.blackPlayer?.toLowerCase() === $wallet.account?.toLowerCase())
	).length;

	$: draws = myGames.filter(g => g.state === 3).length;

	$: activeGames = myGames.filter(g => g.state === 1 || g.state === 2).length;

	$: winRate = myGames.filter(g => g.state >= 3).length > 0
		? Math.round((wins / myGames.filter(g => g.state >= 3).length) * 100)
		: 0;

	$: totalEthWon = myGames
		.filter(g =>
			(g.state === 4 && g.whitePlayer?.toLowerCase() === $wallet.account?.toLowerCase()) ||
			(g.state === 5 && g.blackPlayer?.toLowerCase() === $wallet.account?.toLowerCase())
		)
		.reduce((sum, g) => sum + parseFloat(g.betting), 0);

	$: totalEthLost = myGames
		.filter(g =>
			(g.state === 5 && g.whitePlayer?.toLowerCase() === $wallet.account?.toLowerCase()) ||
			(g.state === 4 && g.blackPlayer?.toLowerCase() === $wallet.account?.toLowerCase())
		)
		.reduce((sum, g) => sum + parseFloat(g.betting), 0);

	// Game history sorted by completion
	$: completedGames = myGames
		.filter(g => g.state >= 3)
		.sort((a, b) => b.state - a.state);
</script>

<svelte:head>
	<title>Profile - MyChess.onchain</title>
</svelte:head>

<section class="py-8 px-4">
	<div class="max-w-4xl mx-auto">
		{#if !$wallet.connected}
			<div class="card text-center py-12">
				<div class="text-5xl mb-4">♔</div>
				<p class="text-chess-gray mb-4">Connect your wallet to view your profile</p>
				<button class="btn btn-primary" on:click={wallet.connect}>
					Connect Wallet
				</button>
			</div>

		{:else}
			<!-- Profile Header -->
			<div class="card mb-6">
				<div class="flex flex-col md:flex-row items-center gap-6">
					<!-- Avatar -->
					<div class="w-24 h-24 rounded-full bg-chess-accent/20 flex items-center justify-center text-5xl">
						♔
					</div>

					<!-- Info -->
					<div class="flex-1 text-center md:text-left">
						<h1 class="font-display text-2xl mb-2">
							{truncateAddress($wallet.account)}
						</h1>
						<p class="text-chess-gray text-sm mb-3">
							{$wallet.account}
						</p>
						<div class="flex flex-wrap justify-center md:justify-start gap-2">
							<span class="px-3 py-1 rounded-full bg-chess-accent/10 text-chess-accent text-sm">
								{myGames.length} Games
							</span>
							<span class="px-3 py-1 rounded-full bg-chess-success/10 text-chess-success text-sm">
								{winRate}% Win Rate
							</span>
							{#if activeGames > 0}
								<span class="px-3 py-1 rounded-full bg-chess-blue/10 text-chess-blue text-sm">
									{activeGames} Active
								</span>
							{/if}
						</div>
					</div>

					<!-- Quick Actions -->
					<div class="flex gap-2">
						<a href="/lobby?action=create" class="btn btn-primary">
							New Game
						</a>
					</div>
				</div>
			</div>

			<!-- Stats Grid -->
			<div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
				<div class="card text-center">
					<div class="text-3xl font-display text-chess-success mb-1">{wins}</div>
					<div class="text-chess-gray text-sm">Wins</div>
				</div>
				<div class="card text-center">
					<div class="text-3xl font-display text-chess-danger mb-1">{losses}</div>
					<div class="text-chess-gray text-sm">Losses</div>
				</div>
				<div class="card text-center">
					<div class="text-3xl font-display text-chess-gray mb-1">{draws}</div>
					<div class="text-chess-gray text-sm">Draws</div>
				</div>
				<div class="card text-center">
					<div class="text-3xl font-display text-chess-accent mb-1">{winRate}%</div>
					<div class="text-chess-gray text-sm">Win Rate</div>
				</div>
			</div>

			<!-- ETH Stats -->
			<div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
				<div class="card">
					<h3 class="text-chess-gray text-sm mb-2">Total ETH Won</h3>
					<div class="flex items-baseline gap-2">
						<span class="text-3xl font-display text-chess-success">+{totalEthWon.toFixed(4)}</span>
						<span class="text-chess-gray">ETH</span>
					</div>
				</div>
				<div class="card">
					<h3 class="text-chess-gray text-sm mb-2">Total ETH Lost</h3>
					<div class="flex items-baseline gap-2">
						<span class="text-3xl font-display text-chess-danger">-{totalEthLost.toFixed(4)}</span>
						<span class="text-chess-gray">ETH</span>
					</div>
				</div>
			</div>

			<!-- Net Profit -->
			{@const netProfit = totalEthWon - totalEthLost}
			<div class="card mb-8 text-center py-6">
				<h3 class="text-chess-gray text-sm mb-2">Net Profit/Loss</h3>
				<div class="text-4xl font-display {netProfit >= 0 ? 'text-chess-success' : 'text-chess-danger'}">
					{netProfit >= 0 ? '+' : ''}{netProfit.toFixed(4)} ETH
				</div>
			</div>

			<!-- ELO Rating -->
			<div class="mb-8">
				<RatingPanel />
			</div>

			<!-- Bond Management -->
			<div class="mb-8">
				<BondingPanel />
			</div>

			<!-- Arbitrator Program -->
			<div class="mb-8">
				<ArbitratorPanel />
			</div>

			<!-- Governance -->
			<div class="mb-8">
				<GovernancePanel />
			</div>

			<!-- Game History -->
			<div class="card">
				<div class="flex items-center justify-between mb-6">
					<h2 class="font-display text-xl">Game History</h2>
					<span class="text-chess-gray text-sm">{completedGames.length} completed</span>
				</div>

				{#if completedGames.length === 0}
					<div class="text-center py-8">
						<div class="text-4xl mb-4 opacity-50">♟</div>
						<p class="text-chess-gray">No completed games yet</p>
						<a href="/lobby" class="btn btn-primary mt-4">Find a Game</a>
					</div>
				{:else}
					<div class="space-y-3">
						{#each completedGames as game (game.address)}
							{@const isWhite = game.whitePlayer?.toLowerCase() === $wallet.account?.toLowerCase()}
							{@const opponent = isWhite ? game.blackPlayer : game.whitePlayer}
							{@const won = (game.state === 4 && isWhite) || (game.state === 5 && !isWhite)}
							{@const isDraw = game.state === 3}

							<a href="/game/{game.address}" class="flex items-center gap-4 p-4 rounded-lg bg-chess-darker hover:bg-chess-dark transition-colors">
								<!-- Result icon -->
								<div class="w-10 h-10 rounded-full flex items-center justify-center
									{won ? 'bg-chess-success/20 text-chess-success' : ''}
									{!won && !isDraw ? 'bg-chess-danger/20 text-chess-danger' : ''}
									{isDraw ? 'bg-chess-gray/20 text-chess-gray' : ''}
								">
									{#if won}
										<span class="text-xl">✓</span>
									{:else if isDraw}
										<span class="text-xl">=</span>
									{:else}
										<span class="text-xl">✗</span>
									{/if}
								</div>

								<!-- Game info -->
								<div class="flex-1 min-w-0">
									<div class="flex items-center gap-2 mb-1">
										<span class="font-medium">
											{won ? 'Won' : isDraw ? 'Draw' : 'Lost'} vs {truncateAddress(opponent)}
										</span>
									</div>
									<div class="text-chess-gray text-sm">
										Played as {isWhite ? 'White' : 'Black'} · {game.betting} ETH
									</div>
								</div>

								<!-- ETH result -->
								<div class="text-right">
									{#if won}
										<span class="text-chess-success font-medium">+{game.betting} ETH</span>
									{:else if isDraw}
										<span class="text-chess-gray">0 ETH</span>
									{:else}
										<span class="text-chess-danger font-medium">-{game.betting} ETH</span>
									{/if}
								</div>

								<span class="text-chess-accent">→</span>
							</a>
						{/each}
					</div>
				{/if}
			</div>

			<!-- NFT Collection (Placeholder) -->
			<div class="card mt-6">
				<h2 class="font-display text-xl mb-6">NFT Collection</h2>
				<div class="text-center py-8">
					<div class="text-4xl mb-4 opacity-50">🏆</div>
					<p class="text-chess-gray">Victory NFTs will appear here</p>
					<p class="text-chess-gray/60 text-sm mt-2">Win games to mint unique NFTs</p>
				</div>
			</div>
		{/if}
	</div>
</section>
