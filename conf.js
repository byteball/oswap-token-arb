/*jslint node: true */
"use strict";

//exports.port = 6611;
//exports.myUrl = 'wss://mydomain.com/bb';

// for local testing
//exports.WS_PROTOCOL === 'ws://';
//exports.port = 16611;
//exports.myUrl = 'ws://127.0.0.1:' + exports.port;

exports.bServeAsHub = false;
exports.bLight = true;

exports.storage = 'sqlite';

exports.hub = process.env.testnet ? 'obyte.org/bb-test' : 'obyte.org/bb';
exports.deviceName = 'Oswap token arbitrage bot';
exports.permanent_pairing_secret = '*';
exports.control_addresses = ['DEVICE ALLOWED TO CHAT'];
exports.payout_address = 'WHERE THE MONEY CAN BE SENT TO';
exports.bSingleAddress = true;
exports.bWantNewPeers = true;
exports.KEYS_FILENAME = 'keys.json';

// TOR
exports.socksHost = '127.0.0.1';
exports.socksPort = 9050;

exports.bNoPassphrase = true;

exports.explicitStart = true;

exports.min_reserve_delta = 1e8;
exports.min_distance_delta = 1e-3;

exports.min_profit = 0.1; // in USD

exports.share = 0.8;

exports.token_registry_address = "O6H6ZIFI57X3PLTYHOCVYPP5A553CYFQ"

exports.lib_aas = [
	'5GG2PDVJ555WEUFGNPX55W2Z2T4P6BG5', 'ASXH57GPNWI5FO5KJWJWLRMVZTXBRKJX', '2R5PP7IZRWIBXAKGI6YXIYDQ4EZKAWHE', 'U75U5R3BYXVXBOTSRRDKS7HUIB63DJ2K', 'MC5KTC25FGEMSGDBD6KBYW3DUFF35OKT', 'IXBHF6T4IKMYAFGRM54F5FVMXGKCTFNT', 'FVFJQZVUWUANWRWXJ5LWVYDUP2XF7BIB',
	'U6TGY7C5SLLIPDDCEDAXHMZV7Y2DN3GK', // oswap token lib
	'N7NRF3EZHGBK3KBCINKE7Z3GZGMFO4AS', // triangular arb lib
];


exports.base_arb_aa = 'JKPIRZII4IZCUTIWP3NVWLZDO4Q3A4BC';
exports.arb_aa = '';
exports.owner = ''; // set in conf.json


console.log('finished arb conf');
