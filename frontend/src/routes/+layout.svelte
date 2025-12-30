<script>
	import '../app.css';
	import { page } from '$app/stores';
	import { wallet, networkName, isSupported, truncateAddress } from '$lib/stores/wallet.js';
	import { onboarding } from '$lib/stores/onboarding.js';
	import OnboardingTour from '$lib/components/OnboardingTour.svelte';

	let connecting = false;
	let mobileMenuOpen = false;
	let wasConnected = false;

	async function connect() {
		connecting = true;
		await wallet.connect();
		connecting = false;
	}

	// Show onboarding tour when user first connects
	$: if ($wallet.connected && !wasConnected && !$onboarding.completed) {
		wasConnected = true;
		// Small delay to let the UI settle
		setTimeout(() => onboarding.start(), 500);
	}

	$: currentPath = $page.url.pathname;
</script>

<div class="min-h-screen flex flex-col">
	<!-- Header -->
	<header class="fixed top-0 left-0 right-0 z-50 bg-chess-darker/95 backdrop-blur-sm border-b border-chess-accent/10">
		<div class="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
			<a href="/" class="flex items-center gap-3 hover:opacity-80 transition-opacity">
				<span class="text-3xl text-chess-accent">♞</span>
				<span class="font-display text-xl font-semibold hidden sm:block">Solidity Chess</span>
			</a>

			<!-- Desktop Navigation -->
			<nav class="hidden md:flex items-center gap-6">
				<a
					href="/"
					class="transition-colors {currentPath === '/' ? 'text-chess-accent' : 'text-chess-gray hover:text-chess-light'}"
				>
					Home
				</a>
				<a
					href="/lobby"
					class="transition-colors {currentPath.startsWith('/lobby') ? 'text-chess-accent' : 'text-chess-gray hover:text-chess-light'}"
				>
					Lobby
				</a>
				{#if $wallet.connected}
					<a
						href="/profile"
						class="transition-colors {currentPath === '/profile' ? 'text-chess-accent' : 'text-chess-gray hover:text-chess-light'}"
					>
						Profile
					</a>
				{/if}
				<a
					href="https://github.com/jacmos3/ChessGameSolidity"
					target="_blank"
					rel="noopener noreferrer"
					class="text-chess-gray hover:text-chess-light transition-colors"
				>
					GitHub
				</a>
			</nav>

			<div class="flex items-center gap-3">
				{#if $wallet.connected}
					<span class="hidden sm:inline px-3 py-1.5 rounded-lg text-xs font-medium {$isSupported ? 'bg-chess-success/20 text-chess-success' : 'bg-yellow-500/20 text-yellow-500'}">
						{$networkName}
					</span>
					<a
						href="/profile"
						class="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-chess-accent/10 hover:bg-chess-accent/20 transition-colors"
					>
						<span class="text-chess-accent">♔</span>
						<span class="text-sm">{truncateAddress($wallet.account)}</span>
					</a>
				{:else}
					<button
						class="btn btn-primary text-sm"
						on:click={connect}
						disabled={connecting}
					>
						{connecting ? 'Connecting...' : 'Connect'}
					</button>
				{/if}

				<!-- Mobile menu button -->
				<button
					class="md:hidden p-2 text-chess-gray hover:text-white"
					on:click={() => mobileMenuOpen = !mobileMenuOpen}
				>
					{#if mobileMenuOpen}
						✕
					{:else}
						☰
					{/if}
				</button>
			</div>
		</div>

		<!-- Mobile Navigation -->
		{#if mobileMenuOpen}
			<nav class="md:hidden bg-chess-darker border-t border-chess-accent/10 px-4 py-4 space-y-2">
				<a
					href="/"
					class="block py-2 px-3 rounded-lg {currentPath === '/' ? 'bg-chess-accent/10 text-chess-accent' : 'text-chess-gray'}"
					on:click={() => mobileMenuOpen = false}
				>
					Home
				</a>
				<a
					href="/lobby"
					class="block py-2 px-3 rounded-lg {currentPath.startsWith('/lobby') ? 'bg-chess-accent/10 text-chess-accent' : 'text-chess-gray'}"
					on:click={() => mobileMenuOpen = false}
				>
					Lobby
				</a>
				{#if $wallet.connected}
					<a
						href="/profile"
						class="block py-2 px-3 rounded-lg {currentPath === '/profile' ? 'bg-chess-accent/10 text-chess-accent' : 'text-chess-gray'}"
						on:click={() => mobileMenuOpen = false}
					>
						Profile
					</a>
				{/if}
				<a
					href="https://github.com/jacmos3/ChessGameSolidity"
					target="_blank"
					rel="noopener noreferrer"
					class="block py-2 px-3 rounded-lg text-chess-gray"
					on:click={() => mobileMenuOpen = false}
				>
					GitHub
				</a>
				{#if $wallet.connected}
					<button
						class="w-full text-left py-2 px-3 rounded-lg text-chess-danger"
						on:click={() => { wallet.disconnect(); mobileMenuOpen = false; }}
					>
						Disconnect
					</button>
				{/if}
			</nav>
		{/if}
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

<!-- Onboarding Tour -->
<OnboardingTour />
