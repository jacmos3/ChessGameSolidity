// Deploy state
let provider = null;
let signer = null;
let userAddress = null;
let deployedContracts = {};
let currentStep = 0;
let isDeploying = false;

// Base Sepolia config
const BASE_SEPOLIA_CHAIN_ID = 84532;
const BASE_SEPOLIA_CONFIG = {
    chainId: '0x14A34',
    chainName: 'Base Sepolia',
    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://sepolia.base.org'],
    blockExplorerUrls: ['https://sepolia.basescan.org']
};

// Role hashes
const ROLES = {
    GAME_MANAGER_ROLE: '0x3b5d03f6ca43c0d188593da92c9c5dffa6c02bf4fe4d07d4e993d3951682da61',
    DISPUTE_MANAGER_ROLE: '0x9f930660bebd7804dc28f3e129cf320fa9e4f9df4cd04ff8e32646f99c0f32a4',
    PROPOSER_ROLE: '0xb09aa5aeb3702cfd50b6b62bc4532604938f21248a27a1d5ca736082b6819cc1',
    CANCELLER_ROLE: '0xfd643c72710c63c0180259aba6b2d05451e3591a24e58b62239378085726f783'
};

// Connect wallet
async function connectWallet() {
    if (!window.ethereum) {
        alert('Please install MetaMask!');
        return;
    }

    try {
        provider = new ethers.providers.Web3Provider(window.ethereum);
        await provider.send('eth_requestAccounts', []);
        signer = provider.getSigner();
        userAddress = await signer.getAddress();

        const network = await provider.getNetwork();
        updateWalletUI(network.chainId);

        // Listen for changes
        window.ethereum.on('accountsChanged', handleAccountChange);
        window.ethereum.on('chainChanged', () => window.location.reload());

        // Enable deploy button if on correct network
        if (network.chainId === BASE_SEPOLIA_CHAIN_ID) {
            document.getElementById('deployBtn').disabled = false;
        }

        // Load saved state
        loadState();
    } catch (err) {
        console.error('Connection error:', err);
        alert('Failed to connect: ' + err.message);
    }
}

function updateWalletUI(chainId) {
    const walletStatus = document.getElementById('walletStatus');
    const networkStatus = document.getElementById('networkStatus');
    const walletAddress = document.getElementById('walletAddress');
    const connectBtn = document.getElementById('connectBtn');

    walletStatus.textContent = 'Connected';
    walletStatus.className = 'network-badge connected';
    walletAddress.textContent = userAddress;
    connectBtn.textContent = 'Connected';
    connectBtn.disabled = true;

    if (chainId === BASE_SEPOLIA_CHAIN_ID) {
        networkStatus.textContent = 'Base Sepolia';
        networkStatus.className = 'network-badge connected';
    } else {
        networkStatus.textContent = 'Wrong Network - Click to switch';
        networkStatus.className = 'network-badge wrong';
        networkStatus.style.cursor = 'pointer';
        networkStatus.onclick = switchToBaseSepolia;
    }
}

async function switchToBaseSepolia() {
    try {
        await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: BASE_SEPOLIA_CONFIG.chainId }]
        });
    } catch (err) {
        if (err.code === 4902) {
            await window.ethereum.request({
                method: 'wallet_addEthereumChain',
                params: [BASE_SEPOLIA_CONFIG]
            });
        }
    }
}

function handleAccountChange(accounts) {
    if (accounts.length === 0) {
        window.location.reload();
    } else {
        userAddress = accounts[0];
        document.getElementById('walletAddress').textContent = userAddress;
    }
}

// Deploy functions
async function startDeploy() {
    if (isDeploying) return;
    isDeploying = true;

    const deployBtn = document.getElementById('deployBtn');
    deployBtn.disabled = true;
    deployBtn.textContent = 'Deploying...';

    try {
        await deployAllContracts();
    } catch (err) {
        console.error('Deploy error:', err);
        setStepError(currentStep, err.message);
        document.getElementById('resumeBtn').classList.remove('hidden');
        deployBtn.textContent = 'Start Deployment';
    }

    isDeploying = false;
}

async function resumeDeploy() {
    document.getElementById('resumeBtn').classList.add('hidden');
    await startDeploy();
}

