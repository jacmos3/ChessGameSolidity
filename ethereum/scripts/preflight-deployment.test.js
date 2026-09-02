const assert = require("node:assert/strict");
const test = require("node:test");

const {
  assertDeploymentBalanceReserve,
  assertHandoffPrincipalSeparation,
  assertFeeCapSufficient,
  formatUnits,
  isAddress,
  parseGovernanceHandoff,
  selectedNetwork,
  validateEnvironment
} = require("./preflight-deployment");

const VALID_ADDRESS = "0x1111111111111111111111111111111111111111";
const VALID_ENV = {
  MNEMONIC: "one two three four five six seven eight nine ten eleven twelve",
  BASE_SEPOLIA_RPC_URL: "https://sepolia.example.invalid",
  TEAM_WALLET: VALID_ADDRESS,
  TREASURY_WALLET: "0x2222222222222222222222222222222222222222",
  FAUCET_SIGNER: "0x3333333333333333333333333333333333333333",
  ORACLE_UPDATER: "0x4444444444444444444444444444444444444444",
  GOVERNANCE_HANDOFF: "true"
};
const rpcQuantity = (value) => `0x${BigInt(value).toString(16)}`;

test("selectedNetwork accepts split and inline arguments", () => {
  assert.equal(selectedNetwork(["--network", "base_sepolia"]), "base_sepolia");
  assert.equal(selectedNetwork(["--network=base_sepolia"]), "base_sepolia");
});

test("address validation rejects zero and malformed addresses", () => {
  assert.equal(isAddress(VALID_ADDRESS), true);
  assert.equal(isAddress("0x1234"), false);
  assert.equal(isAddress("0x0000000000000000000000000000000000000000"), false);
});

test("Base Sepolia requires an explicit governance decision", () => {
  assert.equal(parseGovernanceHandoff("base_sepolia", "true"), true);
  assert.equal(parseGovernanceHandoff("base_sepolia", "false"), false);
  assert.throws(() => parseGovernanceHandoff("base_sepolia", undefined), /explicitly/);
});

test("Base mainnet deployment target is rejected", () => {
  assert.throws(() => validateEnvironment(VALID_ENV, "base"), /Unsupported network: base/);
  assert.throws(() => parseGovernanceHandoff("base", "true"), /Unsupported network: base/);
});

test("environment validation selects only the requested RPC", () => {
  const config = validateEnvironment(VALID_ENV, "base_sepolia");
  assert.equal(config.network.chainId, 84532);
  assert.equal(config.rpcUrl, VALID_ENV.BASE_SEPOLIA_RPC_URL);
  assert.equal(config.handoffGovernance, true);
  assert.equal(config.maxPriorityFeePerGas, 1_000_000);
  assert.equal(config.maxFeePerGas, 5_000_000_000);

  const constrained = validateEnvironment(
    { ...VALID_ENV, BASE_MAX_FEE_PER_GAS_WEI: "100000000" },
    "base_sepolia"
  );
  assert.equal(constrained.maxFeePerGas, 100_000_000);
});

test("handoff preflight isolates treasury and operational signers from the deployer", () => {
  const config = validateEnvironment(VALID_ENV, "base_sepolia");
  const deployer = "0x9999999999999999999999999999999999999999";
  assert.doesNotThrow(() => assertHandoffPrincipalSeparation(config, deployer));

  for (const field of ["treasuryWallet", "faucetSigner", "oracleUpdater"]) {
    assert.throws(
      () => assertHandoffPrincipalSeparation({ ...config, [field]: deployer }, deployer),
      /must differ from the deployer/
    );
  }

  assert.doesNotThrow(() => assertHandoffPrincipalSeparation(
    { ...config, handoffGovernance: false, treasuryWallet: deployer },
    deployer
  ));
});

test("environment validation rejects an invalid Base priority fee", () => {
  assert.throws(
    () => validateEnvironment({ ...VALID_ENV, BASE_MAX_PRIORITY_FEE_PER_GAS_WEI: "2.5" }, "base_sepolia"),
    /positive integer/
  );
});

test("environment validation rejects plaintext public RPC URLs", () => {
  assert.throws(
    () => validateEnvironment(
      { ...VALID_ENV, BASE_SEPOLIA_RPC_URL: "http://sepolia.example.invalid" },
      "base_sepolia"
    ),
    /must use HTTPS/
  );
});

test("environment validation reports all missing required variables", () => {
  assert.throws(
    () => validateEnvironment({ GOVERNANCE_HANDOFF: "true" }, "base_sepolia"),
    /MNEMONIC.*BASE_SEPOLIA_RPC_URL.*TEAM_WALLET/
  );
});

test("formatUnits produces concise human-readable values", () => {
  assert.equal(formatUnits(1234567890000000000n, 18), "1.234567");
  assert.equal(formatUnits(1000000000n, 9), "1");
});

test("fee-cap validation accepts fees and balance within the configured cap", () => {
  assert.doesNotThrow(() => assertFeeCapSufficient(
    { maxFeePerGas: 5_000_000_000, maxPriorityFeePerGas: 1_000_000 },
    rpcQuantity(4_500_000_000),
    rpcQuantity(4_000_000_000)
  ));
  assert.equal(
    assertDeploymentBalanceReserve(1_500_000_000_000_000n, 15_000_000),
    1_500_000_000_000_000n
  );
  assert.throws(
    () => assertDeploymentBalanceReserve(1_499_999_999_999_999n, 15_000_000),
    /cannot cover the conservative full-migration gas budget/
  );
});

test("fee-cap validation rejects a base fee that leaves no configured priority headroom", () => {
  assert.throws(
    () => assertFeeCapSufficient(
      { maxFeePerGas: 5_000_000_000, maxPriorityFeePerGas: 1_000_000 },
      rpcQuantity(5_000_000_000),
      rpcQuantity(5_000_000_000)
    ),
    /cannot cover the latest base fee.*priority fee/
  );
});

test("fee-cap validation rejects an RPC suggested fee above the configured cap", () => {
  assert.throws(
    () => assertFeeCapSufficient(
      { maxFeePerGas: 5_000_000_000, maxPriorityFeePerGas: 1_000_000 },
      rpcQuantity(6_000_000_000),
      rpcQuantity(4_000_000_000)
    ),
    /below the RPC suggested gas price/
  );
});
