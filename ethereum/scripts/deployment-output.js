const fs = require("fs");
const path = require("path");

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

  if (env.DEPLOYMENT_FILE) return path.resolve(process.cwd(), env.DEPLOYMENT_FILE);

  const network = networkFromArguments(argv) || env.DEPLOYMENT_NETWORK || "development";
  return path.join(deploymentsDirectory, `latest-${network}.json`);
}

function loadDeployment(options = {}) {
  const deploymentPath = resolveDeploymentPath(options);
  if (!fs.existsSync(deploymentPath)) throw new Error(`Missing deployment file: ${deploymentPath}`);

  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  const requestedNetwork = networkFromArguments(options.argv || process.argv.slice(2));
  if (requestedNetwork && deployment.network !== requestedNetwork) {
    throw new Error(`Deployment file network mismatch: expected ${requestedNetwork}, got ${deployment.network}`);
  }
  return { deployment, deploymentPath };
}

module.exports = {
  loadDeployment,
  networkFromArguments,
  resolveDeploymentPath
};
