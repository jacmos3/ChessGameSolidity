<script>
	import { onMount } from 'svelte';
	import { wallet } from '$lib/stores/wallet.js';
	import { arbitrator, arbitratorAvailable } from '$lib/stores/dispute.js';
	import { bonding } from '$lib/stores/bonding.js';

	let activeTab = 'overview'; // 'overview' | 'stake' | 'unstake'
	let stakeAmount = '';
	let unstakeAmount = '';
	let processing = false;
	let error = null;
	let success = null;

	onMount(async () => {
		if ($wallet.connected && $arbitratorAvailable) {
			await arbitrator.fetchData();
		}
	});

	$: if ($wallet.connected && $arbitratorAvailable) {
		arbitrator.fetchData();
	}

	async function handleStake() {
		if (!stakeAmount || parseFloat(stakeAmount) <= 0) {
			error = 'Enter an amount to stake';
			return;
		}

		processing = true;
		error = null;
		success = null;

		try {
			await arbitrator.stake(stakeAmount);
			success = `Staked ${stakeAmount} CHESS as arbitrator`;
			stakeAmount = '';
			// Refresh bonding data too
			bonding.fetchBondData();
		} catch (err) {
			error = err.message || 'Failed to stake';
		}

		processing = false;
	}

	async function handleUnstake() {
		if (!unstakeAmount || parseFloat(unstakeAmount) <= 0) {
			error = 'Enter an amount to unstake';
			return;
		}

		processing = true;
		error = null;
		success = null;

		try {
			await arbitrator.unstake(unstakeAmount);
			success = `Unstaked ${unstakeAmount} CHESS`;
			unstakeAmount = '';
			bonding.fetchBondData();
		} catch (err) {
			error = err.message || 'Failed to unstake';
		}

		processing = false;
	}

	function setMaxStake() {
		// Use available CHESS balance from bonding store
		stakeAmount = $bonding.chessBalance;
	}

	function setMaxUnstake() {
		unstakeAmount = $arbitrator.stakedAmount;
	}

	// Get tier name
	function getTierName(tier) {
		switch (tier) {
			case 1: return 'Bronze';
			case 2: return 'Silver';
			case 3: return 'Gold';
			default: return 'None';
		}
	}

	// Get tier color
	function getTierColor(tier) {
		switch (tier) {
			case 1: return 'text-amber-600';
			case 2: return 'text-gray-400';
			case 3: return 'text-yellow-500';
			default: return 'text-chess-gray';
		}
	}
</script>

