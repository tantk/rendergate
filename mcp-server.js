#!/usr/bin/env node
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Transaction, TransactionBuilder } from "@stellar/stellar-sdk";
import { x402Client, x402HTTPClient } from "@x402/fetch";
import { createEd25519Signer, getNetworkPassphrase } from "@x402/stellar";
import { ExactStellarScheme } from "@x402/stellar/exact/client";

const STELLAR_PRIVATE_KEY = process.env.STELLAR_PRIVATE_KEY;
const SERVER_URL = process.env.RENDERGATE_URL || "https://tantk-rendergate.hf.space";
const NETWORK = "stellar:testnet";
const STELLAR_RPC_URL = "https://soroban-testnet.stellar.org";

// Setup x402 payment client
let httpClient = null;
let client = null;

function getPaymentClient() {
  if (!client && STELLAR_PRIVATE_KEY) {
    const signer = createEd25519Signer(STELLAR_PRIVATE_KEY, NETWORK);
    client = new x402Client().register(
      "stellar:*",
      new ExactStellarScheme(signer, { url: STELLAR_RPC_URL }),
    );
    httpClient = new x402HTTPClient(client);
  }
  return { client, httpClient };
}

async function paidRender(url) {
  const { client, httpClient } = getPaymentClient();
  if (!client) {
    throw new Error("STELLAR_PRIVATE_KEY not set — cannot make x402 payments");
  }

  const renderEndpoint = `${SERVER_URL}/render?url=${encodeURIComponent(url)}`;

  // Step 1: Get 402 response
  const firstTry = await fetch(renderEndpoint);
  if (firstTry.status !== 402) {
    return await firstTry.json();
  }

  // Step 2: Create payment
  const paymentRequired = httpClient.getPaymentRequiredResponse((name) =>
    firstTry.headers.get(name),
  );

  let paymentPayload = await client.createPaymentPayload(paymentRequired);
  const networkPassphrase = getNetworkPassphrase(NETWORK);
  const tx = new Transaction(
    paymentPayload.payload.transaction,
    networkPassphrase,
  );
  const sorobanData = tx.toEnvelope().v1()?.tx()?.ext()?.sorobanData();
  if (sorobanData) {
    paymentPayload = {
      ...paymentPayload,
      payload: {
        ...paymentPayload.payload,
        transaction: TransactionBuilder.cloneFrom(tx, {
          fee: "1",
          sorobanData,
          networkPassphrase,
        })
          .build()
          .toXDR(),
      },
    };
  }

  // Step 3: Send paid request
  const headers = httpClient.encodePaymentSignatureHeader(paymentPayload);
  const resp = await fetch(renderEndpoint, { method: "GET", headers });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Render failed (${resp.status}): ${text}`);
  }

  return await resp.json();
}

// Create MCP server
const server = new McpServer({
  name: "rendergate",
  version: "1.0.0",
});

server.tool(
  "render_page",
  "Render a JavaScript-heavy webpage using a headless browser. Pays $0.001 USDC on Stellar per request via x402. Use this when standard HTTP fetch returns empty content from SPAs, Twitter/X, LinkedIn, DeFi apps, or Cloudflare-protected sites.",
  {
    url: z.string().url().describe("The URL to render (must be public http/https)"),
  },
  async ({ url }) => {
    try {
      const result = await paidRender(url);
      return {
        content: [
          {
            type: "text",
            text: `# ${result.title}\n\nURL: ${result.url}\nRendered: ${result.renderedAt}\nRender time: ${result.renderTimeMs}ms\nPayment: ${result.payment?.price} on ${result.payment?.network}${result.refund ? `\nRefund: ${result.refund.amount} — ${result.refund.reason} (tx: ${result.refund.transaction})` : ""}\n\n${result.content}`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  },
);

// Start
const transport = new StdioServerTransport();
await server.connect(transport);
