const ChessToken = artifacts.require("ChessToken");
const BondingManager = artifacts.require("BondingManager");
const RewardPool = artifacts.require("RewardPool");
const ArbitratorRegistry = artifacts.require("ArbitratorRegistry");
const DisputeDAO = artifacts.require("DisputeDAO");
const ChessMediaLibrary = artifacts.require("ChessMediaLibrary");
const ChessCore = artifacts.require("ChessCore");
const ChessFactory = artifacts.require("ChessFactory");
const ChessNFT = artifacts.require("ChessNFT");
const ChessTimelock = artifacts.require("ChessTimelock");
const ChessGovernor = artifacts.require("ChessGovernor");
const PlayerRating = artifacts.require("PlayerRating");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Current linked bytecode estimates at roughly 6.5M gas on Base.
const CHESS_CORE_DEPLOY_GAS = 8_000_000;

async function captureDeploymentProvenance(entries, expectedDeployer) {
  const networkId = String(await web3.eth.net.getId());
  const deployments = {};

  for (const [name, abstraction, instance] of entries) {
    const artifactNetwork = abstraction._json?.networks?.[networkId];
    const txHash = instance.transactionHash || artifactNetwork?.transactionHash;
    if (!txHash) throw new Error(`${name}: deployment transaction hash unavailable`);

    const [receipt, transaction] = await Promise.all([
      web3.eth.getTransactionReceipt(txHash),
      web3.eth.getTransaction(txHash)
    ]);
    if (!receipt || !transaction || !receipt.contractAddress) {
      throw new Error(`${name}: incomplete deployment transaction provenance`);
    }
    if (transaction.from.toLowerCase() !== expectedDeployer.toLowerCase()) {
      throw new Error(`${name}: unexpected deployment sender ${transaction.from}`);
    }
    deployments[name] = {
      txHash,
      blockNumber: Number(receipt.blockNumber),
      blockHash: receipt.blockHash,
      from: transaction.from,
      address: receipt.contractAddress
    };
  }

  return {
    chainId: Number(await web3.eth.getChainId()),
    deploymentBlock: Math.min(...Object.values(deployments).map((entry) => entry.blockNumber)),
    deployments
  };
}

