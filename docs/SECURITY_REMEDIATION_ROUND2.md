# Security Remediation Round 2 — Final Review

Review date: 2026-08-31

Reviewed baseline: `0fff8f36922d8a36b12304faab6b3c99e536a812`

Reviewed branch: `codex/security-remediation`

This is an external-auditor-style review of the remediation diff, not a formal
third-party attestation. It records evidence, test results, release constraints,
and residual risks. Solidity sources and the canonical migration remain
authoritative.

## 1. Executive summary

The reviewed branch closes the confirmed Critical and High implementation defects
identified against the baseline: challenger-directed adjudication, inconsistent
settlement, concurrent-panel invalidation, selective-abort entropy handling,
stale game authorization, reward/rating farming paths, unsafe frontend transaction
races, and deployment-verifier poisoning gaps.

No remaining Critical or High code vulnerability was confirmed in the final
reviewed paths. That conclusion is conditional on a completely fresh deployment
through the canonical migration and a successful finalized-block verifier run.
It is not approval for a permissionless mainnet launch with material funds.

## 2. Architecture and attack surface

- `ChessFactory` creates canonical EIP-1167 `ChessCore` clones and registers each
  game with bonding, dispute, rating, and reward modules.
- `ChessCore` owns game state and consumes one canonical whole-game dispute verdict
  for prizes, bonds, rating, and rewards.
- `DisputeDAO` and `ArbitratorRegistry` implement participant-funded, FIFO,
  future-entropy, stake-weighted commit/reveal arbitration.
- `RewardPool` and `PlayerRating` accept reports only from games that remain members
  of the currently configured canonical factory.
- `ChessGovernor` and `ChessTimelock` become the administrative boundary after
  handoff. `FAUCET_SIGNER`, `ORACLE_UPDATER`, the treasury, keepers, and the Base
  sequencer remain operational trust boundaries.
- The SvelteKit client signs state-changing transactions and stores sensitive vote
  reveal material locally. Route, chain, account, bytecode, and canonical-link
  changes are therefore security-relevant.

## 3. Finding summary

| ID | Original risk | CWE / OWASP | Status | Confidence |
|---|---|---|---|---|
| R2-01 | Critical — challenger-selected accused player could bias adjudication and settlement | CWE-840 / OWASP A04 | Closed | High |
| R2-02 | High — concurrent disputes and mutable selection snapshots enabled liveness vetoes | CWE-362 / OWASP A04 | Closed | High |
| R2-03 | High — entropy retry/selective abort and unbounded panel recovery | CWE-330, CWE-400 / OWASP A04 | Closed | High |
| R2-04 | High — stale or spoofed game authorization could write ratings/rewards | CWE-863 / OWASP A01 | Closed | High |
| R2-05 | High/Medium — Sybil, replay, and collusion paths in reward issuance | CWE-294, CWE-799 / OWASP A04, A07 | Closed | High |
| R2-06 | Medium — commit-secret loss and stale frontend transaction context | CWE-362 / OWASP A04 | Closed | High |
| R2-07 | High — deployment output/topology checks did not authenticate the deployed release | CWE-345 / OWASP A08 | Closed | High |
| R2-08 | High — temporary deployment privileges could leave hidden poisoned release state | CWE-284 / OWASP A01 | Closed | High |

## 4. Detailed assessment

### R2-01 — Whole-game adjudication and canonical settlement

`challenge(uint256)` is participant-only and no longer accepts an accused player.
The panel chooses `Legit`, `WhiteCheat`, or `BlackCheat`; the same decision drives
bond slashing, prize entitlement, rating, and reward reporting. A cheating
challenger cannot receive challenger compensation. Regressions cover both sides,
draws, terminal moves, and downstream settlement consistency.

- **Evidence:** `ethereum/contracts/DAO/DisputeDAO.sol:48,356` and
  `ethereum/contracts/Chess/ChessCore.sol:390-543,1290`.
- **Original attack:** either participant could select the accused side and obtain
  economically inconsistent outcomes after a legitimate terminal game.
- **CIA / likelihood before remediation:** confidentiality low, integrity critical,
  availability high; exploitation likelihood high for any funded participant.
