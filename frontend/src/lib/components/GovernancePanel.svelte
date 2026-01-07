<script>
	import { onMount } from 'svelte';
	import { wallet, truncateAddress } from '$lib/stores/wallet.js';
	import {
		governance,
		governanceAvailable,
		ProposalState,
		VoteType,
		getProposalStateLabel,
		getProposalStateColor,
		formatTimelockDelay,
		formatBlocks
	} from '$lib/stores/governance.js';

	let activeTab = 'overview'; // 'overview' | 'delegate' | 'proposals'
	let delegateAddress = '';
	let processing = false;
	let error = null;
	let success = null;

	onMount(async () => {
		if ($wallet.connected && $governanceAvailable) {
			await governance.fetchParams();
		}
	});

	$: if ($wallet.connected && $governanceAvailable) {
		governance.fetchParams();
	}

	async function handleSelfDelegate() {
		processing = true;
		error = null;
		success = null;

		try {
			await governance.selfDelegate();
			success = 'Voting power activated! You can now vote on proposals.';
		} catch (err) {
			error = err.message || 'Failed to delegate';
		}

		processing = false;
	}

	async function handleDelegate() {
		if (!delegateAddress || !delegateAddress.startsWith('0x')) {
			error = 'Enter a valid address';
			return;
		}

		processing = true;
		error = null;
		success = null;

		try {
			await governance.delegate(delegateAddress);
			success = `Delegated voting power to ${truncateAddress(delegateAddress)}`;
			delegateAddress = '';
		} catch (err) {
			error = err.message || 'Failed to delegate';
		}

		processing = false;
	}

	// Check if user needs to delegate
	$: needsDelegate = $governance.delegates === '0x0000000000000000000000000000000000000000';
	$: isSelfDelegated = $governance.delegates?.toLowerCase() === $wallet.account?.toLowerCase();
</script>

