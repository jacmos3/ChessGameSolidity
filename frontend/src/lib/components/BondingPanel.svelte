<script>
	import { onMount } from 'svelte';
	import { wallet } from '$lib/stores/wallet.js';
	import { bonding, bondingAvailable, formatChess } from '$lib/stores/bonding.js';

	let activeTab = 'deposit'; // 'deposit' | 'withdraw'
	let chessAmount = '';
	let ethAmount = '';
	let processing = false;
	let minting = false;
	let error = null;
	let success = null;

	// Calculated requirements for common bet amounts
	let requirements = null;

	onMount(async () => {
		if ($wallet.connected && $bondingAvailable) {
			await bonding.fetchBondData();
			await calculateCommonRequirements();
		}
	});

	// Recalculate when wallet changes
	$: if ($wallet.connected && $bondingAvailable) {
		bonding.fetchBondData();
	}

	async function calculateCommonRequirements() {
		const amounts = [0.01, 0.1, 1];
		requirements = {};
		for (const amt of amounts) {
			requirements[amt] = await bonding.calculateRequiredBond(amt);
		}
	}

	async function handleApprove() {
		if (!chessAmount || parseFloat(chessAmount) <= 0) return;

		processing = true;
		error = null;
		success = null;

		try {
			await bonding.approveChess(chessAmount);
			success = 'CHESS approved for unlimited spending. You can now deposit.';
		} catch (err) {
			console.error('Approval error:', err);
			if (err.code === 'ACTION_REJECTED' || err.code === 4001) {
				error = 'Transaction rejected by user';
			} else {
				error = err.message || 'Failed to approve. Check browser console for details.';
			}
		}

		processing = false;
	}

	async function handleDeposit() {
		const chess = parseFloat(chessAmount) || 0;
		const eth = parseFloat(ethAmount) || 0;

		if (chess <= 0 && eth <= 0) {
			error = 'Enter an amount to deposit';
			return;
		}

		processing = true;
		error = null;
		success = null;

		try {
			await bonding.depositBond(chess, eth);
			success = `Deposited ${chess > 0 ? chess + ' CHESS' : ''} ${chess > 0 && eth > 0 ? '+' : ''} ${eth > 0 ? eth + ' ETH' : ''}`;
			chessAmount = '';
			ethAmount = '';
		} catch (err) {
			console.error('Deposit error:', err);
			if (err.code === 'ACTION_REJECTED' || err.code === 4001) {
				error = 'Transaction rejected by user';
			} else if (err.message?.includes('Insufficient CHESS allowance')) {
				error = err.message;
			} else if (err.message?.includes('ERC20InsufficientAllowance')) {
				error = 'CHESS not approved. Please click "Approve CHESS" first, then try depositing again.';
			} else {
				error = err.message || 'Failed to deposit. Check browser console for details.';
			}
		}

		processing = false;
	}

	async function handleWithdrawChess() {
		if (!chessAmount || parseFloat(chessAmount) <= 0) return;

		processing = true;
		error = null;
		success = null;

		try {
			await bonding.withdrawChess(chessAmount);
			success = `Withdrew ${chessAmount} CHESS`;
			chessAmount = '';
		} catch (err) {
			error = err.message || 'Failed to withdraw';
		}

		processing = false;
	}

	async function handleWithdrawEth() {
		if (!ethAmount || parseFloat(ethAmount) <= 0) return;

		processing = true;
		error = null;
		success = null;

		try {
			await bonding.withdrawEth(ethAmount);
			success = `Withdrew ${ethAmount} ETH`;
			ethAmount = '';
		} catch (err) {
			error = err.message || 'Failed to withdraw';
		}

		processing = false;
	}

	function setMaxChess() {
		if (activeTab === 'deposit') {
			chessAmount = $bonding.chessBalance;
		} else {
			chessAmount = $bonding.chessAvailable;
		}
	}

	function setMaxEth() {
		if (activeTab === 'withdraw') {
			ethAmount = $bonding.ethAvailable;
		}
	}

	async function handleMintTestTokens() {
		minting = true;
		error = null;
		success = null;

		try {
			await bonding.mintTestTokens(1000);
			success = 'Minted 1000 CHESS tokens!';
		} catch (err) {
			error = err.message || 'Failed to mint tokens. Only admin can mint.';
		}

		minting = false;
	}

	// Check if we need approval for the chess amount
	$: needsApproval = activeTab === 'deposit' &&
		parseFloat(chessAmount || '0') > 0 &&
		parseFloat($bonding.chessAllowance) < parseFloat(chessAmount || '0');
