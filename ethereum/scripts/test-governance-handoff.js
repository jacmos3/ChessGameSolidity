const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const projectRoot = path.resolve(__dirname, "..");
const executable = (name) => path.join(
  projectRoot,
  "node_modules",
  ".bin",
  `${name}${process.platform === "win32" ? ".cmd" : ""}`
);

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function waitForPort(port, child, timeoutMs = 20_000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const probe = () => {
      if (child.exitCode !== null) {
        reject(new Error(`Ganache exited before accepting connections (code ${child.exitCode}).`));
        return;
      }

      const socket = net.createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() - startedAt >= timeoutMs) {
          reject(new Error(`Ganache did not start on port ${port}.`));
        } else {
          setTimeout(probe, 200);
        }
      });
    };
    probe();
  });
}

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      env,
      stdio: "inherit",
      shell: false
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(command)} failed with ${signal || `code ${code}`}.`));
    });
  });
}

async function stop(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
      resolve();
    }, 5_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function rpc(port, method, params = []) {
  const response = await fetch(`http://127.0.0.1:${port}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params })
  });
  const payload = await response.json();
  if (payload.error) throw new Error(payload.error.message || JSON.stringify(payload.error));
  return payload.result;
}

async function main() {
  const port = await reservePort();
  const deploymentDir = fs.mkdtempSync(path.join(os.tmpdir(), "chess-handoff-"));
  const ganache = spawn(
    executable("ganache"),
    [
      "--server.host", "127.0.0.1",
      "--server.port", String(port),
      "--wallet.deterministic",
      "--wallet.totalAccounts", "20",
      "--miner.blockGasLimit", "30000000",
      "--logging.quiet"
    ],
    { cwd: projectRoot, stdio: ["ignore", "inherit", "inherit"], shell: false }
  );

  try {
    await waitForPort(port, ganache);
    const accounts = await rpc(port, "eth_accounts");
    const env = {
      ...process.env,
      LOCAL_RPC_HOST: "127.0.0.1",
      LOCAL_RPC_PORT: String(port),
      GOVERNANCE_HANDOFF: "true",
      FAUCET_SIGNER: accounts[3],
      ORACLE_UPDATER: accounts[4],
      DEPLOYMENT_MANIFEST_SHA256: "",
      DEPLOYMENTS_DIR: deploymentDir,
      DEPLOYMENT_FILE: path.join(deploymentDir, "latest-development.json")
    };

    console.log("\n=== Governance handoff migration ===");
    await run(executable("truffle"), ["migrate", "--reset", "--compile-none"], env);
    await run(
      executable("truffle"),
      ["exec", "scripts/verify-deployment.js"],
      env
    );
    await run(
      executable("truffle"),
      ["exec", "scripts/verify-governance-handoff.js"],
      env
    );
    console.log("Governance handoff migration passed.");
  } finally {
    await stop(ganache);
    fs.rmSync(deploymentDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
