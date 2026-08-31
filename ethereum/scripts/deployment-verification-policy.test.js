const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");

const {
  EXPECTED_INITIAL_ALLOCATION,
  EXPECTED_INITIAL_TOKEN_SUPPLY,
  EXPECTED_MAX_GLOBAL_DAILY_FAUCET,
  EXPECTED_MAX_GLOBAL_DAILY_REWARD,
  EXPECTED_TIMELOCK_DELAY_SECONDS,
  assertAuthorizedRoleGrantHistory,
  assertBondingReleaseGenesis,
  assertBondingSecurityPolicy,
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
} = require("./deployment-verification-policy");

function deployment(network, handoffGovernance) {
  return { network, config: { handoffGovernance } };
}

test("runtime authentication accepts an exact artifact match", () => {
  const artifact = { deployedBytecode: "0x6001600055" };
  assert.doesNotThrow(() => assertRuntimeMatchesArtifact("0x6001600055", artifact, {}, "Example"));
});

test("clean release genesis rejects every persistent pre-handoff position", () => {
  const clean = {
    factoryGames: 0,
    factoryGameArrayLength: 0,
    daoDisputes: 0,
    daoSelectionSequence: 0,
    daoNextSelectionSequence: 1,
    daoEscrow: 0,
    registryGameRecords: 0,
    registryActiveSelection: 0,
    registryStaked: 0,
    registryArbitrators: 0,
    ratingRankedPlayers: 0,
    rewardFaucetPool: 0,
    rewardGamePool: 0,
    rewardCapacity: 0,
    rewardTodayFaucetClaims: 0,
    rewardTodayGameRewards: 0,
    bondingChess: 0,
    bondingEth: 0,
    bondingChessSlashed: 0,
    bondingEthSlashed: 0,
    bondingTokenBalance: 0,
    registryTokenBalance: 0,
    daoTokenBalance: 0,
    rewardTokenBalance: 0
  };
  assert.doesNotThrow(() => assertCleanReleaseGenesis(clean));
  for (const field of Object.keys(clean)) {
    const poisoned = { ...clean, [field]: clean[field] === 1 ? 2 : 1 };
    assert.throws(() => assertCleanReleaseGenesis(poisoned), /expected/);
  }
  const missing = { ...clean };
  delete missing.daoDisputes;
  assert.throws(() => assertCleanReleaseGenesis(missing), /missing release-genesis value/);
});

test("bonding release genesis is bound to creation time with no material update history", () => {
  const clean = {
    priceLastUpdated: 1_700_000_000,
    priceWindowStartedAt: 1_700_000_000,
    lastMaterialPriceUpdateAt: 0
  };
  assert.doesNotThrow(() => assertBondingReleaseGenesis(clean, 1_700_000_000));

  for (const field of Object.keys(clean)) {
    assert.throws(
      () => assertBondingReleaseGenesis({ ...clean, [field]: clean[field] + 1 }, 1_700_000_000),
      /BondingManager/
    );
  }
});

test("principal event history cannot be griefed by unrelated token holders", () => {
  const treasury = `0x${"11".repeat(20)}`;
  const unrelated = `0x${"22".repeat(20)}`;
  const addressTopic = (address) => `0x${address.slice(2).padStart(64, "0")}`;
  const unrelatedLog = { topics: ["0xtopic", addressTopic(unrelated)] };
  const treasuryLog = { topics: ["0xtopic", addressTopic(treasury)] };

  assert.doesNotThrow(() => assertNoPrincipalEventLogs(
    [unrelatedLog],
    treasury,
    "ChessToken governance"
  ));
  assert.throws(
    () => assertNoPrincipalEventLogs([unrelatedLog, treasuryLog], treasury, "ChessToken governance"),
    /1 forbidden event/
  );
});

