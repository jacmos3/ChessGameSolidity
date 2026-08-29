const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { networkFromArguments, resolveDeploymentPath } = require("./deployment-output");

test("networkFromArguments handles Truffle network syntax", () => {
  assert.equal(networkFromArguments(["--network", "base_sepolia"]), "base_sepolia");
  assert.equal(networkFromArguments(["--network=base"]), "base");
});

test("deployment output follows the selected network", () => {
  const directory = path.join(path.sep, "tmp", "deployments");
  assert.equal(
    resolveDeploymentPath({ argv: ["--network", "base_sepolia"], env: {}, deploymentsDirectory: directory }),
    path.join(directory, "latest-base_sepolia.json")
  );
});

test("DEPLOYMENT_FILE overrides network-derived output", () => {
  const resolved = resolveDeploymentPath({
    argv: ["--network", "base"],
    env: { DEPLOYMENT_FILE: "custom/deployment.json" }
  });
  assert.equal(resolved, path.resolve(process.cwd(), "custom/deployment.json"));
});
