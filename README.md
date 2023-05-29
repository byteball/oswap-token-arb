# Arbitrage AA and bot for arbitraging between OSWAP token and OSWAP-GBYTE pool on Oswap


This Autonomous Agent seeks opportunities to make profit by trading between [OSWAP token](https://token.oswap.io) and the [Oswap v2](https://oswap.io) pool OSWAP-GBYTE that trades the same tokens. The AA tries to make money by buying OSWAP from OSWAP token AA and immediately selling to the Oswap v2 AA, or vice versa.

# Bot

The companion bot watches the markets and triggers the arb AA when it sees an arbitrage opportunity.

## Usage

The base AA is already deployed (see its address by opening `oswap-token-arb.oscript` in VS Code with [Oscript plugin](https://marketplace.visualstudio.com/items?itemName=obyte.oscript-vscode-plugin)), deploy your personal arbitrage AA by indicating your address in the `owner` field of your `conf.json` and running
```bash
node deploy.js
```

Run the bot:
```bash
node run.js stable-oswap2-arb 2>errlog
```

Add some money to your arb AA and a small amount (for network fees) to the bot's balance.


### Run tests
```bash
yarn test
```

