# Solidity Chess - Decentralized Chess on Ethereum

A fully on-chain chess game with integrated anti-cheating mechanisms, tokenomics, and decentralized governance.

![Solidity](https://img.shields.io/badge/Solidity-0.8.24-blue)
![License](https://img.shields.io/badge/License-MIT-green)
![Tests](https://img.shields.io/badge/Tests-272%20passing-brightgreen)

## Overview

Solidity Chess is a complete decentralized chess platform where:
- Every move is validated and stored on-chain
- Players stake ETH + CHESS tokens as collateral
- Disputes are resolved by decentralized arbitrators
- Governance is handled by token holders

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    GOVERNANCE LAYER                          │
│         ChessGovernor + ChessTimelock (2-day delay)         │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│                 ECONOMIC LAYER                               │
│  ChessToken (ERC20) │ BondingManager │ ArbitratorRegistry   │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│               DISPUTE RESOLUTION                             │
│     DisputeDAO (Commit-Reveal Voting, 3-Level Escalation)   │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│                      GAME LAYER                              │
│  ChessFactory (EIP-1167) → ChessCore → PlayerRating (ELO)   │
└─────────────────────────────────────────────────────────────┘
```

## Features

### Core Game
- Complete chess rules implementation (1,386 lines of Solidity)
- All special moves: castling, en passant, pawn promotion
- Check, checkmate, and stalemate detection
- Threefold repetition and 50-move rule
- Three time controls: Finney (~1h), Buterin (~7h), Nakamoto (~7d)
- Tournament and Friendly game modes

### Anti-Cheating System
- **Hybrid Bonding**: Players must stake both CHESS tokens and ETH
- **Commit-Reveal Voting**: Prevents arbitrator collusion
- **3-Level Escalation**: Disputes can escalate with more arbitrators
- **Reputation System**: Arbitrators build reputation through honest voting
- **Slashing**: Cheaters lose their staked collateral

### Tokenomics ($CHESS)
- **Total Supply**: 100,000,000 CHESS
- **Distribution**:
  - Play-to-Earn: 40% (40M)
  - Treasury: 25% (25M)
  - Team: 15% (15M) - 2-year vesting
  - Liquidity: 10% (10M)
  - Community: 10% (10M)

### Governance
- Token-weighted voting via ChessGovernor
- 2-day timelock for execution
- 4% quorum requirement
- Governable parameters: fees, bond requirements, dispute rules

### ELO Rating System
- Standard ELO algorithm with adaptive K-factor
- K=40 for new players (< 30 games)
- K=20 for established players
- K=10 for high-rated players (2400+)
- On-chain leaderboard

## Smart Contracts

| Contract | Description | Gas (Deploy) |
|----------|-------------|--------------|
| ChessCore | Game logic, move validation | 4.9M (impl) |
| ChessFactory | Creates game instances (EIP-1167) | 1.87M |
| ChessToken | ERC20 with governance | 2.77M |
| BondingManager | Hybrid bond management | 1.45M |
| DisputeDAO | Decentralized dispute resolution | 2.14M |
| ArbitratorRegistry | Arbitrator staking & selection | 1.75M |
| PlayerRating | ELO rating system | 1.12M |
| ChessGovernor | On-chain governance | 3.46M |

## Getting Started

### Prerequisites
- Node.js 16+
- Truffle or Hardhat
- Ganache (for local development)
- MetaMask

### Installation

```bash
# Clone repository
git clone https://github.com/yourusername/solidity-chess.git
cd solidity-chess

# Install dependencies
cd ethereum && npm install
cd ../frontend && npm install
```

### Local Development

```bash
# Start Ganache (in separate terminal)
ganache --port 7545

# Deploy contracts
cd ethereum
npx truffle migrate --reset

# Setup test accounts with CHESS tokens and bonds (optional)
npx truffle exec scripts/setup-test-accounts.js

# Start frontend
cd ../frontend
npm run dev
```

Open http://localhost:3000 in your browser.

### Running Tests

```bash
cd ethereum
npx truffle test

# With gas reporting
REPORT_GAS=true npx truffle test
```

## Project Structure

```
solidity-chess/
├── ethereum/
│   ├── contracts/
│   │   ├── Chess/
│   │   │   ├── ChessCore.sol      # Main game logic
│   │   │   ├── ChessBoard.sol     # Board state
│   │   │   ├── ChessFactory.sol   # Game factory (EIP-1167)
│   │   │   ├── ChessNFT.sol       # Game NFTs
│   │   │   └── ChessMediaLibrary.sol
│   │   ├── Token/
│   │   │   ├── ChessToken.sol     # ERC20 governance token
│   │   │   └── BondingManager.sol # Hybrid bond management
│   │   ├── DAO/
│   │   │   ├── DisputeDAO.sol     # Dispute resolution
│   │   │   └── ArbitratorRegistry.sol
│   │   ├── Governance/
│   │   │   ├── ChessGovernor.sol
│   │   │   └── ChessTimelock.sol
│   │   └── Rating/
│   │       └── PlayerRating.sol   # ELO system
│   ├── test/                      # 272 test cases
│   ├── migrations/
│   ├── scripts/
│   └── deployments/
├── frontend/
│   ├── src/
│   │   ├── lib/
│   │   │   ├── components/        # Svelte components
│   │   │   ├── stores/            # State management
│   │   │   └── contracts/         # ABIs
│   │   └── routes/                # SvelteKit pages
│   └── static/
└── docs/
    ├── ANTI_CHEATING_TOKENOMICS.md
    ├── VULNERABILITIES_MITIGATIONS.md
    └── USER_GUIDE.md
```

## Gas Optimization

The project uses several gas optimization techniques:

1. **EIP-1167 Minimal Proxy**: Game instances are clones, reducing deployment from ~5.3M to ~626K gas
2. **Storage Packing**: Multiple variables packed into single 32-byte slots
3. **Batch Operations**: `lockBondsForGame()` locks both players in one call
4. **Optimized Compiler**: Solidity 0.8.24 with viaIR and optimizer (runs=1)

| Operation | Gas Cost |
|-----------|----------|
| Create Game | ~626K |
| Join Game | ~135K-395K |
| Make Move | ~200K-500K |

## Security Considerations

### Implemented Protections
- ReentrancyGuard on all fund-moving functions
- Role-based access control (OpenZeppelin)
- 7-day timelock before arbitrator voting power activates
- Circuit breaker for extreme price movements
- Commit-reveal to prevent front-running

### Known Limitations
- Arbitrator selection uses keccak256 (recommend Chainlink VRF for production)
- TWAP oracle is simplified (recommend Uniswap/Chainlink integration)
- Not formally audited yet

## API Reference

### ChessFactory

```solidity
// Create a new game
function createChessGame(
    uint8 _timeoutPreset,  // 0=Finney, 1=Buterin, 2=Nakamoto
    uint8 _gameMode        // 0=Tournament, 1=Friendly
) external payable returns (address);

// Get all deployed games
function getDeployedChessGames() external view returns (address[] memory);
```

### ChessCore

```solidity
// Join as black player
function joinGameAsBlack() external payable;

// Make a move (coordinates 0-7)
function makeMove(uint8 startX, uint8 startY, uint8 endX, uint8 endY) external;

// With pawn promotion
function makeMoveWithPromotion(
    uint8 startX, uint8 startY,
    uint8 endX, uint8 endY,
    int8 promotionPiece  // 5=Queen, 4=Rook, 3=Bishop, 2=Knight
) external;

// Resign the game
function resign() external;

// Claim prize after winning
function claimPrize() external;

// Draw operations
function offerDraw() external;
function acceptDraw() external;
function claimDrawByRepetition() external;
function claimDrawByFiftyMoveRule() external;
```

### BondingManager

```solidity
// Deposit bond (CHESS + ETH)
function depositBond(uint256 chessAmount) external payable;

// Withdraw available bond
function withdrawBond(uint256 chessAmount, uint256 ethAmount) external;

// Check bond sufficiency
function hasSufficientBond(address user, uint256 stake) external view returns (bool);
```

## Events

```solidity
// Game events
event GameStarted(address indexed whitePlayer, address indexed blackPlayer, uint256 betAmount);
event MoveMade(address indexed player, uint8 fromRow, uint8 fromCol, uint8 toRow, uint8 toCol, ...);
event GameStateChanged(GameState newState);
event PlayerResigned(address player, address winner);
event PrizeClaimed(address winner, uint256 amount);

// Draw events
event DrawOffered(address indexed player);
event DrawAccepted();
event DrawByRepetition(address indexed claimant);
event DrawByFiftyMoveRule(address indexed claimant);
```

## Frontend Stack

- **Framework**: SvelteKit 1.30.4
- **Styling**: Tailwind CSS 3.4.0
- **Web3**: ethers.js 5.7.2
- **Chess Logic**: chess.js 1.0.0

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Run tests (`npx truffle test`)
4. Commit your changes (`git commit -m 'Add amazing feature'`)
5. Push to the branch (`git push origin feature/amazing-feature`)
6. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [OpenZeppelin](https://openzeppelin.com/) for secure contract libraries
- [Lichess](https://lichess.org/) for open-source sound effects
- Chess.js for move validation reference

---

**Disclaimer**: This software is provided "as is" without warranty. Use at your own risk. Smart contracts have not been formally audited for production use.
