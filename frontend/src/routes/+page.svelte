<script>
	import { wallet, isSupported, contractAddress, truncateAddress } from '$lib/stores/wallet.js';
	import { games } from '$lib/stores/game.js';
	import { leaderboard } from '$lib/stores/leaderboard.js';

	// Fetch games and leaderboard when wallet connects
	$: if ($wallet.connected && $isSupported && $contractAddress) {
		games.fetchGames();
		leaderboard.fetchLeaderboard();
	}

	// Separate games by user involvement
	$: myGames = $games.games.filter(g =>
		g.whitePlayer?.toLowerCase() === $wallet.account?.toLowerCase() ||
		g.blackPlayer?.toLowerCase() === $wallet.account?.toLowerCase()
	);

	$: myActiveGames = myGames.filter(g => g.state === 1 || g.state === 2);
	$: openGames = $games.games.filter(g => g.state === 1); // NotStarted = waiting for opponent
</script>

<svelte:head>
	<title>MyChess On Chain - On-Chain Chess Game</title>
</svelte:head>

{#if !$wallet.connected}
	<!-- Landing for non-connected users -->
	<section class="min-h-[calc(100vh-4rem)] flex items-center justify-center">
		<div class="absolute inset-0 bg-gradient-to-br from-chess-dark via-[#16213e] to-chess-darker -z-10"></div>
		<div class="absolute inset-0 opacity-[0.03] -z-10" style="background-image: linear-gradient(#e4a853 1px, transparent 1px), linear-gradient(90deg, #e4a853 1px, transparent 1px); background-size: 60px 60px;"></div>

		<div class="text-center px-4 max-w-2xl">
			<div class="text-8xl mb-6 filter drop-shadow-[0_4px_20px_rgba(228,168,83,0.3)]">♔</div>
			<h1 class="font-display text-5xl md:text-6xl font-bold mb-4">
				Play Chess <span class="text-chess-accent">On-Chain</span>
			</h1>
			<p class="text-chess-gray text-xl mb-10 max-w-xl mx-auto">
				Every move recorded on the blockchain. Bet ETH, challenge opponents, mint victory NFTs.
			</p>

			<button class="btn btn-primary text-lg px-8 py-4" on:click={wallet.connect}>
				Connect Wallet to Play
			</button>

			<div class="mt-16 flex justify-center gap-8 text-chess-gray">
				<div class="text-center">
					<div class="text-3xl font-display text-chess-accent">{$games.games.length || '0'}</div>
					<div class="text-sm">Games Played</div>
				</div>
				<div class="text-center">
					<div class="text-3xl font-display text-chess-accent">100%</div>
					<div class="text-sm">On-Chain</div>
				</div>
				<div class="text-center">
					<div class="text-3xl font-display text-chess-accent">NFT</div>
					<div class="text-sm">Victories</div>
				</div>
			</div>
		</div>
	</section>

{:else if !$isSupported}
	<!-- Wrong network -->
	<section class="min-h-[calc(100vh-4rem)] flex items-center justify-center">
		<div class="card max-w-md text-center">
			<div class="text-5xl text-yellow-500 mb-4">⚠</div>
			<h2 class="font-display text-2xl mb-4">Wrong Network</h2>
			<p class="text-chess-gray mb-6">
				Please switch to a supported network
			</p>
			<div class="flex flex-wrap justify-center gap-2">
				<span class="px-3 py-1 rounded bg-chess-accent/10 text-chess-accent text-sm">Sepolia</span>
				<span class="px-3 py-1 rounded bg-chess-accent/10 text-chess-accent text-sm">Holesky</span>
				<span class="px-3 py-1 rounded bg-chess-accent/10 text-chess-accent text-sm">Linea Sepolia</span>
				<span class="px-3 py-1 rounded bg-chess-accent/10 text-chess-accent text-sm">Localhost</span>
			</div>
		</div>
	</section>

{:else}
	<!-- Dashboard for connected users -->
	<section class="py-8 px-4">
		<div class="max-w-6xl mx-auto">

			<!-- Quick Actions -->
			<div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-12">
				<a href="/lobby?action=create" class="card group hover:border-chess-accent/50 cursor-pointer text-center py-8">
					<div class="text-5xl mb-4 group-hover:scale-110 transition-transform">♔</div>
					<h3 class="font-display text-xl mb-2">Create Game</h3>
					<p class="text-chess-gray text-sm">Start a new match with a custom bet</p>
				</a>

				<a href="/lobby" class="card group hover:border-chess-accent/50 cursor-pointer text-center py-8">
					<div class="text-5xl mb-4 group-hover:scale-110 transition-transform">♞</div>
					<h3 class="font-display text-xl mb-2">Join Game</h3>
					<p class="text-chess-gray text-sm">Browse {openGames.length} open games</p>
				</a>

				<a href="/lobby?filter=active" class="card group hover:border-chess-accent/50 cursor-pointer text-center py-8">
					<div class="text-5xl mb-4 group-hover:scale-110 transition-transform">👁</div>
					<h3 class="font-display text-xl mb-2">Watch Live</h3>
					<p class="text-chess-gray text-sm">Spectate ongoing matches</p>
				</a>
			</div>

			<div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
				<!-- Your Active Games -->
				<div class="lg:col-span-2">
					<div class="flex items-center justify-between mb-4">
						<h2 class="font-display text-xl">Your Games</h2>
						{#if myActiveGames.length > 0}
							<span class="bg-chess-accent text-chess-darker text-sm font-medium px-2 py-1 rounded">
								{myActiveGames.length} active
							</span>
						{/if}
					</div>

					{#if $games.loading && myActiveGames.length === 0}
						<div class="card animate-pulse">
							<div class="h-20 bg-white/5 rounded"></div>
						</div>
					{:else if myActiveGames.length === 0}
						<div class="card text-center py-12">
							<div class="text-4xl mb-4 opacity-50">♟</div>
							<p class="text-chess-gray">No active games</p>
							<a href="/lobby?action=create" class="btn btn-primary mt-4">Create Your First Game</a>
						</div>
					{:else}
						<div class="space-y-3">
							{#each myActiveGames as game (game.address)}
								{@const isWhite = game.whitePlayer?.toLowerCase() === $wallet.account?.toLowerCase()}
								{@const opponent = isWhite ? game.blackPlayer : game.whitePlayer}
								{@const isMyTurn = (game.state === 1 && isWhite) || (game.state === 2 && !isWhite)}

								<a href="/game/{game.address}" class="card flex items-center gap-4 hover:border-chess-accent/50 cursor-pointer !p-4">
									<div class="text-3xl">{isWhite ? '♔' : '♚'}</div>
									<div class="flex-1 min-w-0">
										<div class="flex items-center gap-2">
											<span class="font-medium">vs {truncateAddress(opponent)}</span>
											{#if isMyTurn}
												<span class="bg-chess-success text-white text-xs px-2 py-0.5 rounded animate-pulse">
													Your Turn
												</span>
											{:else}
												<span class="bg-chess-gray/30 text-chess-gray text-xs px-2 py-0.5 rounded">
													Waiting
												</span>
											{/if}
										</div>
										<div class="text-chess-gray text-sm">
											{game.betting} ETH · Playing as {isWhite ? 'White' : 'Black'}
										</div>
									</div>
									<div class="text-chess-accent">→</div>
								</a>
							{/each}
						</div>
					{/if}

					<!-- Recent completed games -->
					{#if myGames.filter(g => g.state >= 3).length > 0}
						<h3 class="font-display text-lg mt-8 mb-4 text-chess-gray">Recent Games</h3>
						<div class="space-y-2">
							{#each myGames.filter(g => g.state >= 3).slice(0, 3) as game (game.address)}
								{@const isWhite = game.whitePlayer?.toLowerCase() === $wallet.account?.toLowerCase()}
								{@const won = (game.state === 4 && isWhite) || (game.state === 5 && !isWhite)}

								<a href="/game/{game.address}" class="card flex items-center gap-4 !p-3 opacity-70 hover:opacity-100">
									<div class="w-8 h-8 rounded-full flex items-center justify-center {won ? 'bg-chess-success/20 text-chess-success' : 'bg-chess-danger/20 text-chess-danger'}">
										{won ? '✓' : '✗'}
									</div>
									<div class="flex-1">
										<span class="text-sm">{won ? 'Won' : 'Lost'} vs {truncateAddress(isWhite ? game.blackPlayer : game.whitePlayer)}</span>
									</div>
									<span class="text-sm {won ? 'text-chess-success' : 'text-chess-danger'}">
										{won ? '+' : '-'}{game.betting} ETH
									</span>
								</a>
							{/each}
						</div>
					{/if}
				</div>

				<!-- Sidebar -->
				<div class="space-y-6">
					<!-- Player Stats Card -->
					<div class="card">
						<h3 class="font-display text-lg mb-4">Your Stats</h3>
						<div class="grid grid-cols-2 gap-4 text-center">
							<div class="bg-chess-darker rounded-lg p-3">
								<div class="text-2xl font-display text-chess-accent">{myGames.length}</div>
								<div class="text-xs text-chess-gray">Games</div>
							</div>
							<div class="bg-chess-darker rounded-lg p-3">
								<div class="text-2xl font-display text-chess-success">{myGames.filter(g => (g.state === 4 && g.whitePlayer?.toLowerCase() === $wallet.account?.toLowerCase()) || (g.state === 5 && g.blackPlayer?.toLowerCase() === $wallet.account?.toLowerCase())).length}</div>
								<div class="text-xs text-chess-gray">Wins</div>
							</div>
						</div>
						<a href="/profile" class="btn btn-secondary w-full mt-4 text-sm">View Profile</a>
					</div>

					<!-- Leaderboard -->
					<div class="card">
						<h3 class="font-display text-lg mb-4">Leaderboard</h3>
						{#if $leaderboard.loading}
							<div class="text-center py-4">
								<span class="text-chess-gray text-sm animate-pulse">Loading...</span>
							</div>
						{:else if $leaderboard.players.length === 0}
							<p class="text-chess-gray text-sm text-center py-4">No completed games yet</p>
						{:else}
							<div class="space-y-3">
								{#each $leaderboard.players.slice(0, 5) as player, i}
									<div class="flex items-center gap-3">
										<div class="w-6 h-6 rounded-full flex items-center justify-center text-sm font-bold
											{i === 0 ? 'bg-yellow-500/20 text-yellow-500' : ''}
											{i === 1 ? 'bg-gray-400/20 text-gray-400' : ''}
											{i === 2 ? 'bg-orange-600/20 text-orange-600' : ''}
											{i > 2 ? 'bg-chess-darker text-chess-gray' : ''}
										">
											{i + 1}
										</div>
										<div class="flex-1 truncate text-sm">
											{truncateAddress(player.address)}
										</div>
										<div class="text-right">
											<div class="text-chess-accent font-medium text-sm">
												{player.wins}W/{player.losses}L
											</div>
											<div class="text-xs text-chess-gray">
												{player.winRatio}%
											</div>
										</div>
									</div>
								{/each}
							</div>
						{/if}
						<div class="border-t border-chess-accent/10 mt-4 pt-4 text-center">
							<span class="text-chess-gray text-xs">
								{#if $leaderboard.lastUpdated}
									Updated from on-chain data
								{:else}
									Connect wallet to load
								{/if}
							</span>
						</div>
					</div>

					<!-- Open Games Preview -->
					<div class="card">
						<div class="flex items-center justify-between mb-4">
							<h3 class="font-display text-lg">Open Games</h3>
							<span class="text-chess-accent text-sm">{openGames.length}</span>
						</div>
						{#if openGames.length === 0}
							<p class="text-chess-gray text-sm text-center py-4">No open games</p>
						{:else}
							<div class="space-y-2">
								{#each openGames.slice(0, 3) as game (game.address)}
									<a href="/game/{game.address}" class="flex items-center justify-between p-2 rounded-lg bg-chess-darker hover:bg-chess-dark transition-colors">
										<span class="text-sm">{truncateAddress(game.whitePlayer)}</span>
										<span class="text-chess-accent font-medium">{game.betting} ETH</span>
									</a>
								{/each}
							</div>
							{#if openGames.length > 3}
								<a href="/lobby" class="btn btn-secondary w-full mt-3 text-sm">
									View All {openGames.length} Games
								</a>
							{/if}
						{/if}
					</div>
				</div>
			</div>
		</div>
	</section>
{/if}
