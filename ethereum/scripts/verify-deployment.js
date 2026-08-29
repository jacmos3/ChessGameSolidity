const { loadDeployment } = require("./deployment-output");

const ChessToken = artifacts.require("ChessToken");
const BondingManager = artifacts.require("BondingManager");
const RewardPool = artifacts.require("RewardPool");
const ArbitratorRegistry = artifacts.require("ArbitratorRegistry");
const DisputeDAO = artifacts.require("DisputeDAO");
const ChessCore = artifacts.require("ChessCore");
const ChessFactory = artifacts.require("ChessFactory");
const ChessNFT = artifacts.require("ChessNFT");
const ChessTimelock = artifacts.require("ChessTimelock");
const ChessGovernor = artifacts.require("ChessGovernor");
const PlayerRating = artifacts.require("PlayerRating");

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const EXPECTED_CHAIN_IDS = { development: null, base_sepolia: 84532, base: 8453 };

function assertAddress(actual, expected, label) {
  if (!actual || !expected || actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

async function assertContract(address, label) {
  if (!web3.utils.isAddress(address) || address === ZERO_ADDRESS) throw new Error(`${label}: invalid address ${address}`);
  if (await web3.eth.getCode(address) === "0x") throw new Error(`${label}: no deployed bytecode at ${address}`);
}

async function assertEoa(address, label) {
  if (!web3.utils.isAddress(address) || address === ZERO_ADDRESS) throw new Error(`${label}: invalid address ${address}`);
  if (await web3.eth.getCode(address) !== "0x") throw new Error(`${label}: expected an EOA at ${address}`);
}

async function assertHasRole(contract, role, account, label) {
  if (!(await contract.hasRole(role, account))) throw new Error(`${label}: required role is missing`);
}

async function assertLacksRole(contract, role, account, label) {
  if (await contract.hasRole(role, account)) throw new Error(`${label}: unexpected role remains assigned`);
}

async function verifyAdministration(instances, deployment) {
  const { admin, contracts, config } = deployment;
  const timelock = contracts.ChessTimelock;
  const handoff = config.handoffGovernance === true;
  const expectedOwner = handoff ? timelock : admin;

  assertAddress(await instances.chessFactory.owner(), expectedOwner, "ChessFactory owner");
  assertAddress(await instances.chessNFT.owner(), expectedOwner, "ChessNFT owner");
  assertAddress(await instances.rewardPool.owner(), expectedOwner, "RewardPool owner");

  const accessControlled = [
    [instances.chessToken, "ChessToken"],
    [instances.bondingManager, "BondingManager"],
    [instances.arbitratorRegistry, "ArbitratorRegistry"],
    [instances.disputeDAO, "DisputeDAO"],
    [instances.playerRating, "PlayerRating"]
  ];
  for (const [contract, label] of accessControlled) {
    const adminRole = await contract.DEFAULT_ADMIN_ROLE();
    await assertHasRole(contract, adminRole, expectedOwner, `${label} administrator`);
    if (handoff) await assertLacksRole(contract, adminRole, admin, `${label} deployer administrator`);
  }

  const minterRole = await instances.chessToken.MINTER_ROLE();
  await assertHasRole(instances.chessToken, minterRole, expectedOwner, "ChessToken minter");
  if (handoff) await assertLacksRole(instances.chessToken, minterRole, admin, "ChessToken deployer minter");

  const oracleRole = await instances.bondingManager.ORACLE_ROLE();
  await assertHasRole(instances.bondingManager, oracleRole, config.oracleUpdater, "BondingManager oracle updater");
  if (handoff) await assertLacksRole(instances.bondingManager, oracleRole, admin, "BondingManager deployer oracle");

  const timelockAdminRole = await instances.chessTimelock.DEFAULT_ADMIN_ROLE();
  await assertHasRole(instances.chessTimelock, timelockAdminRole, timelock, "ChessTimelock self-administrator");
  if (handoff) {
    await assertLacksRole(instances.chessTimelock, timelockAdminRole, admin, "ChessTimelock deployer administrator");
  } else {
    await assertHasRole(instances.chessTimelock, timelockAdminRole, admin, "ChessTimelock deployer administrator");
  }
}

module.exports = async function verifyDeployment(callback) {
  try {
    const { deployment, deploymentPath } = loadDeployment();
    const { contracts, config } = deployment;
    if (!contracts || !config || typeof config.handoffGovernance !== "boolean") {
      throw new Error("Deployment output is missing contracts or explicit governance configuration");
    }

    const expectedChainId = EXPECTED_CHAIN_IDS[deployment.network];
    if (expectedChainId === undefined) throw new Error(`Unsupported deployment network: ${deployment.network}`);
    const chainId = await web3.eth.getChainId();
    if (expectedChainId !== null && chainId !== expectedChainId) {
      throw new Error(`Connected chain mismatch: expected ${expectedChainId}, got ${chainId}`);
    }

    const requiredContracts = [
      "ChessToken",
      "BondingManager",
      "ArbitratorRegistry",
      "DisputeDAO",
      "ChessMediaLibrary",
      "ChessRulesEngine",
      "ChessCoreImplementation",
      "ChessFactory",
      "ChessNFT",
      "ChessTimelock",
      "ChessGovernor",
      "PlayerRating",
      "RewardPool"
    ];
    for (const name of requiredContracts) await assertContract(contracts[name], name);
    await assertEoa(config.faucetSigner, "Faucet signer");

    const instances = {
      chessToken: await ChessToken.at(contracts.ChessToken),
      bondingManager: await BondingManager.at(contracts.BondingManager),
      rewardPool: await RewardPool.at(contracts.RewardPool),
      arbitratorRegistry: await ArbitratorRegistry.at(contracts.ArbitratorRegistry),
      disputeDAO: await DisputeDAO.at(contracts.DisputeDAO),
      chessCore: await ChessCore.at(contracts.ChessCoreImplementation),
      chessFactory: await ChessFactory.at(contracts.ChessFactory),
      chessNFT: await ChessNFT.at(contracts.ChessNFT),
      chessTimelock: await ChessTimelock.at(contracts.ChessTimelock),
      chessGovernor: await ChessGovernor.at(contracts.ChessGovernor),
      playerRating: await PlayerRating.at(contracts.PlayerRating)
    };

    assertAddress(await instances.chessCore.rulesEngine(), contracts.ChessRulesEngine, "ChessCore rules engine");
    assertAddress(await instances.chessFactory.chessCoreImplementation(), contracts.ChessCoreImplementation, "ChessFactory implementation");
    assertAddress(await instances.chessFactory.addressNFT(), contracts.ChessNFT, "ChessFactory NFT");
    assertAddress(await instances.chessFactory.bondingManager(), contracts.BondingManager, "ChessFactory BondingManager");
    assertAddress(await instances.chessFactory.disputeDAO(), contracts.DisputeDAO, "ChessFactory DisputeDAO");
    assertAddress(await instances.chessFactory.playerRating(), contracts.PlayerRating, "ChessFactory PlayerRating");
    assertAddress(await instances.chessFactory.rewardPool(), contracts.RewardPool, "ChessFactory RewardPool");

    assertAddress(await instances.bondingManager.chessToken(), contracts.ChessToken, "BondingManager token");
    assertAddress(await instances.bondingManager.chessFactory(), contracts.ChessFactory, "BondingManager factory");
    assertAddress(await instances.disputeDAO.chessToken(), contracts.ChessToken, "DisputeDAO token");
    assertAddress(await instances.disputeDAO.bondingManager(), contracts.BondingManager, "DisputeDAO BondingManager");
    assertAddress(await instances.disputeDAO.arbitratorRegistry(), contracts.ArbitratorRegistry, "DisputeDAO registry");
    assertAddress(await instances.disputeDAO.chessFactory(), contracts.ChessFactory, "DisputeDAO factory");
    assertAddress(await instances.arbitratorRegistry.chessToken(), contracts.ChessToken, "ArbitratorRegistry token");
    assertAddress(await instances.playerRating.chessFactory(), contracts.ChessFactory, "PlayerRating factory");
    assertAddress(await instances.rewardPool.chessToken(), contracts.ChessToken, "RewardPool token");
    assertAddress(await instances.rewardPool.playerRating(), contracts.PlayerRating, "RewardPool rating");
    assertAddress(await instances.rewardPool.chessFactory(), contracts.ChessFactory, "RewardPool factory");
    assertAddress(await instances.rewardPool.faucetSigner(), config.faucetSigner, "RewardPool faucet signer");
    assertAddress(await instances.chessNFT.factory(), contracts.ChessFactory, "ChessNFT factory");
    assertAddress(await instances.chessGovernor.token(), contracts.ChessToken, "ChessGovernor token");
    assertAddress(await instances.chessGovernor.timelock(), contracts.ChessTimelock, "ChessGovernor timelock");

    const factoryGameRole = await instances.bondingManager.GAME_MANAGER_ROLE();
    const bondingDisputeRole = await instances.bondingManager.DISPUTE_MANAGER_ROLE();
    const registryDisputeRole = await instances.arbitratorRegistry.DISPUTE_MANAGER_ROLE();
    await assertHasRole(instances.bondingManager, factoryGameRole, contracts.ChessFactory, "ChessFactory BondingManager role");
    await assertHasRole(instances.bondingManager, bondingDisputeRole, contracts.DisputeDAO, "DisputeDAO BondingManager role");
    await assertHasRole(instances.arbitratorRegistry, registryDisputeRole, contracts.DisputeDAO, "DisputeDAO registry role");

    const proposerRole = await instances.chessTimelock.PROPOSER_ROLE();
    const cancellerRole = await instances.chessTimelock.CANCELLER_ROLE();
    const executorRole = await instances.chessTimelock.EXECUTOR_ROLE();
    await assertHasRole(instances.chessTimelock, proposerRole, contracts.ChessGovernor, "ChessGovernor proposer");
    await assertHasRole(instances.chessTimelock, cancellerRole, contracts.ChessGovernor, "ChessGovernor canceller");
    await assertHasRole(instances.chessTimelock, executorRole, ZERO_ADDRESS, "Permissionless timelock executor");

    await verifyAdministration(instances, deployment);
    console.log(`Deployment topology verified on ${deployment.network} (chain ${chainId}).`);
    console.log(`Deployment file: ${deploymentPath}`);
    callback();
  } catch (error) {
    callback(error);
  }
};
