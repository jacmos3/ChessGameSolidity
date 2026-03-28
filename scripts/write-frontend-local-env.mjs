import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const deploymentFile =
  process.env.DEPLOYMENT_FILE ||
  path.join(rootDir, "ethereum", "deployments", "latest-development.json");
const outputFile =
  process.env.FRONTEND_ENV_FILE ||
  path.join(rootDir, "frontend", ".env.local");

if (!fs.existsSync(deploymentFile)) {
  console.error(`Missing deployment file: ${deploymentFile}`);
  console.error("Run the local migration first so the frontend can receive contract addresses.");
  process.exit(1);
}

const deployment = JSON.parse(fs.readFileSync(deploymentFile, "utf8"));
const contracts = deployment.contracts || {};

const envLines = [
  "# Auto-generated from ethereum/deployments/latest-development.json",
  `# Generated at ${new Date().toISOString()}`,
  "",
  `VITE_CONTRACT_ADDRESS_LOCAL=${contracts.ChessFactory || ""}`,
  `VITE_BONDING_MANAGER_LOCAL=${contracts.BondingManager || ""}`,
  `VITE_CHESS_TOKEN_LOCAL=${contracts.ChessToken || ""}`,
  `VITE_DISPUTE_DAO_LOCAL=${contracts.DisputeDAO || ""}`,
  `VITE_ARBITRATOR_REGISTRY_LOCAL=${contracts.ArbitratorRegistry || ""}`,
  `VITE_CHESS_GOVERNOR_LOCAL=${contracts.ChessGovernor || ""}`,
  `VITE_CHESS_TIMELOCK_LOCAL=${contracts.ChessTimelock || ""}`,
  `VITE_PLAYER_RATING_LOCAL=${contracts.PlayerRating || ""}`,
  ""
];

fs.writeFileSync(outputFile, `${envLines.join("\n")}`, "utf8");
console.log(`Wrote frontend local env to ${path.relative(rootDir, outputFile)}`);
