<script>
	import { onMount } from 'svelte';
	import { wallet, truncateAddress } from '$lib/stores/wallet.js';
	import {
		dispute,
		disputeAvailable,
		DisputeState,
		Vote,
		formatTimeRemaining,
		getStateLabel,
		getVoteLabel
	} from '$lib/stores/dispute.js';

	export let gameId;
	export let whitePlayer = '';
	export let blackPlayer = '';
	export let gameState = 0; // Game state from contract

	let disputeData = null;
	let loading = false;
	let error = null;
	let success = null;

	// Challenge form
	let accusedPlayer = '';

	// Vote form
	let selectedVote = Vote.None;
	let voteSalt = '';
	let savedCommit = null; // Store commit locally for reveal

	onMount(async () => {
		if ($wallet.connected && $disputeAvailable) {
			await dispute.fetchParams();
			await loadDispute();
		}
	});

	$: if ($wallet.connected && $disputeAvailable && gameId) {
		loadDispute();
	}

	async function loadDispute() {
		loading = true;
		disputeData = await dispute.getDisputeByGame(gameId);
		loading = false;
	}

	// Check if game is finished and can be challenged
	$: canChallenge = gameState >= 3 && gameState <= 5 && // Draw, WhiteWin, BlackWin
		(!disputeData || disputeData.state === DisputeState.Pending);

	// Check if current user is a selected arbitrator
	$: isArbitrator = disputeData?.arbitrators?.some(
		a => a.toLowerCase() === $wallet.account?.toLowerCase()
	);

	// Current phase
	$: currentPhase = disputeData ? getPhase(disputeData) : null;

	function getPhase(d) {
		const now = Math.floor(Date.now() / 1000);
		if (d.state === DisputeState.Challenged) {
			if (now <= d.commitDeadline) return 'commit';
			return 'revealing';
		}
		if (d.state === DisputeState.Revealing) return 'reveal';
		return null;
	}

	async function handleChallenge() {
		if (!accusedPlayer) {
			error = 'Select a player to accuse';
			return;
		}

		loading = true;
		error = null;
		success = null;

		try {
			await dispute.challenge(gameId, accusedPlayer);
			success = 'Challenge submitted! Arbitrators will vote.';
			await loadDispute();
		} catch (err) {
			error = err.message || 'Failed to submit challenge';
		}

		loading = false;
	}

	async function handleCommitVote() {
		if (selectedVote === Vote.None) {
			error = 'Select a vote';
			return;
		}

		loading = true;
		error = null;
		success = null;

		try {
			// Generate salt
			const salt = dispute.generateSalt();
			voteSalt = salt;

			// Commit vote
			const commitHash = await dispute.commitVote(disputeData.id, selectedVote, salt);

			// Save commit data locally for reveal phase
			savedCommit = {
				disputeId: disputeData.id,
				vote: selectedVote,
				salt: salt,
				hash: commitHash
			};

			// Store in localStorage for persistence
			localStorage.setItem(`vote_commit_${disputeData.id}`, JSON.stringify(savedCommit));

			success = 'Vote committed! Save this info for reveal phase. Salt: ' + salt.slice(0, 10) + '...';
			await loadDispute();
		} catch (err) {
			error = err.message || 'Failed to commit vote';
		}

		loading = false;
	}

	async function handleRevealVote() {
		// Try to load saved commit
		const saved = savedCommit || JSON.parse(localStorage.getItem(`vote_commit_${disputeData.id}`) || 'null');

		if (!saved) {
			error = 'No saved commit found. Enter your vote and salt manually.';
			return;
		}

		loading = true;
		error = null;
		success = null;

		try {
			await dispute.revealVote(saved.disputeId, saved.vote, saved.salt);
			success = 'Vote revealed successfully!';

			// Clear saved commit
			localStorage.removeItem(`vote_commit_${disputeData.id}`);
			savedCommit = null;

			await loadDispute();
		} catch (err) {
			error = err.message || 'Failed to reveal vote';
		}

		loading = false;
	}

	async function handleResolve() {
		loading = true;
		error = null;
		success = null;

		try {
			await dispute.resolveDispute(disputeData.id);
			success = 'Dispute resolved!';
			await loadDispute();
		} catch (err) {
			error = err.message || 'Failed to resolve dispute';
		}

		loading = false;
	}

	// Load saved commit on mount if exists
	onMount(() => {
		if (disputeData?.id) {
			savedCommit = JSON.parse(localStorage.getItem(`vote_commit_${disputeData.id}`) || 'null');
		}
	});
</script>

