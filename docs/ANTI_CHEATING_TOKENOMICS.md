# Anti-Cheating System & Tokenomics

## Il Paradigma: "Don't Detect, Disincentivize"

```
Approccio Oracle:
"Rileviamo automaticamente chi bara" → Centralizzato, fallibile

Approccio Game Theory Puro:
"Rendiamo il cheating economicamente stupido" → Decentralizzato, robusto

Non serve SAPERE chi bara.
Serve che barare NON CONVENGA anche se nessuno lo sa.
```

---

## Token: $CHESS

### Utility del Token

| Utility | Descrizione |
|---------|-------------|
| **BONDING** | Depositi $CHESS per giocare. Più stake nella partita → più bond richiesto |
| **STAKING ARBITRI** | Stake $CHESS per diventare arbitro DAO. Voti sulle dispute. Guadagni fee + reward |
| **CHALLENGE DEPOSIT** | Depositi $CHESS per aprire una disputa. Vinci → reward. Perdi → perdi deposit |
| **FEE PAYMENT** | Paghi fee in $CHESS (sconto) o in ETH (fee più alta, convertita e burned) |
| **GOVERNANCE** | Voti su parametri (bond ratio, fee %, soglie) |

### Tokenomics

```
Supply Totale: 100,000,000 $CHESS

Distribuzione:
├── 40% Play-to-Earn (emesso giocando partite)
├── 25% Treasury DAO
├── 15% Team (vesting 2 anni)
├── 10% Liquidity
└── 10% Early community/airdrop

Meccanismo Deflazionario:
- Fee in ETH → buyback & burn $CHESS
- Slashing → burned (non redistribuito)
```

---

## Sistema Dispute SENZA Oracle

### Flow Completo

```
                    PARTITA
                       │
                       ▼
              ┌─────────────────┐
              │  48h Challenge  │
              │     Window      │
              └────────┬────────┘
                       │
           ┌───────────┴───────────┐
           │                       │
           ▼                       ▼
    Nessun Challenge         Challenge!
           │                       │
           ▼                       ▼
    Prize distribuito      ┌──────────────┐
    Bond rilasciato        │  DAO Voting  │
                           │   (48-72h)   │
                           └──────┬───────┘
                                  │
                    ┌─────────────┴─────────────┐
                    │                           │
                    ▼                           ▼
              Voto: CHEAT                 Voto: LEGIT
                    │                           │
                    ▼                           ▼
            - Cheater bond BURNED        - Challenger deposit:
            - Prize → vittima              50% accusato
            - Reward → challenger          50% arbitri
            - Fee → arbitri              - Partita finalizzata
```

### Fasi del Sistema

#### FASE 1: PARTITA
- Alice e Bob giocano
- Entrambi hanno bond depositato
- Alice vince

#### FASE 2: PERIODO DI CHALLENGE (48h)
- Chiunque può challengare la partita
- Per challengare: deposita X $CHESS
- Se nessuno challenge → partita finalizzata, prize distribuito

#### FASE 3: DISPUTA (se challenged)
- Partita va in "dispute"
- Prize bloccato
- DAO vota

#### FASE 4: VOTAZIONE DAO
- Arbitri (stakers) analizzano la partita
- Guardano: mosse, tempi, pattern
- Votano: LEGIT o CHEAT
- Quorum richiesto (es. 10 arbitri)
- Maggioranza 2/3 decide

#### FASE 5: RISOLUZIONE

**Se CHEAT (accusato colpevole):**
- Bond dell'accusato: SLASHED (burned)
- Prize: restituito al perdente
- Challenger: riceve reward
- Arbitri corretti: ricevono fee

**Se LEGIT (accusato innocente):**
- Challenge deposit: SLASHED
- 50% all'accusato (compensazione)
- 50% agli arbitri
- Partita finalizzata normalmente

---

## Game Theory: Analisi Matematica

### EV del Cheater

```
Variabili:
- S = stake partita (100 $CHESS)
- B = bond richiesto (500 $CHESS)
- P_c = probabilità di essere challengato
- P_v = probabilità che DAO voti CHEAT (se challengato)
- W = win rate con engine (95%)

EV_cheat = W × S × (1 - P_c × P_v) - P_c × P_v × B

Con P_c = 30% (qualcuno nota), P_v = 80% (DAO vota giusto):
EV_cheat = 0.95 × 100 × (1 - 0.24) - 0.24 × 500
EV_cheat = 95 × 0.76 - 120
EV_cheat = 72.2 - 120 = -47.8 $CHESS

✗ NEGATIVO! Non conviene barare.
```

### EV del Challenger Onesto

```
Se challenge un vero cheater:
- Costo: 50 $CHESS
- P(win) = 80% (DAO vota correttamente)
- Reward se win: 100 $CHESS

EV = 0.80 × 100 - 0.20 × 50 = 80 - 10 = +70 $CHESS

✓ POSITIVO! Conviene challengare i cheater.
```

