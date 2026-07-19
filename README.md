# Inter-Bank Fund Transfer & Settlement System

### Inter-Bank Fund Transfer & Settlement System (Permissioned Blockchain) — Hyperledger Fabric

> Designing a permissioned blockchain prototype network to simulate inter-bank fund transfers in an enterprise banking environment. Implementing smart contracts for account creation, balance validation, and secure fund transfer with immutable transaction records. Focusing on auditability, transparency, and settlement traceability required in financial transactions.

---


- **Blockchain**: Hyperledger Fabric v2.x (Permissioned)
- **Smart Contract (Chaincode)**: JavaScript (Node.js)
- **Gateway Application**: Node.js + Fabric Gateway SDK
- **Consensus**: Raft (via Fabric Orderer)
- **Network**: 2 Organizations (Org1 - Bank A, Org2 - Bank B), 1 Orderer
- **Channel**: `mychannel`
- **Tools**: Docker, Docker Compose, Fabric CLI

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────┐
│               Hyperledger Fabric Network              │
│                                                       │
│  ┌─────────────┐          ┌─────────────┐            │
│  │    Org1     │          │    Org2     │            │
│  │  (Bank A)   │◄────────►│  (Bank B)   │            │
│  │ peer0:7051  │          │ peer0:9051  │            │
│  └─────┬───────┘          └──────┬──────┘            │
│        │                         │                   │
│        └──────────┬──────────────┘                   │
│                   │                                   │
│         ┌─────────▼─────────┐                        │
│         │  Orderer (Raft)   │                        │
│         │    port: 7050     │                        │
│         └───────────────────┘                        │
│                                                       │
│              Channel: mychannel                       │
│           Chaincode: interbank (JS)                   │
└──────────────────────────────────────────────────────┘
         ▲
         │
┌────────┴──────────┐
│  Node.js Gateway  │
│   Application     │
│   (app.js)        │
└───────────────────┘
```

---

## 📂 Project Structure

```
hyperledger/
├── fabric-samples/
│   └── asset-transfer-basic/
│       ├── chaincode-javascript/          ← Smart Contract
│       │   ├── index.js                   ← Entry point
│       │   └── lib/
│       │       └── interbankTransfer.js   ← Core chaincode logic
│       └── application-gateway-javascript/ ← Client Application
│           └── src/
│               └── app.js                 ← Gateway demo app
└── README.md
```

---

## 🔧 Prerequisites

- Docker & Docker Compose
- Node.js >= 20
- WSL2 (Ubuntu) on Windows
- Hyperledger Fabric binaries (installed via `install-fabric.sh`)

---

## 🚀 Setup & Run

### 1. Download Fabric Binaries

```bash
cd ~/hyperledger
curl -sSLO https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh
chmod +x install-fabric.sh
./install-fabric.sh docker binary
```

### 2. Fix Script Permissions (WSL)

```bash
find ~/hyperledger/fabric-samples/test-network -name "*.sh" \
  -exec chmod +x {} \; -exec sed -i 's/\r//' {} \;
```

### 3. Start the Network & Create Channel

```bash
cd ~/hyperledger/fabric-samples/test-network
./network.sh up
./network.sh createChannel -c mychannel
```

### 4. Deploy the Interbank Chaincode

```bash
./network.sh deployCC \
  -ccn interbank \
  -ccp ../asset-transfer-basic/chaincode-javascript \
  -ccl javascript \
  -c mychannel
```

### 5. Run the Node.js Gateway Application

```bash
cd ~/hyperledger/fabric-samples/asset-transfer-basic/application-gateway-javascript
npm install
node src/app.js
```

### 🔁 Restarting the Network (After Tear Down)

If you have shut down the network using `./network.sh down` (or want to start fresh), you must bring the network back up, recreate the channel, and deploy the chaincode by running:

```bash
cd ~/hyperledger/fabric-samples/test-network

# 1. Start the network
./network.sh up

# 2. Create the channel
./network.sh createChannel -c mychannel