async function deployAllContracts() {
    const teamWallet = document.getElementById('teamWallet').value || userAddress;
    const treasuryWallet = document.getElementById('treasuryWallet').value || userAddress;
    const chessPrice = ethers.utils.parseEther(document.getElementById('chessPrice').value || '0.0001');

    const totalSteps = 12;

    // Step 0: ChessToken
    if (currentStep === 0) {
        setStepActive(0);
        const contract = await deployContract('ChessToken', [teamWallet, treasuryWallet]);
        deployedContracts.ChessToken = contract.address;
        setStepDone(0, contract.address);
        currentStep = 1;
        saveState();
    }

    // Step 1: PlayerRating
    if (currentStep === 1) {
        setStepActive(1);
        const contract = await deployContract('PlayerRating', []);
        deployedContracts.PlayerRating = contract.address;
        setStepDone(1, contract.address);
        currentStep = 2;
        saveState();
    }

    // Step 2: BondingManager
    if (currentStep === 2) {
        setStepActive(2);
        const contract = await deployContract('BondingManager', [deployedContracts.ChessToken, chessPrice]);
        deployedContracts.BondingManager = contract.address;
        setStepDone(2, contract.address);
        currentStep = 3;
        saveState();
    }

    // Step 3: ChessTimelock
    if (currentStep === 3) {
        setStepActive(3);
        const timelockDelay = 172800; // 2 days
        const contract = await deployContract('ChessTimelock', [
            timelockDelay,
            [], // proposers (empty, will add governor)
            ['0x0000000000000000000000000000000000000000'], // executors (anyone)
            userAddress // admin
        ]);
        deployedContracts.ChessTimelock = contract.address;
        setStepDone(3, contract.address);
        currentStep = 4;
        saveState();
    }

    // Step 4: ChessGovernor
    if (currentStep === 4) {
        setStepActive(4);
        const contract = await deployContract('ChessGovernor', [
            deployedContracts.ChessToken,
            deployedContracts.ChessTimelock
        ]);
        deployedContracts.ChessGovernor = contract.address;
        setStepDone(4, contract.address);
        currentStep = 5;
        saveState();
    }

    // Step 5: ArbitratorRegistry
    if (currentStep === 5) {
        setStepActive(5);
        const contract = await deployContract('ArbitratorRegistry', [deployedContracts.ChessToken]);
        deployedContracts.ArbitratorRegistry = contract.address;
        setStepDone(5, contract.address);
        currentStep = 6;
        saveState();
    }

    // Step 6: DisputeDAO
    if (currentStep === 6) {
        setStepActive(6);
        const contract = await deployContract('DisputeDAO', [
            deployedContracts.ChessToken,
            deployedContracts.BondingManager,
            deployedContracts.ArbitratorRegistry
        ]);
        deployedContracts.DisputeDAO = contract.address;
        setStepDone(6, contract.address);
        currentStep = 7;
        saveState();
    }

    // Step 7: RewardPool
    if (currentStep === 7) {
        setStepActive(7);
        const contract = await deployContract('RewardPool', [
            deployedContracts.ChessToken,
            deployedContracts.PlayerRating
        ]);
        deployedContracts.RewardPool = contract.address;
        setStepDone(7, contract.address);
        currentStep = 8;
        saveState();
    }

    // Step 8: ChessMediaLibrary
    if (currentStep === 8) {
        setStepActive(8);
        const contract = await deployContract('ChessMediaLibrary', []);
        deployedContracts.ChessMediaLibrary = contract.address;
        setStepDone(8, contract.address);
        currentStep = 9;
        saveState();
    }

    // Step 9: ChessCore (with linked library)
    if (currentStep === 9) {
        setStepActive(9);
        const contract = await deployContractWithLibrary('ChessCore', [], deployedContracts.ChessMediaLibrary);
        deployedContracts.ChessCore = contract.address;
        setStepDone(9, contract.address);
        currentStep = 10;
        saveState();
    }

    // Step 10: ChessFactory
    if (currentStep === 10) {
        setStepActive(10);
        const contract = await deployContract('ChessFactory', [deployedContracts.ChessCore]);
        deployedContracts.ChessFactory = contract.address;

        // Get ChessNFT address
        const nftAddress = await contract.addressNFT();
        deployedContracts.ChessNFT = nftAddress;

        setStepDone(10, contract.address);
        currentStep = 11;
        saveState();
    }

    // Step 11: Configure Roles
    if (currentStep === 11) {
        setStepActive(11);
        await configureRoles();
        setStepDone(11, 'All roles configured');
        currentStep = 12;
        saveState();
    }

    // Done!
    updateProgress(100);
    updateOutput();
    document.getElementById('successBox').classList.remove('hidden');
    document.getElementById('deployBtn').textContent = 'Deployment Complete!';
}

