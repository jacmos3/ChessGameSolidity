# Project Agent Instructions

## Existing work

- Treat every existing modification as user or prior-agent work unless provenance is certain.
- Inspect `git status` and the relevant diff before editing. Never discard, rewrite, or revert unrelated changes.
- When resuming interrupted work, inspect the prior thread or summary when available, identify completed work, and continue instead of restarting.

## Manager policy

- The primary agent is the manager. Do not create a redundant manager subagent.
- Do not delegate small, clear, sequential tasks. Delegate only bounded independent work or noisy read-heavy investigation that would pollute the primary context.
- Start with the cheapest adequate profile. Escalate model or reasoning only when unresolved ambiguity, risk, or failed validation justifies it.
- Keep at most three subagents active. Parallelize only lightweight read-only work; serialize edits, builds, test suites, browser automation, simulators, and local chains.
- Never assign overlapping write scopes. Wait for implementation to finish before starting verification.
- Require concise subagent results containing conclusions, evidence, file references, residual risks, and the next action. Do not forward raw logs into the primary thread.
- Specialized subagents must not spawn descendants unless the user explicitly requests deeper delegation.

## Routing

- Use `scout` for targeted file discovery, execution-path mapping, prior-work inspection, and log triage.
- Use `reviewer` for correctness, security, regression, and missing-test analysis.
- Use `contract_auditor` for Solidity, authorization, protocol invariants, dispute logic, liveness, and economic security.
- Use `worker` for one bounded implementation after the relevant behavior is understood.
- Use `verifier` for focused validation after edits are complete.
- For a complex change, prefer `scout` or `reviewer`, then one `worker`, then `verifier`; do not run these write or verification phases concurrently.

## Resource safety

- This machine has 8 GB of RAM. Serialize memory-intensive operations.
- Prefer `rg -I` restricted to relevant text source and configuration files. Never run an unrestricted multithreaded `git grep` for broad or secret scanning.
- If `git grep` is necessary, use `--threads=1 -I` and exclude dependencies, generated files, build artifacts, images, and media.
- If a command reaches its timeout, do not assume it stopped. Check the exact process and terminate only that orphan before continuing.
- Never start a heavy operation while an earlier git, build, browser, test, simulator, or local-chain process may still be running.
