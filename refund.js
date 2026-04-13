import {
  Keypair,
  Networks,
  TransactionBuilder,
  Operation,
  Asset,
  Horizon,
} from "@stellar/stellar-sdk";

const USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const USDC = new Asset("USDC", USDC_ISSUER);
const HORIZON_URL = "https://horizon-testnet.stellar.org";

const BLOCKED_PATTERNS = [
  "you've been blocked",
  "you have been blocked",
  "blocked by network security",
  "access denied",
  "please log in",
  "log in to",
  "sign in to",
  "enable javascript",
  "just a moment...",
  "checking your browser",
  "performing security verification",
  "ray id:",
  "cloudflare",
  "attention required",
  "please verify you are a human",
  "this page doesn't exist",
];

export function isFailedRender(content, title) {
  if (!content || content.length < 100) return "empty_content";

  const lower = content.toLowerCase();
  const titleLower = (title || "").toLowerCase();

  // Check title for block signals
  if (titleLower === "just a moment..." || titleLower === "blocked") {
    return "blocked_page";
  }

  // Check content for block/login patterns
  for (const pattern of BLOCKED_PATTERNS) {
    // Only flag if the blocked pattern is a large portion of the content
    // (avoid false positives on pages that mention "log in" in a nav bar)
    if (lower.includes(pattern) && content.length < 500) {
      return "blocked_page";
    }
  }

  return null; // render is good
}

export async function sendRefund(payerAddress, amount, memo) {
  const serverSecret = process.env.SERVER_SECRET;
  if (!serverSecret) {
    console.error("SERVER_SECRET not set — cannot send refund");
    return null;
  }

  try {
    const server = new Horizon.Server(HORIZON_URL);
    const keypair = Keypair.fromSecret(serverSecret);
    const account = await server.loadAccount(keypair.publicKey());

    const tx = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.payment({
          destination: payerAddress,
          asset: USDC,
          amount: amount,
        }),
      )
      .addMemo(TransactionBuilder.memo("text", (memo || "RenderGate refund").slice(0, 28)))
      .setTimeout(30)
      .build();

    tx.sign(keypair);
    const result = await server.submitTransaction(tx);
    console.log(`Refund sent to ${payerAddress}: ${result.hash}`);
    return result.hash;
  } catch (err) {
    console.error(`Refund failed for ${payerAddress}:`, err.message);
    return null;
  }
}
