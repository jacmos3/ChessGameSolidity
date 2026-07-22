const fs = require("fs");
const path = require("path");
const solc = require("solc");

const projectRoot = path.resolve(__dirname, "..");
const contractsDir = path.join(projectRoot, "contracts");
const buildDir = path.join(projectRoot, "build", "contracts");

function collectSources(directory, sources = {}) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collectSources(absolutePath, sources);
    } else if (entry.name.endsWith(".sol")) {
      const sourceName = path.relative(projectRoot, absolutePath).split(path.sep).join("/");
      sources[sourceName] = { content: fs.readFileSync(absolutePath, "utf8") };
    }
  }
  return sources;
}

function resolveImport(importPath) {
  const candidates = [
    path.join(projectRoot, importPath),
    path.join(projectRoot, "node_modules", importPath),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return { contents: fs.readFileSync(candidate, "utf8") };
    }
  }

  return { error: `Import not found: ${importPath}` };
}

function truffleLinkPlaceholders(bytecode, linkReferences) {
  const replacements = [];
  for (const libraries of Object.values(linkReferences || {})) {
    for (const [libraryName, references] of Object.entries(libraries)) {
      const placeholder = `__${libraryName}`.padEnd(40, "_").slice(0, 40);
      for (const reference of references) {
        replacements.push({ start: reference.start * 2, length: reference.length * 2, placeholder });
      }
    }
  }

  let linkedBytecode = bytecode;
  for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
    linkedBytecode =
      linkedBytecode.slice(0, replacement.start) +
      replacement.placeholder +
      linkedBytecode.slice(replacement.start + replacement.length);
  }
  return linkedBytecode;
}

const input = {
  language: "Solidity",
  sources: collectSources(contractsDir),
  settings: {
    evmVersion: "cancun",
    viaIR: true,
    optimizer: { enabled: true, runs: 1 },
    debug: { revertStrings: "strip" },
    outputSelection: {
      "*": {
        "*": [
          "abi",
          "metadata",
          "devdoc",
          "userdoc",
          "evm.bytecode",
          "evm.deployedBytecode",
        ],
        "": ["ast"],
      },
    },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input), { import: resolveImport }));
const diagnostics = output.errors || [];
for (const diagnostic of diagnostics) {
  const writer = diagnostic.severity === "error" ? console.error : console.warn;
  writer(diagnostic.formattedMessage.trim());
}

if (diagnostics.some(({ severity }) => severity === "error")) {
  process.exit(1);
}

fs.rmSync(buildDir, { recursive: true, force: true });
fs.mkdirSync(buildDir, { recursive: true });

const astBySource = Object.fromEntries(
  Object.entries(output.sources || {}).map(([sourceName, source]) => [sourceName, source.ast])
);
let artifactCount = 0;

for (const [sourceName, contracts] of Object.entries(output.contracts || {})) {
  if (!input.sources[sourceName]) continue;

  for (const [contractName, contract] of Object.entries(contracts)) {
    const bytecode = truffleLinkPlaceholders(
      contract.evm.bytecode.object,
      contract.evm.bytecode.linkReferences
    );
    const deployedBytecode = truffleLinkPlaceholders(
      contract.evm.deployedBytecode.object,
      contract.evm.deployedBytecode.linkReferences
    );
    const artifact = {
      contractName,
      abi: contract.abi,
      metadata: contract.metadata,
      bytecode: bytecode ? `0x${bytecode}` : "0x",
      deployedBytecode: deployedBytecode ? `0x${deployedBytecode}` : "0x",
      immutableReferences: contract.evm.deployedBytecode.immutableReferences || {},
      linkReferences: contract.evm.bytecode.linkReferences || {},
      deployedLinkReferences: contract.evm.deployedBytecode.linkReferences || {},
      generatedSources: contract.evm.bytecode.generatedSources || [],
      deployedGeneratedSources: contract.evm.deployedBytecode.generatedSources || [],
      sourceMap: contract.evm.bytecode.sourceMap || "",
      deployedSourceMap: contract.evm.deployedBytecode.sourceMap || "",
      source: input.sources[sourceName].content,
      sourcePath: path.join(projectRoot, sourceName),
      ast: astBySource[sourceName],
      legacyAST: astBySource[sourceName],
      compiler: { name: "solc", version: solc.version() },
      networks: {},
      schemaVersion: "3.4.16",
      updatedAt: new Date().toISOString(),
      devdoc: contract.devdoc,
      userdoc: contract.userdoc,
    };

    fs.writeFileSync(
      path.join(buildDir, `${contractName}.json`),
      `${JSON.stringify(artifact, null, 2)}\n`
    );
    artifactCount += 1;
  }
}

if (artifactCount === 0) {
  throw new Error("Compilation produced no project artifacts");
}

console.log(`Compiled ${artifactCount} contracts with ${solc.version()}.`);
