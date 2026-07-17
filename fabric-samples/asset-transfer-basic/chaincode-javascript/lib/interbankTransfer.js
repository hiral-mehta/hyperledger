/*
 * Inter-Bank Fund Transfer & Settlement System
 * Hyperledger Fabric Smart Contract
 *
 * Features:
 *  - Account creation with bank association
 *  - Balance validation before transfer
 *  - Secure fund transfer with immutable transaction records
 *  - Full audit trail and settlement traceability
 */

'use strict';

const stringify = require('json-stringify-deterministic');
const sortKeysRecursive = require('sort-keys-recursive');
const { Contract } = require('fabric-contract-api');

class InterbankTransfer extends Contract {

    // Returns a deterministic timestamp from the tx proposal (same on all peers)
    _getTxTimestamp(ctx) {
        const ts = ctx.stub.getTxTimestamp();
        return new Date(ts.seconds.low * 1000).toISOString();
    }

    // ─────────────────────────────────────────────
    // LEDGER INITIALIZATION
    // ─────────────────────────────────────────────

    async InitLedger(ctx) {
        const accounts = [
            {
                docType: 'account',
                accountId: 'ACC001',
                accountHolder: 'Rahul Sharma',
                bankName: 'State Bank of India',
                bankCode: 'SBI001',
                balance: 500000,
                currency: 'INR',
                status: 'ACTIVE',
                createdAt: this._getTxTimestamp(ctx),
            },
            {
                docType: 'account',
                accountId: 'ACC002',
                accountHolder: 'Priya Patel',
                bankName: 'HDFC Bank',
                bankCode: 'HDFC001',
                balance: 750000,
                currency: 'INR',
                status: 'ACTIVE',
                createdAt: this._getTxTimestamp(ctx),
            },
            {
                docType: 'account',
                accountId: 'ACC003',
                accountHolder: 'Amit Verma',
                bankName: 'ICICI Bank',
                bankCode: 'ICICI001',
                balance: 1000000,
                currency: 'INR',
                status: 'ACTIVE',
                createdAt: this._getTxTimestamp(ctx),
            },
        ];

        for (const account of accounts) {
            await ctx.stub.putState(
                account.accountId,
                Buffer.from(stringify(sortKeysRecursive(account)))
            );
            console.log(`Initialized account: ${account.accountId}`);
        }
    }

    // ─────────────────────────────────────────────
    // ACCOUNT MANAGEMENT
    // ─────────────────────────────────────────────

    /**
     * CreateAccount - Register a new bank account on the ledger
     * @param {String} accountId   - Unique account identifier
     * @param {String} accountHolder - Full name of account holder
     * @param {String} bankName    - Name of the bank
     * @param {String} bankCode    - Unique bank code (e.g. SBI001)
     * @param {String} initialBalance - Opening balance
     * @param {String} currency    - Currency code (e.g. INR, USD)
     */
    async CreateAccount(ctx, accountId, accountHolder, bankName, bankCode, initialBalance, currency) {
        const exists = await this.AccountExists(ctx, accountId);
        if (exists) {
            throw new Error(`Account ${accountId} already exists`);
        }

        const balance = parseFloat(initialBalance);
        if (isNaN(balance) || balance < 0) {
            throw new Error('Initial balance must be a non-negative number');
        }

        const account = {
            docType: 'account',
            accountId,
            accountHolder,
            bankName,
            bankCode,
            balance,
            currency,
            status: 'ACTIVE',
            createdAt: this._getTxTimestamp(ctx),
        };

        await ctx.stub.putState(
            accountId,
            Buffer.from(stringify(sortKeysRecursive(account)))
        );

        // Emit account creation event
        await ctx.stub.setEvent('AccountCreated', Buffer.from(JSON.stringify({ accountId, bankName, accountHolder })));

        return JSON.stringify(account);
    }

    /**
     * GetAccount - Read account details from ledger
     */
    async GetAccount(ctx, accountId) {
        const accountJSON = await ctx.stub.getState(accountId);
        if (!accountJSON || accountJSON.length === 0) {
            throw new Error(`Account ${accountId} does not not exist`);
        }
        return accountJSON.toString();
    }

    /**
     * FreezeAccount - Freeze an account (e.g. for compliance/audit)
     */
    async FreezeAccount(ctx, accountId) {
        const accountString = await this.GetAccount(ctx, accountId);
        const account = JSON.parse(accountString);
        account.status = 'FROZEN';
        await ctx.stub.putState(
            accountId,
            Buffer.from(stringify(sortKeysRecursive(account)))
        );
        return JSON.stringify({ success: true, accountId, status: 'FROZEN' });
    }

