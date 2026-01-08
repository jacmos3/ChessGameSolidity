# MyChess.onchain - Guida Deploy con Remix IDE

Questa guida ti permette di deployare tutti i contratti manualmente usando Remix IDE.
**Nessuna chiave privata viene condivisa** - MetaMask gestisce tutto in sicurezza.

---

## Prerequisiti

### 1. Aggiungi Base Sepolia a MetaMask

| Campo | Valore |
|-------|--------|
| Network Name | Base Sepolia |
| RPC URL | `https://sepolia.base.org` |
| Chain ID | `84532` |
| Symbol | `ETH` |
| Explorer | `https://sepolia.basescan.org` |

### 2. Ottieni ETH Testnet

Vai su: https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet

Servono circa **0.5 ETH** per deployare tutti i contratti.

### 3. Apri Remix IDE

Vai su: https://remix.ethereum.org

---

## Setup Remix

### Configurazione Compilatore

1. Vai su **Solidity Compiler** (icona a sinistra)
2. Imposta:
   - Compiler: `0.8.24`
   - EVM Version: `cancun`
   - Enable optimization: ✅ (runs: 1)
   - Use configuration file: ❌
   - viaIR: ✅ (importante!)

### Connetti MetaMask

1. Vai su **Deploy & Run Transactions**
2. Environment: `Injected Provider - MetaMask`
3. Verifica che sia su **Base Sepolia (84532)**

---

## Ordine di Deploy

⚠️ **IMPORTANTE**: Segui l'ordine esatto! Ogni contratto dipende dai precedenti.

Tieni un file di testo aperto per salvare gli indirizzi man mano.

```
📋 INDIRIZZI DEPLOYATI
======================
ChessToken:
PlayerRating:
BondingManager:
ChessTimelock:
ChessGovernor:
ArbitratorRegistry:
DisputeDAO:
RewardPool:
ChessCore:
ChessFactory:
ChessNFT:
```

---

## Step 1: ChessToken

**File**: `01_ChessToken.sol`

1. Copia il contenuto del file in Remix
2. Compila (Ctrl+S)
3. In "Deploy", seleziona contratto: `ChessToken`
4. Constructor args:
   - `_teamWallet`: `<TUO_INDIRIZZO>` (dove ricevere i token team)
   - `_treasury`: `<TUO_INDIRIZZO>` (treasury)
5. Click **Deploy** → Conferma in MetaMask
6. **Salva l'indirizzo** ✏️

---

## Step 2: PlayerRating

**File**: `02_PlayerRating.sol`

1. Copia in Remix e compila
2. Seleziona: `PlayerRating`
3. Nessun constructor arg
4. **Deploy** → Conferma
5. **Salva l'indirizzo** ✏️

---

## Step 3: BondingManager

**File**: `03_BondingManager.sol`

1. Copia in Remix e compila
2. Seleziona: `BondingManager`
3. Constructor args:
   - `_chessToken`: `<indirizzo ChessToken>`
   - `_initialChessPrice`: `100000000000000` (0.0001 ETH = prezzo iniziale CHESS)
4. **Deploy** → Conferma
5. **Salva l'indirizzo** ✏️

---

## Step 4: ChessTimelock

**File**: `04_ChessTimelock.sol`

1. Copia in Remix e compila
2. Seleziona: `ChessTimelock`
3. Constructor args:
   - `minDelay`: `172800` (2 giorni in secondi)
   - `proposers`: `[]` (array vuoto)
   - `executors`: `["0x0000000000000000000000000000000000000000"]`
   - `admin`: `<TUO_INDIRIZZO>`
4. **Deploy** → Conferma
5. **Salva l'indirizzo** ✏️

---

## Step 5: ChessGovernor

**File**: `05_ChessGovernor.sol`

1. Copia in Remix e compila
2. Seleziona: `ChessGovernor`
3. Constructor args:
   - `_token`: `<indirizzo ChessToken>`
   - `_timelock`: `<indirizzo ChessTimelock>`
4. **Deploy** → Conferma
5. **Salva l'indirizzo** ✏️

---

## Step 6: ArbitratorRegistry

**File**: `06_ArbitratorRegistry.sol`

1. Copia in Remix e compila
2. Seleziona: `ArbitratorRegistry`
3. Constructor args:
   - `_chessToken`: `<indirizzo ChessToken>`
4. **Deploy** → Conferma
5. **Salva l'indirizzo** ✏️

---

## Step 7: DisputeDAO

**File**: `07_DisputeDAO.sol`

1. Copia in Remix e compila
2. Seleziona: `DisputeDAO`
3. Constructor args:
   - `_chessToken`: `<indirizzo ChessToken>`
   - `_bondingManager`: `<indirizzo BondingManager>`
   - `_arbitratorRegistry`: `<indirizzo ArbitratorRegistry>`
4. **Deploy** → Conferma
5. **Salva l'indirizzo** ✏️

---

## Step 8: RewardPool

**File**: `08_RewardPool.sol`

1. Copia in Remix e compila
2. Seleziona: `RewardPool`
3. Constructor args:
   - `_chessToken`: `<indirizzo ChessToken>`
   - `_playerRating`: `<indirizzo PlayerRating>`
4. **Deploy** → Conferma
5. **Salva l'indirizzo** ✏️

---

## Step 9: ChessCore (Implementation)

**File**: `10_ChessCore.sol`

⚠️ Questo file include già ChessMediaLibrary integrata.

1. Copia in Remix e compila
2. Seleziona: `ChessCore`
3. Nessun constructor arg
4. **Deploy** → Conferma
5. **Salva l'indirizzo** ✏️ (sarà l'implementation per la factory)