- **Fix / regression:** a single side-specific verdict is consumed by all
  settlement paths; `ethereum/test/TestDisputeDAO.js` and
  `ethereum/test/TestIntegration.js` exercise both sides and downstream settlement.

### R2-02 — Arbitration concurrency and FIFO liveness

Production policy is snapshotted atomically when Black joins and both game bonds
are locked. Selection is FIFO: only the head obtains a population snapshot and
future target block, while the registry mutation lock prevents last-look stake or
tier changes. One stake position cannot support concurrent panels. Promoted
disputes receive a fresh activation window, and the client exposes the required
permissionless head activation before finalization. Structural insufficiency
enters `Unresolved` immediately and advances the queue.

- **Evidence:** `ethereum/contracts/DAO/DisputeDAO.sol:502-543,1012-1111` and
  `ethereum/contracts/DAO/ArbitratorRegistry.sol:168,372-399,1179-1205`.
- **Original attack:** a selected candidate or concurrent dispute could invalidate
  eligibility and hold another participant's bonds, prize, and deposit.
- **CIA / likelihood before remediation:** confidentiality low, integrity high,
  availability high; likelihood medium under concurrent disputes.
- **Fix / regression:** FIFO sequencing, mutation locking, assignment reservation,
  promoted-head activation, and structural backstop are covered by
  `ethereum/test/TestDisputeDAO.js`, `ethereum/test/TestArbitratorRegistry.js`, and
  frontend dispute-action tests.

### R2-03 — Future entropy and bounded recovery

The first transaction commits a future block before its hash is visible.
`finalizePanel` captures and consumes that hash atomically with deterministic
selection. Refresh is bounded to an expired blockhash during the seven-day
recovery window; after timeout, `markPanelUnavailable` also waits until committed
entropy is unrecoverable. No failure path silently confirms the provisional game
result.

- **Evidence:** `ethereum/contracts/DAO/DisputeDAO.sol:459-495,553-616,1075-1085`.
- **Original attack:** a caller could inspect or selectively abandon entropy and
  retry selection, biasing the panel or indefinitely extending recovery.
- **CIA / likelihood before remediation:** confidentiality low, integrity high,
  availability high; likelihood medium for a motivated challenger or keeper.
- **Fix / regression:** deterministic future-block selection, snapshot consistency,
  bounded refresh, and unavailable-panel cases are covered by
  `ethereum/test/TestDisputeDAO.js`.

### R2-04 — Canonical rating and reward authorization

Local registration is insufficient: callers must still be canonical members of
the current factory. Rating registration binds the game identity, while economic
rewards exclude non-eligible and non-qualifying games.

- **Evidence:** `ethereum/contracts/Rating/PlayerRating.sol:105-134,203-260` and
  `ethereum/contracts/Token/RewardPool.sol:155-160,487-526`.
- **Original attack:** a stale locally registered or spoofed game could continue
  writing economically relevant ratings and rewards after the factory changed.
- **CIA / likelihood before remediation:** confidentiality low, integrity high,
  availability low; likelihood high because a stale authorization was sufficient.
- **Fix / regression:** authorization is rechecked against the current factory at
  use time; `ethereum/test/TestPlayerRating.js`, `ethereum/test/TestRewardPool.js`,
  and `ethereum/test/TestIntegration.js` cover factory replacement and settlement.

### R2-05 — Reward replay, Sybil, and farming resistance

Faucet and reward-eligibility signatures bind purpose, pool, chain, beneficiary,
epoch, nonce, and deadline. Daily global ceilings bound signer compromise;
repeated opponents have a bidirectional cooldown and reward processing is
one-shot. Rating no longer provides a permissionless economic multiplier.

- **Evidence:** `ethereum/contracts/Token/RewardPool.sol:75-86,160-188,258-554`.
- **Original attack:** replayed authorizations, cheap accounts, or repeated
  attacker-controlled pairs could drain the faucet or game-reward capacity.
- **CIA / likelihood before remediation:** confidentiality low, integrity high,
  availability medium; likelihood high because accounts and games are cheap.
