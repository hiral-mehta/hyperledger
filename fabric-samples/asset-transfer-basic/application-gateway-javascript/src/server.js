/*
 * Inter-Bank Fund Transfer & Settlement System
 * Express REST API — Hyperledger Fabric Gateway
 */

'use strict';

const express = require('express');
const cors = require('cors');
const path = require('path');
const grpc = require('@grpc/grpc-js');
const { connect, hash, signers } = require('@hyperledger/fabric-gateway');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const { TextDecoder } = require('node:util');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// ─── Fabric Config ────────────────────────────────────────────────────────────

const channelName   = process.env.CHANNEL_NAME   || 'mychannel';
const chaincodeName = process.env.CHAINCODE_NAME || 'interbank';
const mspId         = process.env.MSP_ID         || 'Org1MSP';
const peerEndpoint  = process.env.PEER_ENDPOINT  || 'localhost:7051';
const peerHostAlias = process.env.PEER_HOST_ALIAS || 'peer0.org1.example.com';

const cryptoPath = path.resolve(
    __dirname, '..', '..', '..', 'test-network',
    'organizations', 'peerOrganizations', 'org1.example.com'
);

const keyDirectoryPath  = path.resolve(cryptoPath, 'users', 'User1@org1.example.com', 'msp', 'keystore');
const certDirectoryPath = path.resolve(cryptoPath, 'users', 'User1@org1.example.com', 'msp', 'signcerts');
const tlsCertPath       = path.resolve(cryptoPath, 'peers', 'peer0.org1.example.com', 'tls', 'ca.crt');

const utf8Decoder = new TextDecoder();
let contract = null;
let gateway  = null;
let client   = null;

// ─── Fabric Connection ────────────────────────────────────────────────────────

async function connectToFabric() {
    const tlsRootCert    = await fs.readFile(tlsCertPath);
    const tlsCredentials = grpc.credentials.createSsl(tlsRootCert);
    client = new grpc.Client(peerEndpoint, tlsCredentials, {
        'grpc.ssl_target_name_override': peerHostAlias,
    });

    const certFiles = await fs.readdir(certDirectoryPath);
    const credentials = await fs.readFile(path.join(certDirectoryPath, certFiles[0]));

    const keyFiles = await fs.readdir(keyDirectoryPath);
    const privateKeyPem = await fs.readFile(path.join(keyDirectoryPath, keyFiles[0]));
    const privateKey = crypto.createPrivateKey(privateKeyPem);

    gateway = connect({
        client,
        identity: { mspId, credentials },
        signer: signers.newPrivateKeySigner(privateKey),
        hash: hash.sha256,
        evaluateOptions:     () => ({ deadline: Date.now() + 5000 }),
        endorseOptions:      () => ({ deadline: Date.now() + 15000 }),
        submitOptions:       () => ({ deadline: Date.now() + 5000 }),
        commitStatusOptions: () => ({ deadline: Date.now() + 60000 }),
    });

    const network = gateway.getNetwork(channelName);
    contract = network.getContract(chaincodeName);
    console.log('✅  Connected to Hyperledger Fabric network');
}

function parseResult(bytes) {
    return JSON.parse(utf8Decoder.decode(bytes));
}

function extractError(err) {
    const match = err.message?.match(/message:"([^"]+)"/);
    return match ? match[1] : err.message;
}

// ─── REST API Routes ──────────────────────────────────────────────────────────

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', connected: contract !== null, channel: channelName, chaincode: chaincodeName });
});

// Init Ledger
app.post('/api/init', async (req, res) => {
    try {
        await contract.submitTransaction('InitLedger');
        res.json({ success: true, message: 'Ledger initialized with seed accounts' });
    } catch (err) {
        res.status(500).json({ success: false, error: extractError(err) });
    }
});

// Get all accounts
app.get('/api/accounts', async (req, res) => {
    try {
        const result = await contract.evaluateTransaction('GetAllAccounts');
        res.json(parseResult(result));
    } catch (err) {
        res.status(500).json({ success: false, error: extractError(err) });
    }
});

