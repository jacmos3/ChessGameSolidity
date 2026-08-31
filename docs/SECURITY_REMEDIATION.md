# Security Remediation Status

> **Historical round-one record.** This document is retained for traceability and
> describes an earlier remediation state. The current final assessment, controls,
> verification results, and residual risks are documented in
> [`SECURITY_REMEDIATION_ROUND2.md`](./SECURITY_REMEDIATION_ROUND2.md). Where the two
> documents differ, the round-two report is authoritative.

This document describes the security-remediation branch based on commit `b2e41a0`. It is the operational reference for the changed security boundaries and ABI migration. The Solidity sources and canonical migration remain authoritative.

The remediation has been verified locally only. It is not an external audit, a formal verification, or evidence that a public deployment is safe for material funds.

## Finding status

| ID | Status | Implemented control | Regression coverage |
|---|---|---|---|
| H-01 | Fixed | `ChessFactory.isDeployedGame` provides an O(1) canonical registry. The frontend rejects unsupported chains, missing or legacy factories, addresses without bytecode, unregistered games, signer/account/route changes, and mismatched factory/DAO/bonding/token/registry links. Canonical game and protocol links are reread after transaction population; challenges also recheck the live deposit and exact allowance immediately before send. | `frontend/test/gameVerification.test.js`, `frontend/test/disputeVerification.test.js`, `frontend/test/tokenAllowance.test.js` |
| H-02 | Fixed | Black's join scans and validates the final board, reconstructs both king caches, derives castling state, resets rule state, and seeds one canonical initial position. The setup hash is domain-separated by chain, game address, mode, board, and every installed rule-relevant field. | `ethereum/test/TestGameCoreSecurityRegression.js` |
| H-03 | Fixed | Friendly setup accepts only `0` and `+/-1..6`; the rules engine handles the full `int8` domain defensively; the renderer and frontend reject corrupt pieces instead of hiding them. | `ethereum/test/TestGameCoreSecurityRegression.js`, `frontend/test/boardValidation.test.js` |
| H-04 | Partially fixed | Opening a challenge now locks the deposit before panel selection. A later transaction captures a future block hash and selects deterministically; failed selection cannot roll back the challenge. Expired entropy can be rescheduled only while the fail-closed eligibility snapshot still matches, and unavailable panels time out to `Unresolved`. | `ethereum/test/TestDisputeDAO.js` selective-abort, snapshot-invalidation, and selection-recovery cases |
| H-05 | Partially fixed | Panel viability is tied to the two locked CHESS game bonds and a configurable active-stake floor. Voting uses snapshotted stake/time power, requires both address and power quorum, reserves one assignment per stake position, and slashes non-reveal and incorrect votes. The reported active stake is not wholly slashable collateral. | `ethereum/test/TestDisputeDAO.js` Sybil/collateral/concurrency cases, `ethereum/test/TestArbitratorRegistry.js` |
| H-06 | Fixed | Non-reveal burns 5% of active stake, reduces reputation, excludes the address from later rounds, and cannot produce `Vote.None`. Incorrect revealed votes burn 1%. Panel policy and commit/reveal durations are fixed when the deposit is locked. After bounded rounds, funds remain reserved until a timelocked `Legit` or `Cheat` backstop decision. | `ethereum/test/TestDisputeDAO.js` period-snapshot/bootstrap/non-reveal/backstop cases, `ethereum/test/TestArbitratorRegistry.js` incorrect-vote cases |
| M-01 | Fixed | Assignment, weekly quota, cooldown, and stake exposure are reserved during panel selection and released on terminal or escalation paths. A stake position cannot serve concurrent panels. | `ethereum/test/TestArbitratorRegistry.js`, `ethereum/test/TestDisputeDAO.js` |
| M-02 | Fixed | Reputation settlement is idempotent for an already selected arbitrator and cannot block release after another state transition. Concurrent selection is prevented. | `ethereum/test/TestArbitratorRegistry.js`, `ethereum/test/TestDisputeDAO.js` |
| M-03 | Fixed | The 75-move automatic draw is applied only while the game is still in progress, after checkmate and Tournament illegal-move loss resolution. | `ethereum/test/TestGameCoreSecurityRegression.js` |
| M-04 | Fixed | The oracle enforces a 15-minute material-update interval and a bounded rolling 24-hour +/-50% limit, with an explicit admin-reviewed reset after a trip. | `ethereum/test/TestBondingManager.js` |
| L-01 | Fixed | Player registration is limited to self-registration or an authorized game contract; reports reject zero participants. | `ethereum/test/TestPlayerRating.js` |
| L-02 | Fixed | Tournament self-check is a distinct `IllegalMoveLoss`, uses resignation-like behavior, and cannot receive the checkmate bonus. | `ethereum/test/TestGameCoreSecurityRegression.js` |
| L-03 | Fixed | Capturing an original corner rook permanently revokes that castling right; a promoted or replacement rook cannot restore it. | `ethereum/test/TestGameCoreSecurityRegression.js` |
| L-04 | Fixed | Setup finalization clears stale repetition data, canonicalizes en passant and turn state, and records the accepted initial position exactly once. | `ethereum/test/TestGameCoreSecurityRegression.js` |