# 3. Deploy the chaincode
./network.sh deployCC \
  -ccn interbank \
  -ccp ../asset-transfer-basic/chaincode-javascript \
  -ccl javascript \
  -c mychannel
```

---

## 📋 Smart Contract Functions

| Function | Type | Description |
|---|---|---|
| `InitLedger` | Invoke | Seeds initial bank accounts |
| `CreateAccount` | Invoke | Register new bank account |
| `GetAccount` | Query | Fetch account details |
| `GetBalance` | Query | Get current balance |
| `FreezeAccount` | Invoke | Freeze account (compliance) |
| `UnfreezeAccount` | Invoke | Reactivate frozen account |
| `InitiateTransfer` | Invoke | Transfer funds between banks |
| `GetTransaction` | Query | Fetch settlement record |
| `GetAccountHistory` | Query | Full immutable audit trail |
| `GetAllAccounts` | Query | List all accounts |
| `GetAllTransactions` | Query | List all settlements |

---

## 🔍 CLI Usage (Manual Testing)

### Set Environment (Org1)

```bash
cd ~/hyperledger/fabric-samples/test-network
export PATH=${PWD}/../bin:$PATH
export FABRIC_CFG_PATH=${PWD}/../config/
export CORE_PEER_TLS_ENABLED=true
export CORE_PEER_LOCALMSPID="Org1MSP"
export CORE_PEER_TLS_ROOTCERT_FILE=${PWD}/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt
export CORE_PEER_MSPCONFIGPATH=${PWD}/organizations/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp
export CORE_PEER_ADDRESS=localhost:7051
```

### Initialize Ledger

```bash
peer chaincode invoke \
  -o localhost:7050 --ordererTLSHostnameOverride orderer.example.com \
  --tls --cafile "${PWD}/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem" \
  -C mychannel -n interbank \
  --peerAddresses localhost:7051 \
  --tlsRootCertFiles "${PWD}/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt" \
  --peerAddresses localhost:9051 \
  --tlsRootCertFiles "${PWD}/organizations/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/tls/ca.crt" \
  -c '{"function":"InitLedger","Args":[]}'
```

### Transfer Funds

```bash
peer chaincode invoke ... \
  -c '{"function":"InitiateTransfer","Args":["TXN001","ACC001","ACC002","50000","Settlement"]}'
```

### Tear Down Network

```bash
cd ~/hyperledger/fabric-samples/test-network
./network.sh down
```

---

## ✅ Key Features

- **Account Management**: Create and manage bank accounts on the permissioned ledger
- **Balance Validation**: Smart contract enforces balance checks before every transfer
- **Atomic Settlement**: Debit and credit happen in a single atomic transaction
- **Immutable Records**: Every settlement is permanently recorded on-chain (`TXN_` prefix)
- **Audit Trail**: `getHistoryForKey` tracks every state change per account
- **Freeze/Unfreeze**: Compliance controls to block accounts
- **Event Emission**: Fabric events emitted on transfers for external listeners
- **Currency Validation**: Rejects cross-currency transfers

---

## Stopping & Restarting (Preserving Ledger Data)

> **Important:** `./network.sh down` **deletes all ledger data** (accounts, transactions, everything). Use the commands below if you want to stop and resume without losing your data.

### Stop (without losing data)

```bash
# Stop all running Fabric containers
docker stop $(docker ps -q)
```

### Resume (after stopping)

```bash
# Restart the stopped containers
docker start $(docker ps -aq)

# Then restart the Node.js server
cd ~/hyperledger/fabric-samples/asset-transfer-basic/application-gateway-javascript
npm run server
```

Your accounts and transactions will still be there. ✅

---

## Full Tear Down (Resets Everything)

Use this only when you want a **complete fresh start**. This deletes all ledger data, crypto material, and containers.

```bash
cd ~/hyperledger/fabric-samples/test-network
./network.sh down
```

After a full tear down, follow the [Restarting the Network](#-restarting-the-network-after-tear-down) section to bring everything back up and click **"Initialize Ledger"** on the dashboard to re-seed the accounts.
