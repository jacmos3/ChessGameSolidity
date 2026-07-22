const fs = require("fs");
const path = require("path");

const limit = 24_576;
const warningThreshold = Math.floor(limit * 0.9);
const buildDir = path.resolve(__dirname, "..", "build", "contracts");

if (!fs.existsSync(buildDir)) {
  throw new Error("Contract artifacts are missing. Run npm run compile first.");
}

const contracts = fs
  .readdirSync(buildDir)
  .filter((file) => file.endsWith(".json"))
  .map((file) => JSON.parse(fs.readFileSync(path.join(buildDir, file), "utf8")))
  .filter(({ deployedBytecode }) => deployedBytecode && deployedBytecode !== "0x")
  .map((artifact) => ({
    name: artifact.contractName,
    bytes: (artifact.deployedBytecode.length - 2) / 2,
  }))
  .sort((left, right) => right.bytes - left.bytes);

if (contracts.length === 0) {
  throw new Error("No deployable contract bytecode found in the artifacts.");
}

let failed = false;
for (const contract of contracts) {
  const status = contract.bytes > limit ? "FAIL" : contract.bytes >= warningThreshold ? "WARN" : "OK";
  console.log(`${status.padEnd(4)} ${contract.name.padEnd(24)} ${String(contract.bytes).padStart(5)} bytes`);
  failed ||= contract.bytes > limit;
}

if (failed) {
  console.error(`One or more contracts exceed the EIP-170 limit of ${limit} bytes.`);
  process.exit(1);
}
