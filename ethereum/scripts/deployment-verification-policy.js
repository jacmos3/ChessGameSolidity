const EXPECTED_CHAIN_IDS = Object.freeze({
  development: null,
  base_sepolia: 84532,
  base: 8453
});
const LOCAL_DEVELOPMENT_CHAIN_IDS = new Set([1337, 5777, 31337]);

const EXPECTED_TIMELOCK_DELAY_SECONDS = 2 * 24 * 60 * 60;
const EXPECTED_MAX_GLOBAL_DAILY_REWARD = 1_000n * 10n ** 18n;
const EXPECTED_MAX_GLOBAL_DAILY_FAUCET = 1_000n * 10n ** 18n;
const EXPECTED_INITIAL_TOKEN_SUPPLY = 20_000_000n * 10n ** 18n;
const EXPECTED_INITIAL_ALLOCATION = 10_000_000n * 10n ** 18n;
const EXPECTED_BONDING_PRICE = Object.freeze({
  development: 1_000_000_000_000_000n,
  base_sepolia: 100_000_000_000_000n,
  base: 1_000_000_000_000_000n
});
const EIP1167_RUNTIME_PREFIX = "363d3d373d3d3d363d73";
const EIP1167_RUNTIME_SUFFIX = "5af43d82803e903d91602b57fd5bf3";

function stripHexPrefix(value, label) {
  if (typeof value !== "string" || !value.startsWith("0x")) {
    throw new Error(`${label} must be 0x-prefixed bytecode`);
  }
  return value.slice(2).toLowerCase();
}

function replaceByteRange(bytecode, start, length, replacement, label) {
  const offset = start * 2;
  const size = length * 2;
  if (!Number.isInteger(start) || !Number.isInteger(length) || start < 0 || length <= 0) {
    throw new Error(`${label}: invalid bytecode reference`);
  }
  if (offset + size > bytecode.length || replacement.length !== size) {
    throw new Error(`${label}: bytecode reference is outside the deployed runtime`);
  }
  return bytecode.slice(0, offset) + replacement + bytecode.slice(offset + size);
}

function normalizedAddress(value, label) {
  const address = stripHexPrefix(value, label);
  if (!/^[0-9a-f]{40}$/.test(address) || /^0{40}$/.test(address)) {
    throw new Error(`${label}: invalid non-zero linked-library address`);
  }
  return address;
}

function linkedLibraryName(libraryKey) {
  const separator = libraryKey.lastIndexOf(":");
  return separator === -1 ? libraryKey : libraryKey.slice(separator + 1);
}

function resolveLegacyTrufflePlaceholders(
  bytecode,
  linkedLibraries,
  resolvedLibraryNames,
  label
) {
  let linkedBytecode = bytecode;
  const replacements = new Map();

  for (const [libraryKey, configuredAddress] of Object.entries(linkedLibraries || {})) {
    const libraryName = linkedLibraryName(libraryKey);
    if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(libraryName) || libraryName.length > 38) {
      throw new Error(`${label}: invalid legacy Truffle library name ${libraryName}`);
    }

    // The repository compiler deliberately emits Truffle's classic 40-character
    // named placeholder. Truffle later strips linkReferences while persisting
    // migration network metadata, so reconstruct only this exact placeholder
    // from the explicitly configured library name and bind it to that address.
    const placeholder = `__${libraryName}`.padEnd(40, "_").slice(0, 40).toLowerCase();
    const address = normalizedAddress(configuredAddress, `${label} ${libraryName}`);
    const previous = replacements.get(placeholder);
    if (previous && previous.address !== address) {
      throw new Error(`${label}: ambiguous address for legacy linked library ${libraryName}`);
    }
    replacements.set(placeholder, { address, libraryName: libraryName.toLowerCase() });
  }

  for (const [placeholder, { address, libraryName }] of replacements) {
    if (linkedBytecode.includes(placeholder)) {
      resolvedLibraryNames.add(libraryName);
    }
    linkedBytecode = linkedBytecode.split(placeholder).join(address);
  }
  return linkedBytecode;
}