`Partially fixed` means that the concrete exploit described in the finding is blocked, but the mechanism still has unavoidable or deliberately accepted trust assumptions described under Residual risks.

## Security boundaries and changed flows

### Canonical games and frontend transactions

Every new EIP-1167 clone is recorded atomically in `ChessFactory.isDeployedGame`. There is no legacy fallback: a factory that does not expose the canonical lookup, an old clone with no registry entry, or a game from another configured factory fails closed.

Before a payable create or game mutation, the frontend binds a verified context containing chain ID, factory, canonical game where applicable, route, and signer account. It rechecks the live network and signer before the send. Bonding operations additionally require the factory's `bondingManager()` and that manager's `chessToken()` to match the configured addresses. CHESS approvals use the exact required amount and can be explicitly revoked.

Dispute and arbitrator writes use the same fail-closed model. The client requires bytecode at every configured protocol address and verifies the mutual links among `ChessFactory`, `DisputeDAO`, `BondingManager`, `ChessToken`, and `ArbitratorRegistry`. A dispute action is bound to the factory's game ID/address entry, `isDeployedGame`, the game's own `gameId()`, and its `disputeDAO()`. After populating a write, the client rereads the canonical links and the live wallet/route before calling `sendTransaction`. A challenge additionally rereads `challengeDeposit` and requires the DAO allowance to equal that amount at this final boundary.

The configured `VITE_*` factory address remains a build-time trust anchor. The checks prove membership in that configured factory, not that the factory bytecode equals an independently published code hash.

### Commit-secret lifecycle

The reveal secret is persisted before wallet broadcast, scoped by chain, DAO, account, and dispute. The record transitions through `pending`, `broadcast` (with transaction hash and nonce), and `confirmed`. If broadcast status cannot be proven, the record is preserved. A retry is idempotent: it can only reuse the saved vote, salt, and commitment while the on-chain commitment remains zero; it cannot create a conflicting replacement commitment.

A route, account, or chain change immediately clears the old secret from visible component state and invalidates late asynchronous UI updates. The separately scoped local record remains recoverable for its original context. A reveal receipt does not delete the secret because one confirmation can be reorganized; the same reveal can be resubmitted from the retained backup. This improves recoverability but deliberately leaves sensitive material in browser storage. There is no automatic finality-based pruning, so users and operators need a backup-retention and cleanup policy.

### Friendly setup and game rules

Custom setup remains available only before a Friendly game begins. Black must use `joinGameAsBlackConfirmingBoard(bytes32)` for a customized position. Finalization requires exactly one king of each color, accepts only the supported piece domain, rebuilds king caches, derives castling rights from the accepted position, clears en passant and clocks, sets White to move, and creates a fresh repetition history.

`getBoardSetupHash()` commits to `BOARD_SETUP_DOMAIN`, chain ID, game address, mode, board, king positions, castling flags, en passant state, half-move clock, side to move, and the initial repetition count. An approval cannot be replayed for an identical board in another game or chain.

### Arbitration

The current state flow is:

```text
Pending -> Selecting -> Challenged -> Revealing -> Resolved
                        |                |
                        +---- inconclusive ----> Selecting (next round)

Selecting -- 7-day unavailable timeout --> Unresolved
third inconclusive round -----------------> Unresolved
Unresolved -- timelocked Legit/Cheat -----> Resolved
```

`challenge()` reserves the deposit and snapshots quorum, supermajority, minimum panel size, required panel active stake, commit duration, and reveal duration. Every finalized escalation round uses those snapshotted durations, so a later governance parameter change cannot shorten or extend an already funded dispute. `finalizePanel()` can run after the scheduled future block, captures its block hash, and requests up to 5, 7, then 9 arbitrators per populated tier across the three rounds. Candidate rank is derived from the captured entropy and candidate address rather than mutable pool order.

The panel must satisfy both a snapshotted address-count quorum and a snapshotted voting-power quorum. Outcome tallies are voting power, not one-address-one-vote. Required active-stake coverage is the greater of 3,000 CHESS and the configured coverage of both players' locked CHESS bonds; the default coverage is 100%. `getPanelSecurity()` therefore returns `panelActiveStake` and `requiredPanelActiveStake`: neither value means that the whole amount is slashable for an incorrect majority verdict. Each selected address can have only one active assignment and consumes its weekly quota at assignment time.

