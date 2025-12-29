<script>
	import '../app.css';
	import { wallet, networkName, isSupported, truncateAddress } from '$lib/stores/wallet.js';

	let connecting = false;

	async function connect() {
		connecting = true;
		await wallet.connect();
		connecting = false;
	}
</script>

<div class="min-h-screen flex flex-col">
	<!-- Header -->
	<header class="fixed top-0 left-0 right-0 z-50 bg-chess-darker/95 backdrop-blur-sm border-b border-chess-accent/10">
		<div class="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
			<a href="/" class="flex items-center gap-3 hover:opacity-80 transition-opacity">
				<span class="text-3xl text-chess-accent">♞</span>
				<span class="font-display text-xl font-semibold">Solidity Chess</span>
			</a>

			<nav class="flex items-center gap-4">
				<a href="/#games" class="text-chess-gray hover:text-chess-light transition-colors">
					Play
				</a>
				<a
					href="https://github.com/jacmos3/ChessGameSolidity"
					target="_blank"
					rel="noopener noreferrer"
					class="text-chess-gray hover:text-chess-light transition-colors"
				>
					GitHub
				</a>

				{#if $wallet.connected}
					<div class="flex items-center gap-2">
						<span class="px-3 py-1.5 rounded-lg text-sm font-medium {$isSupported ? 'bg-chess-success/20 text-chess-success' : 'bg-yellow-500/20 text-yellow-500'}">
							{$networkName}
						</span>
						<button
							class="btn-primary px-4 py-2 rounded-lg text-sm"
							on:click={wallet.disconnect}
						>
							{truncateAddress($wallet.account)}
						</button>
					</div>
				{:else}
					<button
						class="btn btn-primary text-sm"
						on:click={connect}
						disabled={connecting}
					>
						{connecting ? 'Connecting...' : 'Connect Wallet'}
					</button>
				{/if}
			</nav>
		</div>
	</header>

	<!-- Main content -->
	<main class="flex-1 pt-16">
		<slot />
	</main>

	<!-- Footer -->
	<footer class="bg-chess-darker border-t border-chess-accent/10 py-8">
		<div class="max-w-6xl mx-auto px-4 text-center">
			<div class="flex items-center justify-center gap-2 mb-4">
				<span class="text-chess-accent">♞</span>
				<span class="font-display">Solidity Chess</span>
			</div>
			<p class="text-chess-gray text-sm">
				Built by <a href="https://github.com/jacmos3" class="text-chess-accent hover:underline">jacmos3</a>
				· <a href="https://github.com/jacmos3/ChessGameSolidity" class="text-chess-accent hover:underline">Open Source</a>
				· MIT License
			</p>
		</div>
	</footer>
</div>

{#if $wallet.error}
	<div class="fixed bottom-4 right-4 bg-chess-danger text-white px-6 py-3 rounded-lg shadow-lg flex items-center gap-3 z-50">
		<span>{$wallet.error}</span>
		<button on:click={wallet.clearError} class="opacity-70 hover:opacity-100">✕</button>
	</div>
{/if}
