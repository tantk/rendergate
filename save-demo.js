import "dotenv/config";
import { writeFileSync } from "fs";
import { Transaction, TransactionBuilder } from "@stellar/stellar-sdk";
import { x402Client, x402HTTPClient } from "@x402/fetch";
import { createEd25519Signer, getNetworkPassphrase } from "@x402/stellar";
import { ExactStellarScheme } from "@x402/stellar/exact/client";

const SERVER_URL = process.env.SERVER_URL || "https://tantk-rendergate.hf.space";
const NETWORK = "stellar:testnet";

const signer = createEd25519Signer(process.env.STELLAR_PRIVATE_KEY, NETWORK);
const client = new x402Client().register(
  "stellar:*",
  new ExactStellarScheme(signer, { url: "https://soroban-testnet.stellar.org" }),
);
const httpClient = new x402HTTPClient(client);

async function paidRender(targetUrl) {
  const endpoint = `${SERVER_URL}/render?url=${encodeURIComponent(targetUrl)}`;
  const r1 = await fetch(endpoint);
  if (r1.status !== 402) return await r1.json();

  const pr = httpClient.getPaymentRequiredResponse((n) => r1.headers.get(n));
  let pp = await client.createPaymentPayload(pr);
  const np = getNetworkPassphrase(NETWORK);
  const tx = new Transaction(pp.payload.transaction, np);
  const sd = tx.toEnvelope().v1()?.tx()?.ext()?.sorobanData();
  if (sd) {
    pp = {
      ...pp,
      payload: {
        ...pp.payload,
        transaction: TransactionBuilder.cloneFrom(tx, {
          fee: "1", sorobanData: sd, networkPassphrase: np,
        }).build().toXDR(),
      },
    };
  }
  const headers = httpClient.encodePaymentSignatureHeader(pp);
  const r2 = await fetch(endpoint, { headers });
  return await r2.json();
}

function formatOutput(data, targetUrl) {
  let out = `=== RenderGate: ${targetUrl} ===\n`;
  out += `Payment: ${data.payment?.price} USDC on ${data.payment?.network}\n`;
  out += `Render time: ${data.renderTimeMs}ms\n\n`;

  out += `Title: ${data.title}\n`;
  if (data.description) out += `Description: ${data.description}\n`;
  out += `\n`;

  if (data.headings?.length > 0) {
    out += `Headings (${data.headings.length}):\n`;
    data.headings.slice(0, 15).forEach((h) => {
      out += `  ${h.level}: ${h.text}\n`;
    });
    out += `\n`;
  }

  if (data.links?.length > 0) {
    out += `Links (${data.links.length}):\n`;
    data.links.slice(0, 15).forEach((l) => {
      out += `  ${l.text.substring(0, 50)} → ${l.href}\n`;
    });
    out += `\n`;
  }

  if (data.refund) {
    out += `*** AUTO-REFUND ***\n`;
    out += `Reason: ${data.refund.reason}\n`;
    out += `Refund amount: ${data.refund.amount}\n`;
    out += `Refund transaction: ${data.refund.transaction}\n`;
    out += `Verify: https://stellar.expert/explorer/testnet/tx/${data.refund.transaction}\n\n`;
  }

  out += `Content (${data.content?.length} chars):\n`;
  out += data.content || "(empty)";
  return out;
}

const sites = [
  { name: "1-twitter", url: "https://x.com/stellarorg" },
  { name: "2-linkedin", url: "https://www.linkedin.com/company/stellar-development-foundation" },
  { name: "3-soroswap", url: "https://soroswap.finance" },
  { name: "4-producthunt", url: "https://www.producthunt.com" },
];

for (const site of sites) {
  console.log(`Rendering ${site.name}...`);
  try {
    const data = await paidRender(site.url);
    const output = formatOutput(data, site.url);
    const path = `demo-output/${site.name}-with.txt`;
    writeFileSync(path, output);
    console.log(`  Saved: ${path} (${data.content?.length} chars, refund: ${!!data.refund})`);
  } catch (err) {
    console.error(`  Failed: ${err.message}`);
  }
}

console.log("Done!");
