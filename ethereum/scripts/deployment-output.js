const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const SUPPORTED_DEPLOYMENT_NETWORKS = new Set(["development", "base_sepolia"]);

function assertSupportedDeploymentNetwork(network) {
  if (!SUPPORTED_DEPLOYMENT_NETWORKS.has(network)) {
    throw new Error(`Unsupported deployment network: ${network || "missing"}`);
  }
}

function networkFromArguments(argv = process.argv.slice(2)) {
  const inline = argv.find((argument) => argument.startsWith("--network="));
  if (inline) return inline.slice("--network=".length);

  const index = argv.indexOf("--network");
  return index >= 0 ? argv[index + 1] : undefined;
}

function resolveDeploymentPath(options = {}) {
  const env = options.env || process.env;
  const argv = options.argv || process.argv.slice(2);
  const deploymentsDirectory = options.deploymentsDirectory || path.join(__dirname, "..", "deployments");

  const network = networkFromArguments(argv) || env.DEPLOYMENT_NETWORK || "development";
  assertSupportedDeploymentNetwork(network);

  if (env.DEPLOYMENT_FILE) return path.resolve(process.cwd(), env.DEPLOYMENT_FILE);

  return path.join(deploymentsDirectory, `latest-${network}.json`);
}

function loadDeployment(options = {}) {
  const deploymentPath = resolveDeploymentPath(options);
  if (!fs.existsSync(deploymentPath)) throw new Error(`Missing deployment file: ${deploymentPath}`);

  const deploymentBytes = fs.readFileSync(deploymentPath);
  const deploymentSha256 = crypto.createHash("sha256").update(deploymentBytes).digest("hex");
  const deployment = JSON.parse(deploymentBytes.toString("utf8"));
  assertSupportedDeploymentNetwork(deployment.network);
  const env = options.env || process.env;
  const expectedDigest = env.DEPLOYMENT_MANIFEST_SHA256;
  const publicNetwork = deployment.network === "base_sepolia";
  if (publicNetwork && !expectedDigest) {
    throw new Error("DEPLOYMENT_MANIFEST_SHA256 is required for public-network verification");
  }
  if (expectedDigest) {
    const normalizedExpected = expectedDigest.toLowerCase().replace(/^sha256:/, "");
    if (!/^[0-9a-f]{64}$/.test(normalizedExpected)) {
      throw new Error("DEPLOYMENT_MANIFEST_SHA256 must be a 64-character hexadecimal digest");
    }
    if (deploymentSha256 !== normalizedExpected) {
      throw new Error(
        `Deployment manifest digest mismatch: expected ${normalizedExpected}, got ${deploymentSha256}`
      );
    }
  }
  const requestedNetwork = networkFromArguments(options.argv || process.argv.slice(2));
  if (requestedNetwork && deployment.network !== requestedNetwork) {
    throw new Error(`Deployment file network mismatch: expected ${requestedNetwork}, got ${deployment.network}`);
  }
  return { deployment, deploymentPath, deploymentSha256 };
}

module.exports = {
  assertSupportedDeploymentNetwork,
  loadDeployment,
  networkFromArguments,
  resolveDeploymentPath
};
