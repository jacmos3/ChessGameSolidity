const path = require("path");
const dotenv = require("dotenv");
const HDWalletProvider = require("@truffle/hdwallet-provider");
const { parseBaseMaxPriorityFeePerGas } = require("./base-fee-config");

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const VALID_MNEMONIC_LENGTHS = new Set([12, 15, 18, 21, 24]);
const NETWORKS = {
  base_sepolia: {
    label: "Base Sepolia",
    chainId: 84532,
    rpcVariable: "BASE_SEPOLIA_RPC_URL",
    forceGovernanceHandoff: false
  },
  base: {
    label: "Base",
    chainId: 8453,
    rpcVariable: "BASE_RPC_URL",
    forceGovernanceHandoff: true
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
  if (network.forceGovernanceHandoff) {
    if (rawValue !== undefined && rawValue !== "true") {
      throw new Error("GOVERNANCE_HANDOFF must be true for Base mainnet");
    }
    return true;
  }

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

  try {
    const parsedRpc = new URL(env[network.rpcVariable]);
    if (parsedRpc.protocol !== "https:" && parsedRpc.protocol !== "http:") {
      throw new Error("unsupported protocol");
    }
  } catch {
    throw new Error(`${network.rpcVariable} must be a valid HTTP(S) URL`);
  }

  for (const name of ["TEAM_WALLET", "TREASURY_WALLET", "FAUCET_SIGNER", "ORACLE_UPDATER"]) {
    if (!isAddress(env[name])) throw new Error(`${name} must be a valid non-zero address`);
  }

  return {
    network,
    rpcUrl: env[network.rpcVariable],
    handoffGovernance: parseGovernanceHandoff(networkName, env.GOVERNANCE_HANDOFF),
    teamWallet: env.TEAM_WALLET,
    treasuryWallet: env.TREASURY_WALLET,
    faucetSigner: env.FAUCET_SIGNER,
    oracleUpdater: env.ORACLE_UPDATER,
    maxPriorityFeePerGas: parseBaseMaxPriorityFeePerGas(env)
  };
}

async function run() {
  dotenv.config({ path: path.join(__dirname, "..", ".env"), quiet: true });

  const networkName = selectedNetwork();
  const config = validateEnvironment(process.env, networkName);
  const deployer = deriveDeployer(process.env.MNEMONIC.trim(), config.rpcUrl);
  const warnings = [];

  if (config.handoffGovernance) {
    if (config.faucetSigner.toLowerCase() === deployer.toLowerCase()) {
      throw new Error("FAUCET_SIGNER must differ from the deployer when governance handoff is enabled");
    }
    if (config.oracleUpdater.toLowerCase() === deployer.toLowerCase()) {
      throw new Error("ORACLE_UPDATER must differ from the deployer when governance handoff is enabled");
    }
  } else {
    warnings.push("Governance handoff is disabled; the deployer will retain protocol administration");
  }

  if (config.teamWallet.toLowerCase() === config.treasuryWallet.toLowerCase()) {
    warnings.push("TEAM_WALLET and TREASURY_WALLET are the same address");
  }
  if (config.faucetSigner.toLowerCase() === config.oracleUpdater.toLowerCase()) {
    warnings.push("FAUCET_SIGNER and ORACLE_UPDATER are the same address; operational duties are not isolated");
  }

  const [chainIdHex, balanceHex, gasPriceHex, blockNumberHex] = await Promise.all([
    rpcCall(config.rpcUrl, "eth_chainId"),
    rpcCall(config.rpcUrl, "eth_getBalance", [deployer, "latest"]),
    rpcCall(config.rpcUrl, "eth_gasPrice"),
    rpcCall(config.rpcUrl, "eth_blockNumber")
  ]);

  const chainId = Number(BigInt(chainIdHex));
  if (chainId !== config.network.chainId) {
    throw new Error(`RPC chain mismatch: expected ${config.network.chainId}, got ${chainId}`);
  }
  const balance = BigInt(balanceHex);
  if (balance === 0n) throw new Error("The deployer has no native ETH for gas");
  if (balance < 10n ** 16n) warnings.push("Deployer balance is below 0.01 ETH; it may be insufficient for the full migration");

  console.log(`Deployment preflight: ${config.network.label}`);
  console.log(`  Chain ID: ${chainId}`);
  console.log(`  Latest block: ${Number(BigInt(blockNumberHex))}`);
  console.log(`  Deployer: ${deployer}`);
  console.log(`  Deployer balance: ${formatUnits(balance, 18)} ETH`);
  console.log(`  Gas price: ${formatUnits(BigInt(gasPriceHex), 9)} gwei`);
  console.log(`  Max priority fee: ${formatUnits(BigInt(config.maxPriorityFeePerGas), 9)} gwei`);
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