---

## Step 10: ChessFactory

**File**: `11_ChessFactory.sol`

1. Copia in Remix e compila
2. Seleziona: `ChessFactory`
3. Constructor args:
   - `_implementation`: `<indirizzo ChessCore>`
4. **Deploy** → Conferma
5. **Salva l'indirizzo** ✏️
6. **Leggi ChessNFT address**:
   - Espandi il contratto deployato
   - Clicca su `addressNFT` (read)
   - **Salva l'indirizzo ChessNFT** ✏️

---

## Step 11: Configurazione Ruoli

Ora devi configurare i permessi tra i contratti. Usa le funzioni del contratto deployato in Remix.

### 11.1 Configura ChessFactory

Espandi `ChessFactory` nei contratti deployati e chiama:

| Funzione | Parametro |
|----------|-----------|
| `setBondingManager` | `<indirizzo BondingManager>` |
| `setDisputeDAO` | `<indirizzo DisputeDAO>` |
| `setPlayerRating` | `<indirizzo PlayerRating>` |
| `setRewardPool` | `<indirizzo RewardPool>` |

### 11.2 Configura PlayerRating

Espandi `PlayerRating` e chiama:

| Funzione | Parametro |
|----------|-----------|
| `setChessFactory` | `<indirizzo ChessFactory>` |

### 11.3 Configura RewardPool

Espandi `RewardPool` e chiama:

| Funzione | Parametro |
|----------|-----------|
| `setChessFactory` | `<indirizzo ChessFactory>` |

### 11.4 Configura BondingManager Roles

Espandi `BondingManager` e chiama:

```
GAME_MANAGER_ROLE = 0x3b5d03f6ca43c0d188593da92c9c5dffa6c02bf4fe4d07d4e993d3951682da61
DISPUTE_MANAGER_ROLE = 0x9f930660bebd7804dc28f3e129cf320fa9e4f9df4cd04ff8e32646f99c0f32a4
```

| Funzione | Parametri |
|----------|-----------|
| `grantRole` | `0x3b5d03f6ca43c0d188593da92c9c5dffa6c02bf4fe4d07d4e993d3951682da61`, `<indirizzo ChessFactory>` |
| `grantRole` | `0x9f930660bebd7804dc28f3e129cf320fa9e4f9df4cd04ff8e32646f99c0f32a4`, `<indirizzo DisputeDAO>` |

### 11.5 Configura ArbitratorRegistry Roles

Espandi `ArbitratorRegistry` e chiama:

```
DISPUTE_MANAGER_ROLE = 0x9f930660bebd7804dc28f3e129cf320fa9e4f9df4cd04ff8e32646f99c0f32a4
```

| Funzione | Parametri |
|----------|-----------|
| `grantRole` | `0x9f930660bebd7804dc28f3e129cf320fa9e4f9df4cd04ff8e32646f99c0f32a4`, `<indirizzo DisputeDAO>` |

### 11.6 Configura ChessTimelock Roles

Espandi `ChessTimelock` e chiama:

```
PROPOSER_ROLE = 0xb09aa5aeb3702cfd50b6b62bc4532604938f21248a27a1d5ca736082b6819cc1
CANCELLER_ROLE = 0xfd643c72710c63c0180259aba6b2d05451e3591a24e58b62239378085726f783
```

| Funzione | Parametri |
|----------|-----------|
| `grantRole` | `0xb09aa5aeb3702cfd50b6b62bc4532604938f21248a27a1d5ca736082b6819cc1`, `<indirizzo ChessGovernor>` |
| `grantRole` | `0xfd643c72710c63c0180259aba6b2d05451e3591a24e58b62239378085726f783`, `<indirizzo ChessGovernor>` |

---

## Step 12: Verifica Deploy

### Test Rapido

1. In `ChessFactory`, chiama `createChessGame`:
   - `_timeoutPreset`: `0` (Finney - veloce)
   - `_gameMode`: `1` (Friendly)
   - Value: `0.001` ETH
2. Conferma la transazione
3. Se funziona, il deploy è completo! 🎉

### Verifica Ruoli

Puoi verificare i ruoli chiamando `hasRole` sui vari contratti.

---

## Step 13: Aggiorna Frontend

Copia gli indirizzi nel file `frontend/.env`:

```env
# Base Sepolia
VITE_CONTRACT_ADDRESS_BASE_SEPOLIA=<ChessFactory>
VITE_BONDING_MANAGER_BASE_SEPOLIA=<BondingManager>
VITE_CHESS_TOKEN_BASE_SEPOLIA=<ChessToken>
VITE_DISPUTE_DAO_BASE_SEPOLIA=<DisputeDAO>
VITE_ARBITRATOR_REGISTRY_BASE_SEPOLIA=<ArbitratorRegistry>
VITE_GOVERNOR_BASE_SEPOLIA=<ChessGovernor>
VITE_TIMELOCK_BASE_SEPOLIA=<ChessTimelock>
VITE_PLAYER_RATING_BASE_SEPOLIA=<PlayerRating>
```

---

## Troubleshooting

### "Contract too large"
- Assicurati che viaIR sia attivo
- Optimizer runs = 1

### "Out of gas"
- Aumenta il gas limit manualmente in MetaMask

### "Transaction reverted"
- Verifica che tutti gli indirizzi siano corretti
- Verifica di essere sull'account admin

---

## Tempo Stimato

- Deploy contratti: ~30 minuti
- Configurazione ruoli: ~15 minuti
- **Totale**: ~45 minuti

---

Buon deploy! 🚀
