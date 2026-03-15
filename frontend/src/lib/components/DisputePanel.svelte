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
	export let gameState = 0;

	let disputeData = null;
	let loading = false;
	let error = null;
	let success = null;

	let accusedPlayer = '';
	let selectedVote = Vote.None;
	let voteSalt = '';
	let savedCommit = null;
	let hasSavedCommit = false;
	let lastLoadKey = '';

	onMount(async () => {
		if ($wallet.connected && $disputeAvailable) {
			await refreshPanel(true);
		}
	});

	$: if ($wallet.connected && $disputeAvailable && gameId) {
		refreshPanel();
	}

	$: canChallenge = gameState >= 3 && gameState <= 5 &&
		(!disputeData || (disputeData.state === DisputeState.Pending && disputeData.challengeWindowOpen));
	$: canCloseChallengeWindow = disputeData?.state === DisputeState.Pending && !disputeData?.challengeWindowOpen;
	$: isSelectedArbitrator = disputeData?.user?.isSelectedArbitrator ?? false;
	$: currentPhase = disputeData ? getPhase(disputeData) : null;
	$: timelineSteps = disputeData ? buildTimeline(disputeData) : [];

	async function refreshPanel(force = false) {
		const loadKey = `${gameId}:${$wallet.account || ''}:${$wallet.chainId || ''}`;
		if (!force && loadKey === lastLoadKey) return;

		lastLoadKey = loadKey;
		await dispute.fetchParams();
		await loadDispute();
	}

	async function loadDispute() {
		loading = true;
		disputeData = await dispute.getDisputeByGame(gameId);
		syncSavedCommit();
		loading = false;
	}

	function syncSavedCommit() {
		if (typeof localStorage === 'undefined' || !disputeData?.id) {
			savedCommit = null;
			hasSavedCommit = false;
			return;
		}

		savedCommit = JSON.parse(localStorage.getItem(`vote_commit_${disputeData.id}`) || 'null');
		hasSavedCommit = Boolean(savedCommit);
	}

	function getPhase(d) {
		const now = Math.floor(Date.now() / 1000);

		if (d.state === DisputeState.Pending) {
			return d.challengeWindowOpen ? 'challenge' : 'resolve';
		}

		if (d.state === DisputeState.Challenged) {
			return now <= d.commitDeadline ? 'commit' : 'reveal';
		}

		if (d.state === DisputeState.Revealing) {
			return now <= d.revealDeadline ? 'reveal' : 'resolve';
		}

		if (d.state === DisputeState.Resolved) {
			return 'resolved';
		}

		return 'idle';
	}

	function formatRemainingSeconds(seconds) {
		if (!seconds || seconds <= 0) return 'Ended';

		const hours = Math.floor(seconds / 3600);
		const minutes = Math.floor((seconds % 3600) / 60);

		if (hours > 24) {
			const days = Math.floor(hours / 24);
			return `${days}d ${hours % 24}h`;
		}

		return `${hours}h ${minutes}m`;
	}

	function buildTimeline(d) {
		if (d.state === DisputeState.Pending) {
			return [
				{
					label: 'Challenge',
					status: d.challengeWindowOpen ? 'active' : 'expired',
					detail: d.challengeWindowOpen
						? `${formatRemainingSeconds(d.challengeWindowRemaining)} left`
						: 'Window expired'
				},
				{ label: 'Commit', status: 'upcoming', detail: 'Starts after a challenge' },
				{ label: 'Reveal', status: 'upcoming', detail: 'Hidden votes are revealed' },
				{
					label: 'Resolve',
					status: d.challengeWindowOpen ? 'upcoming' : 'active',
					detail: d.challengeWindowOpen ? 'Waiting for challenge or expiry' : 'Ready to close'
				}
			];
		}

		if (d.state === DisputeState.Challenged) {
			const now = Math.floor(Date.now() / 1000);
			const commitActive = now <= d.commitDeadline;

			return [
				{ label: 'Challenge', status: 'complete', detail: 'Panel selected' },
				{
					label: 'Commit',
					status: commitActive ? 'active' : 'complete',
					detail: commitActive ? formatTimeRemaining(d.commitDeadline) : 'Commit closed'
				},
				{
					label: 'Reveal',
					status: commitActive ? 'upcoming' : 'active',
					detail: commitActive ? 'Starts after commit' : formatTimeRemaining(d.revealDeadline)
				},
				{ label: 'Resolve', status: 'upcoming', detail: 'Final decision after reveal' }
			];
		}

		if (d.state === DisputeState.Revealing) {
			const now = Math.floor(Date.now() / 1000);
			const revealActive = now <= d.revealDeadline;

			return [
				{ label: 'Challenge', status: 'complete', detail: 'Challenge accepted' },
				{ label: 'Commit', status: 'complete', detail: 'Votes committed' },
				{
					label: 'Reveal',
					status: revealActive ? 'active' : 'complete',
					detail: revealActive ? formatTimeRemaining(d.revealDeadline) : 'Reveal closed'
				},
				{
					label: 'Resolve',
					status: revealActive ? 'upcoming' : 'active',
					detail: revealActive ? 'Waiting for reveal deadline' : 'Ready to resolve'
				}
			];
		}

		return [
			{ label: 'Challenge', status: 'complete', detail: 'Closed' },
			{ label: 'Commit', status: 'complete', detail: 'Completed' },
			{ label: 'Reveal', status: 'complete', detail: 'Completed' },
			{
				label: 'Resolve',
				status: 'complete',
				detail: d.finalDecision === Vote.None ? 'No challenge' : getVoteLabel(d.finalDecision)
			}
		];
	}

	function getStepClasses(status) {
		if (status === 'complete') return 'border-chess-success/30 bg-chess-success/10';
		if (status === 'active') return 'border-chess-accent/40 bg-chess-accent/10';
		if (status === 'expired') return 'border-chess-danger/30 bg-chess-danger/10';
		return 'border-chess-accent/10 bg-chess-darker/40';
	}

	function getStepLabel(status) {
		if (status === 'complete') return 'Done';
		if (status === 'active') return 'Current';
		if (status === 'expired') return 'Expired';
		return 'Next';
	}

	function formatParticipant(address, fallback) {
		if (!address || address === '0x0000000000000000000000000000000000000000') {
			return fallback;
		}

		return truncateAddress(address);
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
			success = 'Challenge submitted. Arbitrators can now commit votes.';
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
			const salt = dispute.generateSalt();
			voteSalt = salt;

			const commitHash = await dispute.commitVote(disputeData.id, selectedVote, salt);

			savedCommit = {
				disputeId: disputeData.id,
				vote: selectedVote,
				salt,
				hash: commitHash
			};

			localStorage.setItem(`vote_commit_${disputeData.id}`, JSON.stringify(savedCommit));
			hasSavedCommit = true;
			success = `Vote committed. Save this salt: ${salt.slice(0, 10)}...`;
			await loadDispute();
		} catch (err) {
			error = err.message || 'Failed to commit vote';
		}

		loading = false;
	}

	async function handleRevealVote() {
		const saved = savedCommit || JSON.parse(localStorage.getItem(`vote_commit_${disputeData.id}`) || 'null');

		if (!saved) {
			error = 'No saved commit found for reveal.';
			return;
		}

		loading = true;
		error = null;
		success = null;

		try {
			await dispute.revealVote(saved.disputeId, saved.vote, saved.salt);
			success = 'Vote revealed successfully.';
			localStorage.removeItem(`vote_commit_${disputeData.id}`);
			savedCommit = null;
			hasSavedCommit = false;
			await loadDispute();
		} catch (err) {
			error = err.message || 'Failed to reveal vote';
		}

		loading = false;
	}

	async function handleCloseChallengeWindow() {
		loading = true;
		error = null;
		success = null;

		try {
			await dispute.closeChallengeWindow(gameId);
			success = 'Challenge window closed.';
			await loadDispute();
		} catch (err) {
			error = err.message || 'Failed to close challenge window';
		}

		loading = false;
	}

	async function handleResolve() {
		loading = true;
		error = null;
		success = null;

		try {
			await dispute.resolveDispute(disputeData.id);
			success = 'Dispute resolved.';
			await loadDispute();
		} catch (err) {
			error = err.message || 'Failed to resolve dispute';
		}

		loading = false;
	}
