const path = require("path");
const dotenv = require("dotenv");
const HDWalletProvider = require("@truffle/hdwallet-provider");
const {
  PUBLIC_DEPLOYMENT_GAS_BUDGET,
  parseBaseFeeConfig
} = require("./base-fee-config");

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const VALID_MNEMONIC_LENGTHS = new Set([12, 15, 18, 21, 24]);
const NETWORKS = {
  base_sepolia: {
    label: "Base Sepolia",
    chainId: 84532,
    rpcVariable: "BASE_SEPOLIA_RPC_URL"
  }
};

function selectedNetwork(argv = process.argv.slice(2)) {
  const inline = argv.find((argument) => argument.startsWith("--network="));
  if (inline) return inline.slice("--network=".length);

  const index = argv.indexOf("--network");
  return index >= 0 ? argv[index + 1] : undefined;
}

function isAddress(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value) && value.toLowerCase() !== ZERO_ADDRESS;
}

function parseGovernanceHandoff(networkName, rawValue) {
  const network = NETWORKS[networkName];
  if (!network) throw new Error(`Unsupported network: ${networkName || "missing"}`);

  if (rawValue !== "true" && rawValue !== "false") {
    throw new Error("GOVERNANCE_HANDOFF must explicitly be true or false for Base Sepolia");
  }
  return rawValue === "true";
}

function formatUnits(value, decimals, precision = 6) {
  const amount = BigInt(value);
  const base = 10n ** BigInt(decimals);
  const whole = amount / base;
  const fraction = (amount % base).toString().padStart(decimals, "0").slice(0, precision).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function parseRpcQuantity(value, label) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) {
    throw new Error(`RPC returned an invalid ${label}`);
  }
  return BigInt(value);
}

function assertFeeCapSufficient(config, gasPriceHex, baseFeeHex) {
  const maxFee = BigInt(config.maxFeePerGas);
  const priorityFee = BigInt(config.maxPriorityFeePerGas);
  const gasPrice = parseRpcQuantity(gasPriceHex, "suggested gas price");
  const baseFee = parseRpcQuantity(baseFeeHex, "latest block base fee");

  if (baseFee + priorityFee > maxFee) {
    throw new Error(
      `Configured max total fee of ${formatUnits(maxFee, 9)} gwei cannot cover ` +
      `the latest base fee of ${formatUnits(baseFee, 9)} gwei plus the configured ` +
      `priority fee of ${formatUnits(priorityFee, 9)} gwei`
    );
  }
  if (gasPrice > maxFee) {
    throw new Error(
      `Configured max total fee of ${formatUnits(maxFee, 9)} gwei is below ` +
      `the RPC suggested gas price of ${formatUnits(gasPrice, 9)} gwei`
    );
  }

  return { baseFee, gasPrice };
}

function deriveDeployer(mnemonic, rpcUrl) {
  let provider;
  try {
    provider = new HDWalletProvider({
      mnemonic: { phrase: mnemonic },
      providerOrUrl: rpcUrl,
      numberOfAddresses: 1,
      shareNonce: false
    });
    return provider.getAddress(0);
  } finally {
    if (provider && provider.engine) provider.engine.stop();
  }
}

async function rpcCall(rpcUrl, method, params = []) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(20_000)
  });
  if (!response.ok) throw new Error(`RPC returned HTTP ${response.status}`);

  const body = await response.json();
  if (body.error) throw new Error(`RPC ${method} failed: ${body.error.message || body.error.code}`);
  return body.result;
}

function validateEnvironment(env, networkName) {
  const network = NETWORKS[networkName];
  if (!network) throw new Error(`Unsupported network: ${networkName || "missing"}`);

  const required = [
    "MNEMONIC",
    network.rpcVariable,
    "TEAM_WALLET",
    "TREASURY_WALLET",
    "FAUCET_SIGNER",
    "ORACLE_UPDATER"
  ];
  const missing = required.filter((name) => !env[name] || !env[name].trim());
  if (missing.length > 0) throw new Error(`Missing required variables: ${missing.join(", ")}`);

  const words = env.MNEMONIC.trim().split(/\s+/);
  if (!VALID_MNEMONIC_LENGTHS.has(words.length)) {
    throw new Error("MNEMONIC must contain 12, 15, 18, 21, or 24 words");
  }

  let parsedRpc;
  try {
    parsedRpc = new URL(env[network.rpcVariable]);
  } catch {
    throw new Error(`${network.rpcVariable} must be a valid HTTPS URL`);
  }
  if (parsedRpc.protocol !== "https:") {
    throw new Error(`${network.rpcVariable} must use HTTPS`);
  }

  for (const name of ["TEAM_WALLET", "TREASURY_WALLET", "FAUCET_SIGNER", "ORACLE_UPDATER"]) {
    if (!isAddress(env[name])) throw new Error(`${name} must be a valid non-zero address`);
  }

  const feeConfig = parseBaseFeeConfig(env);
  return {
    network,
    rpcUrl: env[network.rpcVariable],
    handoffGovernance: parseGovernanceHandoff(networkName, env.GOVERNANCE_HANDOFF),
    teamWallet: env.TEAM_WALLET,
    treasuryWallet: env.TREASURY_WALLET,
    faucetSigner: env.FAUCET_SIGNER,
    oracleUpdater: env.ORACLE_UPDATER,
    ...feeConfig
  };
}

