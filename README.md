# MyChess.onchain

MyChess.onchain is a decentralized chess platform with on-chain game state, hybrid ETH + CHESS bonding, commit-reveal dispute resolution, ratings, rewards, and token-governed protocol controls. The repository and some historical documents still use the original name, Solidity Chess.

![Solidity](https://img.shields.io/badge/Solidity-0.8.24-blue)
![Frontend](https://img.shields.io/badge/Frontend-SvelteKit-orange)
![Contract Tests](https://img.shields.io/badge/Contract%20Tests-357-informational)

## Overview

This repo contains:

- `ethereum/`: canonical Solidity sources, Truffle migrations, deployment scripts, and contract tests
- `frontend/`: SvelteKit client, built as a static app for IPFS-style deployment
- `docs/`: historical protocol, UX, and mitigation notes; some documents predate the current Base-focused architecture
- `deploy-app/`: legacy browser deployment helper; it is not the canonical production deployment path

At a high level, the system does four things:

1. stores games and validates piece movement and endgame conditions on-chain
2. locks player collateral through a hybrid bond model
3. allows post-game cheating disputes through a commit-reveal DAO flow
4. tracks token rewards, Elo-style ratings, and governance on-chain

## Current Status

- The contract suite defines `357` test cases across `16` Truffle test files. For long local runs, use a dedicated Ganache process and restart it between large batches if the provider degrades.
- `ChessCore` uses EIP-1167 clones. Heavy rule evaluation lives in one `ChessRulesEngine` deployed by the implementation and shared by the clones through the implementation's immutable reference.
- The frontend is configured for static/IPFS deployment and now lazy-loads ABI-only artifacts.
- The supported deployment path is `ethereum/migrations/2_deploy_chess_system.js`; public Base deployments can transfer protocol control to `ChessTimelock` and remove deployer privileges.
- The system is still not formally audited.

Important limitations:

- arbitrator selection is still pseudo-random on-chain, not VRF-backed
- ratings use a bounded linear approximation of the Elo expected-score curve; `PlayerRating.getTopPlayers()` is a pagination helper, not a sorted on-chain leaderboard
- faucet eligibility and the CHESS/ETH price feed still depend on trusted, separately rotatable off-chain signers
- game state, moves, stakes, disputes, and ratings are public blockchain data; the protocol does not provide player privacy
- timeout presets are block-count based and their wall-clock duration changes with the target chain's block time
- `ethereum/flattened/` and the browser deploy flow are legacy snapshots and must not be treated as authoritative for the current contracts

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
- three timeout presets: `Finney`, `Buterin`, `Nakamoto`
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

`truffle-config.js` still contains a legacy Goerli profile, but Goerli is not part of the supported frontend or deployment workflow. The migration has configuration branches for additional networks, but no Mainnet, Arbitrum, or Optimism Truffle profiles are currently shipped. Historical documents that mention Sepolia, Holesky, or Linea are not authoritative for current deployment.

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

cd ..
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

If you want to run each step manually, start Ganache and pass the same port to every Truffle command:

```bash
cd ethereum
npx ganache --server.host 127.0.0.1 --server.port 8545 --wallet.totalAccounts 20
```

### 2. Deploy contracts

```bash
cd ethereum
LOCAL_RPC_PORT=8545 npx truffle migrate --reset
```

The migration writes the latest addresses to `ethereum/deployments/latest-development.json`.

### Public deployment configuration

Truffle includes `base_sepolia` and `base` network profiles. Configure these variables before a public migration:

```dotenv
MNEMONIC=
BASE_SEPOLIA_RPC_URL=
BASE_RPC_URL=
TEAM_WALLET=
TREASURY_WALLET=
FAUCET_SIGNER=
ORACLE_UPDATER=
```

```bash
cd ethereum
npx truffle migrate --network base_sepolia --reset
```

`FAUCET_SIGNER` authorizes eligible faucet beneficiaries. `ORACLE_UPDATER` receives only `ORACLE_ROLE` and must submit a fresh CHESS/ETH price at least once every seven days; stale prices block bond calculation and new bonded games.

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

> **Deployment warning:** `deploy-app/` and `ethereum/flattened/` predate the latest role wiring, signer model, governance handoff, and contract interfaces. Do not use them for a production deployment without regenerating and auditing the complete flow. The Truffle migration above is the canonical path.

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
```

For Base Sepolia / Base, use the corresponding `..._BASE_SEPOLIA` and `..._BASE` variables.

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

The suite currently contains `357` test cases in `16` files. Run it against a dedicated local Ganache instance:

```bash
cd ethereum
LOCAL_RPC_PORT=8545 npm test
```

With gas reporting:

```bash
LOCAL_RPC_PORT=8545 REPORT_GAS=true npm test
```

The full suite creates a large amount of chain state. If Ganache's provider becomes unstable during a monolithic run, restart Ganache and execute the test files in smaller batches rather than treating connection errors as contract failures.

### Frontend Build

```bash
cd frontend
npm run build
```

The prebuild hook refreshes ABI-only artifacts from the latest Truffle compilation.

## Project Structure

```text
.
├── README.md
├── LICENSE.md
├── package.json
├── scripts/                         # local orchestration and env generation
├── deploy-app/                      # legacy browser deployment helper
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
│   ├── flattened/                   # legacy Remix snapshots, currently stale
│   ├── migrations/                  # canonical deployment flow
│   ├── scripts/                     # smoke and handoff verification
│   └── test/                        # 16 Truffle test files
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

When documentation conflicts, treat the Solidity sources and Truffle migration as authoritative, followed by this README. In particular, `docs/USER_GUIDE.md`, the flattened Remix guide, and the browser deploy helper still contain older branding, networks, interfaces, or role wiring.

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
- stale-price rejection and a dedicated, revocable oracle role
- signer-bound faucet authorizations without `tx.origin` or EOA-only assumptions
- production governance handoff with deployer privilege removal
- custom errors for lower revert overhead

Known limitations:

- no formal external audit yet
- arbitrator selection is not VRF-backed
- the price updater and faucet signer remain trusted operational roles
- all gameplay and dispute data is public on-chain
- public frontend addresses are build-time environment configuration, not discovered from an on-chain registry
- reward and faucet balances require explicit operational funding
- legacy docs, flattened sources, and the browser deploy helper are not synchronized automatically

## Contributing

1. Create a short-lived branch from `main`
2. Run the contract suite before pushing
3. Run the frontend production build
4. Regenerate ABI-only frontend artifacts after contract changes
5. Update this README when protocol behavior or deployment requirements change

## License

The repository ships the MIT license in [`LICENSE.md`](LICENSE.md), and Solidity sources use `SPDX-License-Identifier: MIT`. `ethereum/package.json` still declares `ISC`; align that manifest before a formal package release to remove the remaining metadata inconsistency.