async function deployContract(name, args) {
    log(`Deploying ${name}...`);

    const contractData = CONTRACTS[name];
    if (!contractData) {
        throw new Error(`Contract ${name} not found`);
    }

    const factory = new ethers.ContractFactory(contractData.abi, contractData.bytecode, signer);

    log(`  Waiting for confirmation...`);
    const contract = await factory.deploy(...args);

    log(`  Transaction: ${contract.deployTransaction.hash}`);
    await contract.deployed();

    log(`  Deployed at: ${contract.address}`);
    return contract;
}

// Deploy contract with library linking (for ChessCore which uses ChessMediaLibrary)
async function deployContractWithLibrary(name, args, libraryAddress) {
    log(`Deploying ${name} with linked library...`);

    const contractData = CONTRACTS[name];
    if (!contractData) {
        throw new Error(`Contract ${name} not found`);
    }

    // Link the library address into the bytecode
    // The placeholder format is: __$<keccak256 hash of library name>$__
    // or for older Solidity: __<LibraryName>_____________________
    let linkedBytecode = contractData.bytecode;

    // Replace the library placeholder with actual address
    // ChessMediaLibrary placeholder (Solidity uses keccak256 hash or padded name)
    const libraryPlaceholder = '__ChessMediaLibrary_____________________';
    const addressWithoutPrefix = libraryAddress.slice(2).toLowerCase(); // Remove 0x prefix

    if (linkedBytecode.includes(libraryPlaceholder)) {
        linkedBytecode = linkedBytecode.split(libraryPlaceholder).join(addressWithoutPrefix);
        log(`  Library linked at: ${libraryAddress}`);
    } else {
        // Try hash-based placeholder format: __$<first 34 chars of keccak256>$__
        // keccak256("contracts/Chess/ChessMediaLibrary.sol:ChessMediaLibrary")
        const hashPlaceholderRegex = /__\$[a-fA-F0-9]{34}\$__/g;
        if (hashPlaceholderRegex.test(linkedBytecode)) {
            linkedBytecode = linkedBytecode.replace(hashPlaceholderRegex, addressWithoutPrefix);
            log(`  Library linked (hash format) at: ${libraryAddress}`);
        }
    }

    const factory = new ethers.ContractFactory(contractData.abi, linkedBytecode, signer);

    log(`  Waiting for confirmation...`);
    const contract = await factory.deploy(...args);

    log(`  Transaction: ${contract.deployTransaction.hash}`);
    await contract.deployed();

    log(`  Deployed at: ${contract.address}`);
    return contract;
}

