const assert = require("node:assert/strict");
const test = require("node:test");

const {
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
});

test("environment validation rejects an invalid Base priority fee", () => {
  assert.throws(
    () => validateEnvironment({ ...VALID_ENV, BASE_MAX_PRIORITY_FEE_PER_GAS_WEI: "2.5" }, "base_sepolia"),
    /positive integer/
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
