const fs = require('fs');
const path = require('path');

const buildDir = path.join(__dirname, '..', 'build', 'contracts');
const outputFile = path.join(__dirname, '..', '..', 'deploy-app', 'contracts.js');

const contractNames = [
    'ChessToken',
    'PlayerRating',
    'BondingManager',
    'ChessTimelock',
    'ChessGovernor',
    'ArbitratorRegistry',
    'DisputeDAO',
    'RewardPool',
    'ChessMediaLibrary',
    'ChessCore',
    'ChessFactory'
];

console.log('Extracting contract ABIs and bytecode...\n');

let output = '// Auto-generated contract data\nconst CONTRACTS = {\n';

for (const name of contractNames) {
    const filePath = path.join(buildDir, `${name}.json`);

    if (!fs.existsSync(filePath)) {
        console.error(`  ✗ ${name}.json not found`);
        continue;
    }

    const artifact = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const abi = JSON.stringify(artifact.abi);
    const bytecode = artifact.bytecode;

    if (!bytecode || bytecode === '0x') {
        console.error(`  ✗ ${name} has no bytecode (abstract contract?)`);
        continue;
    }

    console.log(`  ✓ ${name} - ABI: ${artifact.abi.length} items, Bytecode: ${bytecode.length} chars`);

    output += `  ${name}: {\n`;
    output += `    abi: ${abi},\n`;
    output += `    bytecode: "${bytecode}"\n`;
    output += `  },\n`;
}

output += '};\n';

fs.writeFileSync(outputFile, output);
console.log(`\n✓ Saved to: ${outputFile}`);
console.log(`  File size: ${(fs.statSync(outputFile).size / 1024 / 1024).toFixed(2)} MB`);
