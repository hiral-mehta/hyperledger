/*
 * Inter-Bank Fund Transfer & Settlement System
 * Hyperledger Fabric - Node.js Gateway Application
 */

'use strict';

const grpc = require('@grpc/grpc-js');
const { connect, hash, signers } = require('@hyperledger/fabric-gateway');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { TextDecoder } = require('node:util');

// ─── Configuration ───────────────────────────────────────────────────────────

const channelName    = envOrDefault('CHANNEL_NAME', 'mychannel');
const chaincodeName  = envOrDefault('CHAINCODE_NAME', 'interbank');
const mspId          = envOrDefault('MSP_ID', 'Org1MSP');
const peerEndpoint   = envOrDefault('PEER_ENDPOINT', 'localhost:7051');
const peerHostAlias  = envOrDefault('PEER_HOST_ALIAS', 'peer0.org1.example.com');

const cryptoPath = envOrDefault(
    'CRYPTO_PATH',
    path.resolve(__dirname, '..', '..', '..', 'test-network',
        'organizations', 'peerOrganizations', 'org1.example.com')
);

const keyDirectoryPath  = envOrDefault('KEY_DIRECTORY_PATH',
    path.resolve(cryptoPath, 'users', 'User1@org1.example.com', 'msp', 'keystore'));

const certDirectoryPath = envOrDefault('CERT_DIRECTORY_PATH',
    path.resolve(cryptoPath, 'users', 'User1@org1.example.com', 'msp', 'signcerts'));

const tlsCertPath = envOrDefault('TLS_CERT_PATH',
    path.resolve(cryptoPath, 'peers', 'peer0.org1.example.com', 'tls', 'ca.crt'));

const utf8Decoder = new TextDecoder();

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    printBanner();
    displayInputParameters();

    const client = await newGrpcConnection();

    const gateway = connect({
        client,
        identity: await newIdentity(),
        signer: await newSigner(),
        hash: hash.sha256,
        evaluateOptions:     () => ({ deadline: Date.now() + 5000 }),
        endorseOptions:      () => ({ deadline: Date.now() + 15000 }),
        submitOptions:       () => ({ deadline: Date.now() + 5000 }),
        commitStatusOptions: () => ({ deadline: Date.now() + 60000 }),
    });

    try {
        const network  = gateway.getNetwork(channelName);
        const contract = network.getContract(chaincodeName);

        // ── Demo Flow ────────────────────────────────────────────────────────

        // 1. Initialize ledger with seed accounts
        await initLedger(contract);

        // 2. List all accounts
        await getAllAccounts(contract);

        // 3. Create a new account
        await createAccount(contract, 'ACC004', 'Hiral Mehta', 'Axis Bank', 'AXIS001', '250000', 'INR');

        // 4. Check balance before transfer
        await getBalance(contract, 'ACC001');

        // 5. Transfer funds: SBI → HDFC
        const txnId = `TXN${Date.now()}`;
        await initiateTransfer(contract, txnId, 'ACC001', 'ACC002', '75000', 'Inter-bank settlement - SBI to HDFC');

        // 6. Check balance after transfer
        await getBalance(contract, 'ACC001');
        await getBalance(contract, 'ACC002');

        // 7. Get transaction record (audit)
        await getTransaction(contract, txnId);

        // 8. Full account history (immutable audit trail)
        await getAccountHistory(contract, 'ACC001');

        // 9. Test: insufficient balance
        await testInsufficientBalance(contract);

        // 10. Freeze an account and test blocked transfer
        await testFreezeAccount(contract);

    } finally {
        gateway.close();
        client.close();
    }
}

main().catch((error) => {
    console.error('\n❌  FAILED to run the application:', error);
    process.exitCode = 1;
});

// ─── Chaincode Interactions ───────────────────────────────────────────────────

async function initLedger(contract) {
    log('step', 'InitLedger — Seeding 3 bank accounts (SBI, HDFC, ICICI)...');
    await contract.submitTransaction('InitLedger');
    log('ok', 'Ledger initialized successfully');
}

async function getAllAccounts(contract) {
    log('step', 'GetAllAccounts — Fetching all registered accounts...');
    const result = await contract.evaluateTransaction('GetAllAccounts');
    const accounts = JSON.parse(utf8Decoder.decode(result));
    console.log('\n📋  Accounts on Ledger:');
    accounts.forEach(acc => {
        console.log(`   ► ${acc.accountId} | ${acc.accountHolder} | ${acc.bankName} | Balance: ${acc.balance} ${acc.currency} | Status: ${acc.status}`);
    });
}

async function createAccount(contract, accountId, holder, bank, bankCode, balance, currency) {
    log('step', `CreateAccount — Registering account for ${holder} at ${bank}...`);
    const result = await contract.submitTransaction('CreateAccount', accountId, holder, bank, bankCode, balance, currency);
    const account = JSON.parse(utf8Decoder.decode(result));
    log('ok', `Account created: ${account.accountId} | Balance: ${account.balance} ${account.currency}`);
}

async function getBalance(contract, accountId) {
    log('step', `GetBalance — Checking balance for ${accountId}...`);
    const result = await contract.evaluateTransaction('GetBalance', accountId);
    const data = JSON.parse(utf8Decoder.decode(result));
    console.log(`   💰  ${data.accountHolder} (${data.bankName}): ${data.balance} ${data.currency} [${data.status}]`);
}

