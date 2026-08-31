const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { loadDeployment, networkFromArguments, resolveDeploymentPath } = require("./deployment-output");

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

test("public deployment output requires and verifies an external manifest digest", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "deployment-output-"));
  try {
    const deploymentPath = path.join(directory, "manifest.json");
    const bytes = Buffer.from(JSON.stringify({ network: "base", config: {} }));
    fs.writeFileSync(deploymentPath, bytes);
    const digest = crypto.createHash("sha256").update(bytes).digest("hex");

    assert.throws(
      () => loadDeployment({ env: { DEPLOYMENT_FILE: deploymentPath }, argv: [] }),
      /DEPLOYMENT_MANIFEST_SHA256 is required/
    );
    assert.throws(
      () => loadDeployment({
        env: { DEPLOYMENT_FILE: deploymentPath, DEPLOYMENT_MANIFEST_SHA256: "00".repeat(32) },
        argv: []
      }),
      /digest mismatch/
    );
    assert.equal(
      loadDeployment({
        env: { DEPLOYMENT_FILE: deploymentPath, DEPLOYMENT_MANIFEST_SHA256: digest },
        argv: []
      }).deploymentSha256,
      digest
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
