const fs = require("fs");
const path = require("path");
const { loadDeployment } = require("./deployment-output");
const { assertDisputeSecurityPolicy } = require("./deployment-security-policy");
const {
  assertBondingReleaseGenesis,
  assertBondingSecurityPolicy,
  assertAuthorizedRoleGrantHistory,
  assertCleanReleaseGenesis,
  assertCreationInputMatchesArtifact,
  assertDeploymentNetworkPolicy,
  assertEip1167CloneRuntime,
  assertExactRoleMembers,
  assertNoPrincipalEventLogs,
  assertRewardPoolDailyCaps,
  assertRuntimeMatchesArtifact,
  assertTimelockDelay,
  assertTokenGenesisPolicy,
  reconstructRoleMembership
} = require("./deployment-verification-policy");

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
const ARTIFACTS_DIRECTORY = path.join(__dirname, "..", "build", "contracts");
const ROLE_GRANTED_TOPIC = web3.utils.keccak256("RoleGranted(bytes32,address,address)");
const ROLE_REVOKED_TOPIC = web3.utils.keccak256("RoleRevoked(bytes32,address,address)");
const CALL_SCHEDULED_TOPIC = web3.utils.keccak256(
  "CallScheduled(bytes32,uint256,address,uint256,bytes,bytes32,uint256)"
);
const PRICE_HISTORY_TOPICS = [
  "PriceUpdated(uint256,uint256)",
  "CircuitBreakerTriggered(uint256,uint256)",
  "CircuitBreakerReset(uint256,uint256)"
].map((signature) => web3.utils.keccak256(signature));
const REWARD_ACTIVITY_TOPICS = [
  "FaucetClaimed(address,uint256)",
  "RewardDistributed(address,uint256,uint256,uint256,uint256,uint256)",
  "BehaviorRecorded(address,uint8)",
  "RewardEligibilityRegistered(address)",
  "RewardEligibilityRevoked(address)"
].map((signature) => web3.utils.keccak256(signature));
const APPROVAL_TOPIC = web3.utils.keccak256("Approval(address,address,uint256)");
const DELEGATE_CHANGED_TOPIC = web3.utils.keccak256(
  "DelegateChanged(address,address,address)"
);
const PROPOSAL_CREATED_TOPIC = web3.utils.keccak256(
  "ProposalCreated(uint256,address,address[],uint256[],string[],bytes[],uint256,uint256,string)"
);
const PUBLIC_NETWORKS = new Set(["base", "base_sepolia"]);
const TOP_LEVEL_DEPLOYMENTS = [
  ["ChessToken", "ChessToken"],
  ["BondingManager", "BondingManager"],
  ["ArbitratorRegistry", "ArbitratorRegistry"],
  ["DisputeDAO", "DisputeDAO"],
  ["ChessMediaLibrary", "ChessMediaLibrary"],
  ["ChessCoreImplementation", "ChessCore"],
  ["ChessFactory", "ChessFactory"],
  ["ChessTimelock", "ChessTimelock"],
  ["ChessGovernor", "ChessGovernor"],
  ["PlayerRating", "PlayerRating"],
  ["RewardPool", "RewardPool"]
];