// Get single account
app.get('/api/accounts/:id', async (req, res) => {
    try {
        const result = await contract.evaluateTransaction('GetAccount', req.params.id);
        res.json(JSON.parse(result));
    } catch (err) {
        res.status(404).json({ success: false, error: extractError(err) });
    }
});

// Get balance
app.get('/api/accounts/:id/balance', async (req, res) => {
    try {
        const result = await contract.evaluateTransaction('GetBalance', req.params.id);
        res.json(parseResult(result));
    } catch (err) {
        res.status(404).json({ success: false, error: extractError(err) });
    }
});

// Get account history (audit trail)
app.get('/api/accounts/:id/history', async (req, res) => {
    try {
        const result = await contract.evaluateTransaction('GetAccountHistory', req.params.id);
        res.json(parseResult(result));
    } catch (err) {
        res.status(500).json({ success: false, error: extractError(err) });
    }
});

// Create account
app.post('/api/accounts', async (req, res) => {
    const { accountId, accountHolder, bankName, bankCode, initialBalance, currency } = req.body;
    try {
        const result = await contract.submitTransaction(
            'CreateAccount', accountId, accountHolder, bankName, bankCode,
            String(initialBalance), currency || 'INR'
        );
        res.status(201).json(parseResult(result));
    } catch (err) {
        res.status(400).json({ success: false, error: extractError(err) });
    }
});

// Freeze account
app.post('/api/accounts/:id/freeze', async (req, res) => {
    try {
        await contract.submitTransaction('FreezeAccount', req.params.id);
        res.json({ success: true, message: `Account ${req.params.id} frozen` });
    } catch (err) {
        res.status(500).json({ success: false, error: extractError(err) });
    }
});

// Unfreeze account
app.post('/api/accounts/:id/unfreeze', async (req, res) => {
    try {
        await contract.submitTransaction('UnfreezeAccount', req.params.id);
        res.json({ success: true, message: `Account ${req.params.id} unfrozen` });
    } catch (err) {
        res.status(500).json({ success: false, error: extractError(err) });
    }
});

// Initiate fund transfer
app.post('/api/transfer', async (req, res) => {
    const { fromAccountId, toAccountId, amount, remarks } = req.body;
    const txnId = `TXN${Date.now()}`;
    try {
        const commit = await contract.submitAsync('InitiateTransfer', {
            arguments: [txnId, fromAccountId, toAccountId, String(amount), remarks || ''],
        });
        const result = parseResult(commit.getResult());
        const status = await commit.getStatus();
        if (!status.successful) throw new Error(`Transaction failed: ${status.code}`);
        res.status(201).json({ success: true, transaction: result });
    } catch (err) {
        res.status(400).json({ success: false, error: extractError(err) });
    }
});

// Get transaction by ID
app.get('/api/transactions/:id', async (req, res) => {
    try {
        const result = await contract.evaluateTransaction('GetTransaction', req.params.id);
        res.json(parseResult(result));
    } catch (err) {
        res.status(404).json({ success: false, error: extractError(err) });
    }
});

// Get all transactions
app.get('/api/transactions', async (req, res) => {
    try {
        const result = await contract.evaluateTransaction('GetAllTransactions');
        res.json(parseResult(result));
    } catch (err) {
        res.status(500).json({ success: false, error: extractError(err) });
    }
});

// ─── Start Server ─────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;

connectToFabric()
    .then(() => {
        app.listen(PORT, () => {
            console.log(`\n🏦  Inter-Bank Transfer Dashboard`);
            console.log(`🌐  Open: http://localhost:${PORT}`);
            console.log(`📡  Fabric: ${channelName} / ${chaincodeName}`);
        });
    })
    .catch(err => {
        console.error('❌  Failed to connect to Fabric:', err);
        process.exit(1);
    });