function resolveLinkedRuntime(expectedRuntime, linkReferences, linkedLibraries, label) {
  let linkedRuntime = expectedRuntime;
  const resolvedLibraryNames = new Set();
  for (const [sourceName, libraries] of Object.entries(linkReferences || {})) {
    for (const [libraryName, references] of Object.entries(libraries || {})) {
      const configuredAddress =
        linkedLibraries[`${sourceName}:${libraryName}`] || linkedLibraries[libraryName];
      if (!configuredAddress) {
        throw new Error(`${label}: missing deployed address for linked library ${libraryName}`);
      }
      resolvedLibraryNames.add(libraryName.toLowerCase());
      const address = normalizedAddress(configuredAddress, `${label} ${libraryName}`);
      for (const reference of references) {
        const replacement = address.padStart(reference.length * 2, "0");
        linkedRuntime = replaceByteRange(
          linkedRuntime,
          reference.start,
          reference.length,
          replacement,
          `${label} ${libraryName}`
        );
      }
    }
  }
  if (linkedRuntime.includes("__")) {
    linkedRuntime = resolveLegacyTrufflePlaceholders(
      linkedRuntime,
      linkedLibraries,
      resolvedLibraryNames,
      label
    );
  }
  for (const libraryKey of Object.keys(linkedLibraries || {})) {
    const libraryName = linkedLibraryName(libraryKey);
    if (!resolvedLibraryNames.has(libraryName.toLowerCase())) {
      throw new Error(`${label}: configured linked library ${libraryName} is not referenced by artifact`);
    }
  }
  return linkedRuntime;
}

function maskImmutableReferences(runtime, immutableReferences, label) {
  let masked = runtime;
  for (const references of Object.values(immutableReferences || {})) {
    for (const reference of references) {
      masked = replaceByteRange(
        masked,
        reference.start,
        reference.length,
        "0".repeat(reference.length * 2),
        `${label} immutable`
      );
    }
  }
  return masked;
}

function assertImmutableReferencesAreConsistent(runtime, immutableReferences, label) {
  for (const references of Object.values(immutableReferences || {})) {
    let firstValue;
    for (const reference of references) {
      const offset = reference.start * 2;
      const size = reference.length * 2;
      if (!Number.isInteger(reference.start) || !Number.isInteger(reference.length) ||
          reference.start < 0 || reference.length <= 0 || offset + size > runtime.length) {
        throw new Error(`${label} immutable: bytecode reference is outside the deployed runtime`);
      }
      const value = runtime.slice(offset, offset + size);
      if (firstValue === undefined) firstValue = value;
      else if (value !== firstValue) {
        throw new Error(`${label}: deployed runtime contains inconsistent immutable values`);
      }
    }
  }
}

/**
 * Authenticate deployed logic against a repository artifact. Constructor-set
 * immutable slots are masked because the artifact contains placeholders; their
 * security-relevant values must be checked separately through contract getters.
 * Linked libraries are not masked: their configured deployed addresses are
 * inserted into the artifact before comparison.
 */
function assertRuntimeMatchesArtifact(actualCode, artifact, linkedLibraries = {}, label = "Contract") {
  const actualRuntime = stripHexPrefix(actualCode, `${label} deployed runtime`);
  let expectedRuntime = stripHexPrefix(artifact && artifact.deployedBytecode, `${label} artifact runtime`);

  if (actualRuntime.length === 0) throw new Error(`${label}: no deployed bytecode`);
  if (actualRuntime.length !== expectedRuntime.length) {
    throw new Error(
      `${label}: deployed runtime length differs from the repository artifact ` +
      `(expected ${expectedRuntime.length / 2} bytes, got ${actualRuntime.length / 2})`
    );
  }

  expectedRuntime = resolveLinkedRuntime(
    expectedRuntime,
    artifact.deployedLinkReferences,
    linkedLibraries,
    label
  );
  if (!/^[0-9a-f]+$/.test(expectedRuntime)) {
    throw new Error(`${label}: artifact runtime contains unresolved link placeholders`);
  }
  if (!/^[0-9a-f]+$/.test(actualRuntime)) {
    throw new Error(`${label}: deployed runtime is not valid hexadecimal bytecode`);
  }

  assertImmutableReferencesAreConsistent(actualRuntime, artifact.immutableReferences, label);

  const expectedNormalized = maskImmutableReferences(
    expectedRuntime,
    artifact.immutableReferences,
    label
  );
  const actualNormalized = maskImmutableReferences(
    actualRuntime,
    artifact.immutableReferences,
    label
  );
  if (actualNormalized !== expectedNormalized) {
    throw new Error(`${label}: deployed runtime does not match the repository artifact`);
  }
}