async function configureRoles() {
    log('Configuring roles and permissions...');

    // Show config progress UI
    const configProgress = document.getElementById('configProgress');
    const configStep = document.getElementById('configStep');
    const configDetail = document.getElementById('configDetail');
    const configBar = document.getElementById('configBar');
    configProgress.classList.remove('hidden');

    const totalConfigs = 11;
    let currentConfig = 0;

    function updateConfigProgress(description) {
        currentConfig++;
        configStep.textContent = currentConfig;
        configDetail.textContent = description;
        configBar.style.width = ((currentConfig / totalConfigs) * 100) + '%';
        log(`  [${currentConfig}/${totalConfigs}] ${description}`);
    }

    // ChessFactory configuration
    const factory = new ethers.Contract(deployedContracts.ChessFactory, CONTRACTS.ChessFactory.abi, signer);

    configDetail.textContent = 'Setting BondingManager on ChessFactory...';
    let tx = await factory.setBondingManager(deployedContracts.BondingManager);
    await tx.wait();
    updateConfigProgress('BondingManager set on ChessFactory');

    configDetail.textContent = 'Setting DisputeDAO on ChessFactory...';
    tx = await factory.setDisputeDAO(deployedContracts.DisputeDAO);
    await tx.wait();
    updateConfigProgress('DisputeDAO set on ChessFactory');

    configDetail.textContent = 'Setting PlayerRating on ChessFactory...';
    tx = await factory.setPlayerRating(deployedContracts.PlayerRating);
    await tx.wait();
    updateConfigProgress('PlayerRating set on ChessFactory');

    configDetail.textContent = 'Setting RewardPool on ChessFactory...';
    tx = await factory.setRewardPool(deployedContracts.RewardPool);
    await tx.wait();
    updateConfigProgress('RewardPool set on ChessFactory');

    // PlayerRating configuration
    const playerRating = new ethers.Contract(deployedContracts.PlayerRating, CONTRACTS.PlayerRating.abi, signer);
    configDetail.textContent = 'Setting ChessFactory on PlayerRating...';
    tx = await playerRating.setChessFactory(deployedContracts.ChessFactory);
    await tx.wait();
    updateConfigProgress('ChessFactory set on PlayerRating');

    // RewardPool configuration
    const rewardPool = new ethers.Contract(deployedContracts.RewardPool, CONTRACTS.RewardPool.abi, signer);
    configDetail.textContent = 'Setting ChessFactory on RewardPool...';
    tx = await rewardPool.setChessFactory(deployedContracts.ChessFactory);
    await tx.wait();
    updateConfigProgress('ChessFactory set on RewardPool');

    // BondingManager roles
    const bondingManager = new ethers.Contract(deployedContracts.BondingManager, CONTRACTS.BondingManager.abi, signer);
    configDetail.textContent = 'Granting GAME_MANAGER_ROLE to ChessFactory...';
    tx = await bondingManager.grantRole(ROLES.GAME_MANAGER_ROLE, deployedContracts.ChessFactory);
    await tx.wait();
    updateConfigProgress('GAME_MANAGER_ROLE granted to ChessFactory');

    configDetail.textContent = 'Granting DISPUTE_MANAGER_ROLE to DisputeDAO...';
    tx = await bondingManager.grantRole(ROLES.DISPUTE_MANAGER_ROLE, deployedContracts.DisputeDAO);
    await tx.wait();
    updateConfigProgress('DISPUTE_MANAGER_ROLE granted on BondingManager');

    // ArbitratorRegistry roles
    const arbitratorRegistry = new ethers.Contract(deployedContracts.ArbitratorRegistry, CONTRACTS.ArbitratorRegistry.abi, signer);
    configDetail.textContent = 'Granting DISPUTE_MANAGER_ROLE on ArbitratorRegistry...';
    tx = await arbitratorRegistry.grantRole(ROLES.DISPUTE_MANAGER_ROLE, deployedContracts.DisputeDAO);
    await tx.wait();
    updateConfigProgress('DISPUTE_MANAGER_ROLE granted on ArbitratorRegistry');

    // ChessTimelock roles
    const timelock = new ethers.Contract(deployedContracts.ChessTimelock, CONTRACTS.ChessTimelock.abi, signer);
    configDetail.textContent = 'Granting PROPOSER_ROLE to ChessGovernor...';
    tx = await timelock.grantRole(ROLES.PROPOSER_ROLE, deployedContracts.ChessGovernor);
    await tx.wait();
    updateConfigProgress('PROPOSER_ROLE granted to ChessGovernor');

    configDetail.textContent = 'Granting CANCELLER_ROLE to ChessGovernor...';
    tx = await timelock.grantRole(ROLES.CANCELLER_ROLE, deployedContracts.ChessGovernor);
    await tx.wait();
    updateConfigProgress('CANCELLER_ROLE granted to ChessGovernor');

    configDetail.textContent = 'All roles configured!';
    log('All roles configured successfully!');
}

// UI Helpers
function setStepActive(index) {
    const step = document.querySelector(`[data-step="${index}"]`);
    step.className = 'step active';
    updateProgress((index / 12) * 100);
}

function setStepDone(index, address) {
    const step = document.querySelector(`[data-step="${index}"]`);
    step.className = 'step done';
    step.querySelector('.step-address').textContent = address;
    updateOutput();
}

