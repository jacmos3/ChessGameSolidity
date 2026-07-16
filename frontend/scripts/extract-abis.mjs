import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const buildDir = path.resolve(__dirname, '../../ethereum/build/contracts');
const outputDir = path.resolve(__dirname, '../src/lib/contracts/abi');

const contractNames = [
	'ArbitratorRegistry',
	'BondingManager',
	'ChessCore',
	'ChessFactory',
	'ChessGovernor',
	'ChessTimelock',
	'ChessToken',
	'DisputeDAO',
	'PlayerRating',
	'RewardPool'
];

await mkdir(outputDir, { recursive: true });

for (const contractName of contractNames) {
	const sourcePath = path.join(buildDir, `${contractName}.json`);
	const outputPath = path.join(outputDir, `${contractName}.json`);
	const artifact = JSON.parse(await readFile(sourcePath, 'utf8'));
	await writeFile(outputPath, JSON.stringify(artifact.abi), 'utf8');
}
