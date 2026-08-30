<script>
	import { onDestroy, onMount } from 'svelte';
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
	import {
		createVoteCommitRecord,
		getVoteCommitRetryPayload,
		getVoteCommitStorageKey,
		parseVoteCommit,
		reconcileVoteCommitRecord,
		serializeVoteCommit,
		updateVoteCommitStatus,
		voteCommitRecordMatchesContext,
		VoteCommitReconciliation
	} from '$lib/utils/voteCommit.js';
	import { TRANSACTION_NOT_BROADCAST } from '$lib/utils/disputeVerification.js';

	export let gameId;
	export let gameAddress;
	export let whitePlayer = '';
	export let blackPlayer = '';
	export let gameState = 0;

	let disputeData = null;
	let loading = false;
	let error = null;
	let success = null;

	let accusedPlayer = '';
	let selectedVote = Vote.None;
	let savedCommit = null;
	let hasSavedCommit = false;
	let commitBackup = '';
	let commitStorageWarning = '';
	let restoreBackup = '';
	let lastLoadKey = '';
	let loadGeneration = 0;
	let destroyed = false;

	onMount(async () => {
		if ($wallet.connected && $disputeAvailable) {
			await refreshPanel(true);
		}
	});

	onDestroy(() => {
		destroyed = true;
		loadGeneration += 1;
		dispute.invalidateContext();
	});

	$: if ($wallet.connected && $disputeAvailable && gameAddress &&
		gameId !== undefined && gameId !== null) {
		refreshPanel();
	}

	$: canChallenge = gameState >= 3 && gameState <= 5 &&
		(!disputeData || (disputeData.state === DisputeState.Pending && disputeData.challengeWindowOpen));
	$: canCloseChallengeWindow = disputeData?.state === DisputeState.Pending && !disputeData?.challengeWindowOpen;
	$: isSelectedArbitrator = disputeData?.user?.isSelectedArbitrator ?? false;
	$: currentPhase = disputeData ? getPhase(disputeData) : null;
	$: timelineSteps = disputeData ? buildTimeline(disputeData) : [];
	$: panelSelectionTimedOut = Boolean(
		disputeData?.state === DisputeState.Selecting &&
		disputeData.panelSelectionScheduledAt &&
		disputeData.panelSelectionTimeout &&
		Math.floor(Date.now() / 1000) >
			disputeData.panelSelectionScheduledAt + disputeData.panelSelectionTimeout
	);

	function currentPanelLoadKey() {
		return `${gameAddress || ''}:${gameId}:${$wallet.account || ''}:${$wallet.chainId || ''}`;
	}

	function isCurrentPanelLoad(generation, loadKey) {
		return !destroyed && generation === loadGeneration && currentPanelLoadKey() === loadKey;
	}

	function clearCommitRecordUiState() {
		savedCommit = null;
		hasSavedCommit = false;
		commitBackup = '';
	}

	function clearCommitUiState() {
		clearCommitRecordUiState();
		commitStorageWarning = '';
		restoreBackup = '';
	}

	function getCommitContextFor(data = disputeData) {
		if (!data?.context?.verified) {
			throw new Error('Dispute data is not bound to a verified protocol context');
		}
		return {
			chainId: data.context.chainId,
			daoAddress: data.context.daoAddress,
			account: data.context.account,
			gameId: data.context.gameId,
			disputeId: data.context.disputeId
		};
	}

	function isCurrentCommitOperation(operationLoadKey, record) {
		if (destroyed || currentPanelLoadKey() !== operationLoadKey || !disputeData) return false;
		try {
			return voteCommitRecordMatchesContext(record, getCommitContextFor(disputeData));
		} catch {
			return false;
		}
	}

	function applyCommitRecordToCurrentUi(operationLoadKey, record) {
		if (!isCurrentCommitOperation(operationLoadKey, record)) return false;
		savedCommit = record;
		hasSavedCommit = Boolean(record);
		commitBackup = record ? serializeVoteCommit(record) : '';
		return true;
	}

	async function refreshPanel(force = false) {
		const loadKey = currentPanelLoadKey();
		if (!force && loadKey === lastLoadKey) return;

		const contextChanged = loadKey !== lastLoadKey;
		const requestedGameId = gameId;
		const requestedGameAddress = gameAddress;
		if (contextChanged) {
			// Never render a previous account's commit secret while the next
			// route/account/chain is still being verified.
			disputeData = null;
			clearCommitUiState();
		}
		lastLoadKey = loadKey;
		const generation = ++loadGeneration;
		dispute.invalidateContext();
		loading = true;
		error = null;
		try {
			await dispute.fetchParams();
			if (!isCurrentPanelLoad(generation, loadKey)) return;
			const loaded = await dispute.getDisputeByGame(requestedGameId, requestedGameAddress);
			if (!isCurrentPanelLoad(generation, loadKey)) return;
			disputeData = loaded;
			await syncSavedCommit(generation, loadKey, loaded);
		} catch (err) {
			if (!isCurrentPanelLoad(generation, loadKey)) return;
			disputeData = null;
			clearCommitUiState();
			error = err.message || 'Failed to load dispute data';
		} finally {
			if (isCurrentPanelLoad(generation, loadKey)) loading = false;
		}
	}

	async function loadDispute() {
		await refreshPanel(true);
	}

	function getCommitStorage(reportWarning = true) {
		try {
			return window.localStorage;
		} catch {
			if (reportWarning) {
				commitStorageWarning = 'Browser storage is unavailable. Keep an exported reveal backup until the vote is revealed.';
			}
			return null;
		}
	}

	function persistCommitRecord(storage, key, record, reportWarning = true) {
		if (!storage) return false;
		try {
			storage.setItem(key, serializeVoteCommit(record));
			return true;
		} catch {
			if (reportWarning) {
				commitStorageWarning = 'Browser storage could not be updated. Keep the reveal backup displayed on this page.';
			}
			return false;
		}
	}

	function removeCommitRecord(storage, key, reportWarning = true) {
		if (!storage) return false;
		try {
			storage.removeItem(key);
			return true;
		} catch {
			if (reportWarning) {
				commitStorageWarning = 'The obsolete local commit record could not be removed. Its terminal status was verified, but browser cleanup must be retried.';
			}
			return false;
		}
	}

	async function syncSavedCommit(generation = loadGeneration, loadKey = currentPanelLoadKey(), loaded = disputeData) {
		if (typeof window === 'undefined' || !loaded?.id || !$wallet.account || !$wallet.chainId) {
			if (isCurrentPanelLoad(generation, loadKey)) clearCommitUiState();
			return VoteCommitReconciliation.Ambiguous;
		}

		commitStorageWarning = '';
		const context = getCommitContextFor(loaded);
		const expectedHash = loaded.user?.commitHash || '';
		const storageKey = getVoteCommitStorageKey(context);
		const storage = getCommitStorage();
		let parsed = savedCommit
			? parseVoteCommit(serializeVoteCommit(savedCommit), context, expectedHash)
			: null;

		if (!parsed && storage) {
			try {
				parsed = parseVoteCommit(storage.getItem(storageKey), context, expectedHash);
			} catch {
				commitStorageWarning = 'Browser storage could not be read. Any valid in-memory reveal backup has been preserved.';
			}
		}

		// Preserve valid commits created before storage keys were scoped by chain and account.
		if (!parsed && storage && expectedHash) {
			const legacyKey = `vote_commit_${loaded.id}`;
			try {
				const legacyRaw = storage.getItem(legacyKey);
				if (legacyRaw) {
					const legacy = JSON.parse(legacyRaw);
					const migrated = createVoteCommitRecord({
						context,
						vote: legacy.vote,
						salt: legacy.salt,
						hash: legacy.hash,
						createdAt: Date.now()
					});
					if (migrated.hash === expectedHash.toLowerCase()) {
						parsed = migrated;
						persistCommitRecord(storage, storageKey, migrated);
						removeCommitRecord(storage, legacyKey);
					}
				}
			} catch {
				// Invalid legacy records are ignored without discarding a valid in-memory record.
			}
		}

		if (parsed) {
			const reconciliation = await reconcileVoteCommitRecord({
				record: parsed,
				onChainHash: expectedHash,
				provider: $wallet.provider
			});
			if (!isCurrentPanelLoad(generation, loadKey) || disputeData !== loaded) {
				return reconciliation.status;
			}
			if (reconciliation.status === VoteCommitReconciliation.Committed) {
				if (parsed.status !== 'confirmed') {
					parsed = updateVoteCommitStatus(
						parsed,
						'confirmed',
						parsed.transactionHash || '',
						parsed.nonce
					);
					persistCommitRecord(storage, storageKey, parsed);
				}
			} else if (reconciliation.status === VoteCommitReconciliation.TerminallyNotCommitted) {
				const removed = removeCommitRecord(storage, storageKey);
				if (!removed && !commitStorageWarning) {
					commitStorageWarning = 'The terminally failed commit was verified, but its local record could not be cleaned up.';
				}
				savedCommit = null;
				hasSavedCommit = false;
				commitBackup = '';
				return reconciliation.status;
			}
		}

		if (!isCurrentPanelLoad(generation, loadKey) || disputeData !== loaded) {
			return VoteCommitReconciliation.Ambiguous;
		}
		savedCommit = parsed;
		hasSavedCommit = Boolean(parsed);
		commitBackup = parsed ? serializeVoteCommit(parsed) : '';
		return parsed
			? (parsed.status === 'confirmed'
				? VoteCommitReconciliation.Committed
				: VoteCommitReconciliation.Ambiguous)
			: VoteCommitReconciliation.Ambiguous;
	}

	function getCommitContext() {
		return getCommitContextFor(disputeData);
	}

	async function copyCommitBackup() {
		if (!commitBackup) return;

		try {
			await navigator.clipboard.writeText(commitBackup);
			success = 'Reveal backup copied. Keep it private until your vote is revealed.';
			error = null;
		} catch {
			error = 'Clipboard access failed. Select and copy the backup manually.';
		}
	}

	function restoreCommitBackup() {
		try {
			const context = getCommitContext();
			const parsed = parseVoteCommit(
				restoreBackup.trim(),
				context,
				disputeData.user?.commitHash || ''
			);

			if (!parsed) {
				error = 'This backup does not match the connected account, network, dispute, or on-chain commit.';
				return;
			}

			let persisted = true;
			persisted = persistCommitRecord(
				getCommitStorage(),
				getVoteCommitStorageKey(context),
				parsed
			);
			savedCommit = parsed;
			hasSavedCommit = true;
			commitBackup = serializeVoteCommit(parsed);
			restoreBackup = '';
			error = null;
			success = persisted
				? 'Reveal backup restored for this dispute.'
				: 'Backup validated, but browser storage failed. Keep this page open until reveal.';
		} catch {
			error = 'Unable to validate this reveal backup.';
		}
	}

	function getPhase(d) {
		const now = Math.floor(Date.now() / 1000);

		if (d.state === DisputeState.Pending) {
			return d.challengeWindowOpen ? 'challenge' : 'resolve';
		}

		if (d.state === DisputeState.Selecting) {
			return 'select';
		}

		if (d.state === DisputeState.Challenged) {
			if (now <= d.commitDeadline) return 'commit';
			if (now <= d.revealDeadline) return 'reveal';
			return 'resolve';
		}

		if (d.state === DisputeState.Revealing) {
			return now <= d.revealDeadline ? 'reveal' : 'resolve';
		}

		if (d.state === DisputeState.Resolved) {
			return 'resolved';
		}

		if (d.state === DisputeState.Unresolved) {
			return 'backstop';
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

		if (d.state === DisputeState.Selecting) {
			return [
				{ label: 'Challenge', status: 'complete', detail: 'Deposit locked' },
				{ label: 'Panel', status: 'active', detail: `Future entropy at block ${d.panelSelectionBlock}` },
				{ label: 'Commit', status: 'upcoming', detail: 'Starts after panel finalization' },
				{ label: 'Resolve', status: 'upcoming', detail: 'After commit and reveal' }
			];
		}

		if (d.state === DisputeState.Challenged) {
			const now = Math.floor(Date.now() / 1000);
			const commitActive = now <= d.commitDeadline;
			const revealActive = !commitActive && now <= d.revealDeadline;
			const canResolve = now > d.revealDeadline;

			return [
				{ label: 'Challenge', status: 'complete', detail: 'Panel selected' },
				{
					label: 'Commit',
					status: commitActive ? 'active' : 'complete',
					detail: commitActive ? formatTimeRemaining(d.commitDeadline) : 'Commit closed'
				},
				{
					label: 'Reveal',
					status: commitActive ? 'upcoming' : (revealActive ? 'active' : 'complete'),
					detail: commitActive
						? 'Starts after commit'
						: (revealActive ? formatTimeRemaining(d.revealDeadline) : 'Reveal closed')
				},
				{
					label: 'Resolve',
					status: canResolve ? 'active' : 'upcoming',
					detail: canResolve ? 'Ready to resolve' : 'Final decision after reveal'
				}
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

		if (d.state === DisputeState.Unresolved) {
			return [
				{ label: 'Challenge', status: 'complete', detail: 'Deposit remains locked' },
				{ label: 'Panels', status: 'complete', detail: 'Permissionless arbitration exhausted' },
				{ label: 'Backstop', status: 'active', detail: 'Awaiting timelocked governance decision' },
				{ label: 'Resolve', status: 'upcoming', detail: 'Only Legitimate or Cheating is permitted' }
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
			await dispute.challenge(gameId, accusedPlayer, disputeData?.context || $dispute.verification);
			success = 'Challenge locked. Anyone can finalize the panel after the scheduled future block.';
			await loadDispute();
		} catch (err) {
			error = err.message || 'Failed to submit challenge';
		}

		loading = false;
	}

	async function handleFinalizePanel() {
		loading = true;
		error = null;
		success = null;

		try {
			await dispute.finalizePanel(disputeData.id, disputeData.context);
			success = 'Panel selected and commit phase opened.';
			await loadDispute();
		} catch (err) {
			error = err.message || 'Panel cannot be finalized yet';
		}

		loading = false;
	}

	async function handleRefreshPanelSelection() {
		loading = true;
		error = null;
		success = null;

		try {
			await dispute.refreshPanelSelection(disputeData.id, disputeData.context);
			success = 'Expired selection block rescheduled.';
			await loadDispute();
		} catch (err) {
			error = err.message || 'Selection can be rescheduled only after blockhash expiry';
		}

		loading = false;
	}

	async function handleMarkPanelUnavailable() {
		loading = true;
		error = null;
		success = null;

		try {
			await dispute.markPanelUnavailable(disputeData.id, disputeData.context);
			success = 'Selection timeout recorded. The timelocked governance backstop must decide the dispute.';
			await loadDispute();
		} catch (err) {
			error = err.message || 'Selection recovery window has not expired';
		}

		loading = false;
	}

	async function submitVoteCommit(retryRecord = null) {
		const operationLoadKey = currentPanelLoadKey();
		loading = true;
		error = null;
		success = null;

		let pendingRecord = null;
		let storageKey = '';
		let persistenceWarning = false;
		let operationContext = null;
		let operationProvider = null;
		try {
			const context = getCommitContext();
			operationContext = disputeData.context;
			operationProvider = $wallet.provider;
			const retry = retryRecord
				? getVoteCommitRetryPayload(
					retryRecord,
					context,
					disputeData.user.commitHash
				)
				: null;
			const voteToCommit = retry?.vote ?? selectedVote;
			const salt = retry?.salt ?? dispute.generateSalt();
			await dispute.commitVote(context.disputeId, voteToCommit, salt, {
				expectedContext: operationContext,
				beforeBroadcast: ({ commitHash }) => {
					if (currentPanelLoadKey() !== operationLoadKey) {
						throw new Error('Dispute context changed before the vote reached the wallet');
					}
					const record = createVoteCommitRecord({
						context,
						vote: voteToCommit,
						salt,
						hash: commitHash,
						createdAt: retryRecord?.createdAt ?? Date.now(),
						status: 'pending'
					});
					const key = getVoteCommitStorageKey(record);
					const storage = getCommitStorage();
					if (!persistCommitRecord(storage, key, record)) {
						throw new Error('Reveal backup could not be persisted; vote transaction was not sent');
					}
					pendingRecord = record;
					storageKey = key;
					applyCommitRecordToCurrentUi(operationLoadKey, record);
				},
				onBroadcast: ({ transaction }) => {
					const broadcastRecord = updateVoteCommitStatus(
						pendingRecord,
						'broadcast',
						transaction.hash,
						transaction.nonce
					);
					pendingRecord = broadcastRecord;
					const isCurrent = isCurrentCommitOperation(operationLoadKey, broadcastRecord);
					applyCommitRecordToCurrentUi(operationLoadKey, broadcastRecord);
					persistenceWarning = !persistCommitRecord(
						getCommitStorage(isCurrent),
						storageKey,
						broadcastRecord,
						isCurrent
					) || persistenceWarning;
				},
				onConfirmed: () => {
					const confirmedRecord = updateVoteCommitStatus(pendingRecord, 'confirmed');
					pendingRecord = confirmedRecord;
					const isCurrent = isCurrentCommitOperation(operationLoadKey, confirmedRecord);
					applyCommitRecordToCurrentUi(operationLoadKey, confirmedRecord);
					persistenceWarning = !persistCommitRecord(
						getCommitStorage(isCurrent),
						storageKey,
						confirmedRecord,
						isCurrent
					) || persistenceWarning;
				}
			});

			if (isCurrentCommitOperation(operationLoadKey, pendingRecord)) {
				success = !persistenceWarning
					? (retry
						? 'The same vote commitment was resubmitted. Keep the existing reveal backup private.'
						: 'Vote committed. Copy the reveal backup before leaving this page.')
					: 'Vote committed, but the saved status could not be updated. Copy the reveal backup now.';
				await loadDispute();
			}
		} catch (err) {
			if (err.transactionTransmission === TRANSACTION_NOT_BROADCAST && pendingRecord && storageKey) {
				const isCurrent = isCurrentCommitOperation(operationLoadKey, pendingRecord);
				if (retryRecord) {
					persistCommitRecord(
						getCommitStorage(isCurrent),
						storageKey,
						retryRecord,
						isCurrent
					);
					applyCommitRecordToCurrentUi(operationLoadKey, retryRecord);
				} else {
					removeCommitRecord(getCommitStorage(isCurrent), storageKey, isCurrent);
					if (isCurrent && savedCommit?.hash === pendingRecord.hash) {
						clearCommitRecordUiState();
					}
				}
			} else if (pendingRecord && storageKey && operationContext) {
				try {
					const onChainHash = await dispute.getVoteCommitHash(
						pendingRecord.disputeId,
						operationContext
					);
					const reconciliation = await reconcileVoteCommitRecord({
						record: pendingRecord,
						onChainHash,
						provider: operationProvider,
						knownReceipt: err.receipt || err.replacement?.receipt ||
							err.cause?.receipt || err.cause?.replacement?.receipt || null
					});
					if (reconciliation.status === VoteCommitReconciliation.Committed) {
						pendingRecord = updateVoteCommitStatus(
							pendingRecord,
							'confirmed',
							pendingRecord.transactionHash || '',
							pendingRecord.nonce
						);
						const isCurrent = isCurrentCommitOperation(operationLoadKey, pendingRecord);
						persistCommitRecord(
							getCommitStorage(isCurrent), storageKey, pendingRecord, isCurrent
						);
						applyCommitRecordToCurrentUi(operationLoadKey, pendingRecord);
						if (isCurrent) {
							success = 'Vote commitment confirmed on-chain. Keep the reveal backup private.';
							error = null;
							await loadDispute();
							loading = false;
						}
						return;
					}
					if (reconciliation.status === VoteCommitReconciliation.TerminallyNotCommitted) {
						const isCurrent = isCurrentCommitOperation(operationLoadKey, pendingRecord);
						removeCommitRecord(getCommitStorage(isCurrent), storageKey, isCurrent);
						if (isCurrent) {
							clearCommitRecordUiState();
							error = 'The previous transaction is terminally not committed. You may safely retry while the commit window remains open.';
							loading = false;
						}
						return;
					}
				} catch {
					// Failure to prove a terminal outcome remains ambiguous: preserve the salt.
				}
			}
			if (currentPanelLoadKey() === operationLoadKey && !error) {
				error = err.message || 'Failed to commit vote';
			}
		}

		if (currentPanelLoadKey() === operationLoadKey) loading = false;
	}

	async function handleCommitVote() {
		if (selectedVote === Vote.None) {
			error = 'Select a vote';
			return;
		}
		await submitVoteCommit();
	}

	async function handleRetryCommitVote() {
		if (!savedCommit) {
			error = 'No saved commitment is available to retry.';
			return;
		}
		await submitVoteCommit(savedCommit);
	}

	async function handleRevealVote() {
		const saved = savedCommit;
		const operationLoadKey = currentPanelLoadKey();

		if (!saved) {
			error = 'No saved commit found for reveal.';
			return;
		}

		loading = true;
		error = null;
		success = null;

		try {
			await dispute.revealVote(saved.disputeId, saved.vote, saved.salt, disputeData.context);
			// One receipt is not finality. Retain the salt so a reorg can be
			// recovered by reloading and submitting the same reveal again.
			const retained = updateVoteCommitStatus(saved, 'confirmed');
			const isCurrent = isCurrentCommitOperation(operationLoadKey, retained);
			persistCommitRecord(
				getCommitStorage(isCurrent),
				getVoteCommitStorageKey(retained),
				retained,
				isCurrent
			);
			applyCommitRecordToCurrentUi(operationLoadKey, retained);
			if (isCurrent) {
				success = 'Vote revealed successfully. The local backup is retained until finality.';
				await loadDispute();
			}
		} catch (err) {
			if (currentPanelLoadKey() === operationLoadKey) {
				error = err.message || 'Failed to reveal vote';
			}
		}

		if (currentPanelLoadKey() === operationLoadKey) loading = false;
	}

	async function handleCloseChallengeWindow() {
		loading = true;
		error = null;
		success = null;

		try {
			await dispute.closeChallengeWindow(gameId, disputeData.context);
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
			await dispute.resolveDispute(disputeData.id, disputeData.context);
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
			{:else if error && !disputeData}
				<div class="p-4 space-y-3 text-center">
					<p class="text-sm text-chess-danger">{error}</p>
					<button class="btn btn-secondary" on:click={() => refreshPanel(true)}>
						Retry dispute load
					</button>
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
						{:else if disputeData.state === DisputeState.Selecting}
							<div>
								<span class="text-chess-gray">Selection block:</span>
								<span class="ml-1">{disputeData.panelSelectionBlock}</span>
							</div>
							<div>
								<span class="text-chess-gray">Required active stake coverage:</span>
								<span class="ml-1">{disputeData.requiredActiveStakeCoverage} CHESS</span>
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

				{:else if disputeData.state === DisputeState.Selecting}
					<div class="bg-chess-darker/50 rounded-lg p-3 space-y-3">
						<p class="text-sm">
							The challenge and deposit are locked. Panel entropy comes from the committed future block and selection is permissionless.
						</p>
						<div class="text-xs text-chess-gray">
							Target block: {disputeData.panelSelectionBlock}. If its blockhash expires, reschedule before retrying.
						</div>
						<div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
							<button class="btn btn-primary" on:click={handleFinalizePanel} disabled={loading}>
								{loading ? 'Submitting...' : 'Finalize Panel'}
							</button>
							<button class="btn btn-secondary" on:click={handleRefreshPanelSelection} disabled={loading}>
								Reschedule Expired Block
							</button>
						</div>
						{#if panelSelectionTimedOut}
							<button class="btn btn-danger w-full" on:click={handleMarkPanelUnavailable} disabled={loading}>
								Send Timed-out Selection to Backstop
							</button>
						{/if}
					</div>

				{:else if disputeData.state === DisputeState.Unresolved}
					<div class="rounded-lg border border-chess-danger/30 bg-chess-danger/10 p-3 space-y-2">
						<div class="font-display text-sm text-chess-danger">Governance backstop required</div>
						<p class="text-sm">
							Permissionless arbitration could not produce a decision. The challenge deposit and game bonds remain locked.
						</p>
						<p class="text-xs text-chess-gray">
							Only the timelocked governance admin can resolve this dispute, and it must choose Legitimate or Cheating.
						</p>
					</div>

				{:else if disputeData.state !== DisputeState.Resolved}
					<div class="bg-chess-darker/50 rounded-lg p-3">
						<div class="flex justify-between text-sm mb-2">
							<span class="text-chess-gray">Voting power (CHESS)</span>
							<span>
								<span class="text-chess-success">{disputeData.legitVotes} Legit</span>
								<span class="text-chess-gray mx-1">vs</span>
								<span class="text-chess-danger">{disputeData.cheatVotes} Cheat</span>
							</span>
						</div>
						<div class="grid grid-cols-2 gap-3 text-xs text-chess-gray mb-2">
							<div>Participation: {disputeData.totalVotes}/{disputeData.panelSize}</div>
							<div>Abstain power: {disputeData.abstainVotes}</div>
							<div>Revealed power: {disputeData.revealedVotingPower}/{disputeData.requiredVotingPower}</div>
							<div>
								Active stake coverage: {disputeData.panelActiveStake}/{disputeData.requiredActiveStakeCoverage}
							</div>
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
							{#if (disputeData.user.hasCommitted || hasSavedCommit) && !disputeData.user.hasRevealed}
							{#if hasSavedCommit}
								<div class="mb-4 rounded-lg border border-chess-accent/30 bg-chess-accent/10 p-3 space-y-2">
									<div class="text-sm font-medium text-chess-accent">Reveal backup</div>
									<p class="text-xs text-chess-gray">
										Keep this private backup until reveal. Browser storage alone is not sufficient protection against device loss or cleared data.
									</p>
									{#if !disputeData.user.hasCommitted}
										<p class="text-xs text-chess-danger">
											The previous submission is not confirmed on-chain. Keep this backup and do not replace it while broadcast status is uncertain.
										</p>
									{/if}
									<textarea
										class="input min-h-24 font-mono text-xs break-all"
										rows="4"
										readonly
										value={commitBackup}
									></textarea>
									<button class="btn btn-secondary w-full" on:click={copyCommitBackup}>
										Copy Reveal Backup
									</button>
								</div>
							{:else}
								<div class="mb-4 rounded-lg border border-chess-danger/30 bg-chess-danger/10 p-3 space-y-2">
									<div class="text-sm font-medium text-chess-danger">Reveal secret missing</div>
									<p class="text-xs text-chess-gray">
										Paste a previously exported backup. It will be accepted only if it matches this account, network, dispute, and on-chain commitment.
									</p>
									<textarea
										class="input min-h-24 font-mono text-xs"
										rows="4"
										bind:value={restoreBackup}
										placeholder="Paste reveal backup JSON"
									></textarea>
									<button
										class="btn btn-secondary w-full"
										on:click={restoreCommitBackup}
										disabled={!restoreBackup.trim()}
									>
										Restore Reveal Backup
									</button>
								</div>
							{/if}
						{/if}

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
									{:else if hasSavedCommit}
										<div class="space-y-3">
											<div class="text-xs text-chess-danger">
												A prior commit attempt has uncertain broadcast status. Never replace its vote or salt.
											</div>
											<button
												class="btn btn-secondary w-full"
												on:click={handleRetryCommitVote}
												disabled={loading}
											>
												{loading ? 'Retrying...' : 'Retry Same Commitment'}
											</button>
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
									{:else if hasSavedCommit && disputeData.user.hasCommitted}
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
									{:else if hasSavedCommit}
										<p class="text-xs text-chess-danger">
											The saved submission is not confirmed on-chain yet. Keep the backup and retry status loading before reveal.
										</p>
									{:else if disputeData.user.hasCommitted}
										<p class="text-xs text-chess-danger">
											Commit found on-chain. Restore the matching reveal backup above before the deadline.
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

					{#if (disputeData.state === DisputeState.Revealing || disputeData.state === DisputeState.Challenged) && currentPhase === 'resolve'}
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
							{#if disputeData.hasAbstainVotes}
								<span> • {disputeData.abstainVotes} Abstain</span>
							{/if}
						</div>
						<div class="text-xs text-chess-gray mt-1">
							Panel {disputeData.panelSize} • Effective quorum {disputeData.effectiveQuorum || 0}
						</div>
					</div>
				{/if}

				{#if commitStorageWarning}
					<div class="bg-chess-danger/10 border border-chess-danger/30 text-chess-danger rounded-lg p-3 text-sm">
						{commitStorageWarning}
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
