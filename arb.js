"use strict";
var crypto = require('crypto');
const _ = require('lodash');

const eventBus = require('ocore/event_bus.js');
const conf = require('ocore/conf.js');
const mutex = require('ocore/mutex.js');
const network = require('ocore/network.js');
const device = require('ocore/device.js');
const aa_composer = require("ocore/aa_composer.js");
const storage = require("ocore/storage.js");
const db = require("ocore/db.js");
const constants = require("ocore/constants.js");
const light_wallet = require("ocore/light_wallet.js");

const dag = require('aabot/dag.js');
const operator = require('aabot/operator.js');
const aa_state = require('aabot/aa_state.js');
const light_data_feeds = conf.bLight ? require('aabot/light_data_feeds.js') : null;

const xmutex = require("./xmutex");


let arbsByAAs = {};
let prev_trigger_initial_unit;

let arbInfo = {};


let lastArbTs = 0;

let prevStateHash;

let busy = false;

const sha256 = str => crypto.createHash("sha256").update(str, "utf8").digest("base64");

function wait(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForAaStateToEmpty() {
	const unlock = await mutex.lock('aa_free');
	while (true) {
		const ts = Date.now();
		const aa_unlock = await aa_state.lock();
		aa_unlock();
		const elapsed = Date.now() - ts;
		if (elapsed <= 1)
			break;
		console.log(`taking aa_state lock took ${elapsed}ms, will wait more`);
	}
	process.nextTick(unlock); // delay unlock to give a chance to the immediately following code to lock aa_state
}

function getWaitTimeTillNextArb() {
	return lastArbTs + 3000 - Date.now();
}


async function queueEstimateAndArb(arb_aa) {
	if (busy)
		return console.log(`arb ${arb_aa} already busy or queued`);
	busy = true;
	console.log(`arb ${arb_aa} added to busy`);
	await estimateAndArbUnderArbLock(arb_aa);
}

async function estimateAndArbUnderArbLock(arb_aa) {
	await xmutex.lock();
	await estimateAndArb(arb_aa);
	await xmutex.unlock();
}

async function estimateAndArb(arb_aa) {
	await waitForAaStateToEmpty();
	const unlock = await mutex.lock('estimate');
	console.log('===== estimateAndArb arb ' + arb_aa);
	const timeout = getWaitTimeTillNextArb();
	if (timeout > 0) {
		setTimeout(() => estimateAndArbUnderArbLock(arb_aa), timeout + 10);
		return unlock(`too fast after the previous arb, will estimate again in ${timeout}ms`);
	}

	const finish = (msg) => {
		busy = false;
		console.log(`arb ${arb_aa} removed from busy`);
		unlock(msg);
	};

	
	// simulate an arb request
	const aa_unlock = await aa_state.lock();
	let upcomingStateVars = _.cloneDeep(aa_state.getUpcomingStateVars());
	let upcomingBalances = _.cloneDeep(aa_state.getUpcomingBalances());
	const arb_balances = upcomingBalances[arb_aa];
	const { x_asset, y_asset, oswap_v2_aa } = arbInfo;
	if (!arb_balances[x_asset] && !arb_balances[y_asset]) {
		console.log(`arb ${arb_aa} zero balance`, arb_balances);
		aa_unlock();
		return finish();
	}
	const v2_balances = upcomingBalances[oswap_v2_aa];
	if (!v2_balances[x_asset] || !v2_balances[y_asset]) {
		console.log(`arb ${arb_aa}: oswap ${oswap_v2_aa} zero balance`, balances);
		aa_unlock();
		return finish();
	}
	const state = sha256(JSON.stringify([upcomingStateVars, upcomingBalances]));

	if (state === prevStateHash) {
		console.log(`arb ${arb_aa}: the state hasn't changed`);
		aa_unlock();
		return finish();
	}
	prevStateHash = state;

	let payload = {
		arb: 1
	};
	const share = conf.share;
	if (share && share !== 1)
		payload.share = share;
	let objUnit = {
		unit: 'dummy_trigger_unit',
		authors: [{ address: operator.getAddress() }],
		messages: [
			{
				app: 'payment',
				payload: {
					outputs: [{ address: arb_aa, amount: 1e4 }]
				}
			},
			{
				app: 'data',
				payload
			},
		],
		timestamp: Math.round(Date.now() / 1000),
	};
	const start_ts = Date.now();
	let arrResponses = await aa_composer.estimatePrimaryAATrigger(objUnit, arb_aa, upcomingStateVars, upcomingBalances);
	console.log(`--- estimated responses to simulated arb request in ${Date.now() - start_ts}ms`, JSON.stringify(arrResponses, null, 2));
	aa_unlock();
	if (arrResponses[0].bounced)
		return finish(`${arb_aa} would bounce: ` + arrResponses[0].response.error);
	const balances = upcomingBalances[arb_aa];
	for (let asset in balances)
		if (balances[asset] < 0)
			return finish(`${arb_aa}: ${asset} balance would become negative: ${balances[asset]}`);
	const arbResponses = arrResponses.filter(r => r.aa_address === arb_aa);
	const lastResponse = arbResponses[arbResponses.length - 1];
	const profit = lastResponse.response.responseVars.profit;
	if (!profit)
		throw Error(`no profit in response vars from ${arb_aa}`);
	let usd_profit = profit / 1e9 * network.exchangeRates['GBYTE_USD'];
	console.log(`estimateAndArb: ${arb_aa} would succeed with profit ${profit} or $${usd_profit}`);
	if (usd_profit < conf.min_profit)
		return finish(`profit would be too small`);
	const unit = await dag.sendAARequest(arb_aa, payload);
	if (!unit)
		return finish(`sending arb request failed`);
	const objJoint = await dag.readJoint(unit);
	// upcoming state vars are updated and the next request will see them
	console.log(`estimateAndArb: ${arb_aa} calling onAARequest manually`);
	await aa_state.onAARequest({ unit: objJoint.unit, aa_address: arb_aa });
	lastArbTs = Date.now();
	finish();
}


async function onAAResponse(objAAResponse) {
	const { aa_address, trigger_unit, trigger_initial_unit, trigger_address, bounced, response } = objAAResponse;
	if (bounced && trigger_address === operator.getAddress())
		return console.log(`=== our request ${trigger_unit} bounced with error`, response.error);
	if (bounced)
		return console.log(`request ${trigger_unit} bounced with error`, response.error);
	if (!isAffected([aa_address]))
		return;
	console.log(`arb affected by response from ${aa_address} initial trigger ${trigger_initial_unit} trigger ${trigger_unit}`);
	await waitForAaStateToEmpty();
	const unlock = await mutex.lock('resp');
	if (trigger_initial_unit !== prev_trigger_initial_unit)
		await queueEstimateAndArb(conf.arb_aa);
	prev_trigger_initial_unit = trigger_initial_unit;
	unlock();
}

async function onAARequest(objAARequest, arrResponses) {
	const address = objAARequest.unit.authors[0].address;
	if (address === operator.getAddress())
		return console.log(`skipping our own request`);
	if (arrResponses[0].bounced)
		return console.log(`trigger ${objAARequest.unit.unit} from ${address} will bounce`, arrResponses[0].response.error);
	const aas = arrResponses.map(r => r.aa_address);
	console.log(`request from ${address} trigger ${objAARequest.unit.unit} affected AAs`, aas);
	if (!isAffected(aas))
		return;
	console.log(`affected arb`);
	await waitForAaStateToEmpty();
	await queueEstimateAndArb(conf.arb_aa);
}


function isAffected(aas) {
	for (let aa of aas)
		if (arbsByAAs[aa])
			return true;
	return false;
}

async function waitForStability() {
	const last_mci = await device.requestFromHub('get_last_mci', null);
	console.log(`last mci ${last_mci}`);
	while (true) {
		await wait(60 * 1000);
		const props = await device.requestFromHub('get_last_stable_unit_props', null);
		const { main_chain_index } = props;
		console.log(`last stable mci ${main_chain_index}`);
		if (main_chain_index >= last_mci)
			break;
	}
	console.log(`mci ${last_mci} is now stable`);
}



async function addArb(arb_aa) {
	console.log(`adding arb ${arb_aa}`);
	await aa_state.followAA(arb_aa);

	// follow the dependent AAs
	const { oswap_token_aa, oswap_v2_aa } = await dag.readAAParams(arb_aa);

	if (!oswap_v2_aa)
		throw Error(`unknown type of arb: ${arb_aa}`)
	await aa_state.followAA(oswap_token_aa);
	await aa_state.followAA(oswap_v2_aa);
	arbsByAAs[oswap_token_aa] = arb_aa;
	arbsByAAs[oswap_v2_aa] = arb_aa;

	const { x_asset, y_asset } = await dag.readAAParams(oswap_v2_aa);
	arbInfo = { x_asset, y_asset, oswap_v2_aa };

	const oracle = await dag.executeGetter(oswap_token_aa, 'get_oracle');
	await light_data_feeds.updateDataFeed(oracle, 'TVL');
}

async function loadLibs() {
	for (let address of conf.lib_aas) {
	//	await dag.loadAA(address);
		const definition = await dag.readAADefinition(address);
		const payload = { address, definition };
		await storage.insertAADefinitions(db, [payload], constants.GENESIS_UNIT, 0, false);
	}
}





async function startWatching() {
	if (!conf.arb_aa)
		throw Error(`please specify arb_aa in conf`);
	await loadLibs();
	await addArb(conf.arb_aa);

	await light_wallet.waitUntilFirstHistoryReceived();

	await waitForStability();

	eventBus.on("aa_request_applied", onAARequest);
	eventBus.on("aa_response_applied", onAAResponse);

	setTimeout(queueEstimateAndArb, 1000, conf.arb_aa);
}


exports.startWatching = startWatching;

