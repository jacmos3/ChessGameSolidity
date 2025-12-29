<script>
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { activeGame } from '$lib/stores/game.js';
	import { wallet, truncateAddress, explorer } from '$lib/stores/wallet.js';
	import ChessBoard from '$lib/components/ChessBoard.svelte';

	$: address = $page.params.address;

	let actionLoading = false;
	let actionError = null;
	let actionSuccess = null;
	let showResignModal = false;
	let showPromotionModal = false;
	let promotionMoveData = null;
	let pendingMove = null;
	let errorTimeout = null;

	// Promotion pieces: Queen, Rook, Bishop, Knight
	const promotionPieces = [
		{ value: 5, symbol: '♛', name: 'Queen' },
		{ value: 4, symbol: '♜', name: 'Rook' },
		{ value: 3, symbol: '♝', name: 'Bishop' },
		{ value: 2, symbol: '♞', name: 'Knight' }
	];

	// Auto-dismiss minor errors after 3 seconds
	function setError(message) {
		actionError = message;
		if (errorTimeout) clearTimeout(errorTimeout);

		// Auto-dismiss for cancelled transactions
		if (message === 'Transaction cancelled') {
			errorTimeout = setTimeout(() => {
				actionError = null;
			}, 3000);
		}
	}

	onMount(() => {
		activeGame.load(address);
		return () => {
			activeGame.clear();
			if (errorTimeout) clearTimeout(errorTimeout);
		};
	});

	// Reload when address changes
	$: if (address) {
		activeGame.load(address);
	}

	// Reload when wallet account changes (user switched accounts)
	let previousAccount = null;
	$: if ($wallet.account && $wallet.account !== previousAccount) {
		previousAccount = $wallet.account;
		if (address && previousAccount !== null) {
			activeGame.load(address);
		}
	}

	$: data = $activeGame.data;
	$: canMove = data?.stateInfo.isActive && data?.isMyTurn && data?.playerRole !== 'spectator';
	$: canJoin = data?.stateInfo.canJoin && data?.playerRole === 'spectator';
	$: canResign = data?.stateInfo.isActive && data?.playerRole !== 'spectator';
	$: canClaim = (data?.state === 3) ||
		(data?.state === 4 && data?.playerRole === 'white') ||
		(data?.state === 5 && data?.playerRole === 'black');

	// Move history from contract events
	$: moveHistory = data?.moveHistory || [];

	// Parse error messages to be more user-friendly
	function parseError(err) {
		const message = err?.message || err?.reason || String(err);

		// User rejected transaction
		if (message.includes('user rejected') || message.includes('User denied') || message.includes('rejected')) {
			return 'Transaction cancelled';
		}
		// Insufficient funds
		if (message.includes('insufficient funds')) {
			return 'Insufficient ETH balance';
		}
		// Contract revert errors
		if (message.includes('revert')) {
			// Try to extract the revert reason
			const match = message.match(/reason="([^"]+)"/);
			if (match) return match[1];
			const match2 = message.match(/reverted with reason string '([^']+)'/);
			if (match2) return match2[1];
		}
		// Gas estimation failed
		if (message.includes('gas')) {
			return 'Transaction failed - invalid move?';
		}
		// Truncate long messages
		if (message.length > 100) {
			return message.substring(0, 100) + '...';
		}
		return message || 'Transaction failed';
	}

	async function handleMove(e) {
		const { from, to } = e.detail;
		actionError = null;
		actionSuccess = null;

		const piece = data.board[from.row][from.col];

		// Check for pawn promotion
		if (activeGame.isPawnPromotion(from.row, from.col, to.row)) {
			// Store move data and show promotion modal
			promotionMoveData = { from, to, piece };
			showPromotionModal = true;
			return;
		}

		// Execute normal move
		await executeMove(from, to, 0);
	}

	async function handlePromotion(promotionValue) {
		showPromotionModal = false;
		if (!promotionMoveData) return;

		const { from, to, piece } = promotionMoveData;
		// For black pieces, use negative value
		const actualValue = piece < 0 ? -promotionValue : promotionValue;

		await executeMove(from, to, actualValue);
		promotionMoveData = null;
	}

	function cancelPromotion() {
		showPromotionModal = false;
		promotionMoveData = null;
	}

	async function executeMove(from, to, promotionPiece) {
		actionLoading = true;
		const piece = data.board[from.row][from.col];
		pendingMove = { from, to, piece };

		try {
			await activeGame.makeMove(from.row, from.col, to.row, to.col, promotionPiece);
			actionSuccess = 'Move executed!';
			// The optimistic update already applied, reload just to confirm state
			await activeGame.load(address);
		} catch (err) {
			console.error('Move error:', err);
			setError(parseError(err));
		}

		pendingMove = null;
		actionLoading = false;
	}

	async function handleJoin() {
		actionLoading = true;
		actionError = null;

		try {
			await activeGame.joinGame();
			actionSuccess = 'Joined as Black!';
			await activeGame.load(address);
		} catch (err) {
			console.error('Join error:', err);
			setError(parseError(err));
		}

		actionLoading = false;
	}

	async function handleResign() {
		showResignModal = false;
		actionLoading = true;
		actionError = null;

		try {
			await activeGame.resign();
			actionSuccess = 'You resigned';
			await activeGame.load(address);
		} catch (err) {
			console.error('Resign error:', err);
			setError(parseError(err));
		}

		actionLoading = false;
	}

	async function handleClaimPrize() {
		actionLoading = true;
		actionError = null;

		try {
			await activeGame.claimPrize();
			actionSuccess = 'Prize claimed!';
			await activeGame.load(address);
		} catch (err) {
			console.error('Claim error:', err);
			setError(parseError(err));
		}

		actionLoading = false;
	}

	function copyGameLink() {
		navigator.clipboard.writeText(window.location.href);
		actionSuccess = 'Link copied!';
		setTimeout(() => actionSuccess = null, 2000);
	}

	function copyAddress() {
		navigator.clipboard.writeText(address);
		actionSuccess = 'Contract address copied!';
		setTimeout(() => actionSuccess = null, 2000);
	}

	const stateColors = {
		blue: 'bg-chess-blue',
		success: 'bg-chess-success',
		gray: 'bg-chess-gray',
		accent: 'bg-chess-accent',
		purple: 'bg-chess-purple'
	};