module.exports = async function (deployer, network, accounts) {
  const admin = accounts[0];

  // Configuration based on network
  const config = getNetworkConfig(network, accounts);

  console.log("\n===========================================");
  console.log("  Chess Game Anti-Cheating System Deploy");
  console.log("===========================================");
  console.log(`Network: ${network}`);
  console.log(`Admin: ${admin}`);
  console.log(`Treasury: ${config.treasury}`);
  console.log(`Team Wallet: ${config.teamWallet}`);
  console.log("-------------------------------------------\n");

  // =========================================
  // PHASE 1: Deploy Core Token
  // =========================================
  console.log("PHASE 1: Deploying ChessToken...");

  await deployer.deploy(
    ChessToken,
    config.teamWallet,
    config.treasury,
    { from: admin }
  );
  const chessToken = await ChessToken.deployed();
  console.log(`  ChessToken deployed at: ${chessToken.address}`);

  // =========================================
  // PHASE 2: Deploy BondingManager
  // =========================================
  console.log("\nPHASE 2: Deploying BondingManager...");

  await deployer.deploy(
    BondingManager,
    chessToken.address,
    config.initialChessPrice,
    { from: admin }
  );
  const bondingManager = await BondingManager.deployed();
  console.log(`  BondingManager deployed at: ${bondingManager.address}`);

  // =========================================
  // PHASE 3: Deploy ArbitratorRegistry
  // =========================================
  console.log("\nPHASE 3: Deploying ArbitratorRegistry...");

  await deployer.deploy(
    ArbitratorRegistry,
    chessToken.address,
    { from: admin }
  );
  const arbitratorRegistry = await ArbitratorRegistry.deployed();
  console.log(`  ArbitratorRegistry deployed at: ${arbitratorRegistry.address}`);

  // =========================================
  // PHASE 4: Deploy DisputeDAO
  // =========================================
  console.log("\nPHASE 4: Deploying DisputeDAO...");

  await deployer.deploy(
    DisputeDAO,
    chessToken.address,
    bondingManager.address,
    arbitratorRegistry.address,
    { from: admin }
  );
  const disputeDAO = await DisputeDAO.deployed();
  console.log(`  DisputeDAO deployed at: ${disputeDAO.address}`);

  // =========================================
  // PHASE 5: Deploy ChessCore Implementation & ChessFactory
  // =========================================
  console.log("\nPHASE 5: Deploying ChessCore implementation and ChessFactory...");

  // 5.1 Deploy ChessMediaLibrary (required by ChessCore)
  await deployer.deploy(ChessMediaLibrary, { from: admin });
  const chessMediaLibrary = await ChessMediaLibrary.deployed();
  console.log(`  ChessMediaLibrary deployed at: ${chessMediaLibrary.address}`);

  // 5.2 Link library to ChessCore and deploy implementation
  await deployer.link(ChessMediaLibrary, ChessCore);
  await deployer.deploy(ChessCore, { from: admin, gas: CHESS_CORE_DEPLOY_GAS });
  const chessCoreImpl = await ChessCore.deployed();
  const chessRulesEngineAddress = await chessCoreImpl.rulesEngine();
  console.log(`  ChessCore implementation deployed at: ${chessCoreImpl.address}`);
  console.log(`  ChessRulesEngine deployed at: ${chessRulesEngineAddress}`);

  // 5.2 Deploy ChessFactory with implementation address
  await deployer.deploy(ChessFactory, chessCoreImpl.address, { from: admin });
  const chessFactory = await ChessFactory.deployed();
  console.log(`  ChessFactory deployed at: ${chessFactory.address}`);

  // Get ChessNFT address (created by ChessFactory)
  const chessNFTAddress = await chessFactory.addressNFT();
  console.log(`  ChessNFT deployed at: ${chessNFTAddress}`);

  // =========================================
  // PHASE 6: Deploy Governance (Timelock + Governor)
  // =========================================
  console.log("\nPHASE 6: Deploying Governance contracts...");

  // 6.1 Deploy Timelock with 2-day delay
  const timelockDelay = config.timelockDelay || 2 * 24 * 60 * 60; // 2 days in seconds
  const proposers = []; // Will be set to Governor after deployment
  const executors = ["0x0000000000000000000000000000000000000000"]; // Anyone can execute after delay

  await deployer.deploy(
    ChessTimelock,
    timelockDelay,
    proposers,
    executors,
    admin,
    { from: admin }
  );
  const chessTimelock = await ChessTimelock.deployed();
  console.log(`  ChessTimelock deployed at: ${chessTimelock.address}`);

  // 6.2 Deploy Governor
  await deployer.deploy(
    ChessGovernor,
    chessToken.address,
    chessTimelock.address,
    { from: admin }
  );
  const chessGovernor = await ChessGovernor.deployed();
  console.log(`  ChessGovernor deployed at: ${chessGovernor.address}`);

  // 6.3 Configure Timelock - grant Governor the proposer role
  const PROPOSER_ROLE = await chessTimelock.PROPOSER_ROLE();
  const CANCELLER_ROLE = await chessTimelock.CANCELLER_ROLE();
  console.log("  Granting PROPOSER_ROLE to ChessGovernor on Timelock...");
  await chessTimelock.grantRole(PROPOSER_ROLE, chessGovernor.address, { from: admin });
  console.log("  Granting CANCELLER_ROLE to ChessGovernor on Timelock...");
  await chessTimelock.grantRole(CANCELLER_ROLE, chessGovernor.address, { from: admin });

  // =========================================
  // PHASE 6.5: Deploy PlayerRating
  // =========================================
  console.log("\nPHASE 6.5: Deploying PlayerRating...");

  await deployer.deploy(PlayerRating, { from: admin });
  const playerRating = await PlayerRating.deployed();
  console.log(`  PlayerRating deployed at: ${playerRating.address}`);

  // =========================================
  // PHASE 6.6: Deploy RewardPool
  // =========================================
  console.log("\nPHASE 6.6: Deploying RewardPool...");

  await deployer.deploy(
    RewardPool,
    chessToken.address,
    playerRating.address,
    { from: admin }
  );
  const rewardPool = await RewardPool.deployed();
  console.log(`  RewardPool deployed at: ${rewardPool.address}`);

  // =========================================
  // PHASE 7: Configure Roles & Permissions
  // =========================================
  console.log("\nPHASE 7: Configuring roles and permissions...");

  // 7.1 Configure ChessFactory with anti-cheating contracts
  console.log("  Setting BondingManager on ChessFactory...");
  await chessFactory.setBondingManager(bondingManager.address, { from: admin });

  console.log("  Setting DisputeDAO on ChessFactory...");
  await chessFactory.setDisputeDAO(disputeDAO.address, { from: admin });

  console.log("  Setting ChessFactory on BondingManager...");
  await bondingManager.setChessFactory(chessFactory.address, { from: admin });

  console.log("  Setting ChessFactory on DisputeDAO...");
  await disputeDAO.setChessFactory(chessFactory.address, { from: admin });

  console.log("  Setting PlayerRating on ChessFactory...");
  await chessFactory.setPlayerRating(playerRating.address, { from: admin });

  console.log("  Setting RewardPool on ChessFactory...");
  await chessFactory.setRewardPool(rewardPool.address, { from: admin });

  console.log("  Setting ChessFactory on PlayerRating...");
  await playerRating.setChessFactory(chessFactory.address, { from: admin });

  console.log("  Setting signer-backed eligibility registry on PlayerRating...");
  await playerRating.setEligibilityRegistry(rewardPool.address, { from: admin });

  console.log("  Setting ChessFactory on RewardPool...");
  await rewardPool.setChessFactory(chessFactory.address, { from: admin });

  if (config.faucetSigner.toLowerCase() !== admin.toLowerCase()) {
    console.log("  Setting dedicated faucet signer...");
    await rewardPool.setFaucetSigner(config.faucetSigner, { from: admin });
  }

  const ORACLE_ROLE_BM = await bondingManager.ORACLE_ROLE();
  if (config.oracleUpdater.toLowerCase() !== admin.toLowerCase()) {
    console.log("  Granting ORACLE_ROLE to the dedicated price updater...");
    await bondingManager.grantRole(ORACLE_ROLE_BM, config.oracleUpdater, { from: admin });
  }

  // 7.2 Grant GAME_MANAGER_ROLE to ChessFactory on BondingManager
  const GAME_MANAGER_ROLE_BM = await bondingManager.GAME_MANAGER_ROLE();
  console.log("  Granting GAME_MANAGER_ROLE to ChessFactory on BondingManager...");
  await bondingManager.grantRole(GAME_MANAGER_ROLE_BM, chessFactory.address, { from: admin });

  // 7.3 Grant DISPUTE_MANAGER_ROLE to DisputeDAO on BondingManager
  const DISPUTE_MANAGER_ROLE_BM = await bondingManager.DISPUTE_MANAGER_ROLE();
  console.log("  Granting DISPUTE_MANAGER_ROLE to DisputeDAO on BondingManager...");
  await bondingManager.grantRole(DISPUTE_MANAGER_ROLE_BM, disputeDAO.address, { from: admin });

  // 7.4 Grant DISPUTE_MANAGER_ROLE to DisputeDAO on ArbitratorRegistry
  const DISPUTE_MANAGER_ROLE_AR = await arbitratorRegistry.DISPUTE_MANAGER_ROLE();
  console.log("  Granting DISPUTE_MANAGER_ROLE to DisputeDAO on ArbitratorRegistry...");
  await arbitratorRegistry.grantRole(DISPUTE_MANAGER_ROLE_AR, disputeDAO.address, { from: admin });

  // 7.5 Transfer protocol control to governance on production networks.
  if (config.handoffGovernance) {
    console.log("  Transferring protocol administration to ChessTimelock...");

    const tokenAdminRole = await chessToken.DEFAULT_ADMIN_ROLE();
    const tokenMinterRole = await chessToken.MINTER_ROLE();
    const bondingAdminRole = await bondingManager.DEFAULT_ADMIN_ROLE();
    const registryAdminRole = await arbitratorRegistry.DEFAULT_ADMIN_ROLE();
    const disputeAdminRole = await disputeDAO.DEFAULT_ADMIN_ROLE();
    const ratingAdminRole = await playerRating.DEFAULT_ADMIN_ROLE();
    const timelockAdminRole = await chessTimelock.DEFAULT_ADMIN_ROLE();

    await chessToken.grantRole(tokenAdminRole, chessTimelock.address, { from: admin });
    await chessToken.grantRole(tokenMinterRole, chessTimelock.address, { from: admin });
    await bondingManager.grantRole(bondingAdminRole, chessTimelock.address, { from: admin });
    await arbitratorRegistry.grantRole(registryAdminRole, chessTimelock.address, { from: admin });
    await disputeDAO.grantRole(disputeAdminRole, chessTimelock.address, { from: admin });
    await playerRating.grantRole(ratingAdminRole, chessTimelock.address, { from: admin });

    await chessFactory.transferOwnership(chessTimelock.address, { from: admin });
    await rewardPool.transferOwnership(chessTimelock.address, { from: admin });
    const chessNFT = await ChessNFT.at(chessNFTAddress);
    await chessNFT.transferOwnership(chessTimelock.address, { from: admin });

    await chessToken.renounceRole(tokenMinterRole, admin, { from: admin });
    await chessToken.renounceRole(tokenAdminRole, admin, { from: admin });
    await bondingManager.renounceRole(ORACLE_ROLE_BM, admin, { from: admin });
    await bondingManager.renounceRole(bondingAdminRole, admin, { from: admin });
    await arbitratorRegistry.renounceRole(registryAdminRole, admin, { from: admin });
    await disputeDAO.renounceRole(disputeAdminRole, admin, { from: admin });
    await playerRating.renounceRole(ratingAdminRole, admin, { from: admin });
    await chessTimelock.renounceRole(timelockAdminRole, admin, { from: admin });

    console.log("  Governance handoff complete; deployer privileges removed.");
  } else {
    console.log("  Governance handoff skipped for this network.");
  }

  // =========================================
  // PHASE 8: Verification & Summary
  // =========================================
  console.log("\n===========================================");
  console.log("  Deployment Complete - Verification");
  console.log("===========================================");

  // Verify ChessFactory configuration
  const factoryBM = await chessFactory.bondingManager();
  const factoryDAO = await chessFactory.disputeDAO();
  console.log(`\nChessFactory Configuration:`);
  console.log(`  BondingManager: ${factoryBM === bondingManager.address ? '✓' : '✗'} ${factoryBM}`);
  console.log(`  DisputeDAO: ${factoryDAO === disputeDAO.address ? '✓' : '✗'} ${factoryDAO}`);

  const bondingFactory = await bondingManager.chessFactory();
  const disputeFactory = await disputeDAO.chessFactory();
  console.log(`  BondingManager factory: ${bondingFactory === chessFactory.address ? '✓' : '✗'} ${bondingFactory}`);
  console.log(`  DisputeDAO factory: ${disputeFactory === chessFactory.address ? '✓' : '✗'} ${disputeFactory}`);

  // Verify roles
  const factoryHasGameManagerRole = await bondingManager.hasRole(GAME_MANAGER_ROLE_BM, chessFactory.address);
  const daoHasDisputeRoleBM = await bondingManager.hasRole(DISPUTE_MANAGER_ROLE_BM, disputeDAO.address);
  const daoHasDisputeRoleAR = await arbitratorRegistry.hasRole(DISPUTE_MANAGER_ROLE_AR, disputeDAO.address);

  console.log(`\nRole Verification:`);
  console.log(`  ChessFactory has GAME_MANAGER_ROLE on BondingManager: ${factoryHasGameManagerRole ? '✓' : '✗'}`);
  console.log(`  DisputeDAO has DISPUTE_MANAGER_ROLE on BondingManager: ${daoHasDisputeRoleBM ? '✓' : '✗'}`);
  console.log(`  DisputeDAO has DISPUTE_MANAGER_ROLE on ArbitratorRegistry: ${daoHasDisputeRoleAR ? '✓' : '✗'}`);

  // Print deployment summary
  console.log("\n===========================================");
  console.log("  Deployed Contract Addresses");
  console.log("===========================================");
  console.log(`ChessToken:         ${chessToken.address}`);
  console.log(`BondingManager:     ${bondingManager.address}`);
  console.log(`ArbitratorRegistry: ${arbitratorRegistry.address}`);
  console.log(`DisputeDAO:         ${disputeDAO.address}`);
  console.log(`ChessMediaLibrary:  ${chessMediaLibrary.address}`);
  console.log(`ChessRulesEngine:   ${chessRulesEngineAddress}`);
  console.log(`ChessCoreImpl:      ${chessCoreImpl.address}`);
  console.log(`ChessFactory:       ${chessFactory.address}`);
  console.log(`ChessNFT:           ${chessNFTAddress}`);
  console.log(`ChessTimelock:      ${chessTimelock.address}`);
  console.log(`ChessGovernor:      ${chessGovernor.address}`);
  console.log(`PlayerRating:       ${playerRating.address}`);
  console.log(`RewardPool:         ${rewardPool.address}`);
  console.log("===========================================\n");

  const provenance = await captureDeploymentProvenance([
    ["ChessToken", ChessToken, chessToken],
    ["BondingManager", BondingManager, bondingManager],
    ["ArbitratorRegistry", ArbitratorRegistry, arbitratorRegistry],
    ["DisputeDAO", DisputeDAO, disputeDAO],
    ["ChessMediaLibrary", ChessMediaLibrary, chessMediaLibrary],
    ["ChessCoreImplementation", ChessCore, chessCoreImpl],
    ["ChessFactory", ChessFactory, chessFactory],
    ["ChessTimelock", ChessTimelock, chessTimelock],
    ["ChessGovernor", ChessGovernor, chessGovernor],
    ["PlayerRating", PlayerRating, playerRating],
    ["RewardPool", RewardPool, rewardPool]
  ], admin);

  // Save deployment addresses to file (for frontend/scripts)
  const deploymentInfo = {
    network: network,
    timestamp: new Date().toISOString(),
    admin: admin,
    contracts: {
      ChessToken: chessToken.address,
      BondingManager: bondingManager.address,
      ArbitratorRegistry: arbitratorRegistry.address,
      DisputeDAO: disputeDAO.address,
      ChessMediaLibrary: chessMediaLibrary.address,
      ChessRulesEngine: chessRulesEngineAddress,
      ChessCoreImplementation: chessCoreImpl.address,
      ChessFactory: chessFactory.address,
      ChessNFT: chessNFTAddress,
      ChessTimelock: chessTimelock.address,
      ChessGovernor: chessGovernor.address,
      PlayerRating: playerRating.address,
      RewardPool: rewardPool.address
    },
    config: config,
    provenance
  };

  if (process.env.SKIP_DEPLOYMENT_OUTPUT === "true") {
    console.log("Deployment file output skipped for this run.\n");
    return;
  }

  const deploymentsDir = process.env.DEPLOYMENTS_DIR || path.join(__dirname, '..', 'deployments');

  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const filename = `deployment-${network}-${Date.now()}.json`;
  const deploymentBytes = Buffer.from(JSON.stringify(deploymentInfo, null, 2));
  const deploymentDigest = crypto.createHash("sha256").update(deploymentBytes).digest("hex");
  fs.writeFileSync(
    path.join(deploymentsDir, filename),
    deploymentBytes
  );
  console.log(`Deployment info saved to: deployments/${filename}`);
  console.log(`Deployment manifest SHA-256: ${deploymentDigest}`);

  // Also save as latest
  fs.writeFileSync(
    path.join(deploymentsDir, `latest-${network}.json`),
    deploymentBytes
  );
  console.log(`Latest deployment saved to: deployments/latest-${network}.json\n`);
};