</script>

{#if $disputeAvailable}
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
		{:else if !disputeData || disputeData.state === DisputeState.None}
			<div class="p-4 text-center text-chess-gray">
				<p>No dispute record found for this game.</p>
			</div>
		{:else}
			<div class="p-4 space-y-4">
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
							<span class="ml-1">{formatParticipant(disputeData.challenger, 'Open window')}</span>
						</div>
						<div>
							<span class="text-chess-gray">Accused:</span>
							<span class="ml-1">{formatParticipant(disputeData.accusedPlayer, 'Not selected')}</span>
						</div>
						<div>
							<span class="text-chess-gray">Stake:</span>
							<span class="ml-1">{disputeData.gameStake} ETH</span>
						</div>
						<div>
							<span class="text-chess-gray">Escalation:</span>
							<span class="ml-1">Level {disputeData.escalationLevel}</span>
						</div>
						{#if disputeData.state === DisputeState.Pending}
							<div>
								<span class="text-chess-gray">Window:</span>
								<span class="ml-1">
									{#if disputeData.challengeWindowOpen}
										{formatRemainingSeconds(disputeData.challengeWindowRemaining)}
									{:else}
										Expired
									{/if}
								</span>
							</div>
							<div>
								<span class="text-chess-gray">Next:</span>
								<span class="ml-1">{disputeData.challengeWindowOpen ? 'Awaiting challenge' : 'Close window'}</span>
							</div>
						{:else}
							<div>
								<span class="text-chess-gray">Panel:</span>
								<span class="ml-1">{disputeData.panelSize} arbitrators</span>
							</div>
							<div>
								<span class="text-chess-gray">Quorum:</span>
								<span class="ml-1">{disputeData.effectiveQuorum || 0}</span>
							</div>
						{/if}
					</div>
				</div>

				<div class="grid grid-cols-2 lg:grid-cols-4 gap-2">
					{#each timelineSteps as step}
						<div class="rounded-lg border px-3 py-2 {getStepClasses(step.status)}">
							<div class="flex items-center justify-between gap-2">
								<div class="text-[11px] uppercase tracking-wide text-chess-gray">{step.label}</div>
								<div class="text-[11px] uppercase tracking-wide text-chess-gray">{getStepLabel(step.status)}</div>
							</div>
							<div class="text-xs mt-2 text-chess-light">{step.detail}</div>
						</div>
					{/each}
				</div>

				{#if disputeData.state === DisputeState.Pending}
					<div class="bg-chess-darker/50 rounded-lg p-3 space-y-3">
						<div class="text-sm">
							{#if disputeData.challengeWindowOpen}
								The challenge window is open. Anyone can accuse one player of cheating by posting the CHESS deposit.
							{:else}
								The challenge window expired. This record is still pending only because nobody has closed it on-chain yet.
							{/if}
						</div>
						<div class="text-xs text-chess-gray">
							Deposit required: {$dispute.challengeDeposit} CHESS
						</div>
					</div>

					{#if canChallenge}
						<div class="space-y-4">
							<div>
								<div class="text-sm text-chess-gray mb-2">Accuse Player</div>
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

							<button
								class="btn btn-danger w-full"
								on:click={handleChallenge}
								disabled={loading || !accusedPlayer}
							>
								{loading ? 'Submitting...' : 'Challenge Game'}
							</button>
						</div>
					{:else if canCloseChallengeWindow}
						<button
							class="btn btn-secondary w-full"
							on:click={handleCloseChallengeWindow}
							disabled={loading}
						>
							{loading ? 'Closing...' : 'Close Challenge Window'}
						</button>
					{/if}

				{:else if disputeData.state !== DisputeState.Resolved}
					<div class="bg-chess-darker/50 rounded-lg p-3">
						<div class="flex justify-between text-sm mb-2">
							<span class="text-chess-gray">Votes</span>
							<span>
								<span class="text-chess-success">{disputeData.legitVotes} Legit</span>
								<span class="text-chess-gray mx-1">vs</span>
								<span class="text-chess-danger">{disputeData.cheatVotes} Cheat</span>
							</span>
						</div>
						<div class="grid grid-cols-2 gap-3 text-xs text-chess-gray mb-2">
							<div>Participation: {disputeData.totalVotes}/{disputeData.panelSize}</div>
							<div>Abstain: {disputeData.abstainVotes}</div>
						</div>

						{#if currentPhase === 'commit'}
							<div class="text-xs text-chess-gray">
								Commit deadline: {formatTimeRemaining(disputeData.commitDeadline)}
							</div>
						{:else if currentPhase === 'reveal'}
							<div class="text-xs text-chess-gray">
								Reveal deadline: {formatTimeRemaining(disputeData.revealDeadline)}
							</div>
						{:else if currentPhase === 'resolve'}
							<div class="text-xs text-chess-gray">
								Reveal period ended. Anyone can resolve this dispute now.
							</div>
						{/if}
					</div>

					{#if disputeData.user.isSelectedArbitrator || disputeData.user.isArbitrator}
						<div class="bg-chess-darker/50 rounded-lg p-3 text-sm space-y-2">
							<div class="font-display text-sm">Arbitrator Status</div>
							<div>
								{#if disputeData.user.isSelectedArbitrator}
									<span class="text-chess-accent">You are selected for this dispute.</span>
								{:else}
									<span class="text-chess-gray">You are an arbitrator, but not on this panel.</span>
								{/if}
							</div>
							<div class="text-xs text-chess-gray">
								Registry status: {disputeData.user.canVoteNow ? 'available for new selections' : 'cooldown or unavailable for new selections'}
							</div>
							{#if disputeData.user.hasCommitted && !disputeData.user.hasRevealed}
								<div class="text-xs text-chess-accent">Commit submitted. Reveal is still required.</div>
							{/if}
							{#if disputeData.user.hasRevealed}
								<div class="text-xs text-chess-success">Revealed vote: {getVoteLabel(disputeData.user.revealedVote)}</div>
							{/if}
						</div>
					{/if}

					{#if isSelectedArbitrator}
						<div class="border-t border-chess-accent/10 pt-4">
							<h4 class="font-display text-sm mb-3 flex items-center gap-2">
								<span class="text-chess-accent">*</span>
								Panel Actions
							</h4>

							{#if currentPhase === 'commit'}
								{#if disputeData.user.hasCommitted}
									<div class="text-xs text-chess-accent">
										Commit already submitted. Wait for the reveal phase.
									</div>
								{:else}
									<div class="space-y-3">
										<p class="text-xs text-chess-gray">
											Select your vote. Your choice stays hidden until reveal.
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
								{/if}
							{:else if currentPhase === 'reveal' || currentPhase === 'resolve'}
								<div class="space-y-3">
									{#if disputeData.user.hasRevealed}
										<p class="text-xs text-chess-success">
											Your vote is already revealed.
										</p>
									{:else if hasSavedCommit}
										<p class="text-xs text-chess-gray">
											You have a saved commit. Use it now to reveal your vote.
										</p>

										<button
											class="btn btn-primary w-full"
											on:click={handleRevealVote}
											disabled={loading}
										>
											{loading ? 'Revealing...' : 'Reveal Vote'}
										</button>
									{:else if disputeData.user.hasCommitted}
										<p class="text-xs text-chess-danger">
											Commit found on-chain, but this browser has no saved salt for reveal.
										</p>
									{:else}
										<p class="text-xs text-chess-gray">
											No commit found for your address in this dispute.
										</p>
									{/if}
								</div>
							{/if}
						</div>
					{/if}

					{#if disputeData.state === DisputeState.Revealing && currentPhase === 'resolve'}
						<button
							class="btn btn-secondary w-full"
							on:click={handleResolve}
							disabled={loading}
						>
							{loading ? 'Resolving...' : 'Resolve Dispute'}
						</button>
					{/if}

				{:else}
					<div class="bg-chess-darker/50 rounded-lg p-3 text-center">
						<div class="text-xs text-chess-gray uppercase mb-1">Final Decision</div>
						<div class="text-xl font-display
							{disputeData.finalDecision === Vote.Cheat ? 'text-chess-danger' : 'text-chess-success'}">
							{getVoteLabel(disputeData.finalDecision)}
						</div>
						<div class="text-sm text-chess-gray mt-1">
							{disputeData.legitVotes} Legit vs {disputeData.cheatVotes} Cheat
							{#if disputeData.abstainVotes > 0}
								<span> • {disputeData.abstainVotes} Abstain</span>
							{/if}
						</div>
						<div class="text-xs text-chess-gray mt-1">
							Panel {disputeData.panelSize} • Effective quorum {disputeData.effectiveQuorum || 0}
						</div>
					</div>
				{/if}

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

				{#if disputeData.arbitrators.length > 0}
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
				{/if}
			</div>
		{/if}
	</div>
{/if}