function assertCreationInputMatchesArtifact(
  actualInput,
  artifact,
  encodedConstructorArguments = "0x",
  linkedLibraries = {},
  label = "Contract"
) {
  const actual = stripHexPrefix(actualInput, `${label} creation transaction`);
  let expected = stripHexPrefix(artifact && artifact.bytecode, `${label} artifact creation bytecode`);
  expected = resolveLinkedRuntime(
    expected,
    artifact.linkReferences,
    linkedLibraries,
    `${label} creation bytecode`
  );
  const argumentsHex = stripHexPrefix(encodedConstructorArguments, `${label} constructor arguments`);
  if (!/^[0-9a-f]*$/.test(expected) || !/^[0-9a-f]*$/.test(argumentsHex)) {
    throw new Error(`${label}: invalid or unresolved creation bytecode`);
  }
  const completeExpected = expected + argumentsHex;
  if (actual !== completeExpected) {
    throw new Error(`${label}: deployment initcode or constructor arguments do not match the release artifact`);
  }
}

/**
 * Authenticate a canonical 45-byte EIP-1167 clone runtime and bind its
 * embedded delegatecall target to the expected implementation address.
 * Alternate proxy encodings are intentionally rejected.
 */
function assertEip1167CloneRuntime(actualCode, expectedImplementation, label = "EIP-1167 clone") {
  const actualRuntime = stripHexPrefix(actualCode, `${label} deployed runtime`);
  const implementation = stripHexPrefix(expectedImplementation, `${label} expected implementation`);
  if (!/^[0-9a-f]{40}$/.test(implementation) || /^0{40}$/.test(implementation)) {
    throw new Error(`${label}: expected implementation must be a non-zero address`);
  }

  const expectedLength = EIP1167_RUNTIME_PREFIX.length + 40 + EIP1167_RUNTIME_SUFFIX.length;
  if (!/^[0-9a-f]+$/.test(actualRuntime) || actualRuntime.length !== expectedLength ||
      !actualRuntime.startsWith(EIP1167_RUNTIME_PREFIX) ||
      !actualRuntime.endsWith(EIP1167_RUNTIME_SUFFIX)) {
    throw new Error(`${label}: deployed runtime is not the canonical EIP-1167 runtime`);
  }

  const embeddedImplementation = actualRuntime.slice(
    EIP1167_RUNTIME_PREFIX.length,
    EIP1167_RUNTIME_PREFIX.length + 40
  );
  if (embeddedImplementation !== implementation) {
    throw new Error(`${label}: clone targets an unexpected implementation`);
  }
}

function assertDeploymentNetworkPolicy(deployment, chainId) {
  const expectedChainId = EXPECTED_CHAIN_IDS[deployment.network];
  if (expectedChainId === undefined) {
    throw new Error(`Unsupported deployment network: ${deployment.network}`);
  }
  if (deployment.network === "development" && !LOCAL_DEVELOPMENT_CHAIN_IDS.has(chainId)) {
    throw new Error(
      `Development deployments require an allowlisted local chain, got ${chainId}`
    );
  }
  if (expectedChainId !== null && chainId !== expectedChainId) {
    throw new Error(`Connected chain mismatch: expected ${expectedChainId}, got ${chainId}`);
  }

  const publicNetworkForChain = Object.entries(EXPECTED_CHAIN_IDS).find(
    ([, configuredChainId]) => configuredChainId === chainId
  );
  if (publicNetworkForChain && deployment.network !== publicNetworkForChain[0]) {
    throw new Error(
      `Connected public chain ${chainId} must use deployment network ${publicNetworkForChain[0]}`
    );
  }
  if ((deployment.network === "base" || chainId === EXPECTED_CHAIN_IDS.base) &&
      deployment.config.handoffGovernance !== true) {
    throw new Error("Base mainnet requires governance handoff");
  }
}

function assertTimelockDelay(actualDelay) {
  const normalized = BigInt(actualDelay.toString());
  if (normalized !== BigInt(EXPECTED_TIMELOCK_DELAY_SECONDS)) {
    throw new Error(
      `ChessTimelock delay: expected ${EXPECTED_TIMELOCK_DELAY_SECONDS}, got ${normalized}`
    );
  }
}

