const ChessToken = artifacts.require("ChessToken");
const BondingManager = artifacts.require("BondingManager");
const ArbitratorRegistry = artifacts.require("ArbitratorRegistry");
const DisputeDAO = artifacts.require("DisputeDAO");
const ChessFactory = artifacts.require("ChessFactory");
const ChessNFT = artifacts.require("ChessNFT");

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
  // PHASE 6: Configure Roles & Permissions
  // =========================================
  console.log("\nPHASE 6: Configuring roles and permissions...");

  // 6.1 Configure ChessFactory with anti-cheating contracts
  console.log("  Setting BondingManager on ChessFactory...");
  await chessFactory.setBondingManager(bondingManager.address, { from: admin });

  console.log("  Setting DisputeDAO on ChessFactory...");
  await chessFactory.setDisputeDAO(disputeDAO.address, { from: admin });

  // 6.2 Grant GAME_MANAGER_ROLE to ChessFactory on BondingManager
  // This allows the factory to lock bonds when games are created
  const GAME_MANAGER_ROLE_BM = await bondingManager.GAME_MANAGER_ROLE();
  console.log("  Granting GAME_MANAGER_ROLE to ChessFactory on BondingManager...");
  await bondingManager.grantRole(GAME_MANAGER_ROLE_BM, chessFactory.address, { from: admin });

  // 6.3 Grant DISPUTE_MANAGER_ROLE to DisputeDAO on BondingManager
  // This allows DisputeDAO to slash bonds
  const DISPUTE_MANAGER_ROLE_BM = await bondingManager.DISPUTE_MANAGER_ROLE();
  console.log("  Granting DISPUTE_MANAGER_ROLE to DisputeDAO on BondingManager...");
  await bondingManager.grantRole(DISPUTE_MANAGER_ROLE_BM, disputeDAO.address, { from: admin });

  // 6.4 Grant DISPUTE_MANAGER_ROLE to DisputeDAO on ArbitratorRegistry
  // This allows DisputeDAO to update reputation and record votes
  const DISPUTE_MANAGER_ROLE_AR = await arbitratorRegistry.DISPUTE_MANAGER_ROLE();
  console.log("  Granting DISPUTE_MANAGER_ROLE to DisputeDAO on ArbitratorRegistry...");
  await arbitratorRegistry.grantRole(DISPUTE_MANAGER_ROLE_AR, disputeDAO.address, { from: admin });

  // 6.5 Grant MINTER_ROLE to BondingManager for play-to-earn rewards
  // (Optional - enable if BondingManager should mint rewards)
  // const MINTER_ROLE = await chessToken.MINTER_ROLE();
  // await chessToken.grantRole(MINTER_ROLE, bondingManager.address, { from: admin });

  // =========================================
  // PHASE 7: Verification & Summary
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
  console.log(`ChessToken:        ${chessToken.address}`);
  console.log(`BondingManager:    ${bondingManager.address}`);
  console.log(`ArbitratorRegistry: ${arbitratorRegistry.address}`);
  console.log(`DisputeDAO:        ${disputeDAO.address}`);
  console.log(`ChessFactory:      ${chessFactory.address}`);
  console.log(`ChessNFT:          ${chessNFTAddress}`);
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
      ChessNFT: chessNFTAddress
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