New stake on an active position remains pending for seven days and must be activated explicitly. Non-reveal burns 5% of active stake; a revealed vote contrary to a final decision burns 1%. Prior-round arbitrators are excluded from later rounds of the same dispute.

The commitment is exactly:

```solidity
keccak256(abi.encode(
    block.chainid,
    address(disputeDAO),
    disputeId,
    uint8(vote),
    salt,
    arbitrator
))
```

Commitments created for the previous domain are not revealable by the new DAO.

### Oracle recovery

`BondingManager` rejects material price updates less than 15 minutes apart and compares a proposed price with every still-relevant observation in a bounded 98-entry, 24-hour ring. A move strictly greater than 50% trips and pauses the contract without installing the proposed price. Ordinary `unpause()` is forbidden after a circuit-breaker trip; the timelocked administrator must call `resetCircuitBreaker(trustedPrice)`, which installs a reviewed price and resets the rolling history atomically.

## Deployment and ABI migration

This release is not storage- or ABI-compatible with the previous deployment, and the contracts do not use upgradeable proxies.

- Deploy a completely new coordinated suite using `ethereum/migrations/2_deploy_chess_system.js`.
- Existing EIP-1167 games remain bound to the old `ChessCore` implementation and have no entry in the new factory registry. The supported frontend rejects them by design.
- There is no automatic migration for open games, player bonds, arbitrator stakes, disputes, ratings, rewards, or challenge deposits. Resolve or account for those positions before switching the frontend.
- `ArbitratorRegistry.selectArbitrators` has a new signature, `recordVote` is removed, and the public `arbitrators(address)` tuple has changed.
- `DisputeDAO.quorum()` is replaced by `quorumPercentage()`. `setParameters(...)` retains its Solidity selector, but its fourth argument is now a percentage rather than an absolute quorum. External scripts must be reviewed even if their ABI call still encodes.
- `DisputeDAO` adds the public per-dispute `disputeCommitPeriod(uint256)` and `disputeRevealPeriod(uint256)` getters. `getPanelSecurity(uint256)` now describes `panelActiveStake` and `requiredPanelActiveStake`; consumers must not label those values as wholly slashable collateral.
- `DisputeState` adds `Selecting = 6` and `Unresolved = 7`; indexers and UIs must handle both.
- The semantics of challenge, vote tallies, setup confirmation, rating reporting, oracle update, and circuit-breaker recovery changed even where a selector remains stable.
- Old vote commitments and backups use an incompatible domain. Finish their reveals against the old DAO; they cannot be replayed or translated into a valid new-DAO reveal.
- Regenerate the frontend ABIs from the exact compiled artifacts, then update factory, bonding, token, DAO, registry, rating, governance, and timelock addresses as one release. Never mix addresses from old and new deployments.

Public RPC profiles require HTTPS. Base priority fee defaults to 0.001 gwei and is capped at 0.1 gwei; total max fee is capped at 5 gwei. The cap deliberately trades availability during fee spikes for protection against accidental or malicious overpayment.

The post-deployment verifier also enforces the canonical arbitration defaults exactly: minimum panel size `3`, minimum panel active-stake floor `3,000 CHESS`, coverage `10,000` bps, voting-power quorum `66%`, and decision supermajority `66%`. This is a deployment invariant, not a substitute for later governance-change monitoring.

### Recommended rollout

1. stop creating new positions on the old deployment and inventory every open game, locked player bond, arbitrator stake, dispute, challenge deposit, rating obligation, and reward/faucet balance;
2. resolve or explicitly account for those positions under the old contracts; there is no automated state bridge or balance migration;
3. compile the final sources, enforce the EIP-170 gate, regenerate ABI-only frontend artifacts, and deploy the entire suite through `ethereum/migrations/2_deploy_chess_system.js`;
4. run the topology/security-policy verifier and the governance-handoff verifier against the new address file before funding or publishing frontend configuration;
5. fund operational pools, mature the seven-day arbitrator activation delay, call `activatePendingStake()`, and verify both independent panel count and active-stake coverage across usable tiers;
6. provision keeper, oracle, timelock-backstop, circuit-breaker-reset, and rating-retry procedures, including monitoring and accountable operators;
7. publish one frontend build containing ABIs and every protocol address from that same deployment; invalidate stale static assets and never combine old and new addresses;
8. stage first on Base Sepolia with non-material value, then reassess keeper liveness, gateway headers, fees, panel availability, and governance operations before any production decision.