test("creation authentication binds initcode, links and constructor arguments", () => {
  const linkedAddress = `0x${"11".repeat(20)}`;
  const artifact = {
    bytecode: `0x73${"_".repeat(40)}6000`,
    linkReferences: {
      "contracts/Example.sol": { ExampleLibrary: [{ start: 1, length: 20 }] }
    }
  };
  const args = `0x${"22".repeat(32)}`;
  const actual = `0x73${"11".repeat(20)}6000${"22".repeat(32)}`;
  assert.doesNotThrow(() => assertCreationInputMatchesArtifact(
    actual,
    artifact,
    args,
    { ExampleLibrary: linkedAddress },
    "Example"
  ));
  assert.throws(
    () => assertCreationInputMatchesArtifact(
      `${actual.slice(0, -2)}33`,
      artifact,
      args,
      { ExampleLibrary: linkedAddress },
      "Example"
    ),
    /initcode or constructor arguments/
  );
});

test("creation authentication resolves only an explicitly named legacy Truffle link", () => {
  const linkedAddress = `0x${"11".repeat(20)}`;
  const placeholder = "__ChessMediaLibrary".padEnd(40, "_");
  const artifact = { bytecode: `0x73${placeholder}6000` };
  const actual = `0x73${"11".repeat(20)}6000`;

  assert.doesNotThrow(() => assertCreationInputMatchesArtifact(
    actual,
    artifact,
    "0x",
    { ChessMediaLibrary: linkedAddress },
    "ChessCoreImplementation"
  ));
  assert.throws(
    () => assertCreationInputMatchesArtifact(
      actual,
      artifact,
      "0x",
      { OtherLibrary: linkedAddress },
      "ChessCoreImplementation"
    ),
    /configured linked library OtherLibrary is not referenced/
  );
  assert.throws(
    () => assertCreationInputMatchesArtifact(
      actual,
      { bytecode: `0x73${"11".repeat(20)}6000` },
      "0x",
      { ChessMediaLibrary: linkedAddress },
      "ChessCoreImplementation"
    ),
    /configured linked library ChessMediaLibrary is not referenced/
  );
});

test("EIP-1167 clone authentication binds the canonical runtime to its implementation", () => {
  const implementation = `0x${"12".repeat(20)}`;
  const runtime =
    `0x363d3d373d3d3d363d73${implementation.slice(2)}5af43d82803e903d91602b57fd5bf3`;
  assert.doesNotThrow(() => assertEip1167CloneRuntime(runtime, implementation, "Chess game"));
  assert.doesNotThrow(() => assertEip1167CloneRuntime(runtime.toUpperCase().replace("0X", "0x"), implementation));
});

test("EIP-1167 clone authentication rejects target and runtime substitutions", () => {
  const implementation = `0x${"12".repeat(20)}`;
  const otherImplementation = `0x${"34".repeat(20)}`;
  const prefix = "363d3d373d3d3d363d73";
  const suffix = "5af43d82803e903d91602b57fd5bf3";
  const runtime = `0x${prefix}${implementation.slice(2)}${suffix}`;

  assert.throws(
    () => assertEip1167CloneRuntime(runtime, otherImplementation),
    /unexpected implementation/
  );
  assert.throws(
    () => assertEip1167CloneRuntime(`0x00${runtime.slice(4)}`, implementation),
    /not the canonical EIP-1167 runtime/
  );
  assert.throws(
    () => assertEip1167CloneRuntime(`${runtime}00`, implementation),
    /not the canonical EIP-1167 runtime/
  );
  assert.throws(
    () => assertEip1167CloneRuntime(runtime, `0x${"00".repeat(20)}`),
    /non-zero address/
  );
});

test("runtime authentication rejects changed logic and changed length", () => {
  const artifact = { deployedBytecode: "0x6001600055" };
  assert.throws(
    () => assertRuntimeMatchesArtifact("0x6002600055", artifact, {}, "Example"),
    /does not match the repository artifact/
  );
  assert.throws(
    () => assertRuntimeMatchesArtifact("0x60016000", artifact, {}, "Example"),
    /runtime length differs/
  );
});

