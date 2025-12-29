import { writable, derived } from 'svelte/store';
import { ethers } from 'ethers';

// Supported networks
export const NETWORKS = {
	1337: { name: 'Ganache', explorer: '' },
	5777: { name: 'Ganache', explorer: '' },
	11155111: { name: 'Sepolia', explorer: 'https://sepolia.etherscan.io' },
	17000: { name: 'Holesky', explorer: 'https://holesky.etherscan.io' },
	59141: { name: 'Linea Sepolia', explorer: 'https://sepolia.lineascan.build' }
};

// Contract addresses per network
const CONTRACT_ADDRESSES = {
	1337: import.meta.env.VITE_CONTRACT_ADDRESS_LOCAL || '',
	5777: import.meta.env.VITE_CONTRACT_ADDRESS_LOCAL || '',
	11155111: import.meta.env.VITE_CONTRACT_ADDRESS_SEPOLIA || '',
	17000: import.meta.env.VITE_CONTRACT_ADDRESS_HOLESKY || '',
	59141: import.meta.env.VITE_CONTRACT_ADDRESS_LINEA || ''
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

				// Listen for account changes
				window.ethereum.on('accountsChanged', () => window.location.reload());
				window.ethereum.on('chainChanged', () => window.location.reload());

			} catch (err) {
				update(s => ({
					...s,
					connecting: false,
					error: err.message || 'Failed to connect'
				}));
			}
		},

		disconnect() {
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
