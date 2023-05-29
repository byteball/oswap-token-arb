// uses `aa-testkit` testing framework for AA tests. Docs can be found here `https://github.com/valyakin/aa-testkit`
// `mocha` standard functions and `expect` from `chai` are available globally
// `Testkit`, `Network`, `Nodes` and `Utils` from `aa-testkit` are available globally too
const path = require('path')
const fs = require('fs')
const _ = require('lodash')
const objectHash = require("ocore/object_hash.js");
//const { expect } = require('chai');



describe('Oswap token arb', function () {
	this.timeout(1200000)


	before(async () => {
		this.reversed = false
		this.common_ts = 1657843200
		console.error('--- starting')
		let oswap_aa = fs.readFileSync(path.join(__dirname, '../node_modules/oswap-token-aa/oswap.oscript'), 'utf8');

		this.network = await Network.create()
			.with.numberOfWitnesses(1)
			.with.asset({ pool1: {} })

			.with.agent({ lbc: path.join(__dirname, '../node_modules/oswap-v2-aa/linear-bonding-curve.oscript') })
			.with.agent({ pool_lib: path.join(__dirname, '../node_modules/oswap-v2-aa/pool-lib.oscript') })
			.with.agent({ pool_lib_by_price: path.join(__dirname, '../node_modules/oswap-v2-aa/pool-lib-by-price.oscript') })
			.with.agent({ governance_base: path.join(__dirname, '../node_modules/oswap-v2-aa/governance.oscript') })
			.with.agent({ v2Pool: path.join(__dirname, '../node_modules/oswap-v2-aa/pool.oscript') })
			.with.agent({ v2OswapFactory: path.join(__dirname, '../node_modules/oswap-v2-aa/factory.oscript') })

			.with.agent({ oswap_lib: path.join(__dirname, '../node_modules/oswap-token-aa/oswap-lib.oscript') })
			.with.agent({ sale_pool_base: path.join(__dirname, '../node_modules/oswap-token-aa/initial-sale-pool.oscript') })

			.with.agent({ arb_base: path.join(__dirname, '../oswap-token-arb.oscript') })

			.with.wallet({ oracle: {base: 1e9} })
			.with.wallet({ alice: {base: 10000e9} })
			.with.wallet({ bob: {base: 1000e9} })
			.with.explorer()
			.run()

		this.pool1 = this.network.asset.pool1
		console.error('--- agents\n', this.network.agent)
	//	console.log('--- wallets\n', this.network.wallet)
		this.alice = this.network.wallet.alice
		this.aliceAddress = await this.alice.getAddress()
		this.bob = this.network.wallet.bob
		this.bobAddress = await this.bob.getAddress()
		this.oracle = this.network.wallet.oracle
		this.oracleAddress = await this.oracle.getAddress()
		
		// make sure the launch date is in the future
		oswap_aa = oswap_aa.replace('2023-04-06 04:34:00', new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString().replace(/\..*$/, '').replace('T', ' '))
		oswap_aa = oswap_aa.replace('KMCA3VLWKLO3AWSSDA3LQIKI3OQEN7TV', this.oracleAddress)
		const { address: oswap_aa_address, error } = await this.alice.deployAgent(oswap_aa)
		expect(error).to.be.null
		this.oswap_aa = oswap_aa_address
		console.log({oswap_aa_address})

		const balance = await this.bob.getBalance()
		console.log(balance)
		expect(balance.base.stable).to.be.equal(1000e9)

		this.reserve_asset = 'base'
		this.bounce_fees = this.reserve_asset !== 'base' && { base: [{ address: this.oswap_aa, amount: 1e4 }] }
		this.network_fee_on_top = this.reserve_asset === 'base' ? 1000 : 0

		this.executeGetter = async (aaAddress, getter, args = []) => {
			const { result, error } = await this.alice.executeGetter({
				aaAddress,
				getter,
				args
			})
			if (error)
				console.log(error)
			expect(error).to.be.null
			return result
		}

		this.get_price = async (aaAddress, asset_label, bAfterInterest = true) => {
			return await this.executeGetter(aaAddress, 'get_price', [asset_label, 0, 0, bAfterInterest])
		}

		this.get_leveraged_price = async (aaAddress, asset_label, L) => {
			return await this.executeGetter(aaAddress, 'get_leveraged_price', [asset_label, L, true])
		}

		this.get_token_price = async () => {
			return await this.executeGetter(this.oswap_aa, 'get_price')
		}

		this.get_presale_prices = async () => {
			return await this.executeGetter(this.initial_sale_pool_address, 'get_prices')
		}

		this.get_exchange_result = async (tokens, delta_r) => {
			return await this.executeGetter(this.oswap_aa, 'get_exchange_result', [tokens, delta_r])
		}


		this.printAllLogs = async (response) => {
			const { response_unit, logs, aa_address, response: { responseVars } } = response
			console.log('logs', aa_address, JSON.stringify(logs, null, 2))
			console.log('resp vars', responseVars)
			if (!response_unit)
				return;
			const { unitObj } = await this.alice.getUnitInfo({ unit: response_unit })
			const payments = Utils.getExternalPayments(unitObj)
			const addresses = _.uniq(payments.map(p => p.address)).sort()
			for (let aa of addresses) {
				const { response } = await this.network.getAaResponseToUnitByAA(response_unit, aa)
				if (response)
					await this.printAllLogs(response);
			}
		}

	})


	it('Post data feed', async () => {
		const { unit, error } = await this.oracle.sendMulti({
			messages: [{
				app: 'data_feed',
				payload: {
					TVL: 0.5e6,
				}
			}],
		})
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { unitObj } = await this.oracle.getUnitInfo({ unit: unit })
		const dfMessage = unitObj.messages.find(m => m.app === 'data_feed')
		expect(dfMessage.payload).to.deep.equalInAnyOrder({
			TVL: 0.5e6,
		})
		await this.network.witnessUntilStable(unit)
	})
	
	it('Bob defines the token', async () => {
		const { error: tf_error } = await this.network.timefreeze()
		expect(tf_error).to.be.null
		
		const { unit, error } = await this.bob.triggerAaWithData({
			toAddress: this.oswap_aa,
			amount: 10000,
			data: {
				define: 1
			},
		})
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnitOnNode(this.bob, unit)
		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.validUnit

		this.asset = response.response.responseVars.asset
		this.initial_sale_pool_address = response.response.responseVars.initial_sale_pool_address

		this.x_asset = this.reversed ? 'base' : this.asset
		this.y_asset = this.reversed ? this.asset : 'base'

		this.oswap_label = this.reversed ? 'y' : 'x'
		this.gbyte_label = this.reversed ? 'x' : 'y'
	})

	it('Bob whitelists pool1', async () => {
		const { unit, error } = await this.bob.triggerAaWithData({
			toAddress: this.oswap_aa,
			amount: 10000,
			data: {
				vote_whitelist: 1,
				pool_asset: this.pool1,
			},
		})
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnitOnNode(this.bob, unit)
		console.log(response.response.error)
		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response.responseVars.message).to.be.eq("whitelisted")

		const { vars } = await this.alice.readAAStateVars(this.oswap_aa)
		expect(vars.last_asset_num).to.be.eq(1)
		expect(vars.last_group_num).to.be.eq(1)
		expect(vars['pool_vps_g1']).to.be.deep.eq({ total: 0, 'a1': 0 })
		expect(vars['pool_' + this.pool1]).to.be.deep.eq({ asset_key: 'a1', group_key: 'g1', last_lp_emissions: 0, received_emissions: 0 })

	})

	it('Alice contributes to the initial pool', async () => {
		const amount = 100e9
		const { unit, error } = await this.alice.sendMulti({
			outputs_by_asset: {
				[this.reserve_asset]: [{ address: this.initial_sale_pool_address, amount: amount + this.network_fee_on_top }],
				...this.bounce_fees
			},
		})
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnitOnNode(this.alice, unit)
		console.log(response.response.error)
		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.null
		expect(response.response.responseVars.added).to.be.eq(amount)

		const { vars } = await this.alice.readAAStateVars(this.initial_sale_pool_address)
		expect(vars['user_' + this.aliceAddress]).to.eq(amount)
		expect(vars.total).to.eq(amount)

	})

	it('Bob triggers the initial pool to buy', async () => {
		await this.network.timetravel({ shift: '3d' })
		
		const { final_price, avg_price } = await this.get_presale_prices()
		console.log({ final_price, avg_price })

		const total = 100e9
		const tokens = Math.floor(total / avg_price)

		const { unit, error } = await this.bob.triggerAaWithData({
			toAddress: this.initial_sale_pool_address,
			amount: 10000,
			data: {
				buy: 1,
			},
		})
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnitOnNode(this.bob, unit)
		console.log(response.response.error)
		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.validUnit
		expect(response.response.responseVars.message).to.be.eq("bought")

		const { vars } = await this.bob.readAAStateVars(this.initial_sale_pool_address)
		expect(vars.tokens).to.eq(tokens)
		this.avg_price = total / tokens
		this.tokens = tokens
		console.log('avg price', this.avg_price, {total, tokens})

		const { unitObj } = await this.bob.getUnitInfo({ unit: response.response_unit })
		console.log(Utils.getExternalPayments(unitObj))
		expect(Utils.getExternalPayments(unitObj)).to.deep.equalInAnyOrder([
			{
				address: this.oswap_aa,
				amount: total + this.network_fee_on_top,
			},
		])
	})

	it('Alice stakes the tokens from the initial sale', async () => {	
		const amount = this.tokens

		const { unit, error } = await this.alice.triggerAaWithData({
			toAddress: this.initial_sale_pool_address,
			amount: 10000,
			data: {
				stake: 1,
				group_key: 'g1',
				percentages: {a1: 100},
			},
		})
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnitOnNode(this.alice, unit)
		console.log(response.response.error)
		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.validUnit
		expect(response.response.responseVars.sent).to.be.eq(amount)

		const { vars: pool_vars } = await this.alice.readAAStateVars(this.initial_sale_pool_address)
		expect(pool_vars['user_' + this.aliceAddress]).to.be.undefined

		const { vars: oswap_vars } = await this.alice.readAAStateVars(this.oswap_aa)
		expect(oswap_vars['user_' + this.aliceAddress]).to.be.deepCloseTo({
			balance: amount,
			reward: 0,
			normalized_vp: amount * 4 ** ((response.timestamp - this.common_ts)/360/24/3600),
			last_stakers_emissions: 0,
			expiry_ts: response.timestamp + 4 * 360 * 24 * 3600,
		}, 0.01);

		const { unitObj } = await this.bob.getUnitInfo({ unit: response.response_unit })
		console.log(Utils.getExternalPayments(unitObj))
		expect(Utils.getExternalPayments(unitObj)).to.deep.equalInAnyOrder([
			{
				asset: this.asset,
				address: this.oswap_aa,
				amount: amount,
			},
		])

	})

	it('Alice buys tokens', async () => {
		const amount = 100e9
		const { new_price, swap_fee, arb_profit_tax, total_fee, coef_multiplier, payout, delta_s, delta_reserve } = await this.get_exchange_result(0, amount);
		expect(payout).to.be.false
		expect(delta_reserve).to.be.gt(0)
		console.log({ new_price, swap_fee, arb_profit_tax, total_fee, coef_multiplier, payout, delta_s, delta_reserve })

		const { unit, error } = await this.alice.sendMulti({
			outputs_by_asset: {
				[this.reserve_asset]: [{ address: this.oswap_aa, amount: amount + this.network_fee_on_top }],
				...this.bounce_fees
			},
		})
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnitOnNode(this.alice, unit)
	//	console.log('logs', JSON.stringify(response.logs, null, 2))
		console.log(response.response.error)
		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.validUnit

		expect(response.response.responseVars.price).to.eq(new_price)
		expect(response.response.responseVars.swap_fee).to.eq(swap_fee)
		expect(response.response.responseVars.arb_profit_tax).to.eq(arb_profit_tax)
		expect(response.response.responseVars.total_fee).to.eq(total_fee)
		expect(response.response.responseVars.coef_multiplier).to.eq(coef_multiplier)
		expect(response.response.responseVars['fee%']).to.eq((+(total_fee / amount * 100).toFixed(4)) + '%')

		const { unitObj } = await this.alice.getUnitInfo({ unit: response.response_unit })
		console.log(Utils.getExternalPayments(unitObj))
		expect(Utils.getExternalPayments(unitObj)).to.deep.equalInAnyOrder([
			{
				asset: this.asset,
				address: this.aliceAddress,
				amount: Math.floor(delta_s),
			},
		])
		this.new_issued_shares = unitObj.messages.find(m => m.app === 'payment' && m.payload.asset === this.asset).payload.outputs.find(o => o.address === this.aliceAddress).amount

		const { vars } = await this.alice.readAAStateVars(this.oswap_aa)
		console.log(vars)
		this.state = vars.state

	})


	it('Bob defines a new oswap v2 pool', async () => {
		this.base_interest_rate = 0//.3
		this.swap_fee = 0.003
		this.exit_fee = 0.005
		this.leverage_profit_tax = 0.1
		this.arb_profit_tax = 0.9
		this.alpha = 0.5
		this.beta = 1 - this.alpha
		this.pool_leverage = 10
		const { unit, error } = await this.bob.triggerAaWithData({
			toAddress: this.network.agent.v2OswapFactory,
			amount: 10000,
			data: {
				x_asset: this.x_asset,
				y_asset: this.y_asset,
				swap_fee: this.swap_fee,
				exit_fee: this.exit_fee,
				leverage_profit_tax: this.leverage_profit_tax,
				arb_profit_tax: this.arb_profit_tax,
				base_interest_rate: this.base_interest_rate,
				alpha: this.alpha,
				pool_leverage: this.pool_leverage,
			},
		})
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnitOnNode(this.bob, unit)
		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.validUnit

		this.v2_aa = response.response.responseVars.address
		expect(this.v2_aa).to.be.validAddress

		const { vars } = await this.bob.readAAStateVars(this.v2_aa)
		this.v2_pool_shares_asset = vars.lp_shares.asset
		expect(this.v2_pool_shares_asset).to.be.validUnit

		this.linear_shares = 0
		this.issued_shares = 0
		this.coef = 1
		this.balances = { x: 0, y: 0, xn: 0, yn: 0 }
		this.profits = { x: 0, y: 0 }
		this.leveraged_balances = {}

		this.v2_bounce_fees = /*this.x_asset !== 'base' && */{ base: [{ address: this.v2_aa, amount: 1e4 }] }
		this.v2_bounce_fee_on_top = this.x_asset === 'base' ? 1e4 : 0

	})
	
	
	it('Bob defines a new arbitrage AA', async () => {
		const params = {
			oswap_token_aa: this.oswap_aa,
			oswap_v2_aa: this.v2_aa,
			owner: this.bobAddress,
			reversed: this.reversed,
			nonce: 0,
		}
		const definition = ['autonomous agent', {
			base_aa: this.network.agent.arb_base,
			params
		}];
		do {
			params.nonce++;
			this.arb_aa = objectHash.getChash160(definition);
		}
		while (!this.arb_aa.startsWith('22'));
		console.log('arb AA', this.arb_aa, params)
		const { unit, error } = await this.bob.sendMulti({
			messages: [{
				app: 'definition',
				payload: {
					address: this.arb_aa,
					definition,
				}
			}],
		})
		expect(error).to.be.null
		expect(unit).to.be.validUnit
		await this.network.witnessUntilStable(unit)
	})


	it('Alice sends money to arbitrage AA', async () => {
		const amount = 100e9
		this.arb_asset = 'base'

		const { unit, error } = await this.alice.sendMulti({
			outputs_by_asset: {
			//	base: [{ address: this.arb_aa, amount: 1e4 }],
				[this.arb_asset]: [{ address: this.arb_aa, amount: amount }],
			},
			spend_unconfirmed: 'all',
		})
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnitOnNode(this.alice, unit)
		console.log(response.response.error)
		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.null
		expect(response.response.responseVars.message).to.be.eq('added')
	})



	it('Alice adds liquidity to v2 pool', async () => {
		const x_amount = (this.reversed ? 0.95 : 1) * 40e9
		const y_amount = (this.reversed ? 1 : 0.95) * 40e9
		const { unit, error } = await this.alice.sendMulti({
			outputs_by_asset: {
				[this.x_asset]: [{ address: this.v2_aa, amount: x_amount }],
				[this.y_asset]: [{ address: this.v2_aa, amount: y_amount }],
			},
			spend_unconfirmed: 'all',
		})
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
		console.log(response.response.error)
		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.validUnit
		expect(JSON.parse(response.response.responseVars.event).type).to.be.equal("add")
	})




	it('Alice buys positive L-tokens in oswap v2', async () => {
	//	return;
		const x_change = 0
		const delta_Xn = -300e6
		const L = 5
		const result = await this.executeGetter(this.v2_aa, 'get_leveraged_trade_amounts', [this.oswap_label, L, delta_Xn, 0, this.aliceAddress])
		console.log('result', result)
		const { shares, net_delta, gross_delta, avg_share_price, arb_profit_tax, total_fee, balances, leveraged_balances, initial_price, final_price } = result
		expect(leveraged_balances[(this.reversed ? -L : L) + 'x'].supply).to.be.eq(shares)
		console.log('outp', {
			[this.reversed ? this.y_asset : this.x_asset]: [{address: this.v2_aa, amount: gross_delta + x_change}],
			...this.v2_bounce_fees
		})
		
		this.leveraged_balances = leveraged_balances

		const { unit, error } = await this.alice.sendMulti({
			outputs_by_asset: {
				[this.reversed ? this.y_asset : this.x_asset]: [{address: this.v2_aa, amount: gross_delta + x_change}],
				...this.v2_bounce_fees
			},
			messages: [{
				app: 'data',
				payload: {
					buy: 1,
				//	tokens: 1,
					L: L,
					asset: this.oswap_label,
					delta: -delta_Xn, // positive
				}
			}],
		})
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnitOnNode(this.alice, unit)
	//	console.log('logs', JSON.stringify(response.logs, null, 2))
		console.log(response.response.error)
		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.null

		const { vars } = await this.alice.readAAStateVars(this.v2_aa)
		expect(vars.leveraged_balances).to.be.deep.eq(this.leveraged_balances)

		const final_x5_leveraged_price = await this.get_leveraged_price(this.v2_aa, this.oswap_label, 5)
		console.log({ final_x5_leveraged_price })
		expect(final_x5_leveraged_price).to.be.gt(1)
		expect(final_x5_leveraged_price).to.be.gt(avg_share_price)
	})
	

	it('Alice buys negative L-tokens in oswap v2', async () => {
	//	return;
		const delta_Xn = -100e6
		const L = 10
		const result = await this.executeGetter(this.v2_aa, 'get_leveraged_trade_amounts', [this.gbyte_label, L, delta_Xn, 0, this.aliceAddress])
		console.log('result', result)
		const { shares, net_delta, gross_delta, avg_share_price, arb_profit_tax, total_fee, balances, leveraged_balances, initial_price, final_price } = result
		expect(leveraged_balances[(this.reversed ? L : -L) + 'x'].supply).to.be.eq(shares)
		
		this.leveraged_balances = leveraged_balances

		const { unit, error } = await this.alice.sendMulti({
			outputs_by_asset: {
				[this.reversed ? this.x_asset : this.y_asset]: [{ address: this.v2_aa, amount: gross_delta }],
			//	base: [{ address: this.v2_aa, amount: 1e4 }],
			},
			messages: [{
				app: 'data',
				payload: {
					buy: 1,
				//	tokens: 1,
					L: L,
					asset: this.gbyte_label,
					delta: -delta_Xn, // positive
				}
			}],
		})
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnitOnNode(this.alice, unit)
	//	console.log('logs', JSON.stringify(response.logs, null, 2))
		console.log(response.response.error)
		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.null

		const { vars } = await this.alice.readAAStateVars(this.v2_aa)
		console.log('vars', vars)
	//	expect(vars.leveraged_balances).to.be.deep.eq(this.leveraged_balances)

		const final_y10_leveraged_price = await this.get_leveraged_price(this.v2_aa, this.gbyte_label, 10)
		console.log({ final_y10_leveraged_price })
		expect(final_y10_leveraged_price).to.be.gt(1)
		expect(final_y10_leveraged_price).to.be.gt(avg_share_price)
	})
	

	
	it('Alice triggers arbitrage to buy X from v2', async () => {
		await this.network.timetravel({ shift: '1h' })

		const initial_balances = await this.alice.getOutputsBalanceOf(this.arb_aa);
		console.log({initial_balances})

		const initial_token_price = await this.get_token_price()
		const initial_v2_price = await this.get_price(this.v2_aa, this.oswap_label)
		console.log({ initial_token_price, initial_v2_price })

		const { unit, error } = await this.alice.triggerAaWithData({
			toAddress: this.arb_aa,
			amount: 1e4,
			data: {
				arb: 1,
			//	share: 0.9,
			},
			spend_unconfirmed: 'all',
		})
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
	//	console.log('arb logs', JSON.stringify(response.logs, null, 2))
		await this.network.witnessUntilStable(response.response_unit)
		await this.printAllLogs(response)
		console.log(response.response.error);
		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.validUnit
		expect(response.response.responseVars.message).to.be.equal(this.reversed ? "will arb by selling X to v2 and buying from token" : "will arb by buying X from v2 and selling to token")
		console.log(response.response.responseVars);


		const token_price = await this.get_token_price()
		const v2_price = await this.get_price(this.v2_aa, this.oswap_label)
		console.log({ token_price, v2_price })

		const final_balances = await this.alice.getOutputsBalanceOf(this.arb_aa);
		console.log({final_balances})

	//	expect(1).to.eq(0)
	})
	
	it('Alice triggers arbitrage 2 to buy X from v2', async () => {
		await this.network.timetravel({ shift: '1h' })

		const initial_balances = await this.alice.getOutputsBalanceOf(this.arb_aa);
		console.log({initial_balances})

		const { unit, error } = await this.alice.triggerAaWithData({
			toAddress: this.arb_aa,
			amount: 1e4,
			data: {
				arb: 1,
			//	share: 0.9,
			},
			spend_unconfirmed: 'all',
		})
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
	//	console.log('arb logs', JSON.stringify(response.logs, null, 2))
		await this.network.witnessUntilStable(response.response_unit)
		await this.printAllLogs(response)
		console.log(response.response.error);
		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.validUnit
		expect(response.response.responseVars.message).to.be.equal(this.reversed ? "will arb by selling X to v2 and buying from token" : "will arb by buying X from v2 and selling to token")
		console.log(response.response.responseVars);

		const token_price = await this.get_token_price()
		const v2_price = await this.get_price(this.v2_aa, this.oswap_label)
		console.log({ token_price, v2_price })

		const final_balances = await this.alice.getOutputsBalanceOf(this.arb_aa);
		console.log({final_balances})

	//	expect(1).to.eq(0)
	})
	
	it('Alice triggers arbitrage 3 to buy X from v2', async () => {
		await this.network.timetravel({ shift: '1h' })

		const initial_balances = await this.alice.getOutputsBalanceOf(this.arb_aa);
		console.log({initial_balances})

		const { unit, error } = await this.alice.triggerAaWithData({
			toAddress: this.arb_aa,
			amount: 1e4,
			data: {
				arb: 1,
			//	share: 0.9,
			},
			spend_unconfirmed: 'all',
		})
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
	//	console.log('arb logs', JSON.stringify(response.logs, null, 2))
		await this.network.witnessUntilStable(response.response_unit)
		await this.printAllLogs(response)
		console.log(response.response.error);
		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.validUnit
		expect(response.response.responseVars.message).to.be.equal(this.reversed ? "will arb by selling X to v2 and buying from token" : "will arb by buying X from v2 and selling to token")
		console.log(response.response.responseVars);

		const token_price = await this.get_token_price()
		const v2_price = await this.get_price(this.v2_aa, this.oswap_label)
		console.log({ token_price, v2_price })

		const final_balances = await this.alice.getOutputsBalanceOf(this.arb_aa);
		console.log({final_balances})

	//	expect(1).to.eq(0)
	})

/*
	it('Alice triggers arbitrage again after buying', async () => {
	//	process.exit()
		const { unit, error } = await this.alice.triggerAaWithData({
			toAddress: this.arb_aa,
			amount: 1e4,
			data: {
				arb: 1,
			},
			spend_unconfirmed: 'all',
		})
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
		await this.network.witnessUntilStable(response.response_unit)
		console.log('arb logs', JSON.stringify(response.logs, null, 2))
		expect(response.response.error).to.be.eq("no arb opportunity exists")
		expect(response.bounced).to.be.true
		expect(response.response_unit).to.be.null

		expect(1).to.eq(0)
	})*/

	
	it('Alice sells Y to v2 pool in order to lower its price and increase the X price', async () => {
		await this.network.timetravel({ shift: '1h' })

		const initial_price = await this.get_price(this.v2_aa, this.oswap_label)
		const final_price = initial_price * (this.mid_price ? 1.1 : 1.2)
		console.log({ initial_price, final_price })

		const shifts_and_bounds = await this.executeGetter(this.v2_aa, 'get_shifts_and_bounds')
		console.log({shifts_and_bounds})
		const result = await this.executeGetter(this.v2_aa, 'get_swap_amounts_by_final_price', [this.gbyte_label, final_price])
		const Y_amount = result.in

		const { unit, error } = await this.alice.sendMulti({
			asset: 'base',
			base_outputs: [{address: this.v2_aa, amount: Y_amount}],
		//	asset_outputs: [{address: this.v2_aa, amount: y_amount}],
			spend_unconfirmed: 'all',
			messages: [{
				app: 'data',
				payload: {
					final_price,
				}
			}]
		})
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
		console.log(response.response.error)
		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.validUnit
		expect(JSON.parse(response.response.responseVars.event).type).to.be.equal("swap")
	})


	it('Alice triggers arbitrage to sell X to v2', async () => {
		await this.network.timetravel({ shift: '1h' })

		const initial_token_price = await this.get_token_price()
		const initial_v2_price = await this.get_price(this.v2_aa, this.oswap_label)
		console.log({ initial_token_price, initial_v2_price })

		const { unit, error } = await this.alice.triggerAaWithData({
			toAddress: this.arb_aa,
			amount: 1e4,
			data: {
				arb: 1,
				share: this.reversed ? 0.8 : 0.85,
			},
			spend_unconfirmed: 'all',
		})
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
		await this.network.witnessUntilStable(response.response_unit)
		await this.printAllLogs(response)
	//	console.log(response.response.responseVars);
		console.log(response.response.error);
		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.validUnit
		expect(response.response.responseVars.message).to.be.equal(this.reversed ? "will arb by selling X to token and buying from v2" : "will arb by buying X from token and selling to v2")

		const token_price = await this.get_token_price()
		const v2_price = await this.get_price(this.v2_aa, this.oswap_label)
		console.log({ token_price, v2_price })

	})

	it('Alice triggers arbitrage 2 to sell X to v2', async () => {
		await this.network.timetravel({ shift: '1h' })

		const { unit, error } = await this.alice.triggerAaWithData({
			toAddress: this.arb_aa,
			amount: 1e4,
			data: {
				arb: 1,
				share: this.reversed ? 0.9 : 1,
			},
			spend_unconfirmed: 'all',
		})
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
		await this.network.witnessUntilStable(response.response_unit)
		await this.printAllLogs(response)
		console.log(response.response.responseVars);
		console.log(response.response.error);
		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.validUnit
		expect(response.response.responseVars.message).to.be.equal(this.reversed ? "will arb by selling X to token and buying from v2" : "will arb by buying X from token and selling to v2")

		const token_price = await this.get_token_price()
		const v2_price = await this.get_price(this.v2_aa, this.oswap_label)
		console.log({ token_price, v2_price })

	})
	
	/*
	it('Alice triggers arbitrage again after selling', async () => {
		await this.network.timetravel({ shift: '1h' })
		const { unit, error } = await this.alice.triggerAaWithData({
			toAddress: this.arb_aa,
			amount: 1e4,
			data: {
				arb: 1,
			},
			spend_unconfirmed: 'all',
		})
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
		await this.network.witnessUntilStable(response.response_unit)

		console.log(response.response.responseVars);
		expect(response.response.error).to.be.eq("no arb opportunity exists")
		expect(response.bounced).to.be.true
		expect(response.response_unit).to.be.null
	})*/
	

	it('Bob withdraws the funds', async () => {
		const { unit, error } = await this.bob.triggerAaWithData({
			toAddress: this.arb_aa,
			amount: 1e4,
			data: {
				withdraw: 1,
				asset: this.reversed ? 'x' : 'y'
			},
			spend_unconfirmed: 'all',
		})
		expect(error).to.be.null
		expect(unit).to.be.validUnit

		const { response } = await this.network.getAaResponseToUnit(unit)
		await this.network.witnessUntilStable(response.response_unit)
		expect(response.response.error).to.be.undefined
		expect(response.bounced).to.be.false
		expect(response.response_unit).to.be.validUnit

		const { unitObj } = await this.bob.getUnitInfo({ unit: response.response_unit })
		const payments = Utils.getExternalPayments(unitObj)
		expect(payments.length).to.eq(1)
		const payment = payments[0]
		expect(payment.asset).to.be.undefined
		expect(payment.address).to.be.eq(this.bobAddress)
	//	expect(payment.amount).to.be.gt(10e9)

	})


	after(async () => {
	//	await Utils.sleep(3600 * 1000)
		await this.network.stop()
	})
})