test("runtime authentication masks only compiler-reported immutable slots", () => {
  const immutableValue = "ab".repeat(32);
  const artifact = {
    deployedBytecode: `0x6001${"00".repeat(32)}6002`,
    immutableReferences: { "1": [{ start: 2, length: 32 }] }
  };
  assert.doesNotThrow(() => assertRuntimeMatchesArtifact(
    `0x6001${immutableValue}6002`,
    artifact,
    {},
    "ImmutableExample"
  ));
  assert.throws(
    () => assertRuntimeMatchesArtifact(`0x6101${immutableValue}6002`, artifact, {}, "ImmutableExample"),
    /does not match the repository artifact/
  );
});

test("runtime authentication rejects inconsistent copies of one immutable", () => {
  const artifact = {
    deployedBytecode: `0x60${"00".repeat(32)}61${"00".repeat(32)}62`,
    immutableReferences: {
      "1": [
        { start: 1, length: 32 },
        { start: 34, length: 32 }
      ]
    }
  };
  assert.doesNotThrow(() => assertRuntimeMatchesArtifact(
    `0x60${"ab".repeat(32)}61${"ab".repeat(32)}62`,
    artifact,
    {},
    "ImmutableExample"
  ));
  assert.throws(
    () => assertRuntimeMatchesArtifact(
      `0x60${"ab".repeat(32)}61${"cd".repeat(32)}62`,
      artifact,
      {},
      "ImmutableExample"
    ),
    /inconsistent immutable values/
  );
});

test("runtime authentication binds linked-library addresses instead of masking them", () => {
  const linkedAddress = `0x${"11".repeat(20)}`;
  const artifact = {
    deployedBytecode: `0x73${"_".repeat(40)}5af4`,
    deployedLinkReferences: {
      "contracts/Example.sol": { ExampleLibrary: [{ start: 1, length: 20 }] }
    }
  };
  assert.doesNotThrow(() => assertRuntimeMatchesArtifact(
    `0x73${"11".repeat(20)}5af4`,
    artifact,
    { ExampleLibrary: linkedAddress },
    "LinkedExample"
  ));
  assert.throws(
    () => assertRuntimeMatchesArtifact(
      `0x73${"22".repeat(20)}5af4`,
      artifact,
      { ExampleLibrary: linkedAddress },
      "LinkedExample"
    ),
    /does not match the repository artifact/
  );
});

test("runtime authentication binds a legacy Truffle placeholder after metadata loss", () => {
  const linkedAddress = `0x${"11".repeat(20)}`;
  const placeholder = "__ChessMediaLibrary".padEnd(40, "_");
  const artifact = { deployedBytecode: `0x73${placeholder}5af4` };

  assert.doesNotThrow(() => assertRuntimeMatchesArtifact(
    `0x73${"11".repeat(20)}5af4`,
    artifact,
    { ChessMediaLibrary: linkedAddress },
    "ChessCoreImplementation"
  ));
  assert.throws(
    () => assertRuntimeMatchesArtifact(
      `0x73${"22".repeat(20)}5af4`,
      artifact,
      { ChessMediaLibrary: linkedAddress },
      "ChessCoreImplementation"
    ),
    /does not match the repository artifact/
  );
});

test("runtime authentication rejects missing link metadata or addresses", () => {
  const artifact = {
    deployedBytecode: `0x73${"_".repeat(40)}5af4`,
    deployedLinkReferences: {
      "contracts/Example.sol": { ExampleLibrary: [{ start: 1, length: 20 }] }
    }
  };
  assert.throws(
    () => assertRuntimeMatchesArtifact(
      `0x73${"11".repeat(20)}5af4`,
      artifact,
      {},
      "LinkedExample"
    ),
    /missing deployed address for linked library/
  );

  assert.throws(
    () => assertRuntimeMatchesArtifact(
      `0x73${"11".repeat(20)}5af4`,
      { deployedBytecode: artifact.deployedBytecode },
      {},
      "LinkedExample"
    ),
    /unresolved link placeholders/
  );
});

