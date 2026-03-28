# Solidity Chess

A decentralized chess platform with fully on-chain move validation, hybrid ETH + CHESS bonding, dispute resolution, on-chain ratings, and token-governed protocol controls.

![Solidity](https://img.shields.io/badge/Solidity-0.8.24-blue)
![Frontend](https://img.shields.io/badge/Frontend-SvelteKit-orange)
![Contract Suite](https://img.shields.io/badge/Contract%20Suite-passing-brightgreen)

## Overview

This repo contains:

- `ethereum/`: Solidity contracts, Truffle migrations, deployment artifacts, and contract tests
- `frontend/`: SvelteKit client, built as a static app for IPFS-style deployment
- `docs/`: protocol, UX, and mitigation notes
- `deploy-app/`: static deployment artifacts/scripts

At a high level, the system does four things:

1. validates chess moves and endgame conditions on-chain
2. locks player collateral through a hybrid bond model
3. allows post-game cheating disputes through a commit-reveal DAO flow
4. tracks token rewards, ELO ratings, and governance on-chain

## Current Status

- The contract suite currently passes locally with `330` passing tests.
- `ChessCore` was split to keep runtime size deployable by moving heavy rules logic into `ChessRulesEngine`.
- The frontend is configured for static/IPFS deployment and now lazy-loads ABI-only artifacts.
- The system is still not formally audited.

Two limitations should be stated plainly:

- arbitrator selection is still pseudo-random on-chain, not VRF-backed
- `PlayerRating.getTopPlayers()` is a pagination helper, not a fully sorted on-chain leaderboard

## Architecture

```text
Frontend (SvelteKit static app / IPFS-compatible)
        |
        v
ChessFactory (EIP-1167 clones)
        |
        +--> ChessCore + ChessRulesEngine
        |        |
        |        +--> BondingManager
        |        +--> DisputeDAO
        |        +--> PlayerRating
        |        +--> RewardPool
        |
        +--> ChessNFT

Token / Governance Layer
  - ChessToken
  - ChessGovernor
  - ChessTimelock

Dispute Layer
  - DisputeDAO
  - ArbitratorRegistry
```

## Feature Set

### Game Layer

- full on-chain move validation through `ChessCore` + `ChessRulesEngine`
- special moves: castling, en passant, promotion
- check, checkmate, stalemate, threefold repetition, 50-move rule, 75-move automatic draw
- three timeout presets: `Finney`, `Buterin`, `Nakamoto`
- `Tournament` and `Friendly` modes
- unjoined game cancellation after timeout
- dispute-aware settlement for prizes, rewards, and ratings

### Anti-Cheating Layer

- hybrid bonding in ETH + CHESS
- commit-reveal arbitrator voting
- dynamic effective quorum based on the selected panel
- up to 3 escalation levels
- slashing and challenger compensation on `Cheat` verdicts
- arbitrator reputation tracking

### Token / Governance Layer

- `CHESS` ERC20 with vesting and governance hooks
- governor + timelock governance flow
- configurable dispute and bonding parameters

### Ratings / Rewards

- on-chain ELO updates
- player stats and provisional status
- reward pool for play-to-earn payouts
- frontend leaderboard view built from on-chain data, with client-side ordering

## Smart Contracts

| Contract | Responsibility |
|----------|----------------|
| `ChessCore` | Match lifecycle, moves, settlement, draw flows |
| `ChessRulesEngine` | Move legality, check/checkmate/stalemate evaluation |
| `ChessFactory` | Game creation through clone deployment |
| `ChessNFT` | NFT representation of created matches |
| `ChessToken` | ERC20 governance / ecosystem token |
| `BondingManager` | ETH + CHESS bond accounting and locking |
| `RewardPool` | Reward distribution |
| `ArbitratorRegistry` | Arbitrator staking, tiering, reputation, selection |
| `DisputeDAO` | Challenge window, commit-reveal voting, escalation, final decisions |
| `PlayerRating` | ELO ratings and player stats |
| `ChessGovernor` | Governance proposals and voting |
| `ChessTimelock` | Delayed governance execution |

## Supported Networks

The current frontend wiring targets these chain IDs:

- `1337` / `5777`: local Ganache
- `84532`: Base Sepolia
- `8453`: Base mainnet

Older docs and examples still mention Sepolia, Holesky, or Linea in a few places. The frontend stores now use `LOCAL`, `BASE_SEPOLIA`, and `BASE` env names.

## Getting Started

### Prerequisites

- Node.js LTS
- npm
- Ganache or another local EVM RPC for local development
- MetaMask or another injected EVM wallet for frontend testing

### Install

```bash
git clone https://github.com/jacmos3/ChessGameSolidity.git
cd ChessGameSolidity

cd ethereum
npm install

cd ../frontend
npm install
```

## Local Development

### Fast path

From the repo root:

```bash
npm run dev:local
```

This does four things in order:

1. starts or reuses a local Ganache RPC on `127.0.0.1:8545`
2. runs `truffle migrate --reset`
3. writes `frontend/.env.local` from `ethereum/deployments/latest-development.json`
4. starts the frontend dev server

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

If you want to run each step manually, Truffle can still target any local RPC through `LOCAL_RPC_PORT`.

```bash
npx ganache --server.host 127.0.0.1 --server.port 8545 --wallet.totalAccounts 20
```

If you use another port, pass it through `LOCAL_RPC_PORT`.

### 2. Deploy contracts

```bash
cd ethereum
npx truffle migrate --reset
```

The migration writes the latest addresses to:

- [latest-development.json](/Users/jacopo/Documents/development/chessgame/ethereum/deployments/latest-development.json)

### 3. Configure frontend addresses

Copy `frontend/.env.example` to `frontend/.env`, then fill the local addresses from the latest deployment file.

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
```

For Base Sepolia / Base, use the corresponding `..._BASE_SEPOLIA` and `..._BASE` variables.

### 4. Start the frontend

```bash
cd frontend
npm run dev
```

`npm run dev` automatically runs `npm run sync:abis`, so the frontend ABI-only artifacts stay aligned with the latest Solidity build output.

Open the URL shown by Vite, typically `http://127.0.0.1:3000/`.

## Running Tests

### Contract Suite

```bash
cd ethereum
npx truffle test
```

If your RPC runs on a non-default port:

```bash
LOCAL_RPC_PORT=8545 npx truffle test
```

With gas reporting:

```bash
REPORT_GAS=true npx truffle test
```

## Project Structure

```text
.
├── README.md
├── deploy-app/
├── docs/
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
│   ├── deployments/
│   ├── flattened/
│   ├── migrations/
│   ├── scripts/
│   └── test/
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

Important settlement note:

- decisive, claimable results can use `claimPrize()`
- draws and dispute-aware settlement use `finalizePrizes()` + `withdrawPrize()`

### DisputeDAO

```solidity
function challenge(uint256 gameId, address accusedPlayer) external;
function getChallengeWindowRemaining(uint256 gameId) external view returns (uint256);
function getEffectiveQuorum(uint256 disputeId) external view returns (uint256);
function getSelectedArbitrators(uint256 disputeId) external view returns (address[] memory);
```

## Frontend Stack

- SvelteKit `1.30.4`
- Svelte `4.2.8`
- Vite `4.5.2`
- Tailwind CSS `3.4.0`
- ethers.js `5.7.2`
- chess.js `1.0.0-beta.8`
- `@sveltejs/adapter-static` for IPFS-compatible static builds

## Security Notes

Implemented protections include:

- reentrancy protection on fund-moving flows
- role-based access control
- challenge windows and commit / reveal deadlines
- dispute max duration cap
- bond locking and slashing
- custom errors for lower revert overhead

Known limitations:

- no formal external audit yet
- arbitrator selection is not VRF-backed
- local frontend config still depends on manual env address wiring
- some older docs mention outdated network names and should be cleaned up separately

## Contributing

1. Create a branch from `dev`
2. Run the contract suite before pushing
3. Keep ABI artifacts and frontend wiring aligned with contract changes
4. Prefer fixing stale docs when protocol behavior changes

## License

Repository-wide licensing still needs cleanup.

- most Solidity files use `SPDX-License-Identifier: MIT`
- [ethereum/package.json](/Users/jacopo/Documents/development/chessgame/ethereum/package.json) currently declares `ISC`
- the repo does not currently ship a top-level `LICENSE` file

If this project is meant to be distributed publicly, add a single root license file and align the package manifests with it.