</script>

<svelte:head>
	<title>Game - Solidity Chess</title>
</svelte:head>

<section class="py-4 px-4 min-h-[calc(100vh-8rem)]">
	<div class="max-w-7xl mx-auto">
		{#if $activeGame.loading && !data}
			<!-- Loading state -->
			<div class="flex items-center justify-center py-20">
				<div class="text-center">
					<div class="text-6xl mb-4 animate-pulse">♞</div>
					<p class="text-chess-gray">Loading game...</p>
				</div>
			</div>

		{:else if $activeGame.error}
			<!-- Error state -->
			<div class="card max-w-md mx-auto text-center">
				<div class="text-5xl text-chess-danger mb-4">✕</div>
				<p class="text-chess-danger mb-4">{$activeGame.error}</p>
				<a href="/lobby" class="btn btn-secondary">Back to Lobby</a>
			</div>

		{:else if data}
			<!-- Game layout -->
			<div class="grid grid-cols-1 lg:grid-cols-[1fr,350px] gap-6">
				<!-- Left: Board area -->
				<div>
					<!-- Header -->
					<div class="flex items-center justify-between mb-4">
						<a href="/lobby" class="text-chess-gray hover:text-white transition-colors flex items-center gap-2">
							<span>←</span>
							<span>Back to Lobby</span>
						</a>
						<div class="flex items-center gap-2">
							<button
								class="btn btn-secondary !px-3 !py-1.5 text-sm"
								on:click={copyGameLink}
							>
								Share
							</button>
							<button
								class="btn btn-secondary !px-3 !py-1.5 text-sm"
								on:click={() => activeGame.load(address)}
								disabled={$activeGame.loading}
							>
								{$activeGame.loading ? '...' : 'Refresh'}
							</button>
						</div>
					</div>

					<!-- Messages -->
					{#if actionError}
						{@const isCancelled = actionError === 'Transaction cancelled'}
						<div class="rounded-lg p-3 mb-4 flex items-center gap-3
							{isCancelled ? 'bg-chess-gray/10 border border-chess-gray/30' : 'bg-chess-danger/10 border border-chess-danger/30'}">
							<span class="text-lg {isCancelled ? 'text-chess-gray' : 'text-chess-danger'}">
								{isCancelled ? '↩' : '⚠'}
							</span>
							<p class="flex-1 text-sm {isCancelled ? 'text-chess-gray' : 'text-chess-danger'}">
								{actionError}
							</p>
							<button on:click={() => actionError = null} class="text-chess-gray hover:text-white text-sm">✕</button>
						</div>
					{/if}

					{#if actionSuccess}
						<div class="bg-chess-success/10 border border-chess-success/30 rounded-lg p-3 mb-4 flex items-center gap-3">
							<span class="text-lg text-chess-success">✓</span>
							<p class="flex-1 text-chess-success text-sm">{actionSuccess}</p>
							<button on:click={() => actionSuccess = null} class="text-chess-gray hover:text-white text-sm">✕</button>
						</div>
					{/if}

					<!-- Turn indicator -->
					{#if data.stateInfo.isActive}
						<div class="mb-4 py-3 px-4 rounded-lg text-center font-medium {data.isMyTurn ? 'bg-chess-success text-white' : 'bg-chess-gray/20 text-chess-gray'}">
							{#if data.isMyTurn}
								Your Turn - Make your move!
							{:else}
								Waiting for opponent...
							{/if}
						</div>
					{/if}

					<!-- Pending move indicator -->
					{#if actionLoading && pendingMove}
						<div class="mb-4 py-2 px-4 rounded-lg text-center text-chess-accent bg-chess-accent/10 animate-pulse">
							Waiting for transaction confirmation...
						</div>
					{/if}

					<!-- Chess Board -->
					<div class="flex justify-center">
						<ChessBoard
							board={data.board}
							orientation={data.playerRole === 'black' ? 'black' : 'white'}
							interactive={canMove && !actionLoading}
							{pendingMove}
							on:move={handleMove}
						/>
					</div>

					<!-- Mobile: Action buttons -->
					<div class="lg:hidden mt-6 flex flex-wrap justify-center gap-3">
						{#if canJoin}
							<button class="btn btn-primary" on:click={handleJoin} disabled={actionLoading}>
								Join ({data.betting} ETH)
							</button>
						{/if}
						{#if canResign}
							<button class="btn btn-danger" on:click={() => showResignModal = true} disabled={actionLoading}>
								Resign
							</button>
						{/if}
						{#if canClaim}
							<button class="btn btn-primary" on:click={handleClaimPrize} disabled={actionLoading}>
								Claim Prize
							</button>
						{/if}
					</div>
				</div>

				<!-- Right: Side panel -->
				<div class="space-y-4">
					<!-- Game Info Card -->
					<div class="card">
						<div class="flex items-center justify-between mb-4">
							<span class="text-chess-gray text-sm">Game #{truncateAddress(address)}</span>
							<span class="px-2 py-1 rounded text-xs font-medium text-white {stateColors[data.stateInfo.color] || 'bg-chess-gray'}">
								{data.stateInfo.text}
							</span>
						</div>

						<!-- Prize Pool -->
						<div class="bg-chess-darker rounded-lg p-4 text-center mb-4">
							<div class="text-chess-gray text-sm mb-1">Prize Pool</div>
							<div class="font-display text-3xl text-chess-accent">
								{parseFloat(data.betting) * 2} ETH
							</div>
						</div>

						<!-- Players -->
						<div class="space-y-3">
							<!-- White Player -->
							<div class="flex items-center gap-3 p-3 rounded-lg {data.state === 1 ? 'bg-chess-accent/10 border border-chess-accent/30' : 'bg-chess-darker'}">
								<span class="text-2xl">♔</span>
								<div class="flex-1 min-w-0">
									<div class="text-xs text-chess-gray">White</div>
									<div class="truncate {data.whitePlayer.toLowerCase() === $wallet.account?.toLowerCase() ? 'text-chess-accent' : ''}">
										{truncateAddress(data.whitePlayer)}
										{#if data.whitePlayer.toLowerCase() === $wallet.account?.toLowerCase()}
											<span class="text-chess-accent text-xs">(You)</span>
										{/if}
									</div>
								</div>
								{#if data.state === 1}
									<span class="text-chess-accent text-xs">Turn</span>
								{/if}
							</div>

							<!-- Black Player -->
							<div class="flex items-center gap-3 p-3 rounded-lg {data.state === 2 ? 'bg-chess-accent/10 border border-chess-accent/30' : 'bg-chess-darker'}">
								<span class="text-2xl">♚</span>
								<div class="flex-1 min-w-0">
									<div class="text-xs text-chess-gray">Black</div>
									{#if data.blackPlayer === '0x0000000000000000000000000000000000000000'}
										<div class="text-chess-gray italic">Waiting for opponent...</div>
									{:else}
										<div class="truncate {data.blackPlayer.toLowerCase() === $wallet.account?.toLowerCase() ? 'text-chess-accent' : ''}">
											{truncateAddress(data.blackPlayer)}
											{#if data.blackPlayer.toLowerCase() === $wallet.account?.toLowerCase()}
												<span class="text-chess-accent text-xs">(You)</span>
											{/if}
										</div>
									{/if}
								</div>
								{#if data.state === 2}
									<span class="text-chess-accent text-xs">Turn</span>
								{/if}
							</div>
						</div>
					</div>

					<!-- Actions Card (Desktop) -->
					<div class="hidden lg:block card">
						<h3 class="font-display text-lg mb-4">Actions</h3>
						<div class="space-y-2">
							{#if canJoin}
								<button
									class="btn btn-primary w-full"
									on:click={handleJoin}
									disabled={actionLoading}
								>
									Join as Black ({data.betting} ETH)
								</button>
							{/if}

							{#if canResign}
								<button
									class="btn btn-danger w-full"
									on:click={() => showResignModal = true}
									disabled={actionLoading}
								>
									Resign
								</button>
							{/if}

							{#if canClaim}
								<button
									class="btn btn-primary w-full"
									on:click={handleClaimPrize}
									disabled={actionLoading}
								>
									Claim Prize ({parseFloat(data.betting) * 2} ETH)
								</button>
							{/if}

							{#if !canJoin && !canResign && !canClaim}
								<p class="text-chess-gray text-sm text-center py-2">
									{#if data.playerRole === 'spectator'}
										You are spectating this game
									{:else}
										No actions available
									{/if}
								</p>
							{/if}
						</div>
					</div>

					<!-- Move History Card -->
					<div class="card">
						<h3 class="font-display text-lg mb-4">Move History</h3>
						{#if moveHistory.length === 0}
							<p class="text-chess-gray text-sm text-center py-4">
								No moves yet
							</p>
						{:else}
							<div class="max-h-64 overflow-y-auto text-sm font-mono">
								{#each moveHistory as move, i}
									{#if move.isWhite}
										<div class="flex gap-2 py-1.5 px-2 {move.moveNumber % 2 === 1 ? 'bg-chess-darker/50' : ''} rounded">
											<span class="text-chess-gray w-6 flex-shrink-0">{move.moveNumber}.</span>
											<span class="w-16 flex-shrink-0" title={move.comment || ''}>{move.notation}</span>
											{#if moveHistory[i + 1] && !moveHistory[i + 1].isWhite}
												<span class="w-16 flex-shrink-0" title={moveHistory[i + 1].comment || ''}>{moveHistory[i + 1].notation}</span>
											{/if}
										</div>
									{/if}
								{/each}
							</div>
						{/if}
					</div>

					<!-- Contract Info Card -->
					<div class="card">
						<h3 class="font-display text-lg mb-4">On-Chain Info</h3>
						<div class="space-y-3">
							<!-- Contract Address -->
							<div>
								<div class="text-xs text-chess-gray mb-1">Game Contract</div>
								<div class="flex items-center gap-2">
									<code class="flex-1 text-xs bg-chess-darker px-2 py-1.5 rounded truncate font-mono">
										{address}
									</code>
									<button
										class="p-1.5 rounded hover:bg-chess-accent/20 transition-colors"
										on:click={copyAddress}
										title="Copy address"
									>
										<svg class="w-4 h-4 text-chess-gray" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
										</svg>
									</button>
								</div>
							</div>

							<!-- Explorer Link -->
							{#if $explorer}
								<a
									href="{$explorer}/address/{address}"
									target="_blank"
									rel="noopener noreferrer"
									class="flex items-center justify-center gap-2 w-full py-2 px-3 rounded-lg bg-chess-darker hover:bg-chess-accent/20 transition-colors text-sm"
								>
									<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
									</svg>
									View on Explorer
								</a>
							{:else}
								<div class="text-xs text-chess-gray text-center py-2">
									Local network - no explorer available
								</div>
							{/if}

							<!-- Verify Note -->
							<p class="text-xs text-chess-gray/60 text-center pt-2 border-t border-chess-accent/10">
								Every move is recorded on-chain. Verify the game state directly on the blockchain.
							</p>
						</div>
					</div>
				</div>
			</div>
		{/if}
	</div>
</section>

<!-- Resign Modal -->
{#if showResignModal}
	<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
	<div
		class="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
		on:click|self={() => showResignModal = false}
	>
		<div class="card max-w-sm w-full text-center">
			<h3 class="font-display text-xl mb-4">Confirm Resignation</h3>
			<p class="text-chess-gray mb-6">
				Are you sure? You will lose {data?.betting || 0} ETH.
			</p>
			<div class="flex justify-center gap-3">
				<button class="btn btn-secondary" on:click={() => showResignModal = false}>
					Cancel
				</button>
				<button class="btn btn-danger" on:click={handleResign}>
					Resign
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Pawn Promotion Modal -->
{#if showPromotionModal}
	<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
	<div
		class="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
		on:click|self={cancelPromotion}
	>
		<div class="card max-w-sm w-full text-center">
			<h3 class="font-display text-xl mb-4">Promote Pawn</h3>
			<p class="text-chess-gray mb-6">Choose a piece for promotion:</p>
			<div class="grid grid-cols-4 gap-3 mb-4">
				{#each promotionPieces as piece}
					<button
						class="aspect-square rounded-lg bg-chess-darker hover:bg-chess-accent/20 border border-chess-accent/20 hover:border-chess-accent transition-all flex flex-col items-center justify-center gap-1"
						on:click={() => handlePromotion(piece.value)}
					>
						<span class="text-4xl {promotionMoveData?.piece > 0 ? 'text-white' : 'text-chess-gray'}">{piece.symbol}</span>
						<span class="text-xs text-chess-gray">{piece.name}</span>
					</button>
				{/each}
			</div>
			<button class="btn btn-secondary w-full" on:click={cancelPromotion}>
				Cancel
			</button>
		</div>
	</div>
{/if}