    /**
     * UnfreezeAccount - Reactivate a frozen account
     */
    async UnfreezeAccount(ctx, accountId) {
        const accountString = await this.GetAccount(ctx, accountId);
        const account = JSON.parse(accountString);
        account.status = 'ACTIVE';
        await ctx.stub.putState(
            accountId,
            Buffer.from(stringify(sortKeysRecursive(account)))
        );
        return JSON.stringify({ success: true, accountId, status: 'ACTIVE' });
    }

    /**
     * AccountExists - Check if account exists
     */
    async AccountExists(ctx, accountId) {
        const accountJSON = await ctx.stub.getState(accountId);
        return accountJSON && accountJSON.length > 0;
    }

    // ─────────────────────────────────────────────
    // FUND TRANSFER
    // ─────────────────────────────────────────────

    /**
     * InitiateTransfer - Transfer funds between two bank accounts
     * @param {String} txnId         - Unique transaction ID
     * @param {String} fromAccountId - Sender's account ID
     * @param {String} toAccountId   - Receiver's account ID
     * @param {String} amount        - Amount to transfer
     * @param {String} remarks       - Optional transfer remarks
     */
    async InitiateTransfer(ctx, txnId, fromAccountId, toAccountId, amount, remarks) {
        // Validate transaction ID uniqueness
        const txnKey = `TXN_${txnId}`;
        const existingTxn = await ctx.stub.getState(txnKey);
        if (existingTxn && existingTxn.length > 0) {
            throw new Error(`Transaction ${txnId} already exists`);
        }

        const transferAmount = parseFloat(amount);
        if (isNaN(transferAmount) || transferAmount <= 0) {
            throw new Error('Transfer amount must be a positive number');
        }

        // Load sender account
        const fromAccountJSON = await ctx.stub.getState(fromAccountId);
        if (!fromAccountJSON || fromAccountJSON.length === 0) {
            throw new Error(`Sender account ${fromAccountId} does not exist`);
        }
        const fromAccount = JSON.parse(fromAccountJSON.toString());

        // Load receiver account
        const toAccountJSON = await ctx.stub.getState(toAccountId);
        if (!toAccountJSON || toAccountJSON.length === 0) {
            throw new Error(`Receiver account ${toAccountId} does not exist`);
        }
        const toAccount = JSON.parse(toAccountJSON.toString());

        // Validate account statuses
        if (fromAccount.status !== 'ACTIVE') {
            throw new Error(`Sender account ${fromAccountId} is ${fromAccount.status}. Cannot transfer.`);
        }
        if (toAccount.status !== 'ACTIVE') {
            throw new Error(`Receiver account ${toAccountId} is ${toAccount.status}. Cannot receive funds.`);
        }

        // Validate currency match
        if (fromAccount.currency !== toAccount.currency) {
            throw new Error(`Currency mismatch: ${fromAccount.currency} vs ${toAccount.currency}`);
        }

        // Balance check
        if (fromAccount.balance < transferAmount) {
            throw new Error(
                `Insufficient balance. Available: ${fromAccount.balance} ${fromAccount.currency}, ` +
                `Requested: ${transferAmount} ${fromAccount.currency}`
            );
        }

        const timestamp = this._getTxTimestamp(ctx);

        // Debit sender
        fromAccount.balance = parseFloat((fromAccount.balance - transferAmount).toFixed(2));

        // Credit receiver
        toAccount.balance = parseFloat((toAccount.balance + transferAmount).toFixed(2));

        // Build transaction record
        const transaction = {
            docType: 'transaction',
            txnId,
            fromAccountId,
            fromBank: fromAccount.bankName,
            fromBankCode: fromAccount.bankCode,
            toAccountId,
            toBank: toAccount.bankName,
            toBankCode: toAccount.bankCode,
            amount: transferAmount,
            currency: fromAccount.currency,
            remarks: remarks || '',
            status: 'SETTLED',
            initiatedAt: timestamp,
            settledAt: timestamp,
        };

        // Write updated accounts and transaction atomically
        await ctx.stub.putState(
            fromAccountId,
            Buffer.from(stringify(sortKeysRecursive(fromAccount)))
        );
        await ctx.stub.putState(
            toAccountId,
            Buffer.from(stringify(sortKeysRecursive(toAccount)))
        );
        await ctx.stub.putState(
            txnKey,
            Buffer.from(stringify(sortKeysRecursive(transaction)))
        );

        // Emit transfer event for external listeners
        await ctx.stub.setEvent('FundTransferred', Buffer.from(JSON.stringify({
            txnId,
            fromAccountId,
            toAccountId,
            amount: transferAmount,
            currency: fromAccount.currency,
            timestamp,
        })));

        return JSON.stringify(transaction);
    }

