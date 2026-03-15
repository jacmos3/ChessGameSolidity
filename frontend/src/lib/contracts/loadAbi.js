const abiLoaders = {
	ArbitratorRegistry: () => import('./abi/ArbitratorRegistry.json'),
	BondingManager: () => import('./abi/BondingManager.json'),
	ChessCore: () => import('./abi/ChessCore.json'),
	ChessFactory: () => import('./abi/ChessFactory.json'),
	ChessGovernor: () => import('./abi/ChessGovernor.json'),
	ChessTimelock: () => import('./abi/ChessTimelock.json'),
	ChessToken: () => import('./abi/ChessToken.json'),
	DisputeDAO: () => import('./abi/DisputeDAO.json'),
	PlayerRating: () => import('./abi/PlayerRating.json')
};

const abiCache = new Map();

export async function loadContractAbi(name) {
	const loader = abiLoaders[name];
	if (!loader) {
		throw new Error(`Unknown contract ABI: ${name}`);
	}

	if (!abiCache.has(name)) {
		abiCache.set(
			name,
			loader().then((module) => module.default)
				.catch((error) => {
					abiCache.delete(name);
					throw error;
				})
		);
	}

	return abiCache.get(name);
}