function assertRewardPoolDailyCap(actualCap, immutableMaximum) {
  const normalizedCap = BigInt(actualCap.toString());
  const normalizedMaximum = BigInt(immutableMaximum.toString());
  if (normalizedMaximum !== EXPECTED_MAX_GLOBAL_DAILY_REWARD) {
    throw new Error(
      `RewardPool maximum daily reward: expected ${EXPECTED_MAX_GLOBAL_DAILY_REWARD}, got ${normalizedMaximum}`
    );
  }
  if (normalizedCap !== EXPECTED_MAX_GLOBAL_DAILY_REWARD) {
    throw new Error(
      `RewardPool initial daily cap: expected ${EXPECTED_MAX_GLOBAL_DAILY_REWARD}, got ${normalizedCap}`
    );
  }
}

function assertRewardPoolDailyCaps(actual) {
  assertRewardPoolDailyCap(actual.rewardCap, actual.maximumReward);
  const faucetCap = BigInt(actual.faucetCap.toString());
  const maximumFaucet = BigInt(actual.maximumFaucet.toString());
  if (maximumFaucet !== EXPECTED_MAX_GLOBAL_DAILY_FAUCET) {
    throw new Error(
      `RewardPool maximum daily faucet: expected ${EXPECTED_MAX_GLOBAL_DAILY_FAUCET}, got ${maximumFaucet}`
    );
  }
  if (faucetCap !== EXPECTED_MAX_GLOBAL_DAILY_FAUCET) {
    throw new Error(
      `RewardPool initial daily faucet cap: expected ${EXPECTED_MAX_GLOBAL_DAILY_FAUCET}, got ${faucetCap}`
    );
  }
}

function assertBondingSecurityPolicy(actual, network, currentTimestamp) {
  const expectedPrice = EXPECTED_BONDING_PRICE[network];
  if (expectedPrice === undefined) throw new Error(`Unsupported bonding policy network: ${network}`);
  const fields = [
    ["chessMultiplier", 3n, "CHESS multiplier"],
    ["ethMultiplier", 2n, "ETH multiplier"],
    ["minBondEthValue", 10_000_000_000_000_000n, "minimum bond value"],
    ["chessEthPrice", expectedPrice, "CHESS/ETH price"],
    ["lastKnownPrice", expectedPrice, "last known price"],
    ["priceWindowAnchor", expectedPrice, "price-window anchor"]
  ];
  for (const [field, expected, label] of fields) {
    const value = BigInt(actual[field].toString());
    if (value !== expected) {
      throw new Error(`BondingManager ${label}: expected ${expected}, got ${value}`);
    }
  }
  if (actual.paused !== false) throw new Error("BondingManager must not be paused at release");
  if (actual.circuitBreakerTripped !== false) {
    throw new Error("BondingManager circuit breaker must not be tripped at release");
  }
  const lastUpdated = BigInt(actual.priceLastUpdated.toString());
  const freshnessWindow = BigInt(actual.freshnessWindow.toString());
  const now = BigInt(currentTimestamp.toString());
  if (lastUpdated > now || lastUpdated + freshnessWindow < now) {
    throw new Error("BondingManager release price is stale or future-dated");
  }
}

function assertTokenGenesisPolicy(actual) {
  const fields = [
    ["playToEarnMinted", 0n, "play-to-earn minted"],
    ["treasuryMinted", 0n, "treasury minted"],
    ["teamMinted", 0n, "team minted"],
    ["teamVestingClaimed", 0n, "team vesting claimed"],
    ["liquidityMinted", EXPECTED_INITIAL_ALLOCATION, "liquidity minted"],
    ["communityMinted", EXPECTED_INITIAL_ALLOCATION, "community minted"],
    ["totalSupply", EXPECTED_INITIAL_TOKEN_SUPPLY, "total supply"]
  ];
  for (const [field, expected, label] of fields) {
    const value = BigInt(actual[field].toString());
    if (value !== expected) {
      throw new Error(`ChessToken initial ${label}: expected ${expected}, got ${value}`);
    }
  }
}

function assertBondingReleaseGenesis(actual, creationTimestamp) {
  const createdAt = BigInt(creationTimestamp.toString());
  const priceLastUpdated = BigInt(actual.priceLastUpdated.toString());
  const priceWindowStartedAt = BigInt(actual.priceWindowStartedAt.toString());
  const lastMaterialPriceUpdateAt = BigInt(actual.lastMaterialPriceUpdateAt.toString());

  if (priceLastUpdated !== createdAt) {
    throw new Error("BondingManager price timestamp differs from its authenticated creation block");
  }
  if (priceWindowStartedAt !== createdAt) {
    throw new Error("BondingManager price window differs from its authenticated creation block");
  }
  if (lastMaterialPriceUpdateAt !== 0n) {
    throw new Error("BondingManager has material pre-release price history");
  }
}