async function initiateTransfer(contract, txnId, fromId, toId, amount, remarks) {
    log('step', `InitiateTransfer — Transferring ${amount} INR from ${fromId} → ${toId}...`);

    const commit = await contract.submitAsync('InitiateTransfer', {
        arguments: [txnId, fromId, toId, amount, remarks],
    });

    const result = utf8Decoder.decode(commit.getResult());
    const txn = JSON.parse(result);

    log('pending', `Transaction submitted: ${txnId}. Waiting for commit...`);

    const status = await commit.getStatus();
    if (!status.successful) {
        throw new Error(`Transaction ${txnId} failed with status code: ${status.code}`);
    }

    log('ok', `✅  Transfer SETTLED on blockchain!`);
    console.log(`   📄  Transaction ID : ${txn.txnId}`);
    console.log(`   🏦  From           : ${txn.fromAccountId} (${txn.fromBank})`);
    console.log(`   🏦  To             : ${txn.toAccountId} (${txn.toBank})`);
    console.log(`   💵  Amount         : ${txn.amount} ${txn.currency}`);
    console.log(`   📝  Remarks        : ${txn.remarks}`);
    console.log(`   ✅  Status         : ${txn.status}`);
    console.log(`   🕐  Settled At     : ${txn.settledAt}`);
}

async function getTransaction(contract, txnId) {
    log('step', `GetTransaction — Fetching settlement record for ${txnId}...`);
    const result = await contract.evaluateTransaction('GetTransaction', txnId);
    const txn = JSON.parse(utf8Decoder.decode(result));
    console.log('\n🧾  Settlement Record (Immutable):');
    console.log(JSON.stringify(txn, null, 4));
}

async function getAccountHistory(contract, accountId) {
    log('step', `GetAccountHistory — Audit trail for ${accountId}...`);
    const result = await contract.evaluateTransaction('GetAccountHistory', accountId);
    const history = JSON.parse(utf8Decoder.decode(result));
    console.log(`\n📜  Audit Trail for ${accountId} (${history.length} entries):`);
    history.forEach((entry, i) => {
        console.log(`   [${i + 1}] TxID: ${entry.txId.substring(0, 16)}... | Time: ${entry.timestamp} | Deleted: ${entry.isDelete}`);
    });
}

async function testInsufficientBalance(contract) {
    log('step', 'Test: Insufficient Balance — Trying to overdraw ACC003...');
    try {
        await contract.submitTransaction('InitiateTransfer',
            `TXN_FAIL_${Date.now()}`, 'ACC003', 'ACC001', '9999999', 'Overdraft attempt');
        log('fail', 'ERROR: Should have thrown insufficient balance!');
    } catch (error) {
        log('ok', `Correctly rejected: ${extractErrorMessage(error)}`);
    }
}

async function testFreezeAccount(contract) {
    log('step', 'Test: Freeze ACC002 and try to send funds to it...');
    await contract.submitTransaction('FreezeAccount', 'ACC002');
    log('ok', 'ACC002 frozen successfully');

    try {
        await contract.submitTransaction('InitiateTransfer',
            `TXN_FREEZE_${Date.now()}`, 'ACC001', 'ACC002', '1000', 'Transfer to frozen account');
        log('fail', 'ERROR: Should have been blocked!');
    } catch (error) {
        log('ok', `Correctly blocked: ${extractErrorMessage(error)}`);
    }

    // Unfreeze for cleanup
    await contract.submitTransaction('UnfreezeAccount', 'ACC002');
    log('ok', 'ACC002 unfrozen');
}

// ─── Fabric Connection Helpers ────────────────────────────────────────────────

async function newGrpcConnection() {
    const tlsRootCert = await fs.readFile(tlsCertPath);
    const tlsCredentials = grpc.credentials.createSsl(tlsRootCert);
    return new grpc.Client(peerEndpoint, tlsCredentials, {
        'grpc.ssl_target_name_override': peerHostAlias,
    });
}

async function newIdentity() {
    const certPath = await getFirstDirFileName(certDirectoryPath);
    const credentials = await fs.readFile(certPath);
    return { mspId, credentials };
}

async function newSigner() {
    const keyPath = await getFirstDirFileName(keyDirectoryPath);
    const privateKeyPem = await fs.readFile(keyPath);
    const privateKey = crypto.createPrivateKey(privateKeyPem);
    return signers.newPrivateKeySigner(privateKey);
}

async function getFirstDirFileName(dirPath) {
    const files = await fs.readdir(dirPath);
    const file = files[0];
    if (!file) throw new Error(`No files in directory: ${dirPath}`);
    return path.join(dirPath, file);
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function envOrDefault(key, defaultValue) {
    return process.env[key] || defaultValue;
}

function extractErrorMessage(error) {
    const match = error.message?.match(/message:"([^"]+)"/);
    return match ? match[1] : error.message;
}

function log(type, message) {
    const icons = { step: '🔷', ok: '✅', pending: '⏳', fail: '❌' };
    console.log(`\n${icons[type] || '▶'}  ${message}`);
}

function printBanner() {
    console.log('\n' + '═'.repeat(60));
    console.log('   🏦  Inter-Bank Fund Transfer & Settlement System');
    console.log('   📡  Powered by Hyperledger Fabric');
    console.log('═'.repeat(60));
}

function displayInputParameters() {
    console.log(`\n⚙️   Config:`);
    console.log(`   Channel     : ${channelName}`);
    console.log(`   Chaincode   : ${chaincodeName}`);
    console.log(`   MSP ID      : ${mspId}`);
    console.log(`   Peer        : ${peerEndpoint}`);
}