</script>

<div class="card">
	<div class="p-4 border-b border-chess-accent/10">
		<div class="flex items-center justify-between">
			<h3 class="font-display text-lg flex items-center gap-2">
				<span class="text-chess-accent">⚔</span>
				Bond Management
			</h3>
			{#if $bonding.isPaused}
				<span class="px-2 py-1 bg-chess-danger/20 text-chess-danger text-xs rounded">
					PAUSED
				</span>
			{/if}
		</div>
	</div>

	{#if !$bondingAvailable}
		<div class="p-6 text-center text-chess-gray">
			<p>Bonding is not available on this network.</p>
			<p class="text-sm mt-2">Switch to a supported network to manage your bond.</p>
		</div>
	{:else if $bonding.loading}
		<div class="p-6 text-center text-chess-gray">
			<div class="animate-pulse">Loading bond data...</div>
		</div>
	{:else}
		<!-- Bond Overview -->
		<div class="p-4 bg-chess-darker/30 border-b border-chess-accent/10">
			<div class="grid grid-cols-2 gap-4">
				<!-- CHESS Bond -->
				<div>
					<div class="text-xs text-chess-gray uppercase tracking-wide mb-1">CHESS Bond</div>
					<div class="font-display text-lg text-chess-accent">
						{parseFloat($bonding.chessDeposited).toFixed(2)}
					</div>
					<div class="text-xs text-chess-gray mt-1">
						<span class="text-chess-success">{parseFloat($bonding.chessAvailable).toFixed(2)} available</span>
						{#if parseFloat($bonding.chessLocked) > 0}
							<span class="text-chess-danger ml-2">({parseFloat($bonding.chessLocked).toFixed(2)} locked)</span>
						{/if}
					</div>
				</div>
				<!-- ETH Bond -->
				<div>
					<div class="text-xs text-chess-gray uppercase tracking-wide mb-1">ETH Bond</div>
					<div class="font-display text-lg">
						{parseFloat($bonding.ethDeposited).toFixed(4)} ETH
					</div>
					<div class="text-xs text-chess-gray mt-1">
						<span class="text-chess-success">{parseFloat($bonding.ethAvailable).toFixed(4)} available</span>
						{#if parseFloat($bonding.ethLocked) > 0}
							<span class="text-chess-danger ml-2">({parseFloat($bonding.ethLocked).toFixed(4)} locked)</span>
						{/if}
					</div>
				</div>
			</div>

			<!-- Wallet Balance -->
			<div class="mt-4 pt-3 border-t border-chess-accent/10">
				<div class="flex justify-between text-sm">
					<span class="text-chess-gray">Wallet CHESS:</span>
					<span>{parseFloat($bonding.chessBalance).toFixed(2)}</span>
				</div>
				<div class="flex justify-between text-sm mt-1">
					<span class="text-chess-gray">CHESS Allowance:</span>
					<span class="{parseFloat($bonding.chessAllowance) > 1000000 ? 'text-chess-success' : 'text-chess-gray'}">
						{parseFloat($bonding.chessAllowance) > 1000000 ? 'Unlimited' : parseFloat($bonding.chessAllowance).toFixed(2)}
					</span>
				</div>
				<div class="flex justify-between text-sm mt-1">
					<span class="text-chess-gray">CHESS Price:</span>
					<span>{parseFloat($bonding.chessPrice).toFixed(6)} ETH</span>
				</div>

				<!-- Mint Test Tokens (for testnet) -->
				{#if parseFloat($bonding.chessBalance) < 100}
					<div class="mt-3 pt-3 border-t border-chess-accent/10">
						<p class="text-xs text-chess-gray mb-2">Need CHESS tokens? (Testnet only)</p>
						<button
							class="btn btn-secondary text-xs w-full"
							on:click={handleMintTestTokens}
							disabled={minting}
						>
							{minting ? 'Minting...' : 'Mint 1000 Test CHESS'}
						</button>
					</div>
				{/if}
			</div>
		</div>

		<!-- Requirements Info -->
		{#if requirements}
			<div class="p-4 border-b border-chess-accent/10">
				<div class="text-xs text-chess-gray uppercase tracking-wide mb-2">Bond Required Per Bet</div>
				<div class="grid grid-cols-3 gap-2 text-xs">
					{#each Object.entries(requirements) as [bet, req]}
						{#if req}
							<div class="bg-chess-darker/50 rounded p-2 text-center">
								<div class="text-chess-gray">{bet} ETH bet</div>
								<div class="text-chess-accent font-medium">{parseFloat(req.chessRequired).toFixed(0)} CHESS</div>
								<div class="text-chess-gray">+ {parseFloat(req.ethRequired).toFixed(3)} ETH</div>
							</div>
						{/if}
					{/each}
				</div>
			</div>
		{/if}

		<!-- Tabs -->
		<div class="flex border-b border-chess-accent/10">
			<button
				class="flex-1 py-3 text-sm font-medium transition-colors
					{activeTab === 'deposit' ? 'text-chess-accent border-b-2 border-chess-accent' : 'text-chess-gray hover:text-chess-light'}"
				on:click={() => { activeTab = 'deposit'; error = null; success = null; }}
			>
				Deposit
			</button>
			<button
				class="flex-1 py-3 text-sm font-medium transition-colors
					{activeTab === 'withdraw' ? 'text-chess-accent border-b-2 border-chess-accent' : 'text-chess-gray hover:text-chess-light'}"
				on:click={() => { activeTab = 'withdraw'; error = null; success = null; }}
			>
				Withdraw
			</button>
		</div>

		<!-- Form -->
		<div class="p-4 space-y-4">
			<!-- CHESS Amount -->
			<div>
				<label class="flex justify-between text-sm mb-2">
					<span>CHESS Amount</span>
					<button
						class="text-chess-accent hover:underline text-xs"
						on:click={setMaxChess}
					>
						Max: {activeTab === 'deposit' ? parseFloat($bonding.chessBalance).toFixed(2) : parseFloat($bonding.chessAvailable).toFixed(2)}
					</button>
				</label>
				<input
					type="number"
					bind:value={chessAmount}
					class="input"
					placeholder="0.00"
					min="0"
					step="any"
					disabled={processing}
				/>
			</div>

			<!-- ETH Amount -->
			<div>
				<label class="flex justify-between text-sm mb-2">
					<span>ETH Amount</span>
					{#if activeTab === 'withdraw'}
						<button
							class="text-chess-accent hover:underline text-xs"
							on:click={setMaxEth}
						>
							Max: {parseFloat($bonding.ethAvailable).toFixed(4)}
						</button>
					{/if}
				</label>
				<input
					type="number"
					bind:value={ethAmount}
					class="input"
					placeholder="0.00"
					min="0"
					step="any"
					disabled={processing}
				/>
			</div>

			<!-- Error/Success Messages -->
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

			<!-- Action Buttons -->
			<div class="flex gap-2">
				{#if activeTab === 'deposit'}
					{#if needsApproval}
						<button
							class="btn btn-secondary flex-1"
							on:click={handleApprove}
							disabled={processing || $bonding.isPaused}
						>
							{processing ? 'Approving...' : 'Approve CHESS'}
						</button>
					{/if}
					<button
						class="btn btn-primary flex-1"
						on:click={handleDeposit}
						disabled={processing || $bonding.isPaused || needsApproval}
					>
						{processing ? 'Depositing...' : 'Deposit Bond'}
					</button>
				{:else}
					<button
						class="btn btn-secondary flex-1"
						on:click={handleWithdrawChess}
						disabled={processing || !chessAmount || parseFloat(chessAmount) <= 0}
					>
						{processing ? 'Withdrawing...' : 'Withdraw CHESS'}
					</button>
					<button
						class="btn btn-primary flex-1"
						on:click={handleWithdrawEth}
						disabled={processing || !ethAmount || parseFloat(ethAmount) <= 0}
					>
						{processing ? 'Withdrawing...' : 'Withdraw ETH'}
					</button>
				{/if}
			</div>

			<!-- Help Text -->
			<p class="text-xs text-chess-gray text-center">
				{#if activeTab === 'deposit'}
					Deposit CHESS and ETH to play high-stakes games. Bonds are locked during active games.
				{:else}
					Only unlocked bonds can be withdrawn. Locked bonds are released after game completion.
				{/if}
			</p>
		</div>
	{/if}
</div>
