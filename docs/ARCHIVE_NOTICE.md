# Protocol-lab archive notice

This repository is a frozen historical baseline of the original MyChess.onchain / Solidity Chess protocol.

## Operational status

- Base mainnet deployment is disabled. The `base` Truffle profile, preflight command, mainnet RPC variable, and frontend chain `8453` configuration have been removed.
- Base Sepolia (`84532`) remains available only as an experimental, non-material laboratory target.
- Local development and historical verification remain available for research and migration work.
- Existing contracts, tests, reports, and Git history are retained as evidence of the former design. Their presence does not make them a supported product or deployment path.
- No contract in this repository has been approved for production deployment or custody of material user value.
- The frozen Truffle/Web3 deployment toolchain has known high- and critical-severity dependency advisories. It is retained for historical reproducibility only: do not expose it to untrusted input or load production keys into it.

Do not restore a production network by copying the removed configuration. A future product must use a separately reviewed architecture, deployment process, frontend configuration, and legal/security assessment.

This notice describes repository policy; it is not a legal opinion or certification of regulatory compliance.
