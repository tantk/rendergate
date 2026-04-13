---
title: RenderGate
emoji: 🔍
colorFrom: blue
colorTo: purple
sdk: docker
app_port: 7860
---

# RenderGate

**Pay-per-render headless browser API, powered by x402 micropayments on Stellar.**

AI agents struggle with JavaScript-rendered websites — SPAs, Twitter/X, DeFi apps, and Cloudflare-protected sites all return empty HTML shells to standard HTTP fetch. RenderGate solves this with a headless browser rendering service that agents pay for per-request via x402 micropayments in USDC on Stellar.

**Live service:** https://tantk-rendergate.hf.space

## How It Works

1. Agent requests `GET /render?url=https://x.com/stellarorg`
2. Server responds with **402 Payment Required** + Stellar payment instructions
3. Agent signs a $0.001 USDC payment on Stellar testnet
4. Server verifies payment via x402 facilitator, settles on-chain (~5s)
5. Playwright renders the page with smart wait + scroll for lazy content
6. Agent receives fully rendered content with title, text, and metadata

## The Problem

```
# Standard HTTP fetch on Twitter/X:
curl https://x.com/stellarorg
→ Empty SPA shell. No tweets. No content.

# RenderGate ($0.001 USDC on Stellar):
→ "Stellar @StellarOrg · 9,913 posts · 840K Followers"
→ "Meridian is headed to Lisbon. October 28–29."
→ "10 days until Stellar House. Who's joining us in CDMX?"
→ Full tweets, engagement metrics, retweets, quoted content
```

## Tested Sites

All tested against the live deployed service at `tantk-rendergate.hf.space` with real Stellar testnet payments. Every request is a verifiable on-chain transaction.

### Social Media

| Site | Render Time | Result |
|------|-------------|--------|
| x.com (Twitter profiles) | 8-11s | Full tweets, bios, follower counts, engagement metrics, retweets |
| linkedin.com (company pages) | 5.7s | Full profile, about, employees, locations |
| tiktok.com (profiles) | 5.4s | Profile metadata, follower counts (video content needs login) |
| instagram.com | 3.7s | Login wall only |

### Crypto Exchanges

| Site | Render Time | Result |
|------|-------------|--------|
| coinbase.com/price | 4.9s | Full price page, charts, market data (21K chars) |
| okx.com/price | 6.6s | Full price page, live data |
| kraken.com/prices | 7.5s | Full price page, history, about |
| binance.com/price | — | Blocked (bot protection) |

### Crypto Analytics & Data

| Site | Render Time | Result |
|------|-------------|--------|
| coingecko.com | 8.9s | Full token page, price, market cap, charts (37K chars) |
| coinmarketcap.com | 6.0s | Full token page, rankings, data |
| defillama.com | 3.6s | TVL, fees, revenue, protocol rankings |
| dexscreener.com | 5.7s | Live pair data — price, volume, liquidity, buy/sell ratio |
| stellar.expert | 4.5s | Block explorer, network stats |
| stellarchain.io | 4.7s | Explorer, price, assets |
| solscan.io | 4.4s | Solana explorer, analytics |
| etherscan.io | — | Blocked (Cloudflare challenge) |
| nansen.ai | 3.7s | Landing page content |
| messari.io | — | Blocked (Vercel security checkpoint) |

### Crypto News

| Site | Render Time | Result |
|------|-------------|--------|
| cointelegraph.com | 4.2s | Headlines, prices, articles |
| decrypt.co | 4.0s | Full news feed, coin prices (14K chars) |
| blockworks.co | 7.4s | Analytics, prices, articles |
| theblock.co | 5.2s | News content (behind cookie wall) |

### Stellar Ecosystem

| Site | Render Time | Result |
|------|-------------|--------|
| stellar.expert | 4.5s | Block explorer, network stats |
| stellarchain.io | 4.7s | Explorer, price, assets |
| dashboard.stellar.org | 4.4s | Live network status, stats (6.5K chars) |
| meridian.stellar.org | 7.2s | Conference details — Lisbon 2026 |
| stellarterm.com | 5.3s | DEX trading interface |
| stellarx.com | 5.4s | DEX, markets |
| lobstr.co | 4.2s | Wallet landing, trade features |
| soroswap.finance | 3.7s | Soroban DEX aggregator content |
| freighter.app | 3.2s | Wallet download page |
| scopuly.com | 6.3s | Full wallet/DEX interface |
| lumenswap.io | 3.6s | DEX landing page |

### DeFi Apps

