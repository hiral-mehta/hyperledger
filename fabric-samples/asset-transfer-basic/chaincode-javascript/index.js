/*
 * Copyright IBM Corp. All Rights Reserved.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict';

const interbankTransfer = require('./lib/interbankTransfer');

module.exports.InterbankTransfer = interbankTransfer;
module.exports.contracts = [interbankTransfer];
