# MyChess.onchain

MyChess.onchain is a decentralized chess platform with on-chain game state, hybrid ETH + CHESS bonding, commit-reveal dispute resolution, ratings, rewards, and token-governed protocol controls. The repository and some historical documents still use the original name, Solidity Chess.

![Solidity](https://img.shields.io/badge/Solidity-0.8.24-blue)
![Frontend](https://img.shields.io/badge/Frontend-SvelteKit%202-orange)
![Contract baseline](https://img.shields.io/badge/Contract%20baseline-459%20passed-informational)

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

- The final remediation verification passed `459/459` Truffle cases across four isolated Ganache batches, including arbitration concurrency, whole-game adjudication, reward/rating authorization, and capped-population gas regressions.
- Deployment-script checks passed `50/50`; the frontend runner passed `93/93` tests; the production build, governance-handoff migration/verifiers, EIP-170 gate, and deterministic ABI drift check also passed.
- `ChessCore` uses EIP-1167 clones. Heavy rule evaluation lives in one `ChessRulesEngine` deployed by the implementation and shared by the clones through the implementation's immutable reference.
- The frontend is configured for static/IPFS deployment and now lazy-loads ABI-only artifacts.
- Solidity compilation is pinned to `solc 0.8.24`, generates validated Truffle-compatible artifacts, and enforces the EIP-170 bytecode limit.
- GitHub Actions recompiles, checks bytecode size, runs all contract and frontend utility tests, audits high-severity frontend dependencies, builds the static app, and checks generated ABI drift.
- The supported deployment path is `ethereum/migrations/2_deploy_chess_system.js`; public Base deployments can transfer protocol control to `ChessTimelock` and remove deployer privileges.
- The system is still not formally audited.

The repository is suitable for source publication, local use, and a clearly labelled Base Sepolia beta. It is not approved for a permissionless production launch with material user funds.

Important limitations:

- arbitrator selection commits a challenge before using a future block hash, but it is not VRF-backed; block producers or the Base sequencer can still influence availability, censor finalization, and have limited influence over entropy
- panel formation and dispute recovery require active keepers; an unavailable panel or three inconclusive rounds moves the case to a timelocked governance backstop while funds remain locked
- panel selection is FIFO and keeper-dependent; transient assignment/cooldown pressure can delay the head for up to seven days, while a structurally insufficient pool moves the dispute to the timelocked backstop
- a sustained stream of funded participant challenges can congest the FIFO even though each entry is bounded and cannot silently confirm the provisional result
- stake-weighted Schelling voting raises the cost of address-based Sybil attacks but does not prove that a majority is correct, and it retains whale-influence and herding risks
- ratings use a bounded linear approximation of the Elo expected-score curve; `PlayerRating.getTopPlayers()` is a pagination helper, not a sorted on-chain leaderboard
- faucet eligibility and the CHESS/ETH price feed still depend on trusted, separately rotatable off-chain signers
- Truffle 5 and `@truffle/hdwallet-provider` retain known npm advisories in their deprecated dependency trees; replace or isolate this deployment toolchain before handling a production mnemonic
- game state, moves, stakes, disputes, and ratings are public blockchain data; the protocol does not provide player privacy
- timeout presets use timestamp deadlines: `Finney` is 1 hour, `Buterin` is 7 hours, and `Nakamoto` is 7 days
- `legacy/` is retained for historical reference only and must not be used to build or deploy the protocol

The current remediation controls, external-auditor-style review, ABI migration requirements, and residual risks are tracked in [`docs/SECURITY_REMEDIATION_ROUND2.md`](docs/SECURITY_REMEDIATION_ROUND2.md). The older [`docs/SECURITY_REMEDIATION.md`](docs/SECURITY_REMEDIATION.md) is the historical round-one record.

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

`ChessFactory` records every new clone in the O(1) `isDeployedGame` registry and registers it with the bonding, dispute, rating, and reward components. The frontend accepts only games belonging to the configured factory on the connected chain. With canonical dispute wiring enabled, a game finalizes only after its challenge window has expired or its dispute has been resolved; prize allocation uses a pull-payment flow.

A challenged dispute follows `Pending -> Selecting -> Challenged -> Revealing`. Inconclusive panels return to `Selecting` for a bounded next round. An unavailable panel or exhausted rounds enters `Unresolved`; only the timelocked administrator can then choose `Legit`, `WhiteCheat`, or `BlackCheat`.

## Feature Set

### Game Layer

- on-chain piece movement, king-safety, check, mate, and stalemate evaluation through `ChessCore` + `ChessRulesEngine`
- special moves: castling, en passant, promotion
- check, checkmate, stalemate, threefold repetition, 50-move rule, 75-move automatic draw
- three chain-independent timeout presets: `Finney` (1 hour), `Buterin` (7 hours), `Nakamoto` (7 days)
- `Friendly` mode rejects moves that leave the mover's king in check and allows custom pre-game positions
- custom Friendly positions accept only valid pieces, require exactly one king per color, and are canonicalized when Black confirms the chain- and game-bound setup hash
- `Tournament` mode treats a self-checking move as a distinct illegal-move loss instead of checkmate or a reverted transaction
- canonical repetition/en-passant state, permanent castling-right revocation after a corner-rook capture, and terminal-state precedence for the 75-move draw
- retryable rating reporting after a temporary downstream failure
- unjoined game cancellation after timeout
- dispute-aware settlement for prizes, rewards, and ratings

### Anti-Cheating Layer

- hybrid bonding in ETH + CHESS
- domain-separated commit-reveal arbitrator voting
- challenge-first selection using future block entropy, with refresh and unavailable-panel recovery
- stake-weighted tallies with separate address-count and voting-power quorum snapshots
- per-game snapshots of challenge economics, panel policy, quorum, supermajority, and commit/reveal durations taken atomically when Black joins and both player bonds are locked
- panel collateral tied to both players' locked CHESS bonds, one active assignment per stake position, and quota reservation at selection
- up to 3 arbitration rounds, using as many as 5, 7, and 9 eligible arbitrators per populated tier
- 5% active-stake slash for non-reveal and 1% for a revealed vote contrary to the final decision
- seven-day activation delay for top-ups and exclusion of prior-round arbitrators
- side-specific slashing on `WhiteCheat` / `BlackCheat`, with challenger compensation forbidden when the challenger is the cheating side
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
| `ChessFactory` | Game creation through clone deployment and canonical O(1) game registry |
| `ChessNFT` | ERC721 minted to the creator for every game; `tokenURI()` delegates to the live game-board SVG |
| `ChessToken` | ERC20 governance / ecosystem token |
| `BondingManager` | ETH + CHESS bond accounting, game locks, and rolling oracle circuit breaker |
| `RewardPool` | Distribution from pre-funded reward/faucet balances and signer-authorized faucet claims |
| `ArbitratorRegistry` | Delayed arbitrator stake, bounded tier pools, assignment reservations, selection, reputation, and slashing |
| `DisputeDAO` | Challenge escrow, future-entropy panel selection, weighted commit-reveal voting, bounded escalation, and backstop decisions |
| `PlayerRating` | Authorized/self registration, Elo-style ratings, and player stats |
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
BASE_MAX_FEE_PER_GAS_WEI=5000000000
TEAM_WALLET=
TREASURY_WALLET=
FAUCET_SIGNER=
ORACLE_UPDATER=
GOVERNANCE_HANDOFF=true
# Copy the SHA-256 printed by the migration before public verification.
DEPLOYMENT_MANIFEST_SHA256=
```

```bash
cd ethereum
cp .env.example .env
# Populate .env locally, then validate it without sending transactions.
npm run preflight:base-sepolia
npx truffle migrate --network base_sepolia --reset
npm run verify:deployment -- --network base_sepolia
```

Public RPC values must be valid HTTPS URLs. `BASE_MAX_PRIORITY_FEE_PER_GAS_WEI` defaults to `1000000` (`0.001 gwei`) and cannot exceed `0.1 gwei`. `BASE_MAX_FEE_PER_GAS_WEI` defaults to the absolute `5 gwei` ceiling but may be lowered for a deployment wallet with a smaller balance; it cannot be lower than the priority fee. Preflight then requires current fee headroom and enough balance for a conservative 100-million-gas full-migration budget at the chosen maximum. These limits prevent accidental or malicious overpayment but can deliberately make deployment unavailable during a fee spike. `FAUCET_SIGNER` authorizes eligible faucet beneficiaries and may be either an EOA or an ERC-1271 contract wallet. `ORACLE_UPDATER` receives only `ORACLE_ROLE` and must submit a fresh CHESS/ETH price at least once every seven days; stale prices block bond calculation and new bonded games.

The preflight compiles the canonical sources, enforces EIP-170, derives only the public deployer address, verifies the RPC chain, checks the deployer's native balance, and validates operational addresses. It never prints the mnemonic or sends a transaction. For a public verification, copy the migration's printed SHA-256 into `DEPLOYMENT_MANIFEST_SHA256` and provide the same four principal addresses as independent environment anchors.

The post-deployment verifier pins every read and log scan to one finalized block, rechecks that block before success, authenticates top-level creation transactions, constructor arguments, linked initcode, deployed runtime, and canonical EIP-1167 clones. It also enforces exact current and historical role membership, no scheduled timelock operation or governance proposal, pristine treasury governance state, clean operational genesis, untouched oracle history, zero reward activity, and the canonical dispute policy: minimum panel size `3`, minimum panel active stake `3,000 CHESS`, bond coverage `10,000` bps, voting-power quorum `66%`, and decision supermajority `66%`.

> **Migration warning:** this remediation changes contract interfaces, state semantics, and clone membership. It is not an in-place upgrade. Deploy the complete coordinated suite, resolve or explicitly account for all positions in the old deployment, regenerate ABIs, and switch every frontend address atomically. Do not mix old and new protocol addresses.

The `base` profile automatically transfers ownership and admin roles to `ChessTimelock`, then removes deployer privileges. Base Sepolia keeps the deployer as admin unless `GOVERNANCE_HANDOFF=true` is set. When handoff is enabled, `TREASURY_WALLET`, `FAUCET_SIGNER`, and `ORACLE_UPDATER` must differ from the deployer. For mainnet, the treasury must be an independently controlled, out-of-band verified multisig; code cannot prove the owners, threshold, or absence of undisclosed offline signatures.

Verify a handoff against the selected network:

```bash
cd ethereum
npm run verify:handoff -- --network base
```

Post-deployment operations are required:

- approve and deposit CHESS into `RewardPool.depositRewardPool()` before play-to-earn payouts can occur
- approve and deposit CHESS into `RewardPool.depositFaucetPool()` before faucet claims can occur
- mature and activate enough independent arbitrator stake for the configured panel count and collateral
- operate a keeper for `finalizePanel()`, expired-blockhash `refreshPanelSelection()`, and timed-out `markPanelUnavailable()` calls
- keep the oracle price fresh through the dedicated updater and define a timelock procedure for `resetCircuitBreaker(trustedPrice)`
- define a timelock procedure for final `resolveByBackstop()` decisions on `Unresolved` disputes
- monitor failed rating reports and expose an operational retry through `retryRatingReport()`
- configure and verify CSP, framing, referrer, transport, and other HTTP security headers at the actual gateway
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
Factory, bonding manager, and CHESS token addresses must come from the same new deployment. Legacy factories that do not expose `isDeployedGame(address)` and old clones without a canonical registry entry fail closed. All protocol addresses should be updated as one coordinated release; the `VITE_*` factory remains a build-time trust anchor.

The current UI does not expose every operational recovery call. In particular, `activatePendingStake()`, `resetCircuitBreaker(trustedPrice)`, `retryRatingReport()`, and `resolveByBackstop()` need an audited operator/governance workflow until dedicated UI paths exist.

The frontend derives EIP-1559 max fees from the latest Base block and defaults the priority fee to `1000000` wei (`0.001 gwei`), with the same `0.1 gwei` priority and `5 gwei` total caps used by deployment. Fee data is refreshed after awaited transactions. Override `VITE_BASE_MAX_PRIORITY_FEE_PER_GAS_WEI` only when Base fee policy requires it; local Ganache transactions continue to use provider-managed fees.

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

The final remediation baseline passed `459/459` Truffle cases in four fresh Ganache batches (`124 + 60 + 133 + 142`). The command below compiles, checks every deployed bytecode against EIP-170, runs deployment-script tests, runs the isolated contract batches, and exercises the real deployment migration plus both post-deployment verifiers with governance handoff enabled:

```bash
cd ethereum
npm run test:ci
```

For an ad hoc monolithic run against an already running Ganache instance:

```bash
LOCAL_RPC_PORT=8545 npm test -- --compile-none
```

With gas reporting, set `REPORT_GAS=true` on that monolithic command. The isolated `test:ci` runner is preferred because the full suite creates enough chain state to destabilize a single long-lived provider.

The verified baselines are `459/459` Truffle cases, `50/50` deployment-script tests, and `93/93` frontend tests. The frontend production build, governance-handoff migration/verifiers, fresh ABI extraction, and deterministic ABI drift check also pass. Security regressions cover canonical game/factory/protocol verification, route/account/chain races, exact token allowance and challenge terms, whole-game settlement, promoted FIFO-head activation, commit-secret recovery, custom-board canonicalization and the full `int8` piece domain, endgame/castling/repetition edge cases, rating/reward eligibility, challenge selective-abort, FIFO future-entropy recovery, collateral and weighted quorum, non-reveal/incorrect-vote slashing and backstop behavior, assignment concurrency, rolling oracle/reset limits, deployment provenance/genesis policy, HTTPS RPC validation, and fee caps.

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
│   ├── SECURITY_REMEDIATION.md
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
│   └── test/                        # 19 Truffle test files
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
function isDeployedGame(address game) external view returns (bool);
```

### ChessCore

```solidity
function joinGameAsBlack() external payable;
function joinGameAsBlackConfirmingBoard(bytes32 expectedBoardHash) external payable;
function getBoardSetupHash() external view returns (bytes32);
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
function retryRatingReport() external;

function offerDraw() external;
function acceptDraw() external;
function claimDrawByRepetition() external;
function claimDrawByFiftyMoveRule() external;
```

Settlement guidance:

- `finalizePrizes()` followed by `withdrawPrize()` is the canonical pull-payment path and is required for draws
- `claimPrize()` is a backward-compatible combined path for a single rightful recipient
- neither path can settle while a challenge window or dispute is still active
- customized Friendly boards require Black to confirm the exact chain- and game-bound setup hash; standard boards continue to use `joinGameAsBlack()`
- a Tournament self-check emits `IllegalMoveLoss` and is handled as a behavioral violation, not as checkmate

### DisputeDAO

```solidity
function challenge(uint256 gameId) external;
function activatePanelSelection(uint256 disputeId) external;
function finalizePanel(uint256 disputeId) external;
function refreshPanelSelection(uint256 disputeId) external;
function markPanelUnavailable(uint256 disputeId) external;
function commitVote(uint256 disputeId, bytes32 commitHash) external;
function revealVote(uint256 disputeId, Vote vote, bytes32 salt) external;
function resolveDispute(uint256 disputeId) external;
function resolveByBackstop(uint256 disputeId, Vote decision) external;
function computeVoteCommitment(
    uint256 disputeId,
    Vote vote,
    bytes32 salt,
    address arbitrator
) external view returns (bytes32);
function getChallengeWindowRemaining(uint256 gameId) external view returns (uint256);
function getEffectiveQuorum(uint256 disputeId) external view returns (uint256);
function getSelectedArbitrators(uint256 disputeId) external view returns (address[] memory);
function getPanelSecurity(uint256 disputeId) external view returns (
    uint256 totalVotingPower,
    uint256 minimumRevealedVotingPower,
    uint256 revealedPower,
    uint256 minimumRevealedArbitrators,
    uint256 revealedArbitrators,
    uint256 panelActiveStake,
    uint256 requiredPanelActiveStake
);
```

The default challenge window is 48 hours, followed by future-block panel selection and 24-hour commit and reveal periods. Production games snapshot challenge economics, panel policy, quorum, supermajority, and commit/reveal durations when Black joins and both player bonds become locked. `challenge()` is participant-only, reserves the snapshotted deposit, and asks arbitrators to adjudicate the whole game rather than a challenger-selected accused player. FIFO activation commits the head to future entropy; `finalizePanel()` snapshots stake/time voting power and reserves assignments. Both revealed-address quorum and revealed-power quorum must pass; tallies are voting power rather than address count. `panelActiveStake` is the selected panel's active stake, not an assertion that the whole amount can be slashed for an incorrect outcome.

A vote commitment is:

```solidity
keccak256(abi.encode(
    block.chainid,
    address(disputeDAO),
    disputeId,
    uint8(vote),
    salt,
    arbitratorAddress
))
```

Insufficient quorum or supermajority triggers a fresh, larger panel and excludes the prior round. After three inconclusive rounds, structural panel failure, or a seven-day transient selection failure, the dispute becomes `Unresolved`; deposits and game bonds stay reserved until timelocked governance calls `resolveByBackstop()` with `Legit`, `WhiteCheat`, or `BlackCheat`.

For dispute and arbitrator writes, the frontend verifies bytecode and the mutual factory/DAO/bonding/token/registry links, binds the canonical factory game ID and game address, and rechecks those links plus the wallet route after transaction population and immediately before `sendTransaction`. A challenge also rechecks the live deposit and exact DAO allowance at that final boundary.

Vote reveal data is sensitive browser state. The client writes an account/chain/DAO/dispute-scoped backup before asking the wallet to broadcast, then records the transaction hash and nonce when available. An ambiguous submission is preserved; retry resubmits only the exact saved vote, salt, and commitment. Changing route, account, or chain clears the previous secret from visible component state, while its scoped local backup remains recoverable. A successful reveal does not delete the salt after one receipt because a shallow reorg may require the same reveal again. Keep exported and browser backups private, and remove them only after an independently chosen finality policy; automatic finality-based pruning is not implemented.

### ArbitratorRegistry

Initial stakes activate voting power after seven days. Top-ups to an active position remain pending for a fresh seven days and require `activatePendingStake()`. Selection is capped at 128 registered addresses per tier, reserves cooldown and weekly quota immediately, and permits only one active assignment per stake position. Non-reveal burns 5% of active stake; a revealed vote contrary to the final decision burns 1%.

### BondingManager oracle

Material oracle changes must be at least 15 minutes apart and stay within a rolling 24-hour +/-50% envelope. A violation trips and pauses the contract without accepting the proposed price. `unpause()` cannot bypass a trip; timelocked administration must use `resetCircuitBreaker(trustedPrice)` to reset the price history and unpause atomically.

### RewardPool faucet

Faucet claims require an expiring, epoch- and nonce-bound off-chain authorization:

```javascript
const deadline = Math.floor(Date.now() / 1000) + 15 * 60;
const epoch = await rewardPool.rewardEligibilityEpoch();
const nonce = await rewardPool.faucetNonces(beneficiary);
const domain = await rewardPool.FAUCET_AUTHORIZATION_DOMAIN();
const encoded = ethers.utils.defaultAbiCoder.encode(
  ["bytes32", "address", "uint256", "address", "uint256", "uint256", "uint256"],
  [domain, rewardPool.address, chainId, beneficiary, epoch, nonce, deadline]
);
const digest = ethers.utils.keccak256(encoded);
const authorization = await faucetSigner.signMessage(ethers.utils.arrayify(digest));
await rewardPool.connect(beneficiary).claimFaucet(deadline, authorization);
```

An authorization cannot be replayed across purpose, beneficiary, signer epoch, nonce, chain, or `RewardPool`, and expires at `deadline`. Game-reward eligibility uses a separate v2 domain and nonce. Eligibility remains a trusted off-chain policy enforced by `FAUCET_SIGNER`.

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
- canonical factory membership and mutually linked protocol checks for game, bonding, dispute, and arbitrator frontend writes, repeated at the final pre-send boundary
- challenge windows, irrevocable future-entropy panel selection, and commit / reveal deadlines
- bounded arbitration with a timelocked explicit-decision backstop; the 30-day cleanup applies only to unchallenged `Pending` records
- player-bond locking plus assignment locks and economic arbitrator slashing
- stale-price rejection, rolling price-change circuit breaker, and a dedicated, revocable oracle role
- signer-bound faucet authorizations for EOAs and ERC-1271 contract wallets without `tx.origin`
- production governance handoff with deployer privilege removal
- custom errors for lower revert overhead

Known limitations:

- no formal external audit yet
- the Truffle deployment stack contains deprecated transitive dependencies with unresolved npm advisories; do not treat a clean contract test run as a supply-chain audit
- future-block arbitrator selection is not VRF-backed and still depends on block-production and keeper liveness
- FIFO selection and its registry mutation lock remove last-look snapshot invalidation, but transient assignment/cooldown exhaustion still depends on keepers and can delay the head until the seven-day `Unresolved` timeout
- funded participant challenges can congest the FIFO; deposits and participant-only access raise the cost but do not prove resistance to coordinated Sybil-controlled games
- aggregate eligible population is not proof that the deterministically chosen tier mix will meet panel-size and active-stake coverage requirements; selection may still time out to the backstop
- panel collateral reports active stake, while only 5%/1% is actually slashed for non-reveal/incorrect outcome; stake-weighted voting still has whale and herding risk
- `Unresolved` cases hold funds until timelocked governance acts
- the oracle updater, faucet signer, and governance-authorized circuit-breaker reset remain trusted operational roles
- all gameplay and dispute data is public on-chain
- the canonical game registry exists on-chain, but the configured factory remains a build-time trust anchor and no known factory code hash is authenticated
- CSP and other gateway headers cannot be guaranteed by the static/IPFS bundle and must be verified on the actual hosting layer
- the UI does not yet expose `activatePendingStake()`, `resetCircuitBreaker()`, `retryRatingReport()`, or `resolveByBackstop()`; these require controlled operator/governance procedures
- local capped-population gas tests use Ganache's 30 million gas block limit and a 90% threshold; they are regression guards, not proof that scheduling, finalization, or escalation is reliably executable under live Base conditions
- the Base fee caps deliberately trade availability for spend protection and may prevent deployment or writes during fee spikes
- vote backups remain sensitive local browser data after a one-confirmation reveal so shallow reorgs can be recovered; users/operators need a finality and cleanup policy
- old vote commitments use an incompatible domain and cannot be revealed through the new DAO
- `ChessCore` has limited EIP-170 headroom; every change must retain the bytecode-size gate
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
