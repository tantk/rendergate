import "dotenv/config";
import { Transaction, TransactionBuilder } from "@stellar/stellar-sdk";
import { x402Client, x402HTTPClient } from "@x402/fetch";
import { createEd25519Signer, getNetworkPassphrase } from "@x402/stellar";
import { ExactStellarScheme } from "@x402/stellar/exact/client";

const STELLAR_PRIVATE_KEY = process.env.STELLAR_PRIVATE_KEY;
const SERVER_URL = process.env.SERVER_URL || "http://localhost:3001";
const NETWORK = "stellar:testnet";
const STELLAR_RPC_URL = "https://soroban-testnet.stellar.org";

if (!STELLAR_PRIVATE_KEY) {
  console.error("ERROR: STELLAR_PRIVATE_KEY not set in .env");
  process.exit(1);
}

const targetUrl = process.argv[2] || "https://x.com/stellarorg";

async function main() {
  const renderEndpoint = `${SERVER_URL}/render?url=${encodeURIComponent(targetUrl)}`;

  // Setup x402 client
  const signer = createEd25519Signer(STELLAR_PRIVATE_KEY, NETWORK);
  const rpcConfig = { url: STELLAR_RPC_URL };
  const client = new x402Client().register(
    "stellar:*",
    new ExactStellarScheme(signer, rpcConfig),
  );
  const httpClient = new x402HTTPClient(client);

  console.log(`Target URL: ${targetUrl}`);
  console.log(`Render endpoint: ${renderEndpoint}`);
  console.log(`Paying from: ${signer.address}`);

  // Step 1: Request without payment — expect 402
  console.log("\n--- Step 1: Request without payment ---");
  const firstTry = await fetch(renderEndpoint);
  console.log(`Response: ${firstTry.status} ${firstTry.statusText}`);

  if (firstTry.status !== 402) {
    console.log("No payment required! Response:", await firstTry.text());
    return;
  }

  // Step 2: Extract payment requirements from 402 response
  console.log("\n--- Step 2: Create payment ---");
  const paymentRequired = httpClient.getPaymentRequiredResponse((name) =>
    firstTry.headers.get(name),
  );
  console.log("Payment required:", JSON.stringify(paymentRequired, null, 2));

  // Step 3: Create and configure payment payload
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

  // Step 4: Send paid request
  console.log("\n--- Step 3: Send paid request ---");
  const paymentHeaders =
    httpClient.encodePaymentSignatureHeader(paymentPayload);
  const start = Date.now();
  const paidResponse = await fetch(renderEndpoint, {
    method: "GET",
    headers: paymentHeaders,
  });
  const elapsed = Date.now() - start;

  // Step 5: Show results
  console.log(`\n--- Result (${elapsed}ms) ---`);
  console.log(`Status: ${paidResponse.status}`);

  const paymentResponse = httpClient.getPaymentSettleResponse((name) =>
    paidResponse.headers.get(name),
  );
  if (paymentResponse) {
    console.log("Settlement:", JSON.stringify(paymentResponse, null, 2));
  }

  const data = await paidResponse.json();
  console.log(`\nTitle: ${data.title}`);
  console.log(`Render time: ${data.renderTimeMs}ms`);
  console.log(`Content length: ${data.content?.length} chars`);
  console.log(`\nContent preview:\n${data.content?.substring(0, 600)}`);
}

main().catch((err) => {
  console.error("Client error:", err);
  process.exit(1);
});