function setStepError(index, error) {
    const step = document.querySelector(`[data-step="${index}"]`);
    step.className = 'step error';
    const errorDiv = document.createElement('div');
    errorDiv.className = 'step-error';
    errorDiv.textContent = error;
    step.querySelector('.step-content').appendChild(errorDiv);
}

function updateProgress(percent) {
    document.getElementById('progressBar').style.width = percent + '%';
}

function log(message) {
    console.log(message);
}

function updateOutput() {
    const output = document.getElementById('output');
    let text = `# MyChess.onchain - Deployed Contracts
# Network: Base Sepolia (${BASE_SEPOLIA_CHAIN_ID})
# Date: ${new Date().toISOString()}
# ====================================

`;

    if (deployedContracts.ChessToken) {
        text += `# For frontend/.env:\n\n`;
        text += `VITE_CONTRACT_ADDRESS_BASE_SEPOLIA=${deployedContracts.ChessFactory || ''}\n`;
        text += `VITE_BONDING_MANAGER_BASE_SEPOLIA=${deployedContracts.BondingManager || ''}\n`;
        text += `VITE_CHESS_TOKEN_BASE_SEPOLIA=${deployedContracts.ChessToken || ''}\n`;
        text += `VITE_DISPUTE_DAO_BASE_SEPOLIA=${deployedContracts.DisputeDAO || ''}\n`;
        text += `VITE_ARBITRATOR_REGISTRY_BASE_SEPOLIA=${deployedContracts.ArbitratorRegistry || ''}\n`;
        text += `VITE_GOVERNOR_BASE_SEPOLIA=${deployedContracts.ChessGovernor || ''}\n`;
        text += `VITE_TIMELOCK_BASE_SEPOLIA=${deployedContracts.ChessTimelock || ''}\n`;
        text += `VITE_PLAYER_RATING_BASE_SEPOLIA=${deployedContracts.PlayerRating || ''}\n`;
        text += `\n# Additional addresses:\n`;
        text += `# ChessCore (impl): ${deployedContracts.ChessCore || ''}\n`;
        text += `# ChessNFT: ${deployedContracts.ChessNFT || ''}\n`;
        text += `# RewardPool: ${deployedContracts.RewardPool || ''}\n`;
    }

    output.textContent = text;
}

function copyOutput() {
    const output = document.getElementById('output').textContent;
    navigator.clipboard.writeText(output);
    alert('Copied to clipboard!');
}

function downloadEnv() {
    const output = document.getElementById('output').textContent;
    const blob = new Blob([output], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'deployment-base-sepolia.env';
    a.click();
    URL.revokeObjectURL(url);
}

// State persistence (localStorage)
function saveState() {
    const state = {
        currentStep,
        deployedContracts,
        config: {
            teamWallet: document.getElementById('teamWallet').value,
            treasuryWallet: document.getElementById('treasuryWallet').value,
            chessPrice: document.getElementById('chessPrice').value
        }
    };
    localStorage.setItem('deployState', JSON.stringify(state));
}

function loadState() {
    const saved = localStorage.getItem('deployState');
    if (saved) {
        const state = JSON.parse(saved);
        currentStep = state.currentStep || 0;
        deployedContracts = state.deployedContracts || {};

        if (state.config) {
            document.getElementById('teamWallet').value = state.config.teamWallet || '';
            document.getElementById('treasuryWallet').value = state.config.treasuryWallet || '';
            document.getElementById('chessPrice').value = state.config.chessPrice || '0.0001';
        }

        // Update UI for completed steps
        for (let i = 0; i < currentStep; i++) {
            const step = document.querySelector(`[data-step="${i}"]`);
            step.className = 'step done';
            const contractNames = ['ChessToken', 'PlayerRating', 'BondingManager', 'ChessTimelock',
                                  'ChessGovernor', 'ArbitratorRegistry', 'DisputeDAO', 'RewardPool',
                                  'ChessMediaLibrary', 'ChessCore', 'ChessFactory', 'Roles'];
            step.querySelector('.step-address').textContent = deployedContracts[contractNames[i]] || 'Configured';
        }

        updateProgress((currentStep / 12) * 100);
        updateOutput();

        if (currentStep > 0 && currentStep < 12) {
            document.getElementById('resumeBtn').classList.remove('hidden');
        }
    }
}

function clearState() {
    localStorage.removeItem('deployState');
    window.location.reload();
}