- **Fix / regression:** distinct v2 domains, expiry/epoch/nonces, eligibility,
  daily caps, pair cooldown, and one-shot processing are covered by
  `ethereum/test/TestRewardPool.js` and `ethereum/test/TestIntegration.js`.

### R2-06 — Frontend transaction and secret handling

Frontend writes bind chain, account, route, bytecode, factory membership, and
mutual protocol links, then recheck them after transaction population and before
broadcast. Governance calls also bind exact target, value, and calldata. Vote/salt
material is persisted before wallet interaction; ambiguous broadcasts and shallow
reorgs retain the same secret and commitment instead of guessing from nonce or
receipt state.

- **Evidence:** `frontend/src/lib/utils/disputeVerification.js:254-281,515-535`,
  `frontend/src/lib/utils/voteCommit.js:177-254`, and
  `frontend/src/lib/components/DisputePanel.svelte:642-847`.
- **Original attack/failure:** account, route, chain, or canonical-link changes
  during an asynchronous wallet flow could redirect a write; ambiguous broadcast
  handling could replace or lose the only reveal secret.
- **CIA / likelihood before remediation:** confidentiality medium, integrity high,
  availability medium; likelihood medium in ordinary wallet/provider failure modes.
- **Fix / regression:** post-population context checks and idempotent v4
  backup/reconciliation are covered by
  `frontend/test/disputeVerification.test.js`, `frontend/test/voteCommit.test.js`,
  and `frontend/test/governanceSecurity.test.js`.

### R2-07 — Deployment authenticity

Public verification requires an independently supplied SHA-256 of the exact
deployment manifest and independent anchors for team, treasury, faucet signer, and
oracle updater. All reads and log scans use one finalized block, whose canonical
hash is checked again before success.

The verifier authenticates creation receipts, deployer, constructor arguments,
linked initcode, deployed runtime, and canonical clone target.

- **Evidence:** `ethereum/scripts/verify-deployment.js:175-245,576-589,701-882`
  and `ethereum/scripts/deployment-verification-policy.js:53-270`.
- **Original attack:** a modified manifest, mismatched linked bytecode, constructor
  input, or proxy target could pass a shallow address/topology check and be
  presented as the reviewed release.
- **CIA / likelihood before remediation:** confidentiality medium, integrity
  critical, availability high; likelihood medium in a compromised or mistaken
  deployment workflow.
- **Fix / regression:** authenticated provenance/initcode/runtime, clone target,
  independent digest, and finalized-block pinning are covered by the deployment
  tests and the real governance-handoff run.

### R2-08 — Privilege history and clean release genesis

The verifier reconstructs role history and exact final membership; rejects
timelock schedules and Governor proposals; and requires a clean
factory/dispute/registry/rating/reward/bonding genesis. Oracle timestamps must
equal the authenticated BondingManager creation block, material price history and
reward activity must be empty, and treasury governance state must be pristine.
Principal-scoped event filtering ignores unrelated token holders so a public
account cannot grief verification.

- **Evidence:** `ethereum/scripts/verify-deployment.js:246-325,475-589` and
  `ethereum/scripts/deployment-verification-policy.js:383-558`.
- **Original attack:** temporary privilege, a hidden operational transition, or a
  pending governance operation could be removed from final state while leaving a
  poisoned deployment that passed a final-topology-only check.
- **CIA / likelihood before remediation:** confidentiality medium, integrity
  critical, availability high; likelihood medium for a compromised deployer.
- **Fix / regression:** exact current/historical authorization, clean genesis,
  creation-time oracle binding, and principal-scoped event checks are covered by
  the deployment tests and the real governance-handoff run.

### Cross-cutting verification evidence

Checks were serialized on a memory-constrained development machine:

- pinned `solc 0.8.24` / `viaIR` compilation: passed for 32 contracts;
- EIP-170 gate: passed; `ChessCore` is 23,413 bytes with 1,163 bytes headroom;
- contract regressions: 459/459 passed in four fresh batches
  (`124 + 60 + 133 + 142`);
- deployment/preflight/verifier tests: 50/50 passed;
- real local migration, release verifier, exact-role verifier, and governance
  handoff: passed;