<div class="card">
	<div class="p-4 border-b border-chess-accent/10">
		<div class="flex items-center justify-between">
			<h3 class="font-display text-lg flex items-center gap-2">
				<span class="text-chess-accent">*</span>
				Governance
			</h3>
			{#if parseFloat($governance.votingPower) > 0}
				<span class="px-2 py-1 bg-chess-success/20 text-chess-success text-xs rounded">
					{parseFloat($governance.votingPower).toFixed(0)} VOTES
				</span>
			{/if}
		</div>
	</div>

	{#if !$governanceAvailable}
		<div class="p-6 text-center text-chess-gray">
			<p>Governance is not available on this network.</p>
		</div>
	{:else if $governance.loading && !$governance.votingDelay}
		<div class="p-6 text-center text-chess-gray">
			<div class="animate-pulse">Loading governance data...</div>
		</div>
	{:else}
		<!-- Voting Power Banner -->
		{#if needsDelegate}
			<div class="p-4 bg-chess-accent/10 border-b border-chess-accent/20">
				<div class="flex items-center gap-3">
					<span class="text-2xl">!</span>
					<div class="flex-1">
						<div class="font-medium text-sm">Activate Your Voting Power</div>
						<div class="text-xs text-chess-gray">
							Delegate to yourself to participate in governance
						</div>
					</div>
					<button
						class="btn btn-primary !px-3 !py-1.5 text-sm"
						on:click={handleSelfDelegate}
						disabled={processing}
					>
						{processing ? 'Activating...' : 'Activate'}
					</button>
				</div>
			</div>
		{/if}

		<!-- Stats Overview -->
		<div class="p-4 bg-chess-darker/30 border-b border-chess-accent/10">
			<div class="grid grid-cols-2 md:grid-cols-4 gap-4">
				<div>
					<div class="text-xs text-chess-gray uppercase tracking-wide mb-1">Your Voting Power</div>
					<div class="font-display text-lg text-chess-accent">
						{parseFloat($governance.votingPower).toFixed(0)}
					</div>
				</div>
				<div>
					<div class="text-xs text-chess-gray uppercase tracking-wide mb-1">Quorum</div>
					<div class="font-display text-lg">
						{parseFloat($governance.quorum).toFixed(0)} CHESS
					</div>
				</div>
				<div>
					<div class="text-xs text-chess-gray uppercase tracking-wide mb-1">Voting Period</div>
					<div class="font-display text-lg">
						{formatBlocks($governance.votingPeriod)}
					</div>
				</div>
				<div>
					<div class="text-xs text-chess-gray uppercase tracking-wide mb-1">Timelock</div>
					<div class="font-display text-lg">
						{formatTimelockDelay($governance.timelockDelay)}
					</div>
				</div>
			</div>

			{#if $governance.delegates && !needsDelegate}
				<div class="mt-3 pt-3 border-t border-chess-accent/10 text-sm">
					<span class="text-chess-gray">Delegated to:</span>
					<span class="ml-1 font-mono">
						{isSelfDelegated ? 'Self' : truncateAddress($governance.delegates)}
					</span>
				</div>
			{/if}
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
					{activeTab === 'delegate' ? 'text-chess-accent border-b-2 border-chess-accent' : 'text-chess-gray hover:text-chess-light'}"
				on:click={() => { activeTab = 'delegate'; error = null; success = null; }}
			>
				Delegate
			</button>
			<button
				class="flex-1 py-3 text-sm font-medium transition-colors
					{activeTab === 'proposals' ? 'text-chess-accent border-b-2 border-chess-accent' : 'text-chess-gray hover:text-chess-light'}"
				on:click={() => { activeTab = 'proposals'; error = null; success = null; }}
			>
				Proposals
			</button>
		</div>

		<!-- Tab Content -->
		<div class="p-4">
			{#if activeTab === 'overview'}
				<div class="space-y-4 text-sm">
					<div>
						<h4 class="font-medium mb-2">How Governance Works</h4>
						<ul class="text-chess-gray space-y-1 list-disc list-inside">
							<li>Hold CHESS tokens and delegate to activate voting</li>
							<li>Create proposals if you have {parseFloat($governance.proposalThreshold).toFixed(0)}+ CHESS</li>
							<li>Vote on active proposals (For/Against/Abstain)</li>
							<li>Successful proposals are queued in timelock</li>
							<li>After {formatTimelockDelay($governance.timelockDelay)}, anyone can execute</li>
						</ul>
					</div>

					<div>
						<h4 class="font-medium mb-2">Governable Parameters</h4>
						<ul class="text-chess-gray space-y-1 list-disc list-inside">
							<li>Bond ratios (CHESS and ETH multipliers)</li>
							<li>Challenge deposit amount</li>
							<li>Voting periods and quorum</li>
							<li>Platform fee percentage</li>
							<li>Arbitrator tier thresholds</li>
						</ul>
					</div>

					<div>
						<h4 class="font-medium mb-2">Requirements</h4>
						<div class="bg-chess-darker/50 rounded-lg p-3 space-y-2">
							<div class="flex justify-between">
								<span class="text-chess-gray">Proposal Threshold:</span>
								<span>{parseFloat($governance.proposalThreshold).toFixed(0)} CHESS</span>
							</div>
							<div class="flex justify-between">
								<span class="text-chess-gray">Quorum (4%):</span>
								<span>{parseFloat($governance.quorum).toFixed(0)} CHESS</span>
							</div>
							<div class="flex justify-between">
								<span class="text-chess-gray">Voting Delay:</span>
								<span>{formatBlocks($governance.votingDelay)}</span>
							</div>
							<div class="flex justify-between">
								<span class="text-chess-gray">Voting Period:</span>
								<span>{formatBlocks($governance.votingPeriod)}</span>
							</div>
						</div>
					</div>
				</div>

			{:else if activeTab === 'delegate'}
				<div class="space-y-4">
					<p class="text-sm text-chess-gray">
						Delegate your voting power to yourself or another address.
						Delegating doesn't transfer tokens, only voting rights.
					</p>

					<!-- Self delegate button -->
					<div class="bg-chess-darker/50 rounded-lg p-4">
						<div class="flex items-center justify-between">
							<div>
								<div class="font-medium">Self-Delegate</div>
								<div class="text-xs text-chess-gray">Vote on proposals yourself</div>
							</div>
							<button
								class="btn btn-primary !px-4 !py-2"
								on:click={handleSelfDelegate}
								disabled={processing || isSelfDelegated}
							>
								{#if isSelfDelegated}
									Active
								{:else}
									{processing ? 'Delegating...' : 'Delegate to Self'}
								{/if}
							</button>
						</div>
					</div>

					<!-- Delegate to another address -->
					<div class="space-y-3">
						<label class="text-sm">Or delegate to another address:</label>
						<input
							type="text"
							bind:value={delegateAddress}
							class="input"
							placeholder="0x..."
							disabled={processing}
						/>
						<button
							class="btn btn-secondary w-full"
							on:click={handleDelegate}
							disabled={processing || !delegateAddress}
						>
							{processing ? 'Delegating...' : 'Delegate'}
						</button>
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
				</div>

			{:else if activeTab === 'proposals'}
				<div class="space-y-4">
					<p class="text-sm text-chess-gray">
						Active and recent governance proposals will appear here.
					</p>

					<!-- Placeholder for proposals list -->
					<div class="text-center py-8">
						<div class="text-4xl mb-4 opacity-50">*</div>
						<p class="text-chess-gray">No active proposals</p>
						<p class="text-chess-gray/60 text-sm mt-2">
							Proposals can be created via the governance forum
						</p>
					</div>

					<!-- Create proposal info -->
					{#if parseFloat($governance.votingPower) >= parseFloat($governance.proposalThreshold)}
						<div class="bg-chess-accent/10 rounded-lg p-4 text-sm">
							<div class="font-medium mb-2">You can create proposals!</div>
							<p class="text-chess-gray">
								You have enough voting power to create governance proposals.
								Visit the governance forum to discuss and submit proposals.
							</p>
						</div>
					{:else}
						<div class="text-xs text-chess-gray text-center">
							Need {parseFloat($governance.proposalThreshold).toFixed(0)} CHESS voting power to create proposals
						</div>
					{/if}
				</div>
			{/if}
		</div>
	{/if}
</div>