/**
 * Get network-specific configuration
 */
function getNetworkConfig(network, accounts) {
  const configs = {
    // Local development
    development: {
      teamWallet: null,  // Will use accounts[1]
      treasury: null,    // Will use accounts[2]
      initialChessPrice: web3.utils.toWei("0.001", "ether"), // 1 CHESS = 0.001 ETH
    },

    // Base Sepolia testnet
    base_sepolia: {
      teamWallet: process.env.TEAM_WALLET || null,
      treasury: process.env.TREASURY_WALLET || null,
      initialChessPrice: web3.utils.toWei("0.0001", "ether"),
    },

    // Base mainnet
    base: {
      teamWallet: process.env.TEAM_WALLET,
      treasury: process.env.TREASURY_WALLET,
      initialChessPrice: web3.utils.toWei("0.001", "ether"),
    }
  };

  const config = configs[network];
  if (!config) {
    throw new Error(`Unsupported deployment network: ${network}`);
  }

  const productionNetworks = ["base"];
  config.handoffGovernance = productionNetworks.includes(network) || process.env.GOVERNANCE_HANDOFF === "true";

  const isDevelopment = network === "development" || network === "test";
  if (!config.teamWallet || !config.treasury) {
    if (!isDevelopment) {
      throw new Error("TEAM_WALLET and TREASURY_WALLET must be configured for public networks");
    }

    config.teamWallet = config.teamWallet || accounts[1] || accounts[0];
    config.treasury = config.treasury || accounts[2] || accounts[0];
  }

  config.faucetSigner = process.env.FAUCET_SIGNER || (isDevelopment ? accounts[0] : null);
  if (!config.faucetSigner) {
    throw new Error("FAUCET_SIGNER must be configured for public networks");
  }

  config.oracleUpdater = process.env.ORACLE_UPDATER || (isDevelopment ? accounts[0] : null);
  if (!config.oracleUpdater) {
    throw new Error("ORACLE_UPDATER must be configured for public networks");
  }

  const configuredAddresses = {
    TEAM_WALLET: config.teamWallet,
    TREASURY_WALLET: config.treasury,
    FAUCET_SIGNER: config.faucetSigner,
    ORACLE_UPDATER: config.oracleUpdater
  };
  for (const [label, address] of Object.entries(configuredAddresses)) {
    if (!web3.utils.isAddress(address) || address === "0x0000000000000000000000000000000000000000") {
      throw new Error(`${label} must be a valid non-zero address`);
    }
  }

  if (config.handoffGovernance) {
    const deployerAddress = accounts[0].toLowerCase();
    if (config.treasury.toLowerCase() === deployerAddress) {
      throw new Error("TREASURY_WALLET must differ from the deployer when governance handoff is enabled");
    }
    if (config.faucetSigner.toLowerCase() === deployerAddress) {
      throw new Error("FAUCET_SIGNER must differ from the deployer when governance handoff is enabled");
    }
    if (config.oracleUpdater.toLowerCase() === deployerAddress) {
      throw new Error("ORACLE_UPDATER must differ from the deployer when governance handoff is enabled");
    }
  }

  return config;
}