    // ─────────────────────────────────────────────
    // AUDIT & QUERY
    // ─────────────────────────────────────────────

    /**
     * GetTransaction - Retrieve a specific transaction record
     */
    async GetTransaction(ctx, txnId) {
        const txnKey = `TXN_${txnId}`;
        const txnJSON = await ctx.stub.getState(txnKey);
        if (!txnJSON || txnJSON.length === 0) {
            throw new Error(`Transaction ${txnId} not found`);
        }
        return txnJSON.toString();
    }

    /**
     * GetAccountHistory - Full immutable history of an account (audit trail)
     */
    async GetAccountHistory(ctx, accountId) {
        const exists = await this.AccountExists(ctx, accountId);
        if (!exists) {
            throw new Error(`Account ${accountId} does not exist`);
        }

        const historyIterator = await ctx.stub.getHistoryForKey(accountId);
        const history = [];
        let result = await historyIterator.next();

        while (!result.done) {
            console.log('DEBUG: result.value.timestamp structure is:', typeof result.value.timestamp, result.value.timestamp);
            let txTimestamp = new Date().toISOString();
            if (result.value.timestamp) {
                let seconds = 0;
                if (result.value.timestamp.seconds) {
                    console.log('DEBUG: result.value.timestamp.seconds is:', typeof result.value.timestamp.seconds, result.value.timestamp.seconds);
                    if (typeof result.value.timestamp.seconds.low === 'number') {
                        seconds = result.value.timestamp.seconds.low;
                    } else if (typeof result.value.timestamp.seconds === 'number') {
                        seconds = result.value.timestamp.seconds;
                    } else if (typeof result.value.timestamp.seconds.toNumber === 'function') {
                        seconds = result.value.timestamp.seconds.toNumber();
                    }
                }
                console.log('DEBUG: parsed seconds is:', seconds);
                if (seconds > 0) {
                    txTimestamp = new Date(seconds * 1000).toISOString();
                }
            }

            let data = '';
            if (result.value.value && result.value.value.toString()) {
                data = result.value.value.toString('utf8');
            }

            const entry = {
                txId: result.value.txId,
                timestamp: txTimestamp,
                isDelete: !!result.value.isDelete,
                data: data,
            };
            history.push(entry);
            result = await historyIterator.next();
        }

        await historyIterator.close();
        return JSON.stringify(history);
    }

    /**
     * GetAllAccounts - List all accounts on the ledger
     */
    async GetAllAccounts(ctx) {
        const allResults = [];
        const iterator = await ctx.stub.getStateByRange('', '');
        let result = await iterator.next();

        while (!result.done) {
            const strValue = Buffer.from(result.value.value.toString()).toString('utf8');
            try {
                const record = JSON.parse(strValue);
                if (record.docType === 'account') {
                    allResults.push(record);
                }
            } catch (err) {
                console.log(err);
            }
            result = await iterator.next();
        }
        await iterator.close();
        return JSON.stringify(allResults);
    }

    /**
     * GetAllTransactions - List all settlement records on the ledger
     */
    async GetAllTransactions(ctx) {
        const allResults = [];
        const iterator = await ctx.stub.getStateByRange('TXN_', 'TXN_~');
        let result = await iterator.next();

        while (!result.done) {
            const strValue = Buffer.from(result.value.value.toString()).toString('utf8');
            try {
                const record = JSON.parse(strValue);
                allResults.push(record);
            } catch (err) {
                console.log(err);
            }
            result = await iterator.next();
        }
        await iterator.close();
        return JSON.stringify(allResults);
    }

    /**
     * GetBalance - Get current balance of an account
     */
    async GetBalance(ctx, accountId) {
        const accountString = await this.GetAccount(ctx, accountId);
        const account = JSON.parse(accountString);
        return JSON.stringify({
            accountId,
            accountHolder: account.accountHolder,
            bankName: account.bankName,
            balance: account.balance,
            currency: account.currency,
            status: account.status,
        });
    }
}

module.exports = InterbankTransfer;
