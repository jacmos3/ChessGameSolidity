import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const ethereumDir = path.join(rootDir, "ethereum");
const frontendDir = path.join(rootDir, "frontend");

const host = process.env.DEV_LOCAL_HOST || "127.0.0.1";
const rpcPort = Number(process.env.DEV_LOCAL_RPC_PORT || process.env.LOCAL_RPC_PORT || "8545");
const webPort = Number(process.env.DEV_LOCAL_WEB_PORT || "3000");
const walletCount = Number(process.env.DEV_LOCAL_WALLET_COUNT || "20");
const chainId = Number(process.env.DEV_LOCAL_CHAIN_ID || "1337");
const blockGasLimit = process.env.DEV_LOCAL_BLOCK_GAS_LIMIT || "30000000";

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";
const nodeCmd = process.execPath;

let ganacheProcess = null;
let frontendProcess = null;

function prefixStream(stream, label) {
  let buffer = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      console.log(`[${label}] ${line}`);
    }
  });
  stream.on("end", () => {
    if (buffer) {
      console.log(`[${label}] ${buffer}`);
    }
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function canConnect(port, timeoutMs = 500) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });
}

function isPortOccupied(port) {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once("error", (error) => {
      if (error.code === "EADDRINUSE") {
        resolve(true);
        return;
      }
      resolve(false);
    });

    server.once("listening", () => {
      server.close(() => resolve(false));
    });

    server.listen(port, host);
  });
}

async function waitForPort(port, timeoutMs = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await canConnect(port)) {
      return true;
    }
    await sleep(250);
  }
  return false;
}

function spawnLogged(cmd, args, options = {}) {
  const child = spawn(cmd, args, {
    cwd: options.cwd || rootDir,
    env: options.env || process.env,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false
  });

  prefixStream(child.stdout, options.label || path.basename(cmd));
  prefixStream(child.stderr, options.label || path.basename(cmd));
  return child;
}

function runCommand(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnLogged(cmd, args, options);

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `${options.label || cmd} exited with code ${code ?? "null"}${signal ? ` (signal ${signal})` : ""}`
        )
      );
    });
  });
}

async function startGanacheIfNeeded() {
  if (await canConnect(rpcPort)) {
    console.log(`Reusing existing RPC on http://${host}:${rpcPort}`);
    return false;
  }

  if (await isPortOccupied(rpcPort)) {
    throw new Error(
      `RPC port ${rpcPort} is already occupied by another process that is not responding. Stop it or set DEV_LOCAL_RPC_PORT to a free port.`
    );
  }

  console.log(`Starting Ganache on http://${host}:${rpcPort}`);
  ganacheProcess = spawnLogged(
    npxCmd,
    [
      "ganache",
      "--server.host",
      host,
      "--server.port",
      String(rpcPort),
      "--wallet.totalAccounts",
      String(walletCount),
      "--wallet.deterministic",
      "--chain.chainId",
      String(chainId),
      "--miner.blockGasLimit",
      blockGasLimit
    ],
    { cwd: ethereumDir, label: "ganache" }
  );

  const ready = await waitForPort(rpcPort, 20000);
  if (!ready) {
    throw new Error(`Ganache did not start on port ${rpcPort}`);
  }

  return true;
}

async function migrateContracts() {
  console.log("Running local migration");
  await runCommand(
    npxCmd,
    ["truffle", "migrate", "--reset"],
    {
      cwd: ethereumDir,
      label: "migrate",
      env: {
        ...process.env,
        LOCAL_RPC_HOST: host,
        LOCAL_RPC_PORT: String(rpcPort)
      }
    }
  );
}

async function writeFrontendEnv() {
  console.log("Writing frontend local env");
  await runCommand(nodeCmd, [path.join(rootDir, "scripts", "write-frontend-local-env.mjs")], {
    cwd: rootDir,
    label: "env"
  });
}

async function startFrontend() {
  if (await canConnect(webPort) || await isPortOccupied(webPort)) {
    throw new Error(
      `Frontend port ${webPort} is already in use. Stop the existing server or set DEV_LOCAL_WEB_PORT to another port.`
    );
  }

  console.log(`Starting frontend on http://${host}:${webPort}`);
  frontendProcess = spawnLogged(
    npmCmd,
    ["run", "dev", "--", "--host", host, "--port", String(webPort), "--strictPort"],
    { cwd: frontendDir, label: "frontend" }
  );

  const ready = await waitForPort(webPort, 20000);
  if (!ready) {
    throw new Error(`Frontend did not start on port ${webPort}`);
  }
}

function shutdown(code = 0) {
  if (frontendProcess && !frontendProcess.killed) {
    frontendProcess.kill("SIGINT");
  }
  if (ganacheProcess && !ganacheProcess.killed) {
    ganacheProcess.kill("SIGINT");
  }
  setTimeout(() => process.exit(code), 200);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

try {
  const startedGanache = await startGanacheIfNeeded();
  await migrateContracts();
  await writeFrontendEnv();
  await startFrontend();

  console.log("");
  console.log("Local environment ready");
  console.log(`- RPC: http://${host}:${rpcPort}${startedGanache ? "" : " (reused)"}`);
  console.log(`- Frontend: http://${host}:${webPort}`);
  console.log(`- Frontend env: frontend/.env.local`);
  console.log("");
  console.log("Press Ctrl+C to stop the frontend" + (startedGanache ? " and Ganache." : "."));

  frontendProcess.on("exit", (code) => {
    shutdown(code ?? 0);
  });
} catch (error) {
  console.error(error.message);
  shutdown(1);
}