- frontend tests: 93/93 passed, including the promoted FIFO-head activation path;
- SvelteKit production build: passed;
- ABI extraction: deterministic across 10 artifacts.
- frontend `npm audit --audit-level=high`: passed the CI threshold; the registry
  reported 17 Low/Moderate advisories and no High/Critical advisory;
- Ethereum/tooling `npm audit --omit=dev`: failed with 60 advisories (3 Critical,
  17 High). These packages execute in the local compile/deployment toolchain, not
  in deployed EVM runtime, but remain unsafe to expose directly to a valuable
  mnemonic without isolation or replacement.

No public RPC, production deployment, or real credential was used. External
network access was limited to the npm advisory registry for the dependency checks.

## 5. Prioritized remediation plan

### Immediate — before any public deployment

- Create a completely fresh, non-material Base Sepolia deployment through the
  canonical migration; do not reuse or upgrade a prior deployment.
- Independently reproduce the deployment-manifest digest, finalized-block verifier
  output, exact role topology, and treasury multisig configuration.
- Exercise keeper activation/finalization, oracle failure and reset, dispute
  timeout/backstop, RPC failover, and governance emergency runbooks.

### Short term — before mainnet consideration

- Commission an independent third-party contract audit against the final commit.
- Replace or strongly isolate the vulnerable Truffle/HDWalletProvider/solc
  deployment dependency tree before any valuable mnemonic is present.
- Run a public testnet bug bounty or adversarial test period with FIFO congestion
  and panel-capacity scenarios.
- Complete soak monitoring and explicitly accept the residual trust, liveness, and
  sequencer assumptions listed below.

### Subsequent hardening

- Authenticate and monitor the deployed frontend factory root, gateway CSP,
  framing, referrer, and transport headers.
- Add dedicated operator UI/runbooks for stake activation, keeper actions, rating
  retry, circuit-breaker reset, and dispute backstop.
- Keep bytecode-size monitoring mandatory; `ChessCore` has only 1,163 bytes of
  EIP-170 headroom.
- Treat browser vote backups as secrets and define an explicit finality/cleanup
  policy.

## 6. Audit limitations and non-verifiable areas

This review is repository- and local-execution-based. It did not test a public
RPC, deployed Base bytecode, production gateway headers, real operator key custody,
multisig owners/threshold, monitoring, incident response, or undisclosed offline
signatures. It is not formal verification and cannot establish that an arbitrator
majority will vote truthfully. Dependency results are a dated registry snapshot;
they do not prove that an unreported package or build host is uncompromised.

### Residual architectural and operational risks

- Arbitration is a stake-weighted Schelling system, not objective proof. A
  colluding or whale-controlled voting majority can return a wrong verdict.
- Future Base block hashes are not VRF. Sequencer censorship, keeper failure, and
  limited entropy influence remain possible.
- FIFO bounds concurrency conflicts but creates queue contention. Coordinated,
  funded participants can delay later disputes; transient panel depletion can lock
  funds until the seven-day backstop.
- `Unresolved` cases require a subjective timelocked decision and retain bonds,
  prize funds, and challenge deposits until governance acts.
- The faucet signer and oracle updater remain trusted services. Daily caps and
  circuit breakers bound impact but do not remove that trust.
- The treasury must be a separately controlled multisig verified out of band.
  On-chain code cannot prove its human owners, signing threshold, endpoint
  security, or absence of undisclosed offline permit signatures.

### Examined and rejected false positives

- Stale local game mappings alone are not authorization: current canonical factory
  membership is rechecked at use time.
- Truffle's missing `linkReferences` metadata is not accepted by masking bytes; the
  verifier resolves only the exact named legacy placeholder to the manifest-bound
  library and still compares complete initcode/runtime.
- A global ban on token `Approval`/`DelegateChanged` events would be publicly
  griefable. The final verifier filters only the indexed treasury principal.

## 7. Conclusion and release decision

The remediation release gate for the confirmed code findings is satisfied. The
appropriate next step is the fresh, non-material Base Sepolia process in the plan
above. No confirmed Critical or High code vulnerability remains in the reviewed
paths, but this is not a mainnet approval. Until the external audit, independent
deployment reproduction, multisig verification, adversarial test period, and
operational drills are complete, use Base Sepolia with non-material value only.
