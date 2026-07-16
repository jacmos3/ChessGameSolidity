const fs = require("fs");
const path = require("path");

const ChessToken = artifacts.require("ChessToken");
const BondingManager = artifacts.require("BondingManager");
const ArbitratorRegistry = artifacts.require("ArbitratorRegistry");
const DisputeDAO = artifacts.require("DisputeDAO");
const ChessFactory = artifacts.require("ChessFactory");
const ChessNFT = artifacts.require("ChessNFT");
const ChessTimelock = artifacts.require("ChessTimelock");
const PlayerRating = artifacts.require("PlayerRating");
const RewardPool = artifacts.require("RewardPool");

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function assertAddress(actual, expected, label) {
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

async function assertAdminTransferred(contract, deployer, timelock, label) {
  const adminRole = await contract.DEFAULT_ADMIN_ROLE();
  if (await contract.hasRole(adminRole, deployer)) {
    throw new Error(`${label}: deployer still has DEFAULT_ADMIN_ROLE`);
  }
  if (!(await contract.hasRole(adminRole, timelock))) {
    throw new Error(`${label}: timelock is missing DEFAULT_ADMIN_ROLE`);
  }
}

module.exports = async function verifyGovernanceHandoff(callback) {
  try {
    const deploymentPath = process.env.DEPLOYMENT_FILE || path.join(
      __dirname,
      "..",
      "deployments",
      "latest-development.json"
    );
    const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
    const { admin: deployer, contracts, config } = deployment;
    const timelockAddress = contracts.ChessTimelock;

    const chessToken = await ChessToken.at(contracts.ChessToken);
    const bondingManager = await BondingManager.at(contracts.BondingManager);
    const arbitratorRegistry = await ArbitratorRegistry.at(contracts.ArbitratorRegistry);
    const disputeDAO = await DisputeDAO.at(contracts.DisputeDAO);
    const chessFactory = await ChessFactory.at(contracts.ChessFactory);
    const chessNFT = await ChessNFT.at(contracts.ChessNFT);
    const chessTimelock = await ChessTimelock.at(timelockAddress);
    const playerRating = await PlayerRating.at(contracts.PlayerRating);
    const rewardPool = await RewardPool.at(contracts.RewardPool);

    assertAddress(await chessFactory.owner(), timelockAddress, "ChessFactory owner");
    assertAddress(await chessNFT.owner(), timelockAddress, "ChessNFT owner");
    assertAddress(await rewardPool.owner(), timelockAddress, "RewardPool owner");
    assertAddress(await rewardPool.faucetSigner(), config.faucetSigner, "RewardPool faucet signer");

    await assertAdminTransferred(chessToken, deployer, timelockAddress, "ChessToken");
    await assertAdminTransferred(bondingManager, deployer, timelockAddress, "BondingManager");
    await assertAdminTransferred(arbitratorRegistry, deployer, timelockAddress, "ArbitratorRegistry");
    await assertAdminTransferred(disputeDAO, deployer, timelockAddress, "DisputeDAO");
    await assertAdminTransferred(playerRating, deployer, timelockAddress, "PlayerRating");

    const minterRole = await chessToken.MINTER_ROLE();
    if (await chessToken.hasRole(minterRole, deployer)) {
      throw new Error("ChessToken: deployer still has MINTER_ROLE");
    }
    if (!(await chessToken.hasRole(minterRole, timelockAddress))) {
      throw new Error("ChessToken: timelock is missing MINTER_ROLE");
    }

    const oracleRole = await bondingManager.ORACLE_ROLE();
    if (await bondingManager.hasRole(oracleRole, deployer)) {
      throw new Error("BondingManager: deployer still has ORACLE_ROLE");
    }
    if (!(await bondingManager.hasRole(oracleRole, config.oracleUpdater))) {
      throw new Error("BondingManager: configured oracle updater is missing ORACLE_ROLE");
    }

    const timelockAdminRole = await chessTimelock.DEFAULT_ADMIN_ROLE();
    if (await chessTimelock.hasRole(timelockAdminRole, deployer)) {
      throw new Error("ChessTimelock: deployer still has DEFAULT_ADMIN_ROLE");
    }
    if (!(await chessTimelock.hasRole(timelockAdminRole, timelockAddress))) {
      throw new Error("ChessTimelock: self-administration is missing");
    }

    const proposerRole = await chessTimelock.PROPOSER_ROLE();
    const cancellerRole = await chessTimelock.CANCELLER_ROLE();
    const executorRole = await chessTimelock.EXECUTOR_ROLE();
    if (!(await chessTimelock.hasRole(proposerRole, contracts.ChessGovernor))) {
      throw new Error("ChessGovernor is missing PROPOSER_ROLE");
    }
    if (!(await chessTimelock.hasRole(cancellerRole, contracts.ChessGovernor))) {
      throw new Error("ChessGovernor is missing CANCELLER_ROLE");
    }
    if (!(await chessTimelock.hasRole(executorRole, ZERO_ADDRESS))) {
      throw new Error("ChessTimelock is not open for permissionless execution");
    }

    console.log("Governance handoff verified successfully.");
    callback();
  } catch (error) {
    callback(error);
  }
};