### EV del Challenger Disonesto (false accuse)

```
Se challenge un giocatore onesto:
- Costo: 50 $CHESS
- P(win) = 20% (DAO sbaglia raramente)
- Reward se win: 100 $CHESS

EV = 0.20 × 100 - 0.80 × 50 = 20 - 40 = -20 $CHESS

✗ NEGATIVO! Non conviene fare false accuse.
```

### Matrice dei Payoff

```
                    AVVERSARIO
                 Onesto    |   Cheater
         ┌─────────────────┼─────────────────┐
  Onesto │  Win/Lose 50%   │    Lose (high)  │
GIOCATORE│  Fair game      │    Ma cheater   │
         │  EV = 0         │    rischia bond │
         ├─────────────────┼─────────────────┤
 Cheater │  Win (high)     │   Entrambi      │
         │  Ma EV = -47.8  │   rischiano     │
         │  Non conviene!  │   tutto         │
         └─────────────────┴─────────────────┘

Equilibrio di Nash: (Onesto, Onesto)
Strategia dominante = GIOCARE ONESTO
```

---

## Struttura della DAO

### Diventare Arbitro

**Requisiti:**
- Stake minimo: 1000 $CHESS
- Account attivo da 30+ giorni
- Almeno 10 partite giocate

**Responsabilità:**
- Analizzare dispute assegnate
- Votare entro 48h
- Mantenere accuracy > 70%

### Sistema di Voto

Per ogni disputa:
1. Sistema seleziona 15 arbitri random (weighted by stake)
2. Arbitri ricevono:
   - PGN della partita
   - Tempi per mossa
   - Rating dei giocatori
   - Storico partite recenti
3. Votano: LEGIT / CHEAT / ABSTAIN
4. Quorum: almeno 10 voti
5. Decisione: maggioranza 2/3

### Incentivi Arbitri

| Azione | Conseguenza |
|--------|-------------|
| Voto allineato con maggioranza | Ricevi share fee + Reputation +1 |
| Voto contro maggioranza | Nessun reward + Reputation -1 |
| Reputation < 50 | Rimosso dal pool, deve ri-stakare |

---

## Protezioni Anti-Gaming

### Contro Collusione Arbitri
- Arbitri selezionati RANDOM
- Non sanno chi sono gli altri arbitri
- Voto segreto fino a reveal
- Stake at risk se votano male sistematicamente

### Contro Sybil Attack (tanti account)
- Bond requirement per giocare
- Costo per creare "history" credibile
- Challenge più probabili su account nuovi

### Contro Grief Challenges
- Challenge costa 50 $CHESS
- Se perdi, li perdi
- Rate limiting: max 3 challenge attivi per account

---

## Smart Contracts Necessari

```
1. ChessToken.sol
   - ERC20 token $CHESS
   - Mint/burn functions

2. BondingManager.sol
   - Deposit/withdraw bond
   - Lock during games
   - Slash function

3. DisputeDAO.sol
   - Create dispute
   - Arbitro selection
   - Voting mechanism
   - Resolution & distribution

4. ArbitratorRegistry.sol
   - Stake to become arbitro
   - Reputation tracking
   - Removal mechanism
```

---

## Parametri Configurabili (Governance)

| Parametro | Valore Iniziale | Descrizione |
|-----------|-----------------|-------------|
| `BOND_RATIO` | 5x | Bond richiesto / Stake partita |
| `CHALLENGE_WINDOW` | 48h | Tempo per challengare |
| `CHALLENGE_DEPOSIT` | 50 $CHESS | Costo per aprire disputa |
| `VOTING_PERIOD` | 48h | Tempo per votare |
| `QUORUM` | 10 | Voti minimi richiesti |
| `SUPERMAJORITY` | 66% | Percentuale per decisione |
| `MIN_ARBITRATOR_STAKE` | 1000 $CHESS | Stake minimo arbitro |
| `PLATFORM_FEE` | 3% | Fee su ogni partita |

---

## Roadmap Implementazione

### Fase 1: Token & Bonding
- [ ] Deploy ChessToken.sol
- [ ] Deploy BondingManager.sol
- [ ] Integrazione con ChessCore esistente
- [ ] UI per deposit/withdraw bond

### Fase 2: Dispute System
- [ ] Deploy DisputeDAO.sol
- [ ] Deploy ArbitratorRegistry.sol
- [ ] UI per challenge
- [ ] UI per voting arbitri

### Fase 3: Governance
- [ ] Timelock contract
- [ ] Proposal system
- [ ] UI governance

### Fase 4: Ottimizzazioni
- [ ] Gas optimization
- [ ] L2 deployment (Arbitrum/Optimism)
- [ ] Cross-chain bridge