function assertCleanReleaseGenesis(actual) {
  const fields = [
    ["factoryGames", 0n, "ChessFactory game count"],
    ["factoryGameArrayLength", 0n, "ChessFactory game registry length"],
    ["daoDisputes", 0n, "DisputeDAO dispute counter"],
    ["daoSelectionSequence", 0n, "DisputeDAO selection sequence"],
    ["daoNextSelectionSequence", 1n, "DisputeDAO next selection sequence"],
    ["daoEscrow", 0n, "DisputeDAO escrow"],
    ["registryGameRecords", 0n, "ArbitratorRegistry game-record sequence"],
    ["registryActiveSelection", 0n, "ArbitratorRegistry active selection"],
    ["registryStaked", 0n, "ArbitratorRegistry total stake"],
    ["registryArbitrators", 0n, "ArbitratorRegistry arbitrator count"],
    ["ratingRankedPlayers", 0n, "PlayerRating ranked-player count"],
    ["rewardFaucetPool", 0n, "RewardPool faucet balance"],
    ["rewardGamePool", 0n, "RewardPool game-reward balance"],
    ["rewardCapacity", 0n, "RewardPool capacity"],
    ["rewardTodayFaucetClaims", 0n, "RewardPool current-day faucet emissions"],
    ["rewardTodayGameRewards", 0n, "RewardPool current-day game emissions"],
    ["bondingChess", 0n, "BondingManager CHESS bonded"],
    ["bondingEth", 0n, "BondingManager ETH bonded"],
    ["bondingChessSlashed", 0n, "BondingManager CHESS slashed"],
    ["bondingEthSlashed", 0n, "BondingManager ETH slashed"],
    ["bondingTokenBalance", 0n, "BondingManager token balance"],
    ["registryTokenBalance", 0n, "ArbitratorRegistry token balance"],
    ["daoTokenBalance", 0n, "DisputeDAO token balance"],
    ["rewardTokenBalance", 0n, "RewardPool token balance"]
  ];
  for (const [field, expected, label] of fields) {
    if (actual[field] === undefined || actual[field] === null) {
      throw new Error(`${label}: missing release-genesis value`);
    }
    const value = BigInt(actual[field].toString());
    if (value !== expected) {
      throw new Error(`${label}: expected ${expected}, got ${value}`);
    }
  }
}