test("network policy independently requires governance handoff on Base mainnet", () => {
  assert.doesNotThrow(() => assertDeploymentNetworkPolicy(deployment("base", true), 8453));
  assert.throws(
    () => assertDeploymentNetworkPolicy(deployment("base", false), 8453),
    /requires governance handoff/
  );
});

test("network policy cannot disguise any public chain as development", () => {
  for (const chainId of [1, 10, 137, 8453, 84532]) {
    assert.throws(
      () => assertDeploymentNetworkPolicy(deployment("development", false), chainId),
      /allowlisted local chain/
    );
  }
  for (const chainId of [1337, 5777, 31337]) {
    assert.doesNotThrow(
      () => assertDeploymentNetworkPolicy(deployment("development", false), chainId)
    );
  }
});

test("network policy rejects a chain id inconsistent with the deployment network", () => {
  assert.throws(
    () => assertDeploymentNetworkPolicy(deployment("base_sepolia", true), 8453),
    /Connected chain mismatch/
  );
  assert.throws(
    () => assertDeploymentNetworkPolicy(deployment("unsupported", true), 1),
    /Unsupported deployment network/
  );
});

test("timelock verification requires the exact two-day delay", () => {
  assert.doesNotThrow(() => assertTimelockDelay(String(EXPECTED_TIMELOCK_DELAY_SECONDS)));
  assert.throws(() => assertTimelockDelay("0"), /ChessTimelock delay/);
  assert.throws(() => assertTimelockDelay("86400"), /ChessTimelock delay/);
});

test("reward-pool verification requires the bounded default daily emission cap", () => {
  assert.doesNotThrow(() => assertRewardPoolDailyCap(
    EXPECTED_MAX_GLOBAL_DAILY_REWARD,
    EXPECTED_MAX_GLOBAL_DAILY_REWARD
  ));
  assert.throws(
    () => assertRewardPoolDailyCap(1n, EXPECTED_MAX_GLOBAL_DAILY_REWARD),
    /initial daily cap/
  );
  assert.throws(
    () => assertRewardPoolDailyCap(1n, 2n),
    /maximum daily reward/
  );
});

test("reward-pool verification requires both immutable daily ceilings", () => {
  const canonical = {
    rewardCap: EXPECTED_MAX_GLOBAL_DAILY_REWARD,
    maximumReward: EXPECTED_MAX_GLOBAL_DAILY_REWARD,
    faucetCap: EXPECTED_MAX_GLOBAL_DAILY_FAUCET,
    maximumFaucet: EXPECTED_MAX_GLOBAL_DAILY_FAUCET
  };
  assert.doesNotThrow(() => assertRewardPoolDailyCaps(canonical));
  assert.throws(
    () => assertRewardPoolDailyCaps({ ...canonical, faucetCap: 1n }),
    /initial daily faucet cap/
  );
});

test("bonding verification rejects drift and stale or paused release state", () => {
  const canonical = {
    chessMultiplier: 3,
    ethMultiplier: 2,
    minBondEthValue: "10000000000000000",
    chessEthPrice: "1000000000000000",
    lastKnownPrice: "1000000000000000",
    priceWindowAnchor: "1000000000000000",
    priceLastUpdated: 1_000,
    freshnessWindow: 604_800,
    paused: false,
    circuitBreakerTripped: false
  };
  assert.doesNotThrow(() => assertBondingSecurityPolicy(canonical, "base", 2_000));
  assert.throws(
    () => assertBondingSecurityPolicy({ ...canonical, chessMultiplier: 1 }, "base", 2_000),
    /CHESS multiplier/
  );
  assert.throws(
    () => assertBondingSecurityPolicy({ ...canonical, paused: true }, "base", 2_000),
    /must not be paused/
  );
  assert.throws(
    () => assertBondingSecurityPolicy(canonical, "base", 700_000),
    /stale or future-dated/
  );
});

