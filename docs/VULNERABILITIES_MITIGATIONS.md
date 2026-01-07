# Vulnerabilita e Mitigazioni - Sistema Anti-Cheating

## Analisi delle Vulnerabilita

### Critiche (Potrebbero rompere il sistema)

#### 1. Collusion Ring Attack
**Descrizione:** Un gruppo di arbitri si mette d'accordo off-chain per votare sempre in un certo modo, manipolando le dispute.

**Scenario:** 10 arbitri creano un gruppo Telegram. Quando uno di loro bara, gli altri votano LEGIT. Quando un outsider bara, votano CHEAT solo se pagato.

**Impatto:** Distrugge la fiducia nel sistema di arbitraggio.

---

#### 2. Arbitro-Cheater Collusion
**Descrizione:** Un cheater diventa anche arbitro con multipli account, votando sulle proprie dispute.

**Scenario:** Alice ha 5 account arbitro. Bara con account6, poi i suoi 5 arbitri votano LEGIT.

**Impatto:** Self-protection garantita per chi ha abbastanza stake.

---

#### 3. Flash Loan Attack sulla Governance
**Descrizione:** Attaccante prende flash loan di $CHESS, vota su parametri critici, ripaga nel stesso blocco.

**Scenario:** Flash loan 10M $CHESS, vota per ridurre BOND_RATIO da 5x a 0.1x, bara in tutte le partite, ripaga loan.

**Impatto:** Manipolazione dei parametri di sicurezza.

---

#### 4. Token Price Manipulation
**Descrizione:** Se il bond e in $CHESS e il prezzo crolla, il costo reale del bond diventa trascurabile.

**Scenario:** Attaccante shorta $CHESS, fa dump sul mercato, il bond da 500 $CHESS ora vale $5. Bara a costo quasi zero.

**Impatto:** Bond non ha piu valore deterrente.

---

### Gravi (Potrebbero degradare il sistema)

#### 5. Grief Challenge Attack
**Descrizione:** Spammare challenge su partite legittime per far perdere tempo e soldi agli arbitri/giocatori.

**Impatto:** UX terribile, arbitri sovraccarichi.

---

#### 6. Sybil Attack sugli Arbitri
**Descrizione:** Creare migliaia di account arbitro per aumentare probabilita di selezione.

**Impatto:** Concentrazione del potere di voto.

---

#### 7. Reputation Grinding
**Descrizione:** Costruire reputazione votando correttamente su dispute facili, poi tradire su una disputa importante.

**Impatto:** Corruzione a lungo termine.

---

#### 8. Timing Attack sulle Votazioni
**Descrizione:** Aspettare di vedere come votano altri prima di votare (se i voti sono visibili).

**Impatto:** Herding behavior, voti non indipendenti.

---

### Moderate (Potrebbero causare inefficienze)

#### 9. Information Asymmetry
**Descrizione:** Alcuni arbitri hanno strumenti migliori per analizzare partite (engine piu forti).

**Impatto:** Votazioni non uniformi.

---

#### 10. Lazy Voting
**Descrizione:** Arbitri votano random per ricevere reward senza analizzare.

**Impatto:** Decisioni di bassa qualita.

---

#### 11. Whale Intimidation
**Descrizione:** Grandi holder minacciano di dumpare se le dispute non vanno come vogliono.

**Impatto:** Centralizzazione del potere.

---

#### 12. Cross-Game Collusion
**Descrizione:** Due giocatori si accordano per dividere le vincite, alternando chi vince.

**Impatto:** Farming di reward senza skill reale.

---

## Mitigazioni Critiche

### 1. Collusion Ring - Mitigazione Completa

#### A. Commit-Reveal Voting (Schelling Point)

```
FASE 1 - COMMIT (24h):
- Arbitro vota: hash(voto + salt + arbitro_address)
- Nessuno vede i voti degli altri
- Voti sono binding

FASE 2 - REVEAL (24h):
- Arbitro rivela: voto + salt
- Sistema verifica hash
- Se non rivela entro tempo: SLASHED

RISULTATO:
- Impossibile coordinarsi in real-time
- Ogni arbitro deve votare "cosa pensa che gli altri pensino"
- Schelling Point naturale: la verita
```

