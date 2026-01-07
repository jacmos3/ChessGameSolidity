const ChessToken = artifacts.require("ChessToken");
const BondingManager = artifacts.require("BondingManager");
const ArbitratorRegistry = artifacts.require("ArbitratorRegistry");
const DisputeDAO = artifacts.require("DisputeDAO");
const ChessFactory = artifacts.require("ChessFactory");
const ChessNFT = artifacts.require("ChessNFT");
const ChessTimelock = artifacts.require("ChessTimelock");
const ChessGovernor = artifacts.require("ChessGovernor");
const PlayerRating = artifacts.require("PlayerRating");

module.exports = async function (deployer, network, accounts) {
  const admin = accounts[0];

  // Configuration based on network
  const config = getNetworkConfig(network);

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
  // PHASE 5: Deploy ChessFactory
  // =========================================
  console.log("\nPHASE 5: Deploying ChessFactory...");

  await deployer.deploy(ChessFactory, { from: admin });
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
  // PHASE 7: Configure Roles & Permissions
  // =========================================
  console.log("\nPHASE 7: Configuring roles and permissions...");

  // 7.1 Configure ChessFactory with anti-cheating contracts
  console.log("  Setting BondingManager on ChessFactory...");
  await chessFactory.setBondingManager(bondingManager.address, { from: admin });

  console.log("  Setting DisputeDAO on ChessFactory...");
  await chessFactory.setDisputeDAO(disputeDAO.address, { from: admin });

  console.log("  Setting PlayerRating on ChessFactory...");
  await chessFactory.setPlayerRating(playerRating.address, { from: admin });

  console.log("  Setting ChessFactory on PlayerRating...");
  await playerRating.setChessFactory(chessFactory.address, { from: admin });

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

  // 7.5 Transfer admin roles to Timelock for decentralization (optional - can be done later)
  // This makes governance control the protocol parameters
  // await bondingManager.grantRole(await bondingManager.DEFAULT_ADMIN_ROLE(), chessTimelock.address, { from: admin });
  // await disputeDAO.grantRole(await disputeDAO.DEFAULT_ADMIN_ROLE(), chessTimelock.address, { from: admin });

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
  console.log(`ChessFactory:       ${chessFactory.address}`);
  console.log(`ChessNFT:           ${chessNFTAddress}`);
  console.log(`ChessTimelock:      ${chessTimelock.address}`);
  console.log(`ChessGovernor:      ${chessGovernor.address}`);
  console.log(`PlayerRating:       ${playerRating.address}`);
  console.log("===========================================\n");

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
      ChessFactory: chessFactory.address,
      ChessNFT: chessNFTAddress,
      ChessTimelock: chessTimelock.address,
      ChessGovernor: chessGovernor.address,
      PlayerRating: playerRating.address
    },
    config: config
  };

  const fs = require('fs');
  const path = require('path');
  const deploymentsDir = path.join(__dirname, '..', 'deployments');

  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const filename = `deployment-${network}-${Date.now()}.json`;
  fs.writeFileSync(
    path.join(deploymentsDir, filename),
    JSON.stringify(deploymentInfo, null, 2)
  );
  console.log(`Deployment info saved to: deployments/${filename}`);

  // Also save as latest
  fs.writeFileSync(
    path.join(deploymentsDir, `latest-${network}.json`),
    JSON.stringify(deploymentInfo, null, 2)
  );
  console.log(`Latest deployment saved to: deployments/latest-${network}.json\n`);
};

/**
 * Get network-specific configuration
 */
function getNetworkConfig(network) {
  const configs = {
    // Local development
    development: {
      teamWallet: null,  // Will use accounts[1]
      treasury: null,    // Will use accounts[2]
      initialChessPrice: web3.utils.toWei("0.001", "ether"), // 1 CHESS = 0.001 ETH
    },

    // Goerli testnet
    goerli: {
      teamWallet: process.env.TEAM_WALLET || null,
      treasury: process.env.TREASURY_WALLET || null,
      initialChessPrice: web3.utils.toWei("0.0001", "ether"),
    },

    // Sepolia testnet
    sepolia: {
      teamWallet: process.env.TEAM_WALLET || null,
      treasury: process.env.TREASURY_WALLET || null,
      initialChessPrice: web3.utils.toWei("0.0001", "ether"),
    },

    // Mainnet
    mainnet: {
      teamWallet: process.env.TEAM_WALLET,
      treasury: process.env.TREASURY_WALLET,
      initialChessPrice: web3.utils.toWei("0.001", "ether"),
    },

    // Arbitrum
    arbitrum: {
      teamWallet: process.env.TEAM_WALLET,
      treasury: process.env.TREASURY_WALLET,
      initialChessPrice: web3.utils.toWei("0.001", "ether"),
    },

    // Optimism
    optimism: {
      teamWallet: process.env.TEAM_WALLET,
      treasury: process.env.TREASURY_WALLET,
      initialChessPrice: web3.utils.toWei("0.001", "ether"),
    }
  };

  const config = configs[network] || configs.development;

  // For development, use test accounts if not specified
  if (!config.teamWallet) {
    config.teamWallet = web3.eth.accounts.create().address;
    console.log(`  Generated teamWallet: ${config.teamWallet}`);
  }
  if (!config.treasury) {
    config.treasury = web3.eth.accounts.create().address;
    console.log(`  Generated treasury: ${config.treasury}`);
  }

  return config;
}