test("token genesis verification binds the initial allocation counters", () => {
  const canonical = {
    playToEarnMinted: 0,
    treasuryMinted: 0,
    teamMinted: 0,
    teamVestingClaimed: 0,
    liquidityMinted: EXPECTED_INITIAL_ALLOCATION,
    communityMinted: EXPECTED_INITIAL_ALLOCATION,
    totalSupply: EXPECTED_INITIAL_TOKEN_SUPPLY
  };
  assert.doesNotThrow(() => assertTokenGenesisPolicy(canonical));
  assert.throws(
    () => assertTokenGenesisPolicy({ ...canonical, totalSupply: 1n }),
    /initial total supply/
  );
});

test("role-log reconstruction rejects extra final privileged members", () => {
  const grant = `0x${"aa".repeat(32)}`;
  const revoke = `0x${"bb".repeat(32)}`;
  const role = `0x${"11".repeat(32)}`;
  const first = `0x${"22".repeat(20)}`;
  const extra = `0x${"33".repeat(20)}`;
  const topic = (address) => `0x${"00".repeat(12)}${address.slice(2)}`;
  const memberships = reconstructRoleMembership([
    { blockNumber: 1, logIndex: 0, topics: [grant, role, topic(first)] },
    { blockNumber: 2, logIndex: 0, topics: [grant, role, topic(extra)] },
    { blockNumber: 3, logIndex: 0, topics: [revoke, role, topic(extra)] }
  ], grant, revoke);
  assert.doesNotThrow(() => assertExactRoleMembers(memberships, role, [first], "Example role"));

  const withExtra = reconstructRoleMembership([
    { blockNumber: 1, logIndex: 0, topics: [grant, role, topic(first)] },
    { blockNumber: 2, logIndex: 0, topics: [grant, role, topic(extra)] }
  ], grant, revoke);
  assert.throws(
    () => assertExactRoleMembers(withExtra, role, [first], "Example role"),
    /extra/
  );
});

test("role-grant history accepts only explicitly allowlisted role/member pairs", () => {
  const adminRole = `0x${"aa".repeat(32)}`;
  const gameRole = `0x${"bb".repeat(32)}`;
  const admin = `0x${"11".repeat(20)}`;
  const factory = `0x${"22".repeat(20)}`;
  const game = `0x${"33".repeat(20)}`;
  const uppercaseHex = (value) => `0x${value.slice(2).toUpperCase()}`;

  assert.doesNotThrow(() => assertAuthorizedRoleGrantHistory(
    [
      { role: adminRole, account: admin },
      { role: gameRole, account: factory },
      { role: gameRole, account: game }
    ],
    {
      [uppercaseHex(adminRole)]: [uppercaseHex(admin)],
      [gameRole]: new Set([factory, game])
    },
    "Example"
  ));
  assert.doesNotThrow(() => assertAuthorizedRoleGrantHistory([], new Map(), "Empty"));
});

test("role-grant history accepts Map and Set values created in a Truffle-style foreign realm", () => {
  const role = `0x${"12".repeat(32)}`;
  const account = `0x${"34".repeat(20)}`;
  const foreignAllowlist = vm.runInNewContext(
    "new Map([[role, new Set([account])]])",
    { role, account }
  );

  assert.doesNotThrow(() => assertAuthorizedRoleGrantHistory(
    [{ role, account }],
    foreignAllowlist,
    "ForeignRealmAccessControl"
  ));
});

test("role-grant history rejects historically unauthorized roles and accounts", () => {
  const allowedRole = `0x${"aa".repeat(32)}`;
  const unknownRole = `0x${"bb".repeat(32)}`;
  const allowedAccount = `0x${"11".repeat(20)}`;
  const unauthorizedAccount = `0x${"22".repeat(20)}`;
  const allowlist = new Map([[allowedRole, [allowedAccount]]]);

  assert.throws(
    () => assertAuthorizedRoleGrantHistory(
      [{ role: unknownRole, account: allowedAccount }],
      allowlist,
      "Example"
    ),
    /historically granted unauthorized role/
  );
  assert.throws(
    () => assertAuthorizedRoleGrantHistory(
      [{ role: allowedRole, account: unauthorizedAccount }],
      allowlist,
      "Example"
    ),
    /historically granted to unauthorized account/
  );
});