**Perche funziona:**
Senza vedere i voti altrui, l'unico punto focale sicuro e votare onestamente. Se voti LEGIT su un cheater ovvio, rischi che la maggioranza voti CHEAT e perdi stake.

#### B. Selezione Multi-Livello

```
Pool Arbitri Stratificato:
Livello 1: 5 arbitri (stake 1000-5000 $CHESS)
Livello 2: 5 arbitri (stake 5000-20000 $CHESS)
Livello 3: 5 arbitri (stake 20000+ $CHESS)

- 5 arbitri scelti random da OGNI livello
- Colludere richiede controllo di tutti e 3 i livelli
- Costo collusione: stake in 3 fasce diverse
```

#### C. Arbitro Rotation con Cooldown

```
- Dopo aver votato su una disputa: 48h cooldown
- Max 5 dispute/settimana per arbitro
- Impedisce che stesso gruppo voti sempre insieme
```

---

### 2. Arbitro-Cheater Collusion - Mitigazione Completa

#### A. Self-Exclusion Automatica

```solidity
// Quando viene creata una disputa:
function createDispute(uint256 gameId) {
    address player1 = games[gameId].white;
    address player2 = games[gameId].black;

    // Escludi automaticamente:
    excludedArbitrators[disputeId].add(player1);
    excludedArbitrators[disputeId].add(player2);

    // Escludi chi ha giocato contro di loro (ultimi 30 giorni)
    for (opponent in getRecentOpponents(player1, 30 days)) {
        excludedArbitrators[disputeId].add(opponent);
    }
    // ... stesso per player2
}
```

#### B. Graph Analysis On-Chain

```
Tracking delle relazioni:
- Chi ha giocato contro chi
- Pattern di challenge (chi challenge chi)
- Co-occorrenza nelle votazioni

Se due address:
- Hanno giocato insieme 10+ volte
- Hanno sempre votato uguale
- Uno ha sempre challengato gli avversari dell'altro

= FLAGGED come potenziale collusione
= Esclusi da votare sulle rispettive dispute
```

#### C. Skin-in-the-Game Asimmetrico

```
Per votare su dispute con stake > X:
- Devi avere stake >= 2X
- Il tuo stake e locked durante la disputa
- Se voti contro maggioranza: perdi % del tuo stake

Questo rende costosissimo per un cheater avere abbastanza
account arbitro per controllare le proprie dispute.
```

---

### 3. Flash Loan Attack - Mitigazione Completa

#### A. Timelock su Stake per Voting Power

```solidity
struct ArbitratorStake {
    uint256 amount;
    uint256 stakedAt;
    uint256 votingPowerActiveAt;
}

function getVotingPower(address arbitrator) public view returns (uint256) {
    ArbitratorStake storage s = stakes[arbitrator];

    // Voting power attivo solo dopo 7 giorni
    if (block.timestamp < s.votingPowerActiveAt) {
        return 0;
    }

    // Voting power cresce con il tempo (max 2x dopo 1 anno)
    uint256 timeBonus = min(
        (block.timestamp - s.stakedAt) / 365 days,
        1
    );

    return s.amount * (100 + timeBonus * 100) / 100;
}
```

**Flash loan neutralizzato:** I token presi in prestito hanno 0 voting power.

#### B. Snapshot Voting

```
Per ogni proposta di governance:
1. Snapshot del voting power al blocco X
2. Votazione apre al blocco X+100
3. Votazione dura 7 giorni

Risultato:
- Flash loan al blocco X+150 e inutile
- Snapshot gia preso
```

#### C. Quorum Temporale

```
Requisiti per passare una proposta:
- Quorum: 10% supply deve votare
- Supermajority: 66%
- NUOVO: Partecipazione minima da address con stake > 30 giorni
  Almeno 5% del quorum deve venire da staker "maturi"
```

