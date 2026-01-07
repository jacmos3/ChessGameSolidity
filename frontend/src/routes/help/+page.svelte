<script>
	import { wallet } from '$lib/stores/wallet.js';

	let activeSection = 'getting-started';

	const sections = [
		{ id: 'getting-started', title: 'Getting Started', icon: '🚀' },
		{ id: 'wallet', title: 'Connecting Wallet', icon: '👛' },
		{ id: 'bonds', title: 'Bond System', icon: '🔒' },
		{ id: 'playing', title: 'Playing Chess', icon: '♟️' },
		{ id: 'rating', title: 'ELO Rating', icon: '📊' },
		{ id: 'disputes', title: 'Dispute Resolution', icon: '⚖️' },
		{ id: 'arbitrator', title: 'Becoming an Arbitrator', icon: '🏛️' },
		{ id: 'governance', title: 'Governance', icon: '🗳️' },
		{ id: 'faq', title: 'FAQ', icon: '❓' }
	];

	function scrollToSection(id) {
		activeSection = id;
		document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
	}
</script>

<svelte:head>
	<title>Help & Documentation - Solidity Chess</title>
</svelte:head>

<div class="min-h-screen bg-chess-darker">
	<!-- Header -->
	<div class="bg-chess-dark border-b border-chess-accent/20 py-8">
		<div class="max-w-6xl mx-auto px-4">
			<h1 class="font-display text-4xl text-center mb-2">User Guide</h1>
			<p class="text-chess-gray text-center">Everything you need to know about Solidity Chess</p>
		</div>
	</div>

	<div class="max-w-6xl mx-auto px-4 py-8 flex gap-8">
		<!-- Sidebar Navigation -->
		<nav class="hidden lg:block w-64 flex-shrink-0">
			<div class="sticky top-8 card p-4">
				<h3 class="text-sm font-semibold text-chess-gray uppercase tracking-wider mb-4">Contents</h3>
				<ul class="space-y-1">
					{#each sections as section}
						<li>
							<button
								class="w-full text-left px-3 py-2 rounded-lg transition-colors flex items-center gap-2
									{activeSection === section.id ? 'bg-chess-accent/20 text-chess-accent' : 'text-chess-light hover:bg-chess-darker'}"
								on:click={() => scrollToSection(section.id)}
							>
								<span>{section.icon}</span>
								<span class="text-sm">{section.title}</span>
							</button>
						</li>
					{/each}
				</ul>
			</div>
		</nav>

		<!-- Main Content -->
		<main class="flex-1 max-w-3xl">
			<!-- Getting Started -->
			<section id="getting-started" class="card mb-8">
				<h2 class="font-display text-2xl mb-6 flex items-center gap-3">
					<span class="text-3xl">🚀</span> Getting Started
				</h2>

				<h3 class="text-lg font-semibold mb-3">What You Need</h3>
				<ul class="list-disc list-inside space-y-2 text-chess-light mb-6">
					<li><strong>MetaMask</strong> or any Web3-compatible wallet</li>
					<li><strong>ETH</strong> for gas fees and game stakes</li>
					<li><strong>CHESS tokens</strong> for bonding (anti-cheating collateral)</li>
				</ul>

				<h3 class="text-lg font-semibold mb-3">Supported Networks</h3>
				<div class="grid grid-cols-2 gap-3">
					<div class="p-3 bg-chess-darker rounded-lg">
						<div class="font-medium">Ethereum Mainnet</div>
						<div class="text-chess-gray text-sm">Production</div>
					</div>
					<div class="p-3 bg-chess-darker rounded-lg">
						<div class="font-medium">Sepolia Testnet</div>
						<div class="text-chess-gray text-sm">Testing</div>
					</div>
					<div class="p-3 bg-chess-darker rounded-lg">
						<div class="font-medium">Holesky Testnet</div>
						<div class="text-chess-gray text-sm">Testing</div>
					</div>
					<div class="p-3 bg-chess-darker rounded-lg">
						<div class="font-medium">Linea Sepolia</div>
						<div class="text-chess-gray text-sm">L2 Testing</div>
					</div>
				</div>
			</section>

			<!-- Connecting Wallet -->
			<section id="wallet" class="card mb-8">
				<h2 class="font-display text-2xl mb-6 flex items-center gap-3">
					<span class="text-3xl">👛</span> Connecting Your Wallet
				</h2>

				<ol class="list-decimal list-inside space-y-3 text-chess-light">
					<li>Click <strong>"Connect Wallet"</strong> in the top right corner</li>
					<li>Select MetaMask (or your preferred wallet)</li>
					<li>Approve the connection request</li>
					<li>Make sure you're on a supported network</li>
				</ol>

				<div class="mt-6 p-4 bg-chess-accent/10 border border-chess-accent/30 rounded-lg">
					<p class="text-sm">
						<strong class="text-chess-accent">Tip:</strong> Once connected, you'll see your address and ETH balance in the header.
					</p>
				</div>
			</section>

			<!-- Bond System -->
			<section id="bonds" class="card mb-8">
				<h2 class="font-display text-2xl mb-6 flex items-center gap-3">
					<span class="text-3xl">🔒</span> Understanding the Bond System
				</h2>

				<h3 class="text-lg font-semibold mb-3">Why Bonds?</h3>
				<p class="text-chess-light mb-6">
					To prevent cheating and ensure fair play, all players must deposit a bond before playing.
					This bond acts as collateral - if you're caught cheating, you lose it.
				</p>

				<h3 class="text-lg font-semibold mb-3">How It Works</h3>
				<p class="text-chess-light mb-4">The bond consists of two parts:</p>
				<div class="grid grid-cols-2 gap-4 mb-6">
					<div class="p-4 bg-chess-darker rounded-lg border-l-4 border-chess-purple">
						<div class="font-bold text-lg">CHESS Tokens</div>
						<div class="text-chess-gray">3x your stake</div>
					</div>
					<div class="p-4 bg-chess-darker rounded-lg border-l-4 border-chess-blue">
						<div class="font-bold text-lg">ETH</div>
						<div class="text-chess-gray">2x your stake</div>
					</div>
				</div>

				<div class="p-4 bg-chess-darker rounded-lg mb-6">
					<h4 class="font-semibold mb-2">Example: 0.1 ETH Game</h4>
					<ul class="text-chess-light space-y-1">
						<li>• CHESS required: ~0.3 ETH worth of tokens</li>
						<li>• ETH required: 0.2 ETH bonded</li>
					</ul>
				</div>

				<h3 class="text-lg font-semibold mb-3">Depositing Your Bond</h3>
				<ol class="list-decimal list-inside space-y-2 text-chess-light mb-6">
					<li>Go to <a href="/profile" class="text-chess-accent hover:underline">Profile</a> page</li>
					<li>Find the "Bond Management" section</li>
					<li>Enter the amount of CHESS tokens to deposit</li>
					<li>Enter the amount of ETH to deposit</li>
					<li>Click "Deposit Bond"</li>
					<li>Confirm the transaction in MetaMask</li>
				</ol>

				<div class="p-4 bg-chess-danger/10 border border-chess-danger/30 rounded-lg">
					<p class="text-sm">
						<strong class="text-chess-danger">Important:</strong> Bonds are locked while you have active games.
						Complete your games first to unlock your full bond.
					</p>
				</div>
			</section>

			<!-- Playing Chess -->
			<section id="playing" class="card mb-8">
				<h2 class="font-display text-2xl mb-6 flex items-center gap-3">
					<span class="text-3xl">♟️</span> Playing Chess
				</h2>

				<h3 class="text-lg font-semibold mb-3">Creating a Game</h3>
				<ol class="list-decimal list-inside space-y-2 text-chess-light mb-6">
					<li>Go to <a href="/lobby" class="text-chess-accent hover:underline">Lobby</a> page</li>
					<li>Click "Create Game"</li>
					<li>Configure your game settings</li>
					<li>Click "Create Game" and confirm the transaction</li>
				</ol>

				<h3 class="text-lg font-semibold mb-3">Game Settings</h3>
				<div class="overflow-x-auto mb-6">
					<table class="w-full text-sm">
						<thead>
							<tr class="border-b border-chess-dark">
								<th class="text-left py-2 text-chess-gray">Setting</th>
								<th class="text-left py-2 text-chess-gray">Options</th>
							</tr>
						</thead>
						<tbody class="text-chess-light">
							<tr class="border-b border-chess-dark">
								<td class="py-2 font-medium">Stake</td>
								<td class="py-2">0.001 - 100 ETH</td>
							</tr>
							<tr class="border-b border-chess-dark">
								<td class="py-2 font-medium">Time Control</td>
								<td class="py-2">Blitz (~1h) / Rapid (~7h) / Classical (~7d)</td>
							</tr>
							<tr>
								<td class="py-2 font-medium">Mode</td>
								<td class="py-2">Tournament (strict) / Friendly (forgiving)</td>
							</tr>
						</tbody>
					</table>
				</div>

				<h3 class="text-lg font-semibold mb-3">Making Moves</h3>
				<ul class="list-disc list-inside space-y-2 text-chess-light mb-6">
					<li><strong>Click</strong> on a piece to select it, then click the destination</li>
					<li>Or <strong>drag and drop</strong> pieces directly</li>
					<li>Valid moves are highlighted in <span class="text-chess-success">green</span></li>
				</ul>

				<h3 class="text-lg font-semibold mb-3">Special Moves</h3>
				<div class="grid gap-3 mb-6">
					<div class="p-3 bg-chess-darker rounded-lg flex items-center gap-3">
						<span class="text-2xl">♔♖</span>
						<div>
							<div class="font-medium">Castling</div>
							<div class="text-chess-gray text-sm">Move King two squares toward Rook</div>
						</div>
					</div>
					<div class="p-3 bg-chess-darker rounded-lg flex items-center gap-3">
						<span class="text-2xl">♙</span>
						<div>
							<div class="font-medium">En Passant</div>
							<div class="text-chess-gray text-sm">Capture pawn that just moved two squares</div>
						</div>
					</div>
					<div class="p-3 bg-chess-darker rounded-lg flex items-center gap-3">
						<span class="text-2xl">♕</span>
						<div>
							<div class="font-medium">Pawn Promotion</div>
							<div class="text-chess-gray text-sm">Promote pawn when reaching opposite end</div>
						</div>
					</div>
				</div>

				<h3 class="text-lg font-semibold mb-3">Game Controls</h3>
				<div class="overflow-x-auto">
					<table class="w-full text-sm">
						<thead>
							<tr class="border-b border-chess-dark">
								<th class="text-left py-2 text-chess-gray">Action</th>
								<th class="text-left py-2 text-chess-gray">How</th>
							</tr>
						</thead>
						<tbody class="text-chess-light">
							<tr class="border-b border-chess-dark">
								<td class="py-2">Resign</td>
								<td class="py-2">Click "Resign" button</td>
							</tr>
							<tr class="border-b border-chess-dark">
								<td class="py-2">Offer Draw</td>
								<td class="py-2">Click "Offer Draw"</td>
							</tr>
							<tr class="border-b border-chess-dark">
								<td class="py-2">Accept Draw</td>
								<td class="py-2">Click "Accept" when opponent offers</td>
							</tr>
							<tr>
								<td class="py-2">Claim Timeout Victory</td>
								<td class="py-2">Click "Claim Victory" when opponent times out</td>
							</tr>
						</tbody>
					</table>
				</div>
			</section>

			<!-- ELO Rating -->
			<section id="rating" class="card mb-8">
				<h2 class="font-display text-2xl mb-6 flex items-center gap-3">
					<span class="text-3xl">📊</span> ELO Rating System
				</h2>

				<h3 class="text-lg font-semibold mb-3">Rating Levels</h3>
				<div class="overflow-x-auto mb-6">
					<table class="w-full text-sm">
						<thead>
							<tr class="border-b border-chess-dark">
								<th class="text-left py-2 text-chess-gray">Rating</th>
								<th class="text-left py-2 text-chess-gray">Level</th>
							</tr>
						</thead>
						<tbody class="text-chess-light">
							<tr class="border-b border-chess-dark"><td class="py-2">&lt; 1000</td><td class="py-2">Beginner</td></tr>
							<tr class="border-b border-chess-dark"><td class="py-2">1000-1200</td><td class="py-2">Casual</td></tr>
							<tr class="border-b border-chess-dark"><td class="py-2">1200-1400</td><td class="py-2">Intermediate</td></tr>
							<tr class="border-b border-chess-dark"><td class="py-2">1400-1600</td><td class="py-2">Club Player</td></tr>
							<tr class="border-b border-chess-dark"><td class="py-2">1600-1800</td><td class="py-2">Strong Club</td></tr>
							<tr class="border-b border-chess-dark"><td class="py-2">1800-2000</td><td class="py-2">Expert</td></tr>
							<tr class="border-b border-chess-dark"><td class="py-2">2000-2200</td><td class="py-2">Candidate Master</td></tr>
							<tr><td class="py-2">2200+</td><td class="py-2">Master</td></tr>
						</tbody>
					</table>
				</div>

				<div class="p-4 bg-chess-accent/10 border border-chess-accent/30 rounded-lg">
					<p class="text-sm">
						<strong class="text-chess-accent">Starting Rating:</strong> All players begin at 1200 ELO.
					</p>
				</div>
			</section>

			<!-- Disputes -->
			<section id="disputes" class="card mb-8">
				<h2 class="font-display text-2xl mb-6 flex items-center gap-3">
					<span class="text-3xl">⚖️</span> Dispute Resolution
				</h2>

				<h3 class="text-lg font-semibold mb-3">What is a Dispute?</h3>
				<p class="text-chess-light mb-6">
					If you suspect your opponent cheated (used an engine, exploited a bug, etc.),
					you can challenge the game result within 48 hours.
				</p>

				<h3 class="text-lg font-semibold mb-3">How to Challenge</h3>
				<ol class="list-decimal list-inside space-y-2 text-chess-light mb-6">
					<li>Go to the completed game</li>
					<li>Click "Challenge Result"</li>
					<li>Deposit the challenge fee (50 CHESS)</li>
					<li>Provide evidence/explanation</li>
				</ol>

				<h3 class="text-lg font-semibold mb-3">Escalation Levels</h3>
				<div class="grid grid-cols-3 gap-3">
					<div class="p-3 bg-chess-darker rounded-lg text-center">
						<div class="text-2xl font-bold text-chess-accent">5</div>
						<div class="text-sm text-chess-gray">Level 1 Arbitrators</div>
					</div>
					<div class="p-3 bg-chess-darker rounded-lg text-center">
						<div class="text-2xl font-bold text-chess-accent">11</div>
						<div class="text-sm text-chess-gray">Level 2 Arbitrators</div>
					</div>
					<div class="p-3 bg-chess-darker rounded-lg text-center">
						<div class="text-2xl font-bold text-chess-accent">21</div>
						<div class="text-sm text-chess-gray">Level 3 Arbitrators</div>
					</div>
				</div>
			</section>

			<!-- Arbitrator -->
			<section id="arbitrator" class="card mb-8">
				<h2 class="font-display text-2xl mb-6 flex items-center gap-3">
					<span class="text-3xl">🏛️</span> Becoming an Arbitrator
				</h2>

				<h3 class="text-lg font-semibold mb-3">Staking Tiers</h3>
				<div class="overflow-x-auto mb-6">
					<table class="w-full text-sm">
						<thead>
							<tr class="border-b border-chess-dark">
								<th class="text-left py-2 text-chess-gray">Tier</th>
								<th class="text-left py-2 text-chess-gray">Min Stake</th>
								<th class="text-left py-2 text-chess-gray">Max Disputes/Week</th>
							</tr>
						</thead>
						<tbody class="text-chess-light">
							<tr class="border-b border-chess-dark">
								<td class="py-2">Tier 1</td>
								<td class="py-2">1,000 CHESS</td>
								<td class="py-2">5</td>
							</tr>
							<tr class="border-b border-chess-dark">
								<td class="py-2">Tier 2</td>
								<td class="py-2">5,000 CHESS</td>
								<td class="py-2">10</td>
							</tr>
							<tr>
								<td class="py-2">Tier 3</td>
								<td class="py-2">20,000 CHESS</td>
								<td class="py-2">20</td>
							</tr>
						</tbody>
					</table>
				</div>

				<div class="p-4 bg-chess-danger/10 border border-chess-danger/30 rounded-lg">
					<p class="text-sm">
						<strong class="text-chess-danger">7-Day Timelock:</strong> After staking, you must wait 7 days before you can vote.
						This prevents flash loan attacks.
					</p>
				</div>
			</section>

			<!-- Governance -->
			<section id="governance" class="card mb-8">
				<h2 class="font-display text-2xl mb-6 flex items-center gap-3">
					<span class="text-3xl">🗳️</span> Governance
				</h2>

				<h3 class="text-lg font-semibold mb-3">CHESS Token Uses</h3>
				<ul class="list-disc list-inside space-y-2 text-chess-light mb-6">
					<li>Bonding (anti-cheat collateral)</li>
					<li>Arbitrator staking</li>
					<li>Governance voting</li>
					<li>Earning rewards</li>
				</ul>

				<h3 class="text-lg font-semibold mb-3">Proposal Lifecycle</h3>
				<div class="flex flex-wrap gap-2">
					<span class="px-3 py-1 rounded-full bg-chess-gray/20 text-sm">Pending (1 day)</span>
					<span class="text-chess-gray">→</span>
					<span class="px-3 py-1 rounded-full bg-chess-blue/20 text-chess-blue text-sm">Active (5 days)</span>
					<span class="text-chess-gray">→</span>
					<span class="px-3 py-1 rounded-full bg-chess-success/20 text-chess-success text-sm">Succeeded</span>
					<span class="text-chess-gray">→</span>
					<span class="px-3 py-1 rounded-full bg-chess-purple/20 text-chess-purple text-sm">Queued (2 days)</span>
					<span class="text-chess-gray">→</span>
					<span class="px-3 py-1 rounded-full bg-chess-accent/20 text-chess-accent text-sm">Executed</span>
				</div>
			</section>

			<!-- FAQ -->
			<section id="faq" class="card mb-8">
				<h2 class="font-display text-2xl mb-6 flex items-center gap-3">
					<span class="text-3xl">❓</span> Frequently Asked Questions
				</h2>

				<div class="space-y-4">
					<details class="bg-chess-darker rounded-lg">
						<summary class="p-4 cursor-pointer font-medium hover:text-chess-accent">
							Is my money safe?
						</summary>
						<div class="px-4 pb-4 text-chess-light">
							Funds are held in smart contracts using industry-standard security practices.
							However, like all DeFi applications, there are inherent risks. Only play with what you can afford to lose.
						</div>
					</details>

					<details class="bg-chess-darker rounded-lg">
						<summary class="p-4 cursor-pointer font-medium hover:text-chess-accent">
							What happens if I disconnect mid-game?
						</summary>
						<div class="px-4 pb-4 text-chess-light">
							The game continues on-chain. Reconnect with the same wallet to resume.
							If you don't move within the time limit, your opponent can claim victory by timeout.
						</div>
					</details>

					<details class="bg-chess-darker rounded-lg">
						<summary class="p-4 cursor-pointer font-medium hover:text-chess-accent">
							Can I play multiple games at once?
						</summary>
						<div class="px-4 pb-4 text-chess-light">
							Yes! Each game is independent. Just make sure you have enough bond deposited for all active games.
						</div>
					</details>

					<details class="bg-chess-darker rounded-lg">
						<summary class="p-4 cursor-pointer font-medium hover:text-chess-accent">
							Why do I need both CHESS and ETH for bonding?
						</summary>
						<div class="px-4 pb-4 text-chess-light">
							The hybrid bond prevents attackers from using only one asset to manipulate the system.
							It creates a stronger economic deterrent against cheating.
						</div>
					</details>

					<details class="bg-chess-darker rounded-lg">
						<summary class="p-4 cursor-pointer font-medium hover:text-chess-accent">
							Can I lose my bond if I lose a game fairly?
						</summary>
						<div class="px-4 pb-4 text-chess-light">
							No! You only lose your bond if you're caught cheating and lose a dispute.
							Fair losses only cost your stake, not your bond.
						</div>
					</details>

					<details class="bg-chess-darker rounded-lg">
						<summary class="p-4 cursor-pointer font-medium hover:text-chess-accent">
							What's the difference between Tournament and Friendly mode?
						</summary>
						<div class="px-4 pb-4 text-chess-light">
							In <strong>Tournament mode</strong>, an illegal move (like moving into check) results in automatic loss.
							In <strong>Friendly mode</strong>, illegal moves are simply rejected, and you can try again.
						</div>
					</details>

					<details class="bg-chess-darker rounded-lg">
						<summary class="p-4 cursor-pointer font-medium hover:text-chess-accent">
							Why are gas fees high for moves?
						</summary>
						<div class="px-4 pb-4 text-chess-light">
							Chess logic validation on-chain is complex. We've optimized where possible,
							but full move validation has computational costs. Consider playing on L2 networks when available.
						</div>
					</details>
				</div>
			</section>

			<!-- Need Help -->
			<section class="card text-center">
				<h2 class="font-display text-2xl mb-4">Still Need Help?</h2>
				<p class="text-chess-gray mb-6">
					Can't find what you're looking for? Reach out to the community!
				</p>
				<div class="flex flex-wrap justify-center gap-4">
					<a href="https://github.com" target="_blank" rel="noopener"
						class="btn btn-secondary flex items-center gap-2">
						<span>GitHub</span>
					</a>
					<a href="https://discord.com" target="_blank" rel="noopener"
						class="btn btn-secondary flex items-center gap-2">
						<span>Discord</span>
					</a>
					<a href="https://twitter.com" target="_blank" rel="noopener"
						class="btn btn-secondary flex items-center gap-2">
						<span>Twitter</span>
					</a>
				</div>
			</section>
		</main>
	</div>
</div>

<style>
	details summary::-webkit-details-marker {
		display: none;
	}

	details summary::before {
		content: '▶';
		display: inline-block;
		margin-right: 0.5rem;
		transition: transform 0.2s;
	}

	details[open] summary::before {
		transform: rotate(90deg);
	}
</style>
