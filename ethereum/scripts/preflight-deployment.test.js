const assert = require("node:assert/strict");
const test = require("node:test");

const {
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
  assert.equal(selectedNetwork(["--network=base"]), "base");
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

test("Base mainnet cannot disable governance handoff", () => {
  assert.equal(parseGovernanceHandoff("base", "true"), true);
  assert.throws(() => parseGovernanceHandoff("base", "false"), /must be true/);
});

test("environment validation selects only the requested RPC", () => {
  const config = validateEnvironment(VALID_ENV, "base_sepolia");
  assert.equal(config.network.chainId, 84532);
  assert.equal(config.rpcUrl, VALID_ENV.BASE_SEPOLIA_RPC_URL);
  assert.equal(config.handoffGovernance, true);
  assert.equal(config.maxPriorityFeePerGas, 1_000_000);
  assert.equal(config.maxFeePerGas, 5_000_000_000);
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

test("fee-cap validation accepts a suggested fee within the fixed cap", () => {
  assert.doesNotThrow(() => assertFeeCapSufficient(
    { maxFeePerGas: 5_000_000_000, maxPriorityFeePerGas: 1_000_000 },
    rpcQuantity(4_500_000_000),
    rpcQuantity(4_000_000_000)
  ));
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

test("fee-cap validation rejects an RPC suggested fee above the fixed cap", () => {
  assert.throws(
    () => assertFeeCapSufficient(
      { maxFeePerGas: 5_000_000_000, maxPriorityFeePerGas: 1_000_000 },
      rpcQuantity(6_000_000_000),
      rpcQuantity(4_000_000_000)
    ),
    /below the RPC suggested gas price/
  );
});