---

### 4. Price Manipulation - Mitigazione Completa

#### A. Bond Ibrido

```solidity
struct Bond {
    uint256 chessAmount;
    uint256 ethAmount;
}

// Per giocare una partita con stake S:
// Devi depositare:
// - 3x S in $CHESS
// - 2x S in ETH (o stablecoin)

function depositBond(uint256 gameStake) external payable {
    uint256 requiredChess = gameStake * 3;
    uint256 requiredEth = gameStake * 2;

    require(msg.value >= requiredEth, "Insufficient ETH bond");
    chessToken.transferFrom(msg.sender, address(this), requiredChess);

    bonds[msg.sender] = Bond(requiredChess, msg.value);
}
```

**Perche funziona:** Anche se $CHESS va a zero, c'e ancora il bond in ETH che ha valore reale.

#### B. TWAP Oracle per Parametri

```solidity
// Invece di usare prezzo spot, usa TWAP 7 giorni
function getChessEthPrice() public view returns (uint256) {
    return twapOracle.consult(
        address(chessToken),
        1e18,  // 1 CHESS
        7 days // periodo TWAP
    );
}

// Bond minimo in termini ETH (floor)
uint256 constant MIN_BOND_ETH_VALUE = 0.1 ether;

function calculateRequiredBond(uint256 stake) public view returns (uint256) {
    uint256 chessPrice = getChessEthPrice();
    uint256 chessRequired = (stake * BOND_RATIO) / chessPrice;

    // Floor: almeno equivalente di 0.1 ETH
    uint256 minChess = MIN_BOND_ETH_VALUE / chessPrice;
    return max(chessRequired, minChess);
}
```

#### C. Circuit Breaker

```solidity
uint256 public lastKnownPrice;
uint256 public priceUpdateTime;
uint256 constant MAX_PRICE_CHANGE = 50; // 50%

function updatePrice() external {
    uint256 newPrice = twapOracle.consult(...);

    if (lastKnownPrice > 0) {
        uint256 change = abs(newPrice - lastKnownPrice) * 100 / lastKnownPrice;

        if (change > MAX_PRICE_CHANGE) {
            // Prezzo cambiato troppo! Pausa il sistema
            paused = true;
            emit CircuitBreakerTriggered(lastKnownPrice, newPrice);
            return;
        }
    }

    lastKnownPrice = newPrice;
    priceUpdateTime = block.timestamp;
}
```

---

## Schema Architetturale Finale

```
                     +------------------+
                     |   ChessToken     |
                     |    (ERC20)       |
                     +--------+---------+
                              |
              +---------------+---------------+
              |               |               |
    +---------v----+  +-------v-------+  +----v-----------+
    |   Bonding    |  |   Arbitrator  |  |   DisputeDAO   |
    |   Manager    |  |   Registry    |  |                |
    +------+-------+  +-------+-------+  +-------+--------+
           |                  |                  |
           |    TWAP Oracle   |   Timelock       |  Commit-Reveal
           |    Hybrid Bond   |   Multi-level    |  Snapshot
           |    Circuit Break |   Graph Analysis |  Escalation
           |                  |                  |
           +------------------+------------------+
                              |
                     +--------v---------+
                     |    ChessCore     |
                     |  (Game Logic)    |
                     +------------------+
```

---

## Implementazione Prioritaria

### Fase 1: Core Token e Bonding
1. ChessToken.sol - ERC20 con mint/burn
2. BondingManager.sol - Hybrid bonds con TWAP

### Fase 2: Arbitration System
3. ArbitratorRegistry.sol - Staking con timelock, multi-level pools
4. DisputeDAO.sol - Commit-reveal voting, escalation

### Fase 3: Integration
5. Modifiche a ChessCore per integrare bonding
6. Challenge window dopo ogni partita

### Fase 4: Governance
7. Timelock contract
8. Governor contract per parametri