| Site | Render Time | Result |
|------|-------------|--------|
| app.uniswap.org | 7.3s | Live token prices, swap UI, TVL stats |
| aave.com | 3.4s | Full landing, product info |
| compound.finance | 3.1s | Market data, protocol stats |
| blur.io | 3.5s | NFT marketplace, collections, floor prices |

### On-Chain Analytics

| Site | Render Time | Result |
|------|-------------|--------|
| tokenterminal.com | 5.1s | Stellar project page, metrics |
| artemis.xyz | 5.1s | Full analytics platform (26K chars) |
| flipsidecrypto.xyz | 3.9s | Data platform landing |

### Developer Tools

| Site | Render Time | Result |
|------|-------------|--------|
| npmjs.com | 4.6s | Full package pages + README (Cloudflare-protected, works) |
| github.com (issues) | 6.3s | Full issue lists, content |
| dorahacks.io | 6.5s | Full SPA content — hackathon details, resources |

### Blocked Sites

These sites block requests from data center IPs regardless of rendering — this is an IP reputation issue, not a rendering limitation.

| Site | Reason |
|------|--------|
| reddit.com | IP banned from HF's data center |
| producthunt.com | Cloudflare challenge |
| binance.com | Bot protection |
| etherscan.io | Cloudflare challenge |
| messari.io | Vercel security checkpoint |
| instagram.com | Requires login |
| medium.com | Server error (500) |
| opensea.io | Cloudflare challenge |
| dune.com | Cloudflare block |
| alchemy.com | Blocked |

Example transaction: [`5c898eb4...`](https://stellar.expert/explorer/testnet/tx/5c898eb489265c142baee086d502e25b87a5536e4386e5ccdf69edc2515c0ef6)

## Using the Service

Any x402-compatible agent can use RenderGate with just the URL. No API keys, no accounts, no setup.

```javascript
import { wrapFetchWithPayment } from "@x402/fetch";

// One line — the library handles 402 → pay → retry automatically
const response = await paidFetch(
  "https://tantk-rendergate.hf.space/render?url=https://x.com/stellarorg"
);
const data = await response.json();
// { title: "Stellar (@StellarOrg) / X", content: "9,913 posts...", ... }
```

That's it. The agent just needs:
- `@x402/fetch` + `@x402/stellar` (npm packages)
- A Stellar wallet with USDC
- Our URL

## Try It

`demo-client.js` is included to test the service end-to-end. It walks through the x402 payment flow step by step.

```bash
npm install
cp .env.example .env
# Add your Stellar testnet secret key (STELLAR_PRIVATE_KEY)
SERVER_URL=https://tantk-rendergate.hf.space node demo-client.js "https://x.com/stellarorg"
```

You'll need a Stellar testnet wallet funded with USDC — generate one at [lab.stellar.org](https://lab.stellar.org/account/create), fund it, add a USDC trustline, and get testnet USDC from [faucet.circle.com](https://faucet.circle.com).

## API

### `GET /` (free)
Returns service info and usage instructions.

### `GET /health` (free)
Health check.

### `GET /render?url=<encoded_url>` (paid — $0.001 USDC)
Renders the URL with a headless browser and returns:
```json
{
  "title": "Stellar (@StellarOrg) / X",
  "content": "9,913 posts... 840.1K Followers... Meridian is headed to Lisbon...",
  "url": "https://x.com/stellarorg",
  "renderedAt": "2026-04-13T06:59:12.395Z",
  "renderTimeMs": 8071,
  "payment": { "price": "$0.001", "network": "stellar:testnet" }
}
```

## Architecture

```
Agent                    RenderGate                  Stellar
  |                          |                          |
  |--- GET /render?url= --->|                          |
  |<-- 402 Payment Required -|                          |
  |                          |                          |
  |--- Sign USDC payment ---|------------------------->|
  |--- GET + payment header->|                          |
  |                          |--- verify via x402.org ->|
  |                          |<-- settlement confirmed -|
  |                          |                          |
  |                          |--- Playwright render --->| (browser)
  |<-- 200 + rendered JSON --|                          |
```

## Tech Stack

- **Payment:** x402 protocol on Stellar (USDC testnet)
- **Facilitator:** x402.org (OpenZeppelin-based, sponsored fees)
- **Rendering:** Playwright with Chromium (smart wait + scroll)
- **Server:** Express.js
- **Deployment:** Hugging Face Spaces (Docker)

## Built For

[Stellar Hacks: Agents](https://dorahacks.io/hackathon/stellar-agents-x402-stripe-mpp) hackathon — exploring x402 micropayments for the agentic economy on Stellar.
