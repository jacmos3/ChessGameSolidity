const net = require("net");
const path = require("path");
const { spawn } = require("child_process");

const projectRoot = path.resolve(__dirname, "..");
const executable = (name) => path.join(projectRoot, "node_modules", ".bin", `${name}${process.platform === "win32" ? ".cmd" : ""}`);
const batches = [
  [
    "test/TestChessCore.js",
    "test/TestChessRulesEngine.js",
    "test/TestCheckValidation.js",
    "test/TestDrawRules.js",
    "test/TestEnPassantPromotion.js",
    "test/TestGameCoreSecurityRegression.js",
    "test/TestPieceMovements.js",
  ],
  [
    "test/TestChessFactory.js",
    "test/TestChessNFT.js",
    "test/TestGameMechanics.js",
    "test/TestGameRegistration.js",
  ],
  [
    "test/TestChessToken.js",
    "test/TestBondingManager.js",
    "test/TestPlayerRating.js",
    "test/TestRewardPool.js",
  ],
  [
    "test/TestArbitratorRegistry.js",
    "test/TestDisputeDAO.js",
    "test/TestIntegration.js",
    "test/TestGovernance.js",
  ],
];

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
    const child = spawn(command, args, { cwd: projectRoot, env, stdio: "inherit", shell: false });
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

async function main() {
  for (const [index, batch] of batches.entries()) {
    const port = await reservePort();
    const env = {
      ...process.env,
      LOCAL_RPC_HOST: "127.0.0.1",
      LOCAL_RPC_PORT: String(port),
      SKIP_DEPLOYMENT_OUTPUT: "true",
      GOVERNANCE_HANDOFF: "false",
      TEAM_WALLET: "",
      TREASURY_WALLET: "",
      FAUCET_SIGNER: "",
      ORACLE_UPDATER: "",
    };
    console.log(`\n=== Contract test batch ${index + 1}/${batches.length} (port ${port}) ===`);

    const ganache = spawn(
      executable("ganache"),
      [
        "--server.host", "127.0.0.1",
        "--server.port", String(port),
        "--wallet.deterministic",
        "--wallet.totalAccounts", "20",
        "--miner.blockGasLimit", "30000000",
        "--logging.quiet",
      ],
      { cwd: projectRoot, env, stdio: ["ignore", "inherit", "inherit"], shell: false }
    );

    try {
      await waitForPort(port, ganache);
      await run(executable("truffle"), ["test", ...batch, "--compile-none"], env);
    } finally {
      await stop(ganache);
    }
  }

  console.log(`\nAll ${batches.length} contract test batches passed.`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