Before exposing the deployment:

1. verify code, links, roles, ownership, canonical factory behavior, exact arbitration policy, and governance handoff with the repository verifier;
2. mature and activate enough independent arbitrator stake to satisfy panel count and collateral requirements;
3. operate a keeper that calls `finalizePanel()` inside the blockhash window, `refreshPanelSelection()` when necessary, and `markPanelUnavailable()` after the timeout;
4. define timelock procedures for `resolveByBackstop()` and `resetCircuitBreaker()`;
5. monitor pending rating reports and provide an operational path for `retryRatingReport()`;
6. configure CSP, framing, referrer, transport, and other security headers at the actual gateway or hosting layer.

The current UI does not expose `activatePendingStake()`, `resetCircuitBreaker()`, `retryRatingReport()`, or `resolveByBackstop()`. Until dedicated flows are implemented and reviewed, these are operator/governance procedures rather than end-user actions.

## Residual risks

- Future block hash selection removes challenger rollback-grinding but is not VRF. A block producer or Base sequencer can influence availability, censor finalization, and has limited influence over the selected entropy.
- Selection snapshots fail closed. A candidate can change stake, tier, or assignment state after scheduling, invalidate the snapshot, and force the dispute toward the timeout/backstop path. This is a bounded liveness veto, not a way to cancel the challenge or recover its deposit.
- Aggregate eligible population is not proof that the deterministic selected panel will meet tier distribution, minimum-size, and active-stake coverage checks. Pool composition, cooldown, previous assignments, tier imbalance, and the 128-address per-tier cap can still make a panel unavailable.
- Reported panel collateral is active stake, while the outcome penalties are 5% for non-reveal and 1% for an incorrect vote. It must not be represented as the entire amount slashable for a corrupt decision.
- Stake-weighted Schelling voting reduces cheap-address Sybil power but increases whale influence and can encourage herding. It cannot prove whether a majority verdict is factually correct.
- `Unresolved` disputes keep game bonds, prize settlement, and challenge deposits locked until timelocked governance acts. This is a deliberate safety/liveness tradeoff.
- Oracle updater, faucet signer, and circuit-breaker reset governance remain trusted operational boundaries.
- The factory address remains frontend build configuration and known factory code hashes are not authenticated. The canonical-link checks detect mismatched wiring but trust the configured factory as their root.
- Static/IPFS delivery does not itself enforce CSP or HTTP security headers. Those controls require verification on the real gateway.
- The frontend has no dedicated paths for `activatePendingStake()`, `resetCircuitBreaker()`, `retryRatingReport()`, or `resolveByBackstop()`; operational tooling and access procedures remain necessary.
- The capped-population regression uses a local Ganache block limit of 30 million gas and requires estimates below 90% of that value. Even after its extended escalation case passes, it is not proof of Base operability under real block, sequencer, congestion, or fee conditions.
- Base priority and total fee caps deliberately trade availability for spend protection. A fee spike can block deployment or frontend writes until policy or network conditions change.
- Reveal backups remain sensitive local browser data after a one-confirmation reveal to permit shallow-reorg recovery. There is no automatic finality-based cleanup.
- Commitments created for the old DAO/domain cannot be revealed through the new DAO; migration requires resolving them on the old deployment.
- The deprecated Truffle/HDWalletProvider dependency tree remains isolated but not replaced. Do not expose a production mnemonic to an unreviewed build environment.
- `ChessCore` has limited EIP-170 headroom. Future changes must retain the bytecode-size gate.

## Local verification baseline

The final checks were run serially because the development machine is memory constrained:

- pinned `solc 0.8.24`/`viaIR` compilation succeeded for 22 contracts;
- the EIP-170 gate passed; `ChessCore` is `23,689` bytes, leaving `887` bytes of headroom;
- the complete contract run passed `423/423` Truffle cases across four fresh Ganache instances (`123 + 59 + 109 + 132`);
- the capped-population regression covered scheduling, finalization, and escalation estimation with 384 coherently accounted and token-backed synthetic positions under a local 30 million gas block limit;
- deployment-script unit tests passed `22/22`, including exact arbitration-policy verification;
- frontend utility tests passed `53/53` and the SvelteKit production build completed successfully;
- the governance-handoff migration, topology/security-policy verifier, and handoff verifier passed against a temporary local deployment;
- fresh ABI extraction included the per-dispute period getters, and a second extraction produced identical file hashes.

No public RPC, deployment, or external service was contacted during these checks. Local Ganache results do not replace the on-chain and operational validation listed below.

These checks do not cover a live Base sequencer, public RPC behavior, deployed gateway headers, third-party wallet behavior, economic stress at the maximum pool size, or real governance operations.
