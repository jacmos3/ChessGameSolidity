# Legacy snapshots

> **Frozen historical material:** nothing in this directory is supported for production or Base mainnet use. See [`../docs/ARCHIVE_NOTICE.md`](../docs/ARCHIVE_NOTICE.md).

Nothing in this directory is part of the supported build or deployment path.

- `deploy-app/` is the historical browser deployment helper.
- `flattened/` contains stale Remix-oriented contract snapshots.
- `ethereum-scripts/` contains the superseded standalone compiler, deployer, Web3 bootstrap, and browser-artifact extractor.

These files are retained only for historical reference. They do not include the current role wiring, governance handoff, faucet authorization, timeout semantics, or contract interfaces. Do not use them to deploy the protocol.

The archived protocol contracts are in `ethereum/contracts/`. Local development and experimental Base Sepolia migrations use `ethereum/migrations/`; no Base mainnet deployment path is supported.