function assertAddress(actual, expected, label) {
  if (!actual || !expected || actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

function loadArtifact(artifactName) {
  const artifactPath = path.join(ARTIFACTS_DIRECTORY, `${artifactName}.json`);
  if (!fs.existsSync(artifactPath)) {
    throw new Error(`${artifactName}: missing compiled artifact ${artifactPath}`);
  }
  return JSON.parse(fs.readFileSync(artifactPath, "utf8"));
}

function publicPrincipal(deployment, envName, configField) {
  const configured = deployment.config[configField];
  if (!PUBLIC_NETWORKS.has(deployment.network)) return configured;
  const anchored = process.env[envName];
  if (!anchored || !web3.utils.isAddress(anchored) || anchored === ZERO_ADDRESS) {
    throw new Error(`${envName} must be provided as a trusted release input`);
  }
  assertAddress(configured, anchored, `${envName} manifest value`);
  return anchored;
}

function encodeConstructorArguments(deployment, name) {
  const { contracts, config, admin } = deployment;
  const encodings = {
    ChessToken: [
      ["address", "address"],
      [config.teamWallet, config.treasury]
    ],
    BondingManager: [
      ["address", "uint256"],
      [contracts.ChessToken, config.initialChessPrice]
    ],
    ArbitratorRegistry: [["address"], [contracts.ChessToken]],
    DisputeDAO: [
      ["address", "address", "address"],
      [contracts.ChessToken, contracts.BondingManager, contracts.ArbitratorRegistry]
    ],
    ChessMediaLibrary: [[], []],
    ChessCoreImplementation: [[], []],
    ChessFactory: [["address"], [contracts.ChessCoreImplementation]],
    ChessTimelock: [
      ["uint256", "address[]", "address[]", "address"],
      [config.timelockDelay || 2 * 24 * 60 * 60, [], [ZERO_ADDRESS], admin]
    ],
    ChessGovernor: [
      ["address", "address"],
      [contracts.ChessToken, contracts.ChessTimelock]
    ],
    PlayerRating: [[], []],
    RewardPool: [
      ["address", "address"],
      [contracts.ChessToken, contracts.PlayerRating]
    ]
  };
  const [types, values] = encodings[name] || [];
  if (!types) throw new Error(`${name}: constructor verification is not configured`);
  return types.length === 0 ? "0x" : web3.eth.abi.encodeParameters(types, values);
}

async function captureVerificationBlock(deployment) {
  const blockTag = PUBLIC_NETWORKS.has(deployment.network) ? "finalized" : "latest";
  const block = await web3.eth.getBlock(blockTag);
  if (!block || block.number === undefined || !block.hash) {
    throw new Error(`${blockTag === "finalized" ? "Finalized" : "Latest"} verification block is unavailable`);
  }
  return {
    number: Number(block.number),
    hash: block.hash,
    timestamp: Number(block.timestamp),
    finality: blockTag
  };
}

function readerAt(blockNumber) {
  return {
    blockNumber,
    async call(contract, method, ...args) {
      const callable = contract?.contract?.methods?.[method];
      if (typeof callable !== "function") {
        throw new Error(`Cannot perform pinned read: ${method} is unavailable`);
      }
      return callable(...args).call({}, blockNumber);
    },
    async code(address) {
      return web3.eth.getCode(address, blockNumber);
    }
  };
}

async function assertVerificationBlockCanonical(verificationBlock) {
  const canonicalBlock = await web3.eth.getBlock(verificationBlock.number);
  if (!canonicalBlock || canonicalBlock.hash.toLowerCase() !== verificationBlock.hash.toLowerCase()) {
    throw new Error("The authenticated verification block is no longer canonical");
  }
}

async function verifyDeploymentProvenance(deployment, verificationBlock) {
  const provenance = deployment.provenance;
  if (!provenance || !provenance.deployments) {
    throw new Error("Deployment manifest is missing transaction provenance");
  }
  const connectedChainId = Number(await web3.eth.getChainId());
  if (Number(provenance.chainId) !== connectedChainId) {
    throw new Error(`Deployment provenance chain mismatch: expected ${connectedChainId}`);
  }

  let authenticatedDeployer;
  const receipts = {};
  const creationBlocks = {};
  for (const [name, artifactName] of TOP_LEVEL_DEPLOYMENTS) {
    const entry = provenance.deployments[name];
    if (!entry || !entry.txHash) throw new Error(`${name}: missing deployment provenance`);
    const [receipt, transaction] = await Promise.all([
      web3.eth.getTransactionReceipt(entry.txHash),
      web3.eth.getTransaction(entry.txHash)
    ]);
    if (!receipt || !transaction) throw new Error(`${name}: deployment transaction is unavailable`);
    if (!(receipt.status === true || receipt.status === "0x1" || receipt.status === 1)) {
      throw new Error(`${name}: deployment transaction did not succeed`);
    }
    if (transaction.to !== null) throw new Error(`${name}: provenance transaction is not contract creation`);
    assertAddress(receipt.contractAddress, deployment.contracts[name], `${name} creation address`);
    assertAddress(entry.address, deployment.contracts[name], `${name} manifest provenance address`);
    assertAddress(entry.from, transaction.from, `${name} manifest deployment sender`);
    if (Number(entry.blockNumber) !== Number(receipt.blockNumber) ||
        entry.blockHash.toLowerCase() !== receipt.blockHash.toLowerCase()) {
      throw new Error(`${name}: manifest receipt metadata mismatch`);
    }
    const canonicalBlock = await web3.eth.getBlock(receipt.blockNumber);
    if (!canonicalBlock || canonicalBlock.hash.toLowerCase() !== receipt.blockHash.toLowerCase()) {
      throw new Error(`${name}: deployment receipt is not on the canonical chain`);
    }
    if (Number(receipt.blockNumber) > verificationBlock.number) {
      throw new Error(`${name}: deployment is not included in the authenticated verification block`);
    }
    if (!authenticatedDeployer) authenticatedDeployer = transaction.from;
    else assertAddress(transaction.from, authenticatedDeployer, `${name} deployment sender`);

    const linkedLibraries = name === "ChessCoreImplementation"
      ? { ChessMediaLibrary: deployment.contracts.ChessMediaLibrary }
      : {};
    assertCreationInputMatchesArtifact(
      transaction.input,
      loadArtifact(artifactName),
      encodeConstructorArguments(deployment, name),
      linkedLibraries,
      name
    );
    receipts[name] = receipt;
    creationBlocks[name] = Number(receipt.blockNumber);
  }

  assertAddress(deployment.admin, authenticatedDeployer, "Authenticated deployment administrator");
  return {
    deployer: authenticatedDeployer,
    receipts,
    creationBlocks,
    toBlock: verificationBlock.number
  };
}

async function contractEventLogs(address, fromBlock, toBlock, firstTopicFilter) {
  const logs = [];
  const range = 50_000;
  for (let start = fromBlock; start <= toBlock; start += range) {
    const end = Math.min(toBlock, start + range - 1);
    logs.push(...await web3.eth.getPastLogs({
      address,
      fromBlock: start,
      toBlock: end,
      topics: [firstTopicFilter]
    }));
  }
  return logs;
}

async function accessControlLogs(address, fromBlock, toBlock) {
  return contractEventLogs(
    address,
    fromBlock,
    toBlock,
    [ROLE_GRANTED_TOPIC, ROLE_REVOKED_TOPIC]
  );
}

async function verifyExactRoles(contract, label, expectations, fromBlock, toBlock, reader) {
  const logs = await accessControlLogs(contract.address, fromBlock, toBlock);
  const memberships = reconstructRoleMembership(
    logs,
    ROLE_GRANTED_TOPIC,
    ROLE_REVOKED_TOPIC
  );
  const grants = logs
    .filter((log) => log.topics?.[0]?.toLowerCase() === ROLE_GRANTED_TOPIC.toLowerCase())
    .map((log) => ({
      role: log.topics[1],
      account: `0x${log.topics[2].slice(-40)}`
    }));
  assertAuthorizedRoleGrantHistory(
    grants,
    new Map(expectations.map(([role, members, , historicalMembers = members]) => [
      role,
      historicalMembers
    ])),
    label
  );

  for (const [role, members, roleLabel] of expectations) {
    assertExactRoleMembers(memberships, role, members, `${label} ${roleLabel}`);
    for (const member of members) {
      if (!(await reader.call(contract, "hasRole", role, member))) {
        throw new Error(`${label} ${roleLabel}: event-derived member is absent on-chain`);
      }
    }
  }
}

async function assertNoTimelockSchedules(timelock, fromBlock, toBlock) {
  const scheduled = await contractEventLogs(
    timelock.address,
    fromBlock,
    toBlock,
    CALL_SCHEDULED_TOPIC
  );
  if (scheduled.length !== 0) {
    throw new Error("ChessTimelock release genesis contains scheduled operations");
  }
}

async function assertNoReleaseEvents(address, fromBlock, toBlock, topics, label) {
  const logs = await contractEventLogs(address, fromBlock, toBlock, topics);
  if (logs.length !== 0) {
    throw new Error(`${label}: release history contains ${logs.length} forbidden event(s)`);
  }
}

async function assertNoPrincipalReleaseEvents(
  address,
  fromBlock,
  toBlock,
  topics,
  principal,
  label
) {
  const logs = await contractEventLogs(address, fromBlock, toBlock, topics);
  assertNoPrincipalEventLogs(logs, principal, label);
}

async function canonicalGames(factory, reader) {
  const count = Number((await reader.call(factory, "getDeployedChessGameCount")).toString());
  const games = [];
  for (let offset = 0; offset < count; offset += 100) {
    const page = await reader.call(
      factory,
      "getDeployedChessGamesPage",
      offset,
      Math.min(100, count - offset)
    );
    games.push(...page);
  }
  if (games.length !== count || new Set(games.map((game) => game.toLowerCase())).size !== count) {
    throw new Error("ChessFactory canonical game registry is inconsistent");
  }
  for (const game of games) {
    if (!(await reader.call(factory, "isDeployedGame", game))) {
      throw new Error(`ChessFactory does not recognize canonical game ${game}`);
    }
  }
  return games;
}

function decodeInitialMint(receipt, tokenAddress, signature, label) {
  const topic = web3.utils.keccak256(signature);
  const matches = receipt.logs.filter((log) =>
    log.address.toLowerCase() === tokenAddress.toLowerCase() &&
    log.topics?.[0]?.toLowerCase() === topic.toLowerCase()
  );
  if (matches.length !== 1 || matches[0].topics.length < 2) {
    throw new Error(`ChessToken ${label}: expected exactly one constructor event`);
  }
  return {
    recipient: `0x${matches[0].topics[1].slice(-40)}`,
    amount: BigInt(web3.eth.abi.decodeParameter("uint256", matches[0].data))
  };
}

async function verifyTokenGenesis(token, deployment, provenance, teamWallet, treasury, reader) {
  assertAddress(await reader.call(token, "teamWallet"), teamWallet, "ChessToken team wallet");
  assertAddress(await reader.call(token, "pendingTeamWallet"), ZERO_ADDRESS, "ChessToken pending team wallet");
  if ((await reader.call(token, "teamWalletChangeInitiated")).toString() !== "0") {
    throw new Error("ChessToken has a pending team-wallet transition at release");
  }

  const values = await Promise.all([
    reader.call(token, "playToEarnMinted"),
    reader.call(token, "treasuryMinted"),
    reader.call(token, "teamMinted"),
    reader.call(token, "teamVestingClaimed"),
    reader.call(token, "liquidityMinted"),
    reader.call(token, "communityMinted"),
    reader.call(token, "totalSupply")
  ]);
  assertTokenGenesisPolicy({
    playToEarnMinted: values[0],
    treasuryMinted: values[1],
    teamMinted: values[2],
    teamVestingClaimed: values[3],
    liquidityMinted: values[4],
    communityMinted: values[5],
    totalSupply: values[6]
  });

  const creationReceipt = provenance.receipts.ChessToken;
  const creationBlock = await web3.eth.getBlock(creationReceipt.blockNumber);
  if ((await reader.call(token, "teamVestingStart")).toString() !== creationBlock.timestamp.toString()) {
    throw new Error("ChessToken vesting start does not match its authenticated creation block");
  }
  const liquidity = decodeInitialMint(
    creationReceipt,
    token.address,
    "LiquidityMinted(address,uint256)",
    "liquidity allocation"
  );
  const community = decodeInitialMint(
    creationReceipt,
    token.address,
    "CommunityMinted(address,uint256)",
    "community allocation"
  );
  assertAddress(liquidity.recipient, treasury, "ChessToken liquidity recipient");
  assertAddress(community.recipient, treasury, "ChessToken community recipient");
  const expectedAllocation = 10_000_000n * 10n ** 18n;
  if (liquidity.amount !== expectedAllocation || community.amount !== expectedAllocation) {
    throw new Error("ChessToken constructor allocation amount mismatch");
  }
  if (BigInt((await reader.call(token, "balanceOf", treasury)).toString()) !== 20_000_000n * 10n ** 18n) {
    throw new Error("ChessToken treasury does not hold the authenticated initial allocation");
  }
}

async function verifyCleanReleaseGenesis(instances, verificationBlock, reader) {
  const releaseDay = (
    BigInt(verificationBlock.timestamp.toString()) / (24n * 60n * 60n)
  ).toString();
  const values = await Promise.all([
    reader.call(instances.chessFactory, "totalChessGames"),
    reader.call(instances.chessFactory, "getDeployedChessGameCount"),
    reader.call(instances.disputeDAO, "disputeCounter"),
    reader.call(instances.disputeDAO, "selectionSequenceCounter"),
    reader.call(instances.disputeDAO, "nextSelectionSequence"),
    reader.call(instances.disputeDAO, "totalEscrowedDeposits"),
    reader.call(instances.arbitratorRegistry, "gameRecordSequence"),
    reader.call(instances.arbitratorRegistry, "activePanelSelection"),
    reader.call(instances.arbitratorRegistry, "totalStaked"),
    reader.call(instances.arbitratorRegistry, "totalArbitrators"),
    reader.call(instances.playerRating, "getRankedPlayerCount"),
    reader.call(instances.rewardPool, "faucetPool"),
    reader.call(instances.rewardPool, "rewardPool"),
    reader.call(instances.rewardPool, "rewardPoolCapacity"),
    reader.call(instances.rewardPool, "globalDailyFaucetClaims", releaseDay),
    reader.call(instances.rewardPool, "globalDailyRewards", releaseDay),
    reader.call(instances.bondingManager, "totalChessBonded"),
    reader.call(instances.bondingManager, "totalEthBonded"),
    reader.call(instances.bondingManager, "totalChessSlashed"),
    reader.call(instances.bondingManager, "totalEthSlashed"),
    reader.call(instances.chessToken, "balanceOf", instances.bondingManager.address),
    reader.call(instances.chessToken, "balanceOf", instances.arbitratorRegistry.address),
    reader.call(instances.chessToken, "balanceOf", instances.disputeDAO.address),
    reader.call(instances.chessToken, "balanceOf", instances.rewardPool.address)
  ]);
  const [
    factoryGames,
    factoryGameArrayLength,
    daoDisputes,
    daoSelectionSequence,
    daoNextSelectionSequence,
    daoEscrow,
    registryGameRecords,
    registryActiveSelection,
    registryStaked,
    registryArbitrators,
    ratingRankedPlayers,
    rewardFaucetPool,
    rewardGamePool,
    rewardCapacity,
    rewardTodayFaucetClaims,
    rewardTodayGameRewards,
    bondingChess,
    bondingEth,
    bondingChessSlashed,
    bondingEthSlashed,
    bondingTokenBalance,
    registryTokenBalance,
    daoTokenBalance,
    rewardTokenBalance
  ] = values;
  assertCleanReleaseGenesis({
    factoryGames,
    factoryGameArrayLength,
    daoDisputes,
    daoSelectionSequence,
    daoNextSelectionSequence,
    daoEscrow,
    registryGameRecords,
    registryActiveSelection,
    registryStaked,
    registryArbitrators,
    ratingRankedPlayers,
    rewardFaucetPool,
    rewardGamePool,
    rewardCapacity,
    rewardTodayFaucetClaims,
    rewardTodayGameRewards,
    bondingChess,
    bondingEth,
    bondingChessSlashed,
    bondingEthSlashed,
    bondingTokenBalance,
    registryTokenBalance,
    daoTokenBalance,
    rewardTokenBalance
  });
}

async function verifyReleaseHistory(instances, deployment, provenance, verificationBlock, treasury, reader) {
  const bondingCreationBlock = await web3.eth.getBlock(
    provenance.creationBlocks.BondingManager
  );
  if (!bondingCreationBlock) {
    throw new Error("BondingManager authenticated creation block is unavailable");
  }
  assertBondingReleaseGenesis({
    priceLastUpdated: await reader.call(instances.bondingManager, "priceLastUpdated"),
    priceWindowStartedAt: await reader.call(instances.bondingManager, "priceWindowStartedAt"),
    lastMaterialPriceUpdateAt: await reader.call(
      instances.bondingManager,
      "lastMaterialPriceUpdateAt"
    )
  }, bondingCreationBlock.timestamp);
  await assertNoReleaseEvents(
    instances.bondingManager.address,
    provenance.creationBlocks.BondingManager,
    provenance.toBlock,
    PRICE_HISTORY_TOPICS,
    "BondingManager oracle"
  );

  await assertNoReleaseEvents(
    instances.rewardPool.address,
    provenance.creationBlocks.RewardPool,
    provenance.toBlock,
    REWARD_ACTIVITY_TOPICS,
    "RewardPool operational"
  );

  if (deployment.config.handoffGovernance === true &&
      treasury.toLowerCase() === provenance.deployer.toLowerCase()) {
    throw new Error("Treasury must differ from the deployer when governance handoff is enabled");
  }
  assertAddress(
    await reader.call(instances.chessToken, "delegates", treasury),
    ZERO_ADDRESS,
    "ChessToken treasury delegate"
  );
  if (BigInt((await reader.call(instances.chessToken, "getVotes", treasury)).toString()) !== 0n) {
    throw new Error("ChessToken treasury has active voting power at release");
  }
  if (BigInt((await reader.call(instances.chessToken, "nonces", treasury)).toString()) !== 0n) {
    throw new Error("ChessToken treasury permit nonce is not pristine at release");
  }
  await assertNoPrincipalReleaseEvents(
    instances.chessToken.address,
    provenance.creationBlocks.ChessToken,
    provenance.toBlock,
    [APPROVAL_TOPIC, DELEGATE_CHANGED_TOPIC],
    treasury,
    "ChessToken governance"
  );
  await assertNoReleaseEvents(
    instances.chessGovernor.address,
    provenance.creationBlocks.ChessGovernor,
    provenance.toBlock,
    PROPOSAL_CREATED_TOPIC,
    "ChessGovernor"
  );
}

async function verifyExactRoleTopology(instances, deployment, provenance, reader) {
  const { contracts, config } = deployment;
  const handoff = config.handoffGovernance === true;
  const expectedOwner = handoff ? contracts.ChessTimelock : provenance.deployer;
  const governanceAdminHistory = handoff
    ? [provenance.deployer, contracts.ChessTimelock]
    : [provenance.deployer];
  const games = await canonicalGames(instances.chessFactory, reader);

  for (const game of games) {
    assertEip1167CloneRuntime(
      await reader.code(game),
      contracts.ChessCoreImplementation,
      `Canonical game ${game}`
    );
    if (!(await reader.call(instances.rewardPool, "validGameContracts", game))) {
      throw new Error(`RewardPool is missing canonical game authorization for ${game}`);
    }
    if (!(await reader.call(instances.playerRating, "validGameContracts", game))) {
      throw new Error(`PlayerRating is missing canonical game authorization for ${game}`);
    }
    const gameInstance = await ChessCore.at(game);
    const expectedIdentity = BigInt((await reader.call(gameInstance, "gameId")).toString()) + 1n;
    const registeredIdentity = BigInt(
      (await reader.call(instances.playerRating, "registeredGameIds", game)).toString()
    );
    if (registeredIdentity !== expectedIdentity) {
      throw new Error(`PlayerRating canonical game identity mismatch for ${game}`);
    }
  }

  await verifyExactRoles(instances.chessToken, "ChessToken", [
    [
      await reader.call(instances.chessToken, "DEFAULT_ADMIN_ROLE"),
      [expectedOwner],
      "DEFAULT_ADMIN_ROLE",
      governanceAdminHistory
    ],
    [
      await reader.call(instances.chessToken, "MINTER_ROLE"),
      [expectedOwner],
      "MINTER_ROLE",
      governanceAdminHistory
    ]
  ], provenance.creationBlocks.ChessToken, provenance.toBlock, reader);

  const oracleMembers = [config.oracleUpdater];
  if (!handoff && config.oracleUpdater.toLowerCase() !== provenance.deployer.toLowerCase()) {
    oracleMembers.push(provenance.deployer);
  }
  const oracleHistory = [provenance.deployer, config.oracleUpdater];
  await verifyExactRoles(instances.bondingManager, "BondingManager", [
    [
      await reader.call(instances.bondingManager, "DEFAULT_ADMIN_ROLE"),
      [expectedOwner],
      "DEFAULT_ADMIN_ROLE",
      governanceAdminHistory
    ],
    [
      await reader.call(instances.bondingManager, "ORACLE_ROLE"),
      oracleMembers,
      "ORACLE_ROLE",
      oracleHistory
    ],
    [
      await reader.call(instances.bondingManager, "GAME_MANAGER_ROLE"),
      [contracts.ChessFactory, ...games],
      "GAME_MANAGER_ROLE"
    ],
    [
      await reader.call(instances.bondingManager, "DISPUTE_MANAGER_ROLE"),
      [contracts.DisputeDAO],
      "DISPUTE_MANAGER_ROLE"
    ]
  ], provenance.creationBlocks.BondingManager, provenance.toBlock, reader);

  await verifyExactRoles(instances.arbitratorRegistry, "ArbitratorRegistry", [
    [
      await reader.call(instances.arbitratorRegistry, "DEFAULT_ADMIN_ROLE"),
      [expectedOwner],
      "DEFAULT_ADMIN_ROLE",
      governanceAdminHistory
    ],
    [
      await reader.call(instances.arbitratorRegistry, "DISPUTE_MANAGER_ROLE"),
      [contracts.DisputeDAO],
      "DISPUTE_MANAGER_ROLE"
    ]
  ], provenance.creationBlocks.ArbitratorRegistry, provenance.toBlock, reader);

  await verifyExactRoles(instances.disputeDAO, "DisputeDAO", [
    [
      await reader.call(instances.disputeDAO, "DEFAULT_ADMIN_ROLE"),
      [expectedOwner],
      "DEFAULT_ADMIN_ROLE",
      governanceAdminHistory
    ],
    [await reader.call(instances.disputeDAO, "GAME_MANAGER_ROLE"), games, "GAME_MANAGER_ROLE"]
  ], provenance.creationBlocks.DisputeDAO, provenance.toBlock, reader);

  await verifyExactRoles(instances.playerRating, "PlayerRating", [
    [
      await reader.call(instances.playerRating, "DEFAULT_ADMIN_ROLE"),
      [expectedOwner],
      "DEFAULT_ADMIN_ROLE",
      governanceAdminHistory
    ],
    [await reader.call(instances.playerRating, "GAME_REPORTER_ROLE"), [], "GAME_REPORTER_ROLE"]
  ], provenance.creationBlocks.PlayerRating, provenance.toBlock, reader);

  const timelockAdmins = handoff
    ? [contracts.ChessTimelock]
    : [contracts.ChessTimelock, provenance.deployer];
  const timelockAdminHistory = [contracts.ChessTimelock, provenance.deployer];
  await verifyExactRoles(instances.chessTimelock, "ChessTimelock", [
    [
      await reader.call(instances.chessTimelock, "DEFAULT_ADMIN_ROLE"),
      timelockAdmins,
      "DEFAULT_ADMIN_ROLE",
      timelockAdminHistory
    ],
    [await reader.call(instances.chessTimelock, "PROPOSER_ROLE"), [contracts.ChessGovernor], "PROPOSER_ROLE"],
    [await reader.call(instances.chessTimelock, "CANCELLER_ROLE"), [contracts.ChessGovernor], "CANCELLER_ROLE"],
    [await reader.call(instances.chessTimelock, "EXECUTOR_ROLE"), [ZERO_ADDRESS], "EXECUTOR_ROLE"]
  ], provenance.creationBlocks.ChessTimelock, provenance.toBlock, reader);
  await assertNoTimelockSchedules(
    instances.chessTimelock,
    provenance.creationBlocks.ChessTimelock,
    provenance.toBlock
  );
}

async function assertAuthenticatedContract(address, artifactName, label, reader, linkedLibraries = {}) {
  if (!web3.utils.isAddress(address) || address === ZERO_ADDRESS) throw new Error(`${label}: invalid address ${address}`);
  const deployedCode = await reader.code(address);
  assertRuntimeMatchesArtifact(deployedCode, loadArtifact(artifactName), linkedLibraries, label);
}

async function assertHasRole(contract, role, account, label, reader) {
  if (!(await reader.call(contract, "hasRole", role, account))) throw new Error(`${label}: required role is missing`);
}

async function assertLacksRole(contract, role, account, label, reader) {
  if (await reader.call(contract, "hasRole", role, account)) throw new Error(`${label}: unexpected role remains assigned`);
}

async function verifyAdministration(instances, deployment, reader) {
  const { admin, contracts, config } = deployment;
  const timelock = contracts.ChessTimelock;
  const handoff = config.handoffGovernance === true;
  const expectedOwner = handoff ? timelock : admin;

  assertAddress(await reader.call(instances.chessFactory, "owner"), expectedOwner, "ChessFactory owner");
  assertAddress(await reader.call(instances.chessNFT, "owner"), expectedOwner, "ChessNFT owner");
  assertAddress(await reader.call(instances.rewardPool, "owner"), expectedOwner, "RewardPool owner");

  const accessControlled = [
    [instances.chessToken, "ChessToken"],
    [instances.bondingManager, "BondingManager"],
    [instances.arbitratorRegistry, "ArbitratorRegistry"],
    [instances.disputeDAO, "DisputeDAO"],
    [instances.playerRating, "PlayerRating"]
  ];
  for (const [contract, label] of accessControlled) {
    const adminRole = await reader.call(contract, "DEFAULT_ADMIN_ROLE");
    await assertHasRole(contract, adminRole, expectedOwner, `${label} administrator`, reader);
    if (handoff) await assertLacksRole(contract, adminRole, admin, `${label} deployer administrator`, reader);
  }

  const minterRole = await reader.call(instances.chessToken, "MINTER_ROLE");
  await assertHasRole(instances.chessToken, minterRole, expectedOwner, "ChessToken minter", reader);
  if (handoff) await assertLacksRole(instances.chessToken, minterRole, admin, "ChessToken deployer minter", reader);

  const oracleRole = await reader.call(instances.bondingManager, "ORACLE_ROLE");
  await assertHasRole(instances.bondingManager, oracleRole, config.oracleUpdater, "BondingManager oracle updater", reader);
  if (handoff) await assertLacksRole(instances.bondingManager, oracleRole, admin, "BondingManager deployer oracle", reader);

  const timelockAdminRole = await reader.call(instances.chessTimelock, "DEFAULT_ADMIN_ROLE");
  await assertHasRole(instances.chessTimelock, timelockAdminRole, timelock, "ChessTimelock self-administrator", reader);
  if (handoff) {
    await assertLacksRole(instances.chessTimelock, timelockAdminRole, admin, "ChessTimelock deployer administrator", reader);
  } else {
    await assertHasRole(instances.chessTimelock, timelockAdminRole, admin, "ChessTimelock deployer administrator", reader);
  }
}

module.exports = async function verifyDeployment(callback) {
  try {
    const { deployment, deploymentPath } = loadDeployment();
    const { contracts, config } = deployment;
    if (!contracts || !config || typeof config.handoffGovernance !== "boolean") {
      throw new Error("Deployment output is missing contracts or explicit governance configuration");
    }

    const chainId = await web3.eth.getChainId();
    assertDeploymentNetworkPolicy(deployment, chainId);
    const teamWallet = publicPrincipal(deployment, "TEAM_WALLET", "teamWallet");
    const treasury = publicPrincipal(deployment, "TREASURY_WALLET", "treasury");
    publicPrincipal(deployment, "FAUCET_SIGNER", "faucetSigner");
    publicPrincipal(deployment, "ORACLE_UPDATER", "oracleUpdater");
    const verificationBlock = await captureVerificationBlock(deployment);
    const reader = readerAt(verificationBlock.number);
    const provenance = await verifyDeploymentProvenance(deployment, verificationBlock);

    const requiredContracts = [
      ["ChessToken", "ChessToken"],
      ["BondingManager", "BondingManager"],
      ["ArbitratorRegistry", "ArbitratorRegistry"],
      ["DisputeDAO", "DisputeDAO"],
      ["ChessMediaLibrary", "ChessMediaLibrary"],
      ["ChessRulesEngine", "ChessRulesEngine"],
      ["ChessCoreImplementation", "ChessCore"],
      ["ChessFactory", "ChessFactory"],
      ["ChessNFT", "ChessNFT"],
      ["ChessTimelock", "ChessTimelock"],
      ["ChessGovernor", "ChessGovernor"],
      ["PlayerRating", "PlayerRating"],
      ["RewardPool", "RewardPool"]
    ];
    for (const [deploymentName, artifactName] of requiredContracts) {
      const linkedLibraries = deploymentName === "ChessCoreImplementation"
        ? { ChessMediaLibrary: contracts.ChessMediaLibrary }
        : {};
      await assertAuthenticatedContract(
        contracts[deploymentName],
        artifactName,
        deploymentName,
        reader,
        linkedLibraries
      );
    }

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

    assertAddress(await reader.call(instances.chessCore, "rulesEngine"), contracts.ChessRulesEngine, "ChessCore rules engine");
    assertAddress(await reader.call(instances.chessFactory, "chessCoreImplementation"), contracts.ChessCoreImplementation, "ChessFactory implementation");
    assertAddress(await reader.call(instances.chessFactory, "addressNFT"), contracts.ChessNFT, "ChessFactory NFT");
    assertAddress(await reader.call(instances.chessFactory, "bondingManager"), contracts.BondingManager, "ChessFactory BondingManager");
    assertAddress(await reader.call(instances.chessFactory, "disputeDAO"), contracts.DisputeDAO, "ChessFactory DisputeDAO");
    assertAddress(await reader.call(instances.chessFactory, "playerRating"), contracts.PlayerRating, "ChessFactory PlayerRating");
    assertAddress(await reader.call(instances.chessFactory, "rewardPool"), contracts.RewardPool, "ChessFactory RewardPool");
    if (await reader.call(instances.chessFactory, "isDeployedGame", ZERO_ADDRESS)) {
      throw new Error("ChessFactory canonical game registry accepts the zero address");
    }

    assertAddress(await reader.call(instances.bondingManager, "chessToken"), contracts.ChessToken, "BondingManager token");
    assertAddress(await reader.call(instances.bondingManager, "chessFactory"), contracts.ChessFactory, "BondingManager factory");
    assertAddress(await reader.call(instances.disputeDAO, "chessToken"), contracts.ChessToken, "DisputeDAO token");
    assertAddress(await reader.call(instances.disputeDAO, "bondingManager"), contracts.BondingManager, "DisputeDAO BondingManager");
    assertAddress(await reader.call(instances.disputeDAO, "arbitratorRegistry"), contracts.ArbitratorRegistry, "DisputeDAO registry");
    assertAddress(await reader.call(instances.disputeDAO, "chessFactory"), contracts.ChessFactory, "DisputeDAO factory");
    assertAddress(await reader.call(instances.arbitratorRegistry, "chessToken"), contracts.ChessToken, "ArbitratorRegistry token");
    assertAddress(await reader.call(instances.playerRating, "chessFactory"), contracts.ChessFactory, "PlayerRating factory");
    assertAddress(
      await reader.call(instances.playerRating, "eligibilityRegistry"),
      contracts.RewardPool,
      "PlayerRating eligibility registry"
    );
    assertAddress(await reader.call(instances.rewardPool, "chessToken"), contracts.ChessToken, "RewardPool token");
    assertAddress(await reader.call(instances.rewardPool, "playerRating"), contracts.PlayerRating, "RewardPool rating");
    assertAddress(await reader.call(instances.rewardPool, "chessFactory"), contracts.ChessFactory, "RewardPool factory");
    assertAddress(await reader.call(instances.rewardPool, "faucetSigner"), config.faucetSigner, "RewardPool faucet signer");
    assertRewardPoolDailyCaps({
      rewardCap: await reader.call(instances.rewardPool, "globalDailyRewardCap"),
      maximumReward: await reader.call(instances.rewardPool, "MAX_GLOBAL_DAILY_REWARD"),
      faucetCap: await reader.call(instances.rewardPool, "globalDailyFaucetCap"),
      maximumFaucet: await reader.call(instances.rewardPool, "MAX_GLOBAL_DAILY_FAUCET")
    });
    const expectedEligibilityEpoch =
      config.faucetSigner.toLowerCase() === provenance.deployer.toLowerCase() ? 1n : 2n;
    if (BigInt((await reader.call(instances.rewardPool, "rewardEligibilityEpoch")).toString()) !== expectedEligibilityEpoch) {
      throw new Error(`RewardPool eligibility epoch must be ${expectedEligibilityEpoch} at release`);
    }
    assertAddress(await reader.call(instances.chessNFT, "factory"), contracts.ChessFactory, "ChessNFT factory");
    assertAddress(await reader.call(instances.chessGovernor, "token"), contracts.ChessToken, "ChessGovernor token");
    assertAddress(await reader.call(instances.chessGovernor, "timelock"), contracts.ChessTimelock, "ChessGovernor timelock");
    if ((await reader.call(instances.chessGovernor, "votingDelay")).toString() !== "43200" ||
        (await reader.call(instances.chessGovernor, "votingPeriod")).toString() !== "216000" ||
        (await reader.call(instances.chessGovernor, "proposalThreshold")).toString() !== web3.utils.toWei("100000", "ether") ||
        (await reader.call(instances.chessGovernor, "quorumNumerator")).toString() !== "4") {
      throw new Error("ChessGovernor release policy differs from the canonical governance settings");
    }
    assertTimelockDelay(await reader.call(instances.chessTimelock, "getMinDelay"));

    assertBondingSecurityPolicy({
      chessMultiplier: await reader.call(instances.bondingManager, "chessMultiplier"),
      ethMultiplier: await reader.call(instances.bondingManager, "ethMultiplier"),
      minBondEthValue: await reader.call(instances.bondingManager, "minBondEthValue"),
      chessEthPrice: await reader.call(instances.bondingManager, "chessEthPrice"),
      lastKnownPrice: await reader.call(instances.bondingManager, "lastKnownPrice"),
      priceWindowAnchor: await reader.call(instances.bondingManager, "priceWindowAnchor"),
      priceLastUpdated: await reader.call(instances.bondingManager, "priceLastUpdated"),
      freshnessWindow: await reader.call(instances.bondingManager, "TWAP_PERIOD"),
      paused: await reader.call(instances.bondingManager, "paused"),
      circuitBreakerTripped: await reader.call(instances.bondingManager, "circuitBreakerTripped")
    }, deployment.network, verificationBlock.timestamp);
    await verifyTokenGenesis(instances.chessToken, deployment, provenance, teamWallet, treasury, reader);
    await verifyCleanReleaseGenesis(instances, verificationBlock, reader);
    await verifyReleaseHistory(
      instances,
      deployment,
      provenance,
      verificationBlock,
      treasury,
      reader
    );

    const [
      minimumPanelSize,
      minimumPanelCollateral,
      arbitrationCoverageBps,
      quorumPercentage,
      supermajority,
      challengeDeposit,
      challengeDepositBps,
      challengeWindow,
      commitPeriod,
      revealPeriod
    ] = await Promise.all([
      reader.call(instances.disputeDAO, "minimumPanelSize"),
      reader.call(instances.disputeDAO, "minimumPanelCollateral"),
      reader.call(instances.disputeDAO, "arbitrationCoverageBps"),
      reader.call(instances.disputeDAO, "quorumPercentage"),
      reader.call(instances.disputeDAO, "supermajority"),
      reader.call(instances.disputeDAO, "challengeDeposit"),
      reader.call(instances.disputeDAO, "challengeDepositBps"),
      reader.call(instances.disputeDAO, "challengeWindow"),
      reader.call(instances.disputeDAO, "commitPeriod"),
      reader.call(instances.disputeDAO, "revealPeriod")
    ]);
    assertDisputeSecurityPolicy({
      minimumPanelSize,
      minimumPanelCollateral,
      arbitrationCoverageBps,
      quorumPercentage,
      supermajority,
      challengeDeposit,
      challengeDepositBps,
      challengeWindow,
      commitPeriod,
      revealPeriod
    });

    const factoryGameRole = await reader.call(instances.bondingManager, "GAME_MANAGER_ROLE");
    const bondingDisputeRole = await reader.call(instances.bondingManager, "DISPUTE_MANAGER_ROLE");
    const registryDisputeRole = await reader.call(instances.arbitratorRegistry, "DISPUTE_MANAGER_ROLE");
    await assertHasRole(instances.bondingManager, factoryGameRole, contracts.ChessFactory, "ChessFactory BondingManager role", reader);
    await assertHasRole(instances.bondingManager, bondingDisputeRole, contracts.DisputeDAO, "DisputeDAO BondingManager role", reader);
    await assertHasRole(instances.arbitratorRegistry, registryDisputeRole, contracts.DisputeDAO, "DisputeDAO registry role", reader);

    const proposerRole = await reader.call(instances.chessTimelock, "PROPOSER_ROLE");
    const cancellerRole = await reader.call(instances.chessTimelock, "CANCELLER_ROLE");
    const executorRole = await reader.call(instances.chessTimelock, "EXECUTOR_ROLE");
    await assertHasRole(instances.chessTimelock, proposerRole, contracts.ChessGovernor, "ChessGovernor proposer", reader);
    await assertHasRole(instances.chessTimelock, cancellerRole, contracts.ChessGovernor, "ChessGovernor canceller", reader);
    await assertHasRole(instances.chessTimelock, executorRole, ZERO_ADDRESS, "Permissionless timelock executor", reader);

    await verifyAdministration(instances, deployment, reader);
    await verifyExactRoleTopology(instances, deployment, provenance, reader);
    await assertVerificationBlockCanonical(verificationBlock);
    console.log(
      `Deployment provenance, runtime, policy and exact roles verified on ${deployment.network} ` +
      `(chain ${chainId}, ${verificationBlock.finality} block ${verificationBlock.number} ${verificationBlock.hash}).`
    );
    console.log(`Deployment file: ${deploymentPath}`);
    callback();
  } catch (error) {
    callback(error);
  }
};
