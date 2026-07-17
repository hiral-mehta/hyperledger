/*
 * Inter-Bank Fund Transfer & Settlement System
 * Hyperledger Fabric Chaincode Entry Point
 */

'use strict';

const InterbankTransfer = require('./lib/interbankTransfer');

module.exports.InterbankTransfer = InterbankTransfer;
module.exports.contracts = [InterbankTransfer];
