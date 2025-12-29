<script>
	import { onMount, createEventDispatcher } from 'svelte';
	import { activeGame } from '$lib/stores/game.js';
	import { wallet, truncateAddress } from '$lib/stores/wallet.js';
	import ChessBoard from './ChessBoard.svelte';

	export let address;

	const dispatch = createEventDispatcher();

	let actionLoading = false;
	let actionError = null;
	let actionSuccess = null;
	let showResignModal = false;
	let pendingMove = null;

	onMount(() => {
		activeGame.load(address);
		return () => activeGame.clear();
	});

	$: data = $activeGame.data;
	$: canMove = data?.stateInfo.isActive && data?.isMyTurn && data?.playerRole !== 'spectator';
	$: canJoin = data?.stateInfo.canJoin && data?.playerRole === 'spectator';
	$: canResign = data?.stateInfo.isActive && data?.playerRole !== 'spectator';
	$: canClaim = (data?.state === 3) ||
		(data?.state === 4 && data?.playerRole === 'white') ||
		(data?.state === 5 && data?.playerRole === 'black');

	async function handleMove(e) {
		const { from, to } = e.detail;
		actionLoading = true;
		actionError = null;
		actionSuccess = null;

		// Get the piece being moved for optimistic update
		const piece = data.board[from.row][from.col];
		pendingMove = { from, to, piece };

		try {
			await activeGame.makeMove(from.row, from.col, to.row, to.col);
			actionSuccess = 'Move executed!';
			await activeGame.load(address);
		} catch (err) {
			actionError = err.message || 'Move failed';
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
			actionError = err.message || 'Failed to join';
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
			actionError = err.message || 'Failed to resign';
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
			actionError = err.message || 'Failed to claim prize';
		}

		actionLoading = false;
	}

	async function refresh() {
		await activeGame.load(address);
	}

	const colorMap = {
		blue: 'bg-chess-blue',
		success: 'bg-chess-success',
		gray: 'bg-chess-gray',
		accent: 'bg-chess-accent',
		purple: 'bg-chess-purple'
	};
</script>

<div class="max-w-4xl mx-auto">
	<!-- Header -->
	<div class="flex items-center justify-between mb-6">
		<button
			class="btn btn-secondary !px-4 !py-2 text-sm"
			on:click={() => dispatch('close')}
		>
			← Back
		</button>
		<button
			class="btn btn-secondary !px-4 !py-2 text-sm"
			on:click={refresh}
			disabled={$activeGame.loading}
		>
			{$activeGame.loading ? 'Loading...' : 'Refresh'}
		</button>
	</div>

	{#if $activeGame.loading && !data}
		<div class="card text-center py-12">
			<div class="text-4xl mb-4 animate-pulse">♞</div>
			<p class="text-chess-gray">Loading game...</p>
		</div>

	{:else if $activeGame.error}
		<div class="card bg-chess-danger/10 border-chess-danger/30 text-center">
			<p class="text-chess-danger">{$activeGame.error}</p>
		</div>

	{:else if data}
		<!-- Messages -->
		{#if actionError}
			<div class="card bg-chess-danger/10 border-chess-danger/30 mb-4 flex justify-between items-center">
				<p class="text-chess-danger">{actionError}</p>
				<button on:click={() => actionError = null} class="text-chess-gray hover:text-white">✕</button>
			</div>
		{/if}

		{#if actionSuccess}
			<div class="card bg-chess-success/10 border-chess-success/30 mb-4 flex justify-between items-center">
				<p class="text-chess-success">{actionSuccess}</p>
				<button on:click={() => actionSuccess = null} class="text-chess-gray hover:text-white">✕</button>
			</div>
		{/if}

		<!-- Game info panel -->
		<div class="card mb-6">
			<div class="flex items-center justify-between mb-4">
				<span class="font-display text-lg">
					Game #{truncateAddress(address)}
				</span>
				<span class="px-3 py-1 rounded-lg text-sm font-medium text-white {colorMap[data.stateInfo.color] || 'bg-chess-gray'}">
					{data.stateInfo.text}
				</span>
			</div>

			<div class="grid grid-cols-2 gap-4 text-sm">
				<div>
					<span class="text-chess-gray">White: </span>
					<span class="{data.whitePlayer.toLowerCase() === $wallet.account?.toLowerCase() ? 'text-chess-accent' : ''}">
						{truncateAddress(data.whitePlayer)}
						{#if data.whitePlayer.toLowerCase() === $wallet.account?.toLowerCase()}
							<span class="text-chess-accent">(You)</span>
						{/if}
					</span>
				</div>
				<div>
					<span class="text-chess-gray">Black: </span>
					{#if data.blackPlayer === '0x0000000000000000000000000000000000000000'}
						<span class="text-chess-gray">Waiting...</span>
					{:else}
						<span class="{data.blackPlayer.toLowerCase() === $wallet.account?.toLowerCase() ? 'text-chess-accent' : ''}">
							{truncateAddress(data.blackPlayer)}
							{#if data.blackPlayer.toLowerCase() === $wallet.account?.toLowerCase()}
								<span class="text-chess-accent">(You)</span>
							{/if}
						</span>
					{/if}
				</div>
				<div>
					<span class="text-chess-gray">Bet: </span>
					<span>{data.betting} ETH</span>
				</div>
				<div>
					<span class="text-chess-gray">Role: </span>
					<span class="capitalize">{data.playerRole}</span>
				</div>
			</div>

			{#if data.stateInfo.isActive}
				<div class="mt-4 py-3 rounded-lg text-center font-medium {data.isMyTurn ? 'bg-chess-success text-white' : 'bg-chess-gray/30'}">
					{data.isMyTurn ? "Your Turn - Drag a piece to move!" : "Opponent's Turn"}
				</div>
			{/if}
		</div>

		<!-- Chess board -->
		<div class="flex justify-center mb-6">
			<ChessBoard
				board={data.board}
				orientation={data.playerRole === 'black' ? 'black' : 'white'}
				interactive={canMove && !actionLoading}
				{pendingMove}
				on:move={handleMove}
			/>
		</div>

		<!-- Action loading -->
		{#if actionLoading && pendingMove}
			<div class="text-center text-chess-accent mb-4 animate-pulse">
				Waiting for transaction confirmation...
			</div>
		{:else if actionLoading}
			<div class="text-center text-chess-gray mb-4">
				Processing...
			</div>
		{/if}

		<!-- Actions -->
		<div class="flex justify-center gap-4 flex-wrap">
			{#if canJoin}
				<button
					class="btn btn-primary"
					on:click={handleJoin}
					disabled={actionLoading}
				>
					Join as Black ({data.betting} ETH)
				</button>
			{/if}

			{#if canResign}
				<button
					class="btn btn-danger"
					on:click={() => showResignModal = true}
					disabled={actionLoading}
				>
					Resign
				</button>
			{/if}

			{#if canClaim}
				<button
					class="btn btn-primary"
					on:click={handleClaimPrize}
					disabled={actionLoading}
				>
					Claim Prize ({parseFloat(data.betting) * 2} ETH)
				</button>
			{/if}
		</div>
	{/if}
</div>

<!-- Resign confirmation modal -->
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
				<button
					class="btn btn-secondary"
					on:click={() => showResignModal = false}
				>
					Cancel
				</button>
				<button
					class="btn btn-danger"
					on:click={handleResign}
				>
					Resign
				</button>
			</div>
		</div>
	</div>
{/if}
