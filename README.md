# MyChess.onchain

MyChess.onchain is a decentralized chess platform with on-chain game state, hybrid ETH + CHESS bonding, commit-reveal dispute resolution, ratings, rewards, and token-governed protocol controls. The repository and some historical documents still use the original name, Solidity Chess.

![Solidity](https://img.shields.io/badge/Solidity-0.8.24-blue)
![Frontend](https://img.shields.io/badge/Frontend-SvelteKit%202-orange)
![Contract Tests](https://img.shields.io/badge/Contract%20Tests-372-informational)

## Overview

This repo contains:

- `ethereum/`: canonical Solidity sources, Truffle migrations, deployment scripts, and contract tests
- `frontend/`: SvelteKit client, built as a static app for IPFS-style deployment
- `docs/`: historical protocol, UX, and mitigation notes; some documents predate the current Base-focused architecture
- `legacy/`: unsupported historical deployment helpers, flattened contracts, and standalone scripts

At a high level, the system does four things:

1. stores games and validates piece movement and endgame conditions on-chain
2. locks player collateral through a hybrid bond model
3. allows post-game cheating disputes through a commit-reveal DAO flow
4. tracks token rewards, Elo-style ratings, and governance on-chain

## Current Status

- The contract suite defines `372` test cases across `18` Truffle test files. `npm run test:ci` executes them in four isolated Ganache batches and then verifies a fresh governance-handoff migration.
- `ChessCore` uses EIP-1167 clones. Heavy rule evaluation lives in one `ChessRulesEngine` deployed by the implementation and shared by the clones through the implementation's immutable reference.
- The frontend is configured for static/IPFS deployment and now lazy-loads ABI-only artifacts.
- Solidity compilation is pinned to `solc 0.8.24`, generates validated Truffle-compatible artifacts, and enforces the EIP-170 bytecode limit.
- GitHub Actions recompiles, checks bytecode size, runs all contract and frontend utility tests, audits high-severity frontend dependencies, builds the static app, and checks generated ABI drift.
- The supported deployment path is `ethereum/migrations/2_deploy_chess_system.js`; public Base deployments can transfer protocol control to `ChessTimelock` and remove deployer privileges.
- The system is still not formally audited.

The repository is suitable for source publication, local use, and a clearly labelled Base Sepolia beta. It is not approved for a permissionless production launch with material user funds.

Important limitations:

- arbitrator selection is still pseudo-random on-chain, not VRF-backed
- ratings use a bounded linear approximation of the Elo expected-score curve; `PlayerRating.getTopPlayers()` is a pagination helper, not a sorted on-chain leaderboard
- faucet eligibility and the CHESS/ETH price feed still depend on trusted, separately rotatable off-chain signers
- Truffle 5 and `@truffle/hdwallet-provider` retain known npm advisories in their deprecated dependency trees; replace or isolate this deployment toolchain before handling a production mnemonic
- game state, moves, stakes, disputes, and ratings are public blockchain data; the protocol does not provide player privacy
- timeout presets use timestamp deadlines: `Finney` is 1 hour, `Buterin` is 7 hours, and `Nakamoto` is 7 days
- `legacy/` is retained for historical reference only and must not be used to build or deploy the protocol

## Architecture

```text
Frontend (SvelteKit SPA, ABI-only contract access)
        |
        v
ChessFactory ----------------------------------> ChessNFT
        |                                         (one token per game)
        |
        +-- EIP-1167 clone --> ChessCore
                                |
                                +--> shared ChessRulesEngine
                                +--> BondingManager
                                +--> DisputeDAO --> ArbitratorRegistry
                                +--> PlayerRating
                                +--> RewardPool

ChessToken --> ChessGovernor --> ChessTimelock --> protocol administration
```

`ChessFactory` registers every new clone with the bonding, dispute, rating, and reward components. With the canonical dispute wiring enabled, a game finalizes only after its challenge window has expired or its dispute has been resolved; prize allocation uses a pull-payment flow.

## Feature Set

### Game Layer

- on-chain piece movement, king-safety, check, mate, and stalemate evaluation through `ChessCore` + `ChessRulesEngine`
- special moves: castling, en passant, promotion
- check, checkmate, stalemate, threefold repetition, 50-move rule, 75-move automatic draw
- three chain-independent timeout presets: `Finney` (1 hour), `Buterin` (7 hours), `Nakamoto` (7 days)
- `Friendly` mode rejects moves that leave the mover's king in check and allows custom pre-game positions
- `Tournament` mode treats a self-checking move as an immediate loss instead of reverting the transaction
- unjoined game cancellation after timeout
- dispute-aware settlement for prizes, rewards, and ratings

### Anti-Cheating Layer

- hybrid bonding in ETH + CHESS
- commit-reveal arbitrator voting
- dynamic effective quorum based on the selected panel
- up to 3 escalation levels
- slashing and challenger compensation on `Cheat` verdicts
- arbitrator reputation tracking
- per-dispute deposit escrow and assignment-based stake locks for selected arbitrators

### Token / Governance Layer

- capped `CHESS` ERC20Votes token with permit, delegation, controlled minting, and two-year team vesting
- governor + timelock governance flow
- automatic deployer-role removal on the canonical `base` production deployment
- configurable dispute and bonding parameters

### Ratings / Rewards

- on-chain Elo-style rating updates using fixed-point arithmetic and a linear expected-score approximation
- player stats and provisional status
- separately funded reward and faucet pools; deployment alone does not fund either pool
- frontend leaderboard view built from on-chain data, with client-side ordering

## Smart Contracts

| Contract | Responsibility |
|----------|----------------|
| `ChessBoard` | Board storage, initial position, draw-state bookkeeping, SVG support |
| `ChessCore` | Match lifecycle, moves, settlement, draw flows |
| `ChessRulesEngine` | Shared move legality and check/checkmate/stalemate evaluation |
| `ChessMediaLibrary` | On-chain SVG board rendering used by games and NFT metadata |
| `ChessFactory` | Game creation through clone deployment |
| `ChessNFT` | ERC721 minted to the creator for every game; `tokenURI()` delegates to the live game-board SVG |
| `ChessToken` | ERC20 governance / ecosystem token |
| `BondingManager` | ETH + CHESS bond accounting and locking |
| `RewardPool` | Distribution from pre-funded reward/faucet balances and signer-authorized faucet claims |
| `ArbitratorRegistry` | Arbitrator staking, tiering, reputation, selection |
| `DisputeDAO` | Challenge window, commit-reveal voting, escalation, final decisions |
| `PlayerRating` | Elo-style ratings and player stats |
| `ChessGovernor` | Governance proposals and voting |
| `ChessTimelock` | Delayed governance execution |

## Supported Networks

Canonical Truffle profiles:

- `development`: local RPC, default `127.0.0.1:7545`, configurable through `LOCAL_RPC_HOST` and `LOCAL_RPC_PORT`
- `base_sepolia`: Base Sepolia (`84532`)
- `base`: Base mainnet (`8453`)

The frontend recognizes:

- `1337` / `5777`: local Ganache
- `84532`: Base Sepolia
- `8453`: Base mainnet

No Goerli, Ethereum Mainnet, Arbitrum, or Optimism Truffle profile is shipped. Historical documents that mention Goerli, Sepolia, Holesky, Linea, or other networks are not authoritative for the current Base-focused deployment.

## Getting Started

### Prerequisites

- Node.js 20.19+ or 22.12+ (below Node 23)
- npm
- Ganache or another local EVM RPC for local development
- MetaMask or another injected EVM wallet for frontend testing

### Install

```bash
git clone https://github.com/jacmos3/ChessGameSolidity.git
cd ChessGameSolidity

cd ethereum
npm ci

cd ../frontend
npm ci

cd ..
```

## Local Development

### Fast path

From the repo root:

```bash
npm run dev:local
```

This does five things in order:

1. starts or reuses a local Ganache RPC on `127.0.0.1:8545`
2. compiles deterministic Truffle-compatible artifacts with the pinned compiler
3. runs `truffle migrate --reset`
4. writes `frontend/.env.local` from `ethereum/deployments/latest-development.json`
5. starts the frontend dev server

You can override the ports with:

- `DEV_LOCAL_RPC_PORT`
- `DEV_LOCAL_WEB_PORT`

Once the local stack is up, you can run a contract-level smoke test against the same RPC:

```bash
LOCAL_RPC_PORT=8545 npm run smoke:local
```

The smoke flow covers a real end-to-end path on a fresh deployment:

1. mint and stake arbitrators
2. deposit player bonds
3. create and join a game
4. play opening moves and resign
5. open a dispute and run commit/reveal voting
6. resolve the dispute and verify prize settlement

### 1. Start a local RPC

If you want to run each step manually, start Ganache and pass the same port to every Truffle command:

```bash
cd ethereum
npx ganache --server.host 127.0.0.1 --server.port 8545 --wallet.totalAccounts 20
```

### 2. Deploy contracts

```bash
cd ethereum
npm run compile
LOCAL_RPC_PORT=8545 npx truffle migrate --reset
```

The migration writes the latest addresses to `ethereum/deployments/latest-development.json`.

### Public deployment configuration

Truffle includes `base_sepolia` and `base` network profiles. Configure these variables before a public migration:

```dotenv
MNEMONIC=
BASE_SEPOLIA_RPC_URL=
BASE_RPC_URL=
BASE_MAX_PRIORITY_FEE_PER_GAS_WEI=1000000
TEAM_WALLET=
TREASURY_WALLET=
FAUCET_SIGNER=
ORACLE_UPDATER=
GOVERNANCE_HANDOFF=true
```

```bash
cd ethereum
cp .env.example .env
# Populate .env locally, then validate it without sending transactions.
npm run preflight:base-sepolia
npx truffle migrate --network base_sepolia --reset
npm run verify:deployment -- --network base_sepolia
```

`BASE_MAX_PRIORITY_FEE_PER_GAS_WEI` defaults to `1000000` (`0.001 gwei`) so Truffle does not apply its Ethereum-oriented `2.5 gwei` fallback; Truffle derives the EIP-1559 max fee from the live Base fee. `FAUCET_SIGNER` authorizes eligible faucet beneficiaries and may be either an EOA or an ERC-1271 contract wallet. `ORACLE_UPDATER` receives only `ORACLE_ROLE` and must submit a fresh CHESS/ETH price at least once every seven days; stale prices block bond calculation and new bonded games.

The preflight compiles the canonical sources, enforces EIP-170, derives only the public deployer address, verifies the RPC chain, checks the deployer's native balance, and validates operational addresses. It never prints the mnemonic or sends a transaction. The post-deployment verifier reads `deployments/latest-<network>.json` and fails on missing bytecode, incorrect links, missing roles, or unexpected ownership.

The `base` profile automatically transfers ownership and admin roles to `ChessTimelock`, then removes deployer privileges. Base Sepolia keeps the deployer as admin unless `GOVERNANCE_HANDOFF=true` is set. When handoff is enabled, `FAUCET_SIGNER` and `ORACLE_UPDATER` must both differ from the deployer.

Verify a handoff against the selected network:

```bash
cd ethereum
npm run verify:handoff -- --network base
```

Post-deployment operations are required:

- approve and deposit CHESS into `RewardPool.depositRewardPool()` before play-to-earn payouts can occur
- approve and deposit CHESS into `RewardPool.depositFaucetPool()` before faucet claims can occur
- keep the oracle price fresh through the dedicated updater
- optionally pre-fund `DisputeDAO` if governance wants challenger bonuses beyond return of the reserved challenge deposit

Deployment address files under `ethereum/deployments/` are local operational output and are intentionally not committed.

> **Deployment warning:** everything under `legacy/` predates the latest role wiring, signer model, governance handoff, timeout semantics, and contract interfaces. It is unsupported. The pinned compiler and Truffle migration above are the only canonical path.

### 3. Configure frontend addresses

`npm run dev:local` creates `frontend/.env.local` automatically. For a manual setup, copy `frontend/.env.example` to `frontend/.env.local` and fill the local addresses from the latest deployment file.

These are the variables the frontend actually reads today:

```dotenv
VITE_CONTRACT_ADDRESS_LOCAL=
VITE_BONDING_MANAGER_LOCAL=
VITE_CHESS_TOKEN_LOCAL=
VITE_DISPUTE_DAO_LOCAL=
VITE_ARBITRATOR_REGISTRY_LOCAL=
VITE_CHESS_GOVERNOR_LOCAL=
VITE_CHESS_TIMELOCK_LOCAL=
VITE_PLAYER_RATING_LOCAL=
VITE_BASE_MAX_PRIORITY_FEE_PER_GAS_WEI=1000000
```

For Base Sepolia / Base, use the corresponding `..._BASE_SEPOLIA` and `..._BASE` variables.
The frontend derives EIP-1559 max fees from the latest Base block and defaults the priority fee to `1000000` wei (`0.001 gwei`), avoiding provider fallbacks intended for Ethereum mainnet. Override `VITE_BASE_MAX_PRIORITY_FEE_PER_GAS_WEI` only when Base fee policy requires it; local Ganache transactions continue to use provider-managed fees.

The current frontend does not directly load `RewardPool`; rewards are triggered by finalized games and faucet administration remains an external operational flow. Consequently there is no `VITE_REWARD_POOL_*` variable today.

### 4. Start the frontend

```bash
cd frontend
npm run dev
```

`npm run dev` automatically runs `npm run sync:abis`, so the frontend ABI-only artifacts stay aligned with the latest Solidity build output.

`sync:abis` reads from `ethereum/build/contracts`. On a clean checkout, compile or migrate the contracts before starting the frontend:

```bash
cd ethereum
npm run compile
```

Open the URL shown by Vite, typically `http://127.0.0.1:3000/`.

## Running Tests

### Contract Suite

The suite currently contains `374` contract test cases in `18` files plus deployment-script unit tests. The canonical command compiles, checks every deployed bytecode against EIP-170, runs the deployment-script tests, runs four contract-test batches against fresh Ganache instances, and exercises the real deployment migration plus both post-deployment verifiers with governance handoff enabled:

```bash
cd ethereum
npm run test:ci
```

For an ad hoc monolithic run against an already running Ganache instance:

```bash
LOCAL_RPC_PORT=8545 npm test -- --compile-none
```

With gas reporting, set `REPORT_GAS=true` on that monolithic command. The isolated `test:ci` runner is preferred because the full suite creates enough chain state to destabilize a single long-lived provider.

### Frontend Build

Run the frontend utility tests with Node's built-in test runner:

```bash
cd frontend
npm test
```

Then build the static application:

```bash
cd frontend
npm run build
```

The prebuild hook refreshes ABI-only artifacts from the latest pinned Solidity compilation.

## Project Structure

```text
.
├── README.md
├── LICENSE.md
├── package.json
├── .github/workflows/ci.yml         # reproducible contract and frontend checks
├── scripts/                         # local orchestration and env generation
├── legacy/                          # unsupported historical snapshots
├── docs/                            # historical/reference documents
│   ├── ANTI_CHEATING_TOKENOMICS.md
│   ├── USER_GUIDE.md
│   ├── UX_UI_AUDIT_REPORT.md
│   └── VULNERABILITIES_MITIGATIONS.md
├── ethereum/
│   ├── contracts/
│   │   ├── Chess/
│   │   │   ├── ChessBoard.sol
│   │   │   ├── ChessCore.sol
│   │   │   ├── ChessFactory.sol
│   │   │   ├── ChessMediaLibrary.sol
│   │   │   ├── ChessNFT.sol
│   │   │   └── ChessRulesEngine.sol
│   │   ├── DAO/
│   │   ├── Governance/
│   │   ├── Rating/
│   │   └── Token/
│   ├── deployments/                 # ignored local deployment outputs
│   ├── migrations/                  # canonical deployment flow
│   ├── scripts/                     # compiler, size check, test runner, smoke and handoff verification
│   └── test/                        # 18 Truffle test files
└── frontend/
    ├── scripts/
    │   └── extract-abis.mjs
    ├── src/
    │   ├── lib/
    │   │   ├── components/
    │   │   ├── contracts/
    │   │   │   ├── abi/
    │   │   │   └── loadAbi.js
    │   │   └── stores/
    │   └── routes/
    └── static/
```

When documentation conflicts, treat the Solidity sources and Truffle migration as authoritative, followed by this README. In particular, `docs/USER_GUIDE.md` and everything under `legacy/` may contain older branding, networks, interfaces, or role wiring.

## Core Contract Flows

### ChessFactory

```solidity
function createChessGame(
    uint8 _timeoutPreset,
    uint8 _gameMode
) external payable returns (address);

function getDeployedChessGames() external view returns (address[] memory);
```

### ChessCore

```solidity
function joinGameAsBlack() external payable;
function makeMove(uint8 startX, uint8 startY, uint8 endX, uint8 endY) external;
function makeMoveWithPromotion(
    uint8 startX,
    uint8 startY,
    uint8 endX,
    uint8 endY,
    int8 promotionPiece
) external;

function resign() external;
function canClaimPrize() external view returns (bool);
function claimPrize() external;
function finalizePrizes() external;
function withdrawPrize() external;
function cancelUnjoinedGame() external;

function offerDraw() external;
function acceptDraw() external;
function claimDrawByRepetition() external;
function claimDrawByFiftyMoveRule() external;
```

Settlement guidance:

- `finalizePrizes()` followed by `withdrawPrize()` is the canonical pull-payment path and is required for draws
- `claimPrize()` is a backward-compatible combined path for a single rightful recipient
- neither path can settle while a challenge window or dispute is still active

### DisputeDAO

```solidity
function challenge(uint256 gameId, address accusedPlayer) external;
function commitVote(uint256 disputeId, bytes32 commitHash) external;
function revealVote(uint256 disputeId, Vote vote, bytes32 salt) external;
function resolveDispute(uint256 disputeId) external;
function getChallengeWindowRemaining(uint256 gameId) external view returns (uint256);
function getEffectiveQuorum(uint256 disputeId) external view returns (uint256);
function getSelectedArbitrators(uint256 disputeId) external view returns (address[] memory);
```

The default challenge window is 48 hours, followed by 24-hour commit and reveal periods. A vote commitment is `keccak256(abi.encodePacked(vote, salt, arbitratorAddress))`. Insufficient quorum or supermajority triggers automatic escalation when `resolveDispute()` is called, up to the configured limit.

### RewardPool faucet

Faucet claims require an off-chain authorization bound to the pool address, chain ID, and beneficiary:

```javascript
const digest = ethers.utils.solidityKeccak256(
  ["address", "uint256", "address"],
  [rewardPool.address, chainId, beneficiary]
);
const authorization = await faucetSigner.signMessage(ethers.utils.arrayify(digest));
await rewardPool.connect(beneficiary).claimFaucet(authorization);
```

An authorization cannot be replayed for another beneficiary, chain, or `RewardPool`. Eligibility remains a trusted off-chain policy enforced by `FAUCET_SIGNER`.

## Frontend Stack

- SvelteKit `2.70.1`
- Svelte `5.56.7` in legacy component mode
- Vite `8.1.5`
- Tailwind CSS `3.4.x`
- ethers.js `5.8.0`
- chess.js `1.0.0-beta.8`
- `@sveltejs/adapter-static` for IPFS-compatible static builds

## Security Notes

Implemented protections include:

- reentrancy protection on fund-moving flows
- role-based access control
- challenge windows and commit / reveal deadlines
- dispute max duration cap
- bond locking and slashing
- stale-price rejection and a dedicated, revocable oracle role
- signer-bound faucet authorizations for EOAs and ERC-1271 contract wallets without `tx.origin`
- production governance handoff with deployer privilege removal
- custom errors for lower revert overhead

Known limitations:

- no formal external audit yet
- the Truffle deployment stack contains deprecated transitive dependencies with unresolved npm advisories; do not treat a clean contract test run as a supply-chain audit
- arbitrator selection is not VRF-backed
- the price updater and faucet signer remain trusted operational roles
- all gameplay and dispute data is public on-chain
- public frontend addresses are build-time environment configuration, not discovered from an on-chain registry
- reward and faucet balances require explicit operational funding
- historical material under `legacy/` is intentionally unsupported and not synchronized

## Contributing

1. Create a short-lived branch from `main`
2. Run the contract suite before pushing
3. Run the frontend production build
4. Regenerate ABI-only frontend artifacts after contract changes
5. Update this README when protocol behavior or deployment requirements change

## License

The repository ships the MIT license in [`LICENSE.md`](LICENSE.md), Solidity sources use `SPDX-License-Identifier: MIT`, and the contract package declares the same license.