function normalizeRoleHex(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${label}: invalid role identifier`);
  }
  return value.toLowerCase();
}

function normalizeMember(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`${label}: invalid role member`);
  }
  return value.toLowerCase();
}

function reconstructRoleMembership(logs, grantedTopic, revokedTopic) {
  const granted = grantedTopic.toLowerCase();
  const revoked = revokedTopic.toLowerCase();
  const ordered = [...logs].sort((a, b) =>
    Number(a.blockNumber) - Number(b.blockNumber) ||
    Number(a.transactionIndex || 0) - Number(b.transactionIndex || 0) ||
    Number(a.logIndex) - Number(b.logIndex)
  );
  const memberships = new Map();
  for (const log of ordered) {
    const eventTopic = log.topics?.[0]?.toLowerCase();
    if (eventTopic !== granted && eventTopic !== revoked) continue;
    const role = normalizeRoleHex(log.topics?.[1], "AccessControl log role");
    const accountTopic = log.topics?.[2];
    if (typeof accountTopic !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(accountTopic)) {
      throw new Error("AccessControl log account: invalid indexed address");
    }
    const account = normalizeMember(`0x${accountTopic.slice(-40)}`, "AccessControl log account");
    if (!memberships.has(role)) memberships.set(role, new Set());
    if (eventTopic === granted) memberships.get(role).add(account);
    else memberships.get(role).delete(account);
  }
  return memberships;
}

function assertExactRoleMembers(memberships, role, expectedMembers, label) {
  const normalizedRole = normalizeRoleHex(role, `${label} role`);
  const actual = memberships.get(normalizedRole) || new Set();
  const expected = new Set(expectedMembers.map((member) => normalizeMember(member, label)));
  const extras = [...actual].filter((member) => !expected.has(member));
  const missing = [...expected].filter((member) => !actual.has(member));
  if (extras.length || missing.length) {
    throw new Error(
      `${label}: exact membership mismatch; missing [${missing.join(", ")}], extra [${extras.join(", ")}]`
    );
  }
}

/**
 * Reject any historically granted role/member pair outside an explicit
 * per-role allowlist. `allowedMembersByRole` may be a Map or a plain object;
 * each value must be an array or Set of addresses. The input grants are
 * decoded records shaped as `{ role, account }`.
 */
function assertAuthorizedRoleGrantHistory(
  grants,
  allowedMembersByRole,
  label = "AccessControl"
) {
  if (!Array.isArray(grants)) {
    throw new Error(`${label}: decoded RoleGranted history must be an array`);
  }
  const allowlistType = Object.prototype.toString.call(allowedMembersByRole);
  const entries = allowlistType === "[object Map]" &&
      typeof allowedMembersByRole?.entries === "function"
    ? Array.from(allowedMembersByRole.entries())
    : allowedMembersByRole && typeof allowedMembersByRole === "object" &&
        !Array.isArray(allowedMembersByRole)
      ? Object.entries(allowedMembersByRole)
      : null;
  if (!entries) throw new Error(`${label}: role-grant allowlist must be a Map or object`);

  const normalizedAllowlist = new Map();
  for (const [role, members] of entries) {
    const normalizedRole = normalizeRoleHex(role, `${label} allowlist role`);
    if (normalizedAllowlist.has(normalizedRole)) {
      throw new Error(`${label}: duplicate normalized role in role-grant allowlist`);
    }
    const membersType = Object.prototype.toString.call(members);
    if (!Array.isArray(members) && membersType !== "[object Set]") {
      throw new Error(`${label}: allowlisted role members must be an array or Set`);
    }
    normalizedAllowlist.set(
      normalizedRole,
      new Set(Array.from(members, (member) => normalizeMember(member, `${label} allowlist member`)))
    );
  }

  for (const grant of grants) {
    const role = normalizeRoleHex(grant?.role, `${label} RoleGranted role`);
    const account = normalizeMember(grant?.account, `${label} RoleGranted account`);
    const allowedMembers = normalizedAllowlist.get(role);
    if (!allowedMembers) {
      throw new Error(
        `${label}: historically granted unauthorized role ${role} to ${account}; ` +
        `allowed roles [${[...normalizedAllowlist.keys()].join(", ")}]`
      );
    }
    if (!allowedMembers.has(account)) {
      throw new Error(
        `${label}: role ${role} was historically granted to unauthorized account ${account}`
      );
    }
  }
}

function assertNoPrincipalEventLogs(logs, principal, label = "Principal") {
  if (!Array.isArray(logs)) {
    throw new Error(`${label}: event history must be an array`);
  }
  const normalizedPrincipal = normalizeMember(principal, `${label} principal`);
  const principalTopic = `0x${normalizedPrincipal.slice(2).padStart(64, "0")}`;
  const matches = logs.filter(
    (log) => log?.topics?.[1]?.toLowerCase() === principalTopic
  );
  if (matches.length !== 0) {
    throw new Error(`${label}: release history contains ${matches.length} forbidden event(s)`);
  }
}

module.exports = {
  EXPECTED_CHAIN_IDS,
  EXPECTED_BONDING_PRICE,
  EXPECTED_INITIAL_ALLOCATION,
  EXPECTED_INITIAL_TOKEN_SUPPLY,
  EXPECTED_MAX_GLOBAL_DAILY_FAUCET,
  EXPECTED_MAX_GLOBAL_DAILY_REWARD,
  EXPECTED_TIMELOCK_DELAY_SECONDS,
  assertBondingSecurityPolicy,
  assertBondingReleaseGenesis,
  assertAuthorizedRoleGrantHistory,
  assertCleanReleaseGenesis,
  assertCreationInputMatchesArtifact,
  assertDeploymentNetworkPolicy,
  assertEip1167CloneRuntime,
  assertExactRoleMembers,
  assertNoPrincipalEventLogs,
  assertRewardPoolDailyCap,
  assertRewardPoolDailyCaps,
  assertRuntimeMatchesArtifact,
  assertTimelockDelay,
  assertTokenGenesisPolicy,
  reconstructRoleMembership
};