<div class="card">
	<div class="p-4 border-b border-chess-accent/10">
		<div class="flex items-center justify-between">
			<h3 class="font-display text-lg flex items-center gap-2">
				<span class="text-chess-accent">*</span>
				Arbitrator Program
			</h3>
			{#if $arbitrator.isArbitrator}
				<span class="px-2 py-1 bg-chess-success/20 text-chess-success text-xs rounded">
					ACTIVE
				</span>
			{/if}
		</div>
	</div>

	{#if !$arbitratorAvailable}
		<div class="p-6 text-center text-chess-gray">
			<p>Arbitrator program is not available on this network.</p>
		</div>
	{:else if $arbitrator.loading && !$arbitrator.isArbitrator}
		<div class="p-6 text-center text-chess-gray">
			<div class="animate-pulse">Loading arbitrator data...</div>
		</div>
	{:else}
		<!-- Stats Overview -->
		<div class="p-4 bg-chess-darker/30 border-b border-chess-accent/10">
			{#if $arbitrator.isArbitrator}
				<!-- User is arbitrator - show their stats -->
				<div class="grid grid-cols-2 md:grid-cols-4 gap-4">
					<div>
						<div class="text-xs text-chess-gray uppercase tracking-wide mb-1">Staked</div>
						<div class="font-display text-lg text-chess-accent">
							{parseFloat($arbitrator.stakedAmount).toFixed(0)} CHESS
						</div>
					</div>
					<div>
						<div class="text-xs text-chess-gray uppercase tracking-wide mb-1">Tier</div>
						<div class="font-display text-lg {getTierColor($arbitrator.tier)}">
							{getTierName($arbitrator.tier)}
						</div>
					</div>
					<div>
						<div class="text-xs text-chess-gray uppercase tracking-wide mb-1">Reputation</div>
						<div class="font-display text-lg">
							{$arbitrator.reputation}
						</div>
					</div>
					<div>
						<div class="text-xs text-chess-gray uppercase tracking-wide mb-1">Voting Power</div>
						<div class="font-display text-lg">
							{parseFloat($arbitrator.votingPower).toFixed(0)}
						</div>
					</div>
				</div>

				<div class="mt-3 pt-3 border-t border-chess-accent/10">
					<div class="flex items-center gap-2 text-sm">
						<span class="text-chess-gray">Status:</span>
						{#if $arbitrator.canVoteNow}
							<span class="text-chess-success">Can vote on disputes</span>
						{:else}
							<span class="text-chess-danger">Cannot vote (cooldown or pending activation)</span>
						{/if}
					</div>
				</div>
			{:else}
				<!-- User is not arbitrator - show benefits -->
				<div class="text-center py-2">
					<p class="text-chess-gray mb-3">
						Stake CHESS to become an arbitrator and earn rewards for voting on disputes.
					</p>
					<div class="grid grid-cols-3 gap-2 text-sm">
						<div class="bg-chess-darker/50 rounded p-2">
							<div class="text-amber-600 font-medium">Bronze</div>
							<div class="text-chess-gray text-xs">{$arbitrator.tier1Min}+ CHESS</div>
						</div>
						<div class="bg-chess-darker/50 rounded p-2">
							<div class="text-gray-400 font-medium">Silver</div>
							<div class="text-chess-gray text-xs">{$arbitrator.tier2Min}+ CHESS</div>
						</div>
						<div class="bg-chess-darker/50 rounded p-2">
							<div class="text-yellow-500 font-medium">Gold</div>
							<div class="text-chess-gray text-xs">{$arbitrator.tier3Min}+ CHESS</div>
						</div>
					</div>
				</div>
			{/if}
		</div>

		<!-- Registry Stats -->
		<div class="p-4 border-b border-chess-accent/10 bg-chess-darker/20">
			<div class="text-xs text-chess-gray uppercase tracking-wide mb-2">Registry Stats</div>
			<div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
				<div>
					<span class="text-chess-gray">Total Arbitrators:</span>
					<span class="ml-1 font-medium">{$arbitrator.totalArbitrators}</span>
				</div>
				<div>
					<span class="text-chess-gray">Total Staked:</span>
					<span class="ml-1 font-medium">{parseFloat($arbitrator.totalStaked).toFixed(0)} CHESS</span>
				</div>
				<div class="col-span-2">
					<span class="text-chess-gray">By Tier:</span>
					<span class="ml-1">
						<span class="text-amber-600">{$arbitrator.tierCounts.t1}</span> /
						<span class="text-gray-400">{$arbitrator.tierCounts.t2}</span> /
						<span class="text-yellow-500">{$arbitrator.tierCounts.t3}</span>
					</span>
				</div>
			</div>
		</div>

		<!-- Tabs -->
		<div class="flex border-b border-chess-accent/10">
			<button
				class="flex-1 py-3 text-sm font-medium transition-colors
					{activeTab === 'overview' ? 'text-chess-accent border-b-2 border-chess-accent' : 'text-chess-gray hover:text-chess-light'}"
				on:click={() => { activeTab = 'overview'; error = null; success = null; }}
			>
				Info
			</button>
			<button
				class="flex-1 py-3 text-sm font-medium transition-colors
					{activeTab === 'stake' ? 'text-chess-accent border-b-2 border-chess-accent' : 'text-chess-gray hover:text-chess-light'}"
				on:click={() => { activeTab = 'stake'; error = null; success = null; }}
			>
				Stake
			</button>
			{#if $arbitrator.isArbitrator}
				<button
					class="flex-1 py-3 text-sm font-medium transition-colors
						{activeTab === 'unstake' ? 'text-chess-accent border-b-2 border-chess-accent' : 'text-chess-gray hover:text-chess-light'}"
					on:click={() => { activeTab = 'unstake'; error = null; success = null; }}
				>
					Unstake
				</button>
			{/if}
		</div>

		<!-- Tab Content -->
		<div class="p-4">
			{#if activeTab === 'overview'}
				<div class="space-y-4 text-sm">
					<div>
						<h4 class="font-medium mb-2">How it works</h4>
						<ul class="text-chess-gray space-y-1 list-disc list-inside">
							<li>Stake CHESS to join the arbitrator pool</li>
							<li>7-day waiting period before you can vote</li>
							<li>Get selected randomly to vote on disputes</li>
							<li>Vote with the majority to earn reputation</li>
							<li>Higher reputation = more voting opportunities</li>
						</ul>
					</div>

					<div>
						<h4 class="font-medium mb-2">Rewards & Penalties</h4>
						<ul class="text-chess-gray space-y-1 list-disc list-inside">
							<li>Vote with majority: +1 reputation</li>
							<li>Vote against majority: -1 reputation</li>
							<li>Don't reveal vote: -1 reputation</li>
							<li>Reputation below 50: removed from pool</li>
						</ul>
					</div>

					<div>
						<h4 class="font-medium mb-2">Limits</h4>
						<ul class="text-chess-gray space-y-1 list-disc list-inside">
							<li>Max 5 disputes per week</li>
							<li>48h cooldown between votes</li>
							<li>Can't vote on games you participated in</li>
						</ul>
					</div>
				</div>

			{:else if activeTab === 'stake'}
				<div class="space-y-4">
					<div>
						<label class="flex justify-between text-sm mb-2">
							<span>CHESS Amount</span>
							<button
								class="text-chess-accent hover:underline text-xs"
								on:click={setMaxStake}
							>
								Max: {parseFloat($bonding.chessBalance).toFixed(2)}
							</button>
						</label>
						<input
							type="number"
							bind:value={stakeAmount}
							class="input"
							placeholder="1000"
							min="0"
							step="any"
							disabled={processing}
						/>
						<p class="text-xs text-chess-gray mt-1">
							Minimum: {$arbitrator.tier1Min} CHESS for Bronze tier
						</p>
					</div>

					{#if error}
						<div class="bg-chess-danger/10 border border-chess-danger/30 text-chess-danger rounded-lg p-3 text-sm">
							{error}
						</div>
					{/if}

					{#if success}
						<div class="bg-chess-success/10 border border-chess-success/30 text-chess-success rounded-lg p-3 text-sm">
							{success}
						</div>
					{/if}

					<button
						class="btn btn-primary w-full"
						on:click={handleStake}
						disabled={processing || !stakeAmount || parseFloat(stakeAmount) < parseFloat($arbitrator.tier1Min)}
					>
						{processing ? 'Staking...' : 'Stake CHESS'}
					</button>

					<p class="text-xs text-chess-gray text-center">
						Voting power activates 7 days after staking.
					</p>
				</div>

			{:else if activeTab === 'unstake'}
				<div class="space-y-4">
					<div>
						<label class="flex justify-between text-sm mb-2">
							<span>CHESS Amount</span>
							<button
								class="text-chess-accent hover:underline text-xs"
								on:click={setMaxUnstake}
							>
								Max: {parseFloat($arbitrator.stakedAmount).toFixed(2)}
							</button>
						</label>
						<input
							type="number"
							bind:value={unstakeAmount}
							class="input"
							placeholder="0"
							min="0"
							step="any"
							disabled={processing}
						/>
					</div>

					{#if error}
						<div class="bg-chess-danger/10 border border-chess-danger/30 text-chess-danger rounded-lg p-3 text-sm">
							{error}
						</div>
					{/if}

					{#if success}
						<div class="bg-chess-success/10 border border-chess-success/30 text-chess-success rounded-lg p-3 text-sm">
							{success}
						</div>
					{/if}

					<button
						class="btn btn-secondary w-full"
						on:click={handleUnstake}
						disabled={processing || !unstakeAmount || parseFloat(unstakeAmount) <= 0}
					>
						{processing ? 'Unstaking...' : 'Unstake CHESS'}
					</button>

					<p class="text-xs text-chess-gray text-center">
						Cannot unstake during vote cooldown (48h after voting).
					</p>
				</div>
			{/if}
		</div>
	{/if}
</div>
