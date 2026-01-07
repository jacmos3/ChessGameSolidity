# Solidity Chess - User Guide

Welcome to Solidity Chess, a decentralized chess platform where you can play, earn, and participate in governance.

## Table of Contents

1. [Getting Started](#getting-started)
2. [Connecting Your Wallet](#connecting-your-wallet)
3. [Understanding the Bond System](#understanding-the-bond-system)
4. [Playing Chess](#playing-chess)
5. [ELO Rating System](#elo-rating-system)
6. [Dispute Resolution](#dispute-resolution)
7. [Becoming an Arbitrator](#becoming-an-arbitrator)
8. [Governance](#governance)
9. [FAQ](#faq)

---

## Getting Started

### What You Need

1. **MetaMask** or any Web3 wallet
2. **ETH** for gas fees and game stakes
3. **CHESS tokens** for bonding (anti-cheating collateral)

### Supported Networks

- Ethereum Mainnet
- Sepolia Testnet
- Holesky Testnet
- Linea Sepolia

---

## Connecting Your Wallet

1. Click **"Connect Wallet"** in the top right corner
2. Select MetaMask (or your preferred wallet)
3. Approve the connection request
4. Make sure you're on a supported network

Once connected, you'll see your address and ETH balance in the header.

---

## Understanding the Bond System

### Why Bonds?

To prevent cheating and ensure fair play, all players must deposit a bond before playing. This bond acts as collateral - if you're caught cheating, you lose it.

### How It Works

The bond consists of two parts:
- **CHESS tokens** (3x your stake)
- **ETH** (2x your stake)

**Example:** To play a 0.1 ETH game, you need:
- 0.3 ETH worth of CHESS tokens bonded
- 0.2 ETH bonded

### Depositing Your Bond

1. Go to **Profile** page
2. Find the **"Bond Management"** section
3. Enter the amount of CHESS tokens to deposit
4. Enter the amount of ETH to deposit
5. Click **"Deposit Bond"**
6. Confirm the transaction in MetaMask

### Withdrawing Your Bond

You can withdraw any bond that isn't locked in active games:

1. Go to **Profile** > **Bond Management**
2. Enter the amounts to withdraw
3. Click **"Withdraw Bond"**
4. Confirm the transaction

> **Note:** Bonds are locked while you have active games. Complete your games first to unlock your full bond.

---

## Playing Chess

### Creating a Game

1. Go to **Lobby** page
2. Click **"Create Game"**
3. Configure your game:
   - **Stake**: Amount of ETH to bet (0.001 - 100 ETH)
   - **Time Control** (named after crypto pioneers):
     - Finney: ~1 hour per player (Hal Finney - fast)
     - Buterin: ~7 hours per player (Vitalik Buterin - medium)
     - Nakamoto: ~7 days per player (Satoshi Nakamoto - slow)
   - **Mode**:
     - Tournament: Illegal moves result in automatic loss
     - Friendly: Illegal moves are rejected, you can try again
4. Click **"Create Game"**
5. Confirm the transaction (this deposits your stake)

### Joining a Game

1. Browse available games in the **Lobby** or **Home** page
2. Click on a game you want to join
3. Click **"Join as Black"**
4. Confirm the transaction (this deposits your matching stake)
5. The game begins immediately!

### Making Moves

- **Click** on a piece to select it
- **Click** on a valid destination square to move
- Or **drag and drop** pieces
- Valid moves are highlighted in green

### Special Moves

- **Castling**: Move the King two squares toward the Rook
- **En Passant**: Capture a pawn that just moved two squares
- **Pawn Promotion**: When your pawn reaches the opposite end, choose a piece to promote to

### Game Controls

| Action | How |
|--------|-----|
| Resign | Click "Resign" button |
| Offer Draw | Click "Offer Draw" |
| Accept Draw | Click "Accept" when opponent offers |
| Decline Draw | Click "Decline" or make a move |
| Claim Victory by Timeout | Click "Claim Victory" when opponent times out |

### Claiming Your Prize

After winning:
1. A 48-hour challenge window begins
2. If no dispute is raised, click **"Claim Prize"**
3. You receive your stake + opponent's stake

---

## ELO Rating System

### How ELO Works

Your ELO rating reflects your skill level:

| Rating | Level |
|--------|-------|
| < 1000 | Beginner |
| 1000-1200 | Casual |
| 1200-1400 | Intermediate |
| 1400-1600 | Club Player |
| 1600-1800 | Strong Club |
| 1800-2000 | Expert |
| 2000-2200 | Candidate Master |
| 2200+ | Master |

### Starting Rating

All players start at **1200 ELO**.

### Rating Changes

- **Win**: Your rating increases
- **Loss**: Your rating decreases
- **Draw**: Ratings adjust toward equilibrium

The amount of change depends on:
- The difference between your ratings
- Your experience level (K-factor)

### K-Factor

| Games Played | K-Factor | Rating Volatility |
|--------------|----------|-------------------|
| < 30 games | K=40 | High (faster changes) |
| 30+ games | K=20 | Normal |
| 2400+ rating | K=10 | Low (stable rating) |

### Viewing Your Rating

Go to **Profile** to see:
- Current ELO rating
- Peak rating achieved
- Games played
- Win/Loss/Draw record
- Win rate percentage

### Leaderboard

View the global leaderboard to see top-rated players!

---

## Dispute Resolution

### What is a Dispute?

If you suspect your opponent cheated (used an engine, exploited a bug, etc.), you can challenge the game result.

### Challenge Window

After a game ends, there's a **48-hour window** to raise a dispute. After this window closes, the result is final.

### How to Challenge

1. Go to the completed game
2. Click **"Challenge Result"**
3. Deposit the challenge fee (50 CHESS)
4. Provide evidence/explanation

### The Voting Process

1. **Arbitrators are selected** from the registry
2. **Commit Phase**: Arbitrators submit encrypted votes
3. **Reveal Phase**: Arbitrators reveal their votes
4. **Resolution**: Majority decision wins

### Outcomes

**If cheating is confirmed:**
- Cheater loses their bond (slashed)
- Challenger gets 50% of the slashed bond
- Game result is reversed

**If cheating is NOT confirmed:**
- Challenger loses their challenge deposit
- Original result stands

### Escalation

If the initial vote is too close, the dispute can escalate:
- **Level 1**: 5 arbitrators
- **Level 2**: 11 arbitrators
- **Level 3**: 21 arbitrators

---

## Becoming an Arbitrator

### Why Become an Arbitrator?

- Earn rewards for voting honestly
- Help maintain fair play
- Participate in governance

### Requirements

| Tier | Minimum Stake | Max Games/Week |
|------|---------------|----------------|
| Tier 1 | 1,000 CHESS | 5 disputes |
| Tier 2 | 5,000 CHESS | 10 disputes |
| Tier 3 | 20,000 CHESS | 20 disputes |

### How to Register

1. Go to **Profile** > **Arbitrator Panel**
2. Enter your stake amount
3. Click **"Stake & Register"**
4. Confirm the transaction

### Timelock

After staking, you must wait **7 days** before you can vote. This prevents flash loan attacks.

### Reputation System

- Start with **100 reputation**
- Vote with majority: +5 reputation
- Vote against majority: -10 reputation
- Below 50 reputation: Removed from pool
- Maximum reputation: 200

### Earning Rewards

When you vote:
- On the winning side: Share of the dispute fee
- Consistent honest voting: Higher reputation = higher selection chance

### Exclusions

You cannot arbitrate games where:
- You are one of the players
- You played against either player in the last 30 days

---

## Governance

### CHESS Token

The CHESS token is used for:
- Bonding (anti-cheat collateral)
- Arbitrator staking
- Governance voting
- Rewards

### Voting Power

Your voting power equals your CHESS token balance (including staked tokens).

### Creating Proposals

To create a proposal, you need at least **100,000 CHESS** (0.1% of supply).

Proposals can change:
- Bond requirements
- Dispute parameters
- Fee structures
- System upgrades

### Voting on Proposals

1. Go to **Profile** > **Governance Panel**
2. View active proposals
3. Click on a proposal to see details
4. Vote **For**, **Against**, or **Abstain**
5. Confirm your vote

### Proposal Lifecycle

1. **Pending**: 1-day delay before voting starts
2. **Active**: 5-day voting period
3. **Succeeded**: Reached quorum (4%) and majority
4. **Queued**: 2-day timelock before execution
5. **Executed**: Changes take effect

---

## FAQ

### General

**Q: Is my money safe?**
A: Funds are held in audited smart contracts. However, like all DeFi, there are risks. Only play with what you can afford to lose.

**Q: What happens if I disconnect mid-game?**
A: The game continues on-chain. Reconnect with the same wallet to resume. If you don't move within the time limit, your opponent can claim victory.

**Q: Can I play multiple games at once?**
A: Yes! Each game is independent. Just make sure you have enough bond for all active games.

### Bonds

**Q: Why do I need both CHESS and ETH?**
A: The hybrid bond prevents attackers from using only one asset to manipulate the system.

**Q: What if CHESS price changes?**
A: Bond requirements are calculated at game creation using a time-weighted average price (TWAP).

**Q: Can I lose my bond if I lose fairly?**
A: No! You only lose your bond if you're caught cheating and lose a dispute.

### Games

**Q: How are moves validated?**
A: All chess rules are implemented on-chain in Solidity. Invalid moves are rejected by the smart contract.

**Q: What's the difference between Tournament and Friendly mode?**
A: In Tournament mode, an illegal move (like moving into check) results in automatic loss. In Friendly mode, illegal moves are simply rejected.

**Q: Can games end in a draw?**
A: Yes! Draws can happen by:
- Mutual agreement
- Threefold repetition (same position 3 times)
- 50-move rule (50 moves without capture or pawn move)
- Stalemate

### Disputes

**Q: How long do I have to challenge?**
A: 48 hours after the game ends.

**Q: What if arbitrators are corrupt?**
A: Multiple safeguards exist:
- Random selection from large pools
- Commit-reveal voting prevents coordination
- Reputation system punishes dishonest voting
- Multi-level escalation for close calls

**Q: Can I see who voted against me?**
A: Votes are revealed after the reveal phase, but arbitrator identities are pseudonymous (wallet addresses only).

### Technical

**Q: Why are gas fees high?**
A: Chess logic is complex. We've optimized where possible, but on-chain validation has costs. Consider playing on L2 solutions when available.

**Q: What if the transaction fails?**
A: Check your gas limit and try again. If a move fails, the game state remains unchanged.

**Q: Can I use a hardware wallet?**
A: Yes! Any Web3-compatible wallet works with Solidity Chess.

---

## Need Help?

- **GitHub Issues**: Report bugs or suggest features
- **Discord**: Join our community for support
- **Twitter**: Follow us for updates

---

*Last updated: January 2026*