{#if !$disputeAvailable}
	<!-- Dispute system not available -->
{:else}
	<div class="card mt-4">
		<div class="p-4 border-b border-chess-accent/10">
			<h3 class="font-display text-lg flex items-center gap-2">
				<span class="text-chess-danger">!</span>
				Dispute System
			</h3>
		</div>

		{#if loading && !disputeData}
			<div class="p-6 text-center text-chess-gray">
				<div class="animate-pulse">Loading dispute data...</div>
			</div>
		{:else if !disputeData || disputeData.state === DisputeState.None || disputeData.state === DisputeState.Pending}
			<!-- No active dispute - show challenge option -->
			{#if canChallenge}
				<div class="p-4">
					<p class="text-sm text-chess-gray mb-4">
						Suspect cheating? Challenge this game within the challenge window.
						Requires {$dispute.challengeDeposit} CHESS deposit.
					</p>

					<div class="mb-4">
						<label class="text-sm text-chess-gray mb-2 block">Accuse Player</label>
						<div class="flex gap-2">
							<button
								class="flex-1 py-2 px-3 rounded-lg text-sm transition-colors
									{accusedPlayer === whitePlayer ? 'bg-chess-accent text-chess-darker' : 'bg-chess-darker hover:bg-chess-dark'}"
								on:click={() => accusedPlayer = whitePlayer}
							>
								White: {truncateAddress(whitePlayer)}
							</button>
							<button
								class="flex-1 py-2 px-3 rounded-lg text-sm transition-colors
									{accusedPlayer === blackPlayer ? 'bg-chess-accent text-chess-darker' : 'bg-chess-darker hover:bg-chess-dark'}"
								on:click={() => accusedPlayer = blackPlayer}
							>
								Black: {truncateAddress(blackPlayer)}
							</button>
						</div>
					</div>

					{#if error}
						<div class="bg-chess-danger/10 border border-chess-danger/30 text-chess-danger rounded-lg p-3 text-sm mb-4">
							{error}
						</div>
					{/if}

					{#if success}
						<div class="bg-chess-success/10 border border-chess-success/30 text-chess-success rounded-lg p-3 text-sm mb-4">
							{success}
						</div>
					{/if}

					<button
						class="btn btn-danger w-full"
						on:click={handleChallenge}
						disabled={loading || !accusedPlayer}
					>
						{loading ? 'Submitting...' : 'Challenge Game'}
					</button>
				</div>
			{:else}
				<div class="p-4 text-center text-chess-gray">
					<p>No active dispute for this game.</p>
				</div>
			{/if}

		{:else}
			<!-- Active dispute -->
			<div class="p-4 space-y-4">
				<!-- Status header -->
				<div class="bg-chess-darker/50 rounded-lg p-3">
					<div class="flex justify-between items-center mb-2">
						<span class="text-xs text-chess-gray uppercase">Status</span>
						<span class="px-2 py-1 rounded text-xs
							{disputeData.state === DisputeState.Resolved ? 'bg-chess-success/20 text-chess-success' : 'bg-chess-accent/20 text-chess-accent'}">
							{getStateLabel(disputeData.state)}
						</span>
					</div>

					<div class="grid grid-cols-2 gap-4 text-sm">
						<div>
							<span class="text-chess-gray">Challenger:</span>
							<span class="ml-1">{truncateAddress(disputeData.challenger)}</span>
						</div>
						<div>
							<span class="text-chess-gray">Accused:</span>
							<span class="ml-1">{truncateAddress(disputeData.accusedPlayer)}</span>
						</div>
						<div>
							<span class="text-chess-gray">Stake:</span>
							<span class="ml-1">{disputeData.gameStake} ETH</span>
						</div>
						<div>
							<span class="text-chess-gray">Escalation:</span>
							<span class="ml-1">Level {disputeData.escalationLevel}</span>
						</div>
					</div>
				</div>

				<!-- Voting progress -->
				{#if disputeData.state !== DisputeState.Resolved}
					<div class="bg-chess-darker/50 rounded-lg p-3">
						<div class="flex justify-between text-sm mb-2">
							<span class="text-chess-gray">Votes</span>
							<span>
								<span class="text-chess-success">{disputeData.legitVotes} Legit</span>
								<span class="text-chess-gray mx-1">vs</span>
								<span class="text-chess-danger">{disputeData.cheatVotes} Cheat</span>
							</span>
						</div>

						{#if currentPhase === 'commit'}
							<div class="text-xs text-chess-gray">
								Commit deadline: {formatTimeRemaining(disputeData.commitDeadline)}
							</div>
						{:else if currentPhase === 'reveal' || currentPhase === 'revealing'}
							<div class="text-xs text-chess-gray">
								Reveal deadline: {formatTimeRemaining(disputeData.revealDeadline)}
							</div>
						{/if}
					</div>
				{:else}
					<!-- Final result -->
					<div class="bg-chess-darker/50 rounded-lg p-3 text-center">
						<div class="text-xs text-chess-gray uppercase mb-1">Final Decision</div>
						<div class="text-xl font-display
							{disputeData.finalDecision === Vote.Cheat ? 'text-chess-danger' : 'text-chess-success'}">
							{getVoteLabel(disputeData.finalDecision)}
						</div>
						<div class="text-sm text-chess-gray mt-1">
							{disputeData.legitVotes} Legit vs {disputeData.cheatVotes} Cheat
						</div>
					</div>
				{/if}

				<!-- Arbitrator voting panel -->
				{#if isArbitrator && disputeData.state !== DisputeState.Resolved}
					<div class="border-t border-chess-accent/10 pt-4">
						<h4 class="font-display text-sm mb-3 flex items-center gap-2">
							<span class="text-chess-accent">*</span>
							You are an Arbitrator
						</h4>

						{#if currentPhase === 'commit'}
							<!-- Commit phase -->
							<div class="space-y-3">
								<p class="text-xs text-chess-gray">
									Select your vote. Your choice is hidden until the reveal phase.
								</p>

								<div class="flex gap-2">
									<button
										class="flex-1 py-2 px-3 rounded-lg text-sm transition-colors
											{selectedVote === Vote.Legit ? 'bg-chess-success text-chess-darker' : 'bg-chess-darker hover:bg-chess-dark'}"
										on:click={() => selectedVote = Vote.Legit}
									>
										Legitimate
									</button>
									<button
										class="flex-1 py-2 px-3 rounded-lg text-sm transition-colors
											{selectedVote === Vote.Cheat ? 'bg-chess-danger text-chess-darker' : 'bg-chess-darker hover:bg-chess-dark'}"
										on:click={() => selectedVote = Vote.Cheat}
									>
										Cheating
									</button>
									<button
										class="flex-1 py-2 px-3 rounded-lg text-sm transition-colors
											{selectedVote === Vote.Abstain ? 'bg-chess-gray text-chess-darker' : 'bg-chess-darker hover:bg-chess-dark'}"
										on:click={() => selectedVote = Vote.Abstain}
									>
										Abstain
									</button>
								</div>

								<button
									class="btn btn-primary w-full"
									on:click={handleCommitVote}
									disabled={loading || selectedVote === Vote.None}
								>
									{loading ? 'Committing...' : 'Commit Vote'}
								</button>
							</div>

						{:else if currentPhase === 'reveal' || currentPhase === 'revealing'}
							<!-- Reveal phase -->
							<div class="space-y-3">
								{#if savedCommit || localStorage.getItem(`vote_commit_${disputeData.id}`)}
									<p class="text-xs text-chess-gray">
										You have a saved vote commit. Click to reveal your vote.
									</p>

									<button
										class="btn btn-primary w-full"
										on:click={handleRevealVote}
										disabled={loading}
									>
										{loading ? 'Revealing...' : 'Reveal Vote'}
									</button>
								{:else}
									<p class="text-xs text-chess-danger">
										No saved commit found. If you committed a vote, you need your original salt to reveal.
									</p>
								{/if}
							</div>
						{/if}
					</div>
				{/if}

				<!-- Resolve button -->
				{#if disputeData.state === DisputeState.Revealing}
					{@const now = Math.floor(Date.now() / 1000)}
					{#if now > disputeData.revealDeadline}
						<button
							class="btn btn-secondary w-full"
							on:click={handleResolve}
							disabled={loading}
						>
							{loading ? 'Resolving...' : 'Resolve Dispute'}
						</button>
					{/if}
				{/if}

				<!-- Error/Success messages -->
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

				<!-- Arbitrators list -->
				<details class="text-sm">
					<summary class="text-chess-gray cursor-pointer hover:text-chess-light">
						View arbitrators ({disputeData.arbitrators.length})
					</summary>
					<div class="mt-2 space-y-1 text-xs">
						{#each disputeData.arbitrators as arb}
							<div class="flex items-center gap-2">
								<span class="font-mono">{truncateAddress(arb)}</span>
								{#if arb.toLowerCase() === $wallet.account?.toLowerCase()}
									<span class="text-chess-accent">(you)</span>
								{/if}
							</div>
						{/each}
					</div>
				</details>
			</div>
		{/if}
	</div>
{/if}
