import { writable, derived } from 'svelte/store';
import { ethers } from 'ethers';

// Supported networks
export const NETWORKS = {
	1337: { name: 'Ganache', explorer: '' },
	5777: { name: 'Ganache', explorer: '' },
	84532: { name: 'Base Sepolia', explorer: 'https://sepolia.basescan.org' },
	8453: { name: 'Base', explorer: 'https://basescan.org' }
};

// Contract addresses per network
const CONTRACT_ADDRESSES = {
	1337: import.meta.env.VITE_CONTRACT_ADDRESS_LOCAL || '',
	5777: import.meta.env.VITE_CONTRACT_ADDRESS_LOCAL || '',
	84532: import.meta.env.VITE_CONTRACT_ADDRESS_BASE_SEPOLIA || '',
	8453: import.meta.env.VITE_CONTRACT_ADDRESS_BASE || ''
};

// Wallet state
function createWalletStore() {
	const { subscribe, set, update } = writable({
		connected: false,
		connecting: false,
		account: null,
		chainId: null,
		balance: null,
		provider: null,
		signer: null,
		error: null
	});

	let accountsChangedHandler = null;
	let chainChangedHandler = null;

	async function refreshWalletState() {
		if (typeof window === 'undefined' || !window.ethereum) return;

		try {
			const provider = new ethers.providers.Web3Provider(window.ethereum);
			const accounts = await provider.listAccounts();

			if (accounts.length === 0) {
				// User disconnected all accounts
				set({
					connected: false,
					connecting: false,
					account: null,
					chainId: null,
					balance: null,
					provider: null,
					signer: null,
					error: null
				});
				return;
			}

			const signer = provider.getSigner();
			const account = await signer.getAddress();
			const network = await provider.getNetwork();
			const balance = await provider.getBalance(account);

			set({
				connected: true,
				connecting: false,
				account,
				chainId: network.chainId,
				balance: ethers.utils.formatEther(balance),
				provider,
				signer,
				error: null
			});
		} catch (err) {
			console.error('Error refreshing wallet state:', err);
		}
	}

	function setupListeners() {
		if (typeof window === 'undefined' || !window.ethereum) return;

		// Clean up existing listeners
		if (accountsChangedHandler) {
			window.ethereum.removeListener('accountsChanged', accountsChangedHandler);
		}
		if (chainChangedHandler) {
			window.ethereum.removeListener('chainChanged', chainChangedHandler);
		}

		// Set up new listeners
		accountsChangedHandler = (accounts) => {
			console.log('Accounts changed:', accounts);
			refreshWalletState();
		};

		chainChangedHandler = (chainIdHex) => {
			console.log('Chain changed:', chainIdHex);
			refreshWalletState();
		};

		window.ethereum.on('accountsChanged', accountsChangedHandler);
		window.ethereum.on('chainChanged', chainChangedHandler);
	}

	return {
		subscribe,

		async connect() {
			if (typeof window === 'undefined' || !window.ethereum) {
				update(s => ({ ...s, error: 'Please install MetaMask' }));
				return;
			}

			update(s => ({ ...s, connecting: true, error: null }));

			try {
				const provider = new ethers.providers.Web3Provider(window.ethereum);
				await provider.send('eth_requestAccounts', []);

				const signer = provider.getSigner();
				const account = await signer.getAddress();
				const network = await provider.getNetwork();
				const balance = await provider.getBalance(account);

				set({
					connected: true,
					connecting: false,
					account,
					chainId: network.chainId,
					balance: ethers.utils.formatEther(balance),
					provider,
					signer,
					error: null
				});

				// Setup listeners for account/chain changes
				setupListeners();

			} catch (err) {
				update(s => ({
					...s,
					connecting: false,
					error: err.message || 'Failed to connect'
				}));
			}
		},

		disconnect() {
			// Clean up listeners
			if (typeof window !== 'undefined' && window.ethereum) {
				if (accountsChangedHandler) {
					window.ethereum.removeListener('accountsChanged', accountsChangedHandler);
					accountsChangedHandler = null;
				}
				if (chainChangedHandler) {
					window.ethereum.removeListener('chainChanged', chainChangedHandler);
					chainChangedHandler = null;
				}
			}

			set({
				connected: false,
				connecting: false,
				account: null,
				chainId: null,
				balance: null,
				provider: null,
				signer: null,
				error: null
			});
		},

		clearError() {
			update(s => ({ ...s, error: null }));
		},

		// Refresh balance only
		async refreshBalance() {
			update(s => {
				if (!s.provider || !s.account) return s;
				s.provider.getBalance(s.account).then(balance => {
					update(state => ({
						...state,
						balance: ethers.utils.formatEther(balance)
					}));
				});
				return s;
			});
		}
	};
}

export const wallet = createWalletStore();

// Derived stores
export const networkName = derived(wallet, $wallet => {
	if (!$wallet.chainId) return null;
	return NETWORKS[$wallet.chainId]?.name || `Unknown (${$wallet.chainId})`;
});

export const isSupported = derived(wallet, $wallet => {
	if (!$wallet.chainId) return false;
	return !!NETWORKS[$wallet.chainId];
});

export const contractAddress = derived(wallet, $wallet => {
	if (!$wallet.chainId) return null;
	return CONTRACT_ADDRESSES[$wallet.chainId] || null;
});

export const explorer = derived(wallet, $wallet => {
	if (!$wallet.chainId) return null;
	return NETWORKS[$wallet.chainId]?.explorer || null;
});

// Utility
export function truncateAddress(address) {
	if (!address) return '';
	return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