function assertDeploymentBalanceReserve(balance, maxFeePerGas) {
  const available = BigInt(balance);
  const maximumMigrationCost =
    BigInt(maxFeePerGas) * BigInt(PUBLIC_DEPLOYMENT_GAS_BUDGET);
  if (available < maximumMigrationCost) {
    throw new Error(
      `Deployer balance cannot cover the conservative full-migration gas budget at the configured max fee; ` +
      `requires at least ${formatUnits(maximumMigrationCost, 18)} ETH`
    );
  }
  return maximumMigrationCost;
}

function assertHandoffPrincipalSeparation(config, deployer) {
  if (!config.handoffGovernance) return;
  const deployerAddress = deployer.toLowerCase();
  if (config.treasuryWallet.toLowerCase() === deployerAddress) {
    throw new Error("TREASURY_WALLET must differ from the deployer when governance handoff is enabled");
  }
  if (config.faucetSigner.toLowerCase() === deployerAddress) {
    throw new Error("FAUCET_SIGNER must differ from the deployer when governance handoff is enabled");
  }
  if (config.oracleUpdater.toLowerCase() === deployerAddress) {
    throw new Error("ORACLE_UPDATER must differ from the deployer when governance handoff is enabled");
  }
}

async function run() {
  dotenv.config({ path: path.join(__dirname, "..", ".env"), quiet: true });

  const networkName = selectedNetwork();
  const config = validateEnvironment(process.env, networkName);
  const deployer = deriveDeployer(process.env.MNEMONIC.trim(), config.rpcUrl);
  const warnings = [];

  assertHandoffPrincipalSeparation(config, deployer);
  if (!config.handoffGovernance) {
    warnings.push("Governance handoff is disabled; the deployer will retain protocol administration");
  }

  if (config.teamWallet.toLowerCase() === config.treasuryWallet.toLowerCase()) {
    warnings.push("TEAM_WALLET and TREASURY_WALLET are the same address");
  }
  if (config.faucetSigner.toLowerCase() === config.oracleUpdater.toLowerCase()) {
    warnings.push("FAUCET_SIGNER and ORACLE_UPDATER are the same address; operational duties are not isolated");
  }

  const [chainIdHex, balanceHex, gasPriceHex, latestBlock] = await Promise.all([
    rpcCall(config.rpcUrl, "eth_chainId"),
    rpcCall(config.rpcUrl, "eth_getBalance", [deployer, "latest"]),
    rpcCall(config.rpcUrl, "eth_gasPrice"),
    rpcCall(config.rpcUrl, "eth_getBlockByNumber", ["latest", false])
  ]);

  const chainId = Number(BigInt(chainIdHex));
  if (chainId !== config.network.chainId) {
    throw new Error(`RPC chain mismatch: expected ${config.network.chainId}, got ${chainId}`);
  }
  const balance = BigInt(balanceHex);
  if (balance === 0n) throw new Error("The deployer has no native ETH for gas");
  const fullMigrationReserve = assertDeploymentBalanceReserve(
    balance,
    config.maxFeePerGas
  );
  if (!latestBlock || typeof latestBlock !== "object") {
    throw new Error("RPC returned an invalid latest block");
  }
  const blockNumber = parseRpcQuantity(latestBlock.number, "latest block number");
  const { baseFee, gasPrice } = assertFeeCapSufficient(
    config,
    gasPriceHex,
    latestBlock.baseFeePerGas
  );

  console.log(`Deployment preflight: ${config.network.label}`);
  console.log(`  Chain ID: ${chainId}`);
  console.log(`  Latest block: ${blockNumber}`);
  console.log(`  Deployer: ${deployer}`);
  console.log(`  Deployer balance: ${formatUnits(balance, 18)} ETH`);
  console.log(`  Full-migration reserve: ${formatUnits(fullMigrationReserve, 18)} ETH`);
  console.log(`  Base fee: ${formatUnits(baseFee, 9)} gwei`);
  console.log(`  Gas price: ${formatUnits(gasPrice, 9)} gwei`);
  console.log(`  Max priority fee: ${formatUnits(BigInt(config.maxPriorityFeePerGas), 9)} gwei`);
  console.log(`  Max total fee: ${formatUnits(BigInt(config.maxFeePerGas), 9)} gwei`);
  console.log(`  Governance handoff: ${config.handoffGovernance ? "enabled" : "disabled"}`);
  console.log(`  Team wallet: ${config.teamWallet}`);
  console.log(`  Treasury wallet: ${config.treasuryWallet}`);
  console.log(`  Faucet signer: ${config.faucetSigner}`);
  console.log(`  Oracle updater: ${config.oracleUpdater}`);

  for (const warning of warnings) console.warn(`  WARNING: ${warning}`);
  console.log("Deployment preflight passed.");
}

module.exports = {
  NETWORKS,
  assertDeploymentBalanceReserve,
  assertHandoffPrincipalSeparation,
  assertFeeCapSufficient,
  formatUnits,
  isAddress,
  parseGovernanceHandoff,
  selectedNetwork,
  validateEnvironment
};

if (require.main === module) {
  run().catch((error) => {
    console.error(`Deployment preflight failed: ${error.message}`);
    process.exitCode = 1;
  });
}
