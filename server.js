import "dotenv/config";
import express from "express";
import { paymentMiddlewareFromConfig } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactStellarScheme } from "@x402/stellar/exact/server";
import { Transaction, Networks, Address } from "@stellar/stellar-sdk";
import { renderUrl, closeBrowser } from "./renderer.js";
import { isFailedRender, sendRefund } from "./refund.js";

const PORT = process.env.PORT || 3001;
const PRICE = "$0.001";
const REFUND_AMOUNT = "0.001";
const NETWORK = "stellar:testnet";
const FACILITATOR_URL = "https://www.x402.org/facilitator";
const PAY_TO = process.env.PAY_TO;

if (!PAY_TO) {
  console.error("ERROR: PAY_TO not set in .env");
  process.exit(1);
}

function isAllowedUrl(urlStr) {
  try {
    const parsed = new URL(urlStr);
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    const blocked = ["localhost", "127.0.0.1", "0.0.0.0", "[::1]"];
    if (blocked.includes(parsed.hostname)) return false;
    if (parsed.hostname.startsWith("[")) return false; // block all IPv6 literals
    const parts = parsed.hostname.split(".");
    if (parts[0] === "10") return false;
    if (parts[0] === "172" && +parts[1] >= 16 && +parts[1] <= 31) return false;
    if (parts[0] === "192" && parts[1] === "168") return false;
    if (parts[0] === "169" && parts[1] === "254") return false;
    return true;
  } catch {
    return false;
  }
}

// Extract payer from the payment-signature request header (Soroban auth entry)
function getPayerAddress(req) {
  try {
    const header = req.get("payment-signature") || req.get("x-payment");
    if (!header) return null;
    const decoded = JSON.parse(Buffer.from(header, "base64").toString());
    const txXdr = decoded?.payload?.transaction;
    if (!txXdr) return null;
    const tx = new Transaction(txXdr, Networks.TESTNET);
    const op = tx.operations[0];
    if (op?.auth) {
      for (const a of op.auth) {
        const creds = a.credentials();
        if (creds.switch().name === "sorobanCredentialsAddress") {
          return Address.fromScAddress(creds.address().address()).toString();
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

const app = express();

// Info endpoint (free)
app.get("/", (_, res) =>
  res.json({
    service: "RenderGate",
    description: "Pay-per-render headless browser API on Stellar x402",
    price: PRICE,
    network: NETWORK,
    usage: "GET /render?url=<encoded_url>",
  }),
);

// Health check (free)
app.get("/health", (_, res) => res.json({ status: "ok" }));

// URL validation — runs before payment to reject SSRF attempts early
app.use("/render", (req, res, next) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: "Missing ?url= parameter" });
  let decoded;
  try {
    decoded = decodeURIComponent(url);
  } catch {
    return res.status(400).json({ error: "Malformed URL encoding" });
  }
  if (!isAllowedUrl(decoded)) {
    return res
      .status(400)
      .json({ error: "URL not allowed — only public http/https URLs" });
  }
  req.decodedUrl = decoded;
  next();
});

// x402 payment middleware — protects /render
app.use(
  paymentMiddlewareFromConfig(
    {
      "GET /render": {
        accepts: {
          scheme: "exact",
          price: PRICE,
          network: NETWORK,
          payTo: PAY_TO,
          maxTimeoutSeconds: 60,
        },
        description: "Render a JS-heavy webpage and return extracted content",
      },
    },
    new HTTPFacilitatorClient({ url: FACILITATOR_URL }),
    [{ network: NETWORK, server: new ExactStellarScheme() }],
  ),
);

// Protected render endpoint
app.get("/render", async (req, res) => {
  const decoded = req.decodedUrl;

  try {
    console.log(`Rendering: ${decoded}`);
    const start = Date.now();
    const result = await renderUrl(decoded);
    const elapsed = Date.now() - start;

    const failReason = isFailedRender(result.content, result.title);
    if (failReason) {
      const payerAddress = getPayerAddress(req);
      let refund = null;
      if (payerAddress) {
        console.log(`Bad render (${failReason}) for ${decoded} — refunding ${payerAddress}`);
        const refundHash = await sendRefund(payerAddress, REFUND_AMOUNT, `refund:${failReason}`);
        refund = refundHash
          ? { transaction: refundHash, amount: `${REFUND_AMOUNT} USDC`, reason: failReason }
          : { error: "Refund failed — contact support", reason: failReason };
      }

      return res.json({
        ...result,
        renderTimeMs: elapsed,
        payment: { price: PRICE, network: NETWORK },
        refund,
      });
    }

    res.json({
      ...result,
      renderTimeMs: elapsed,
      payment: { price: PRICE, network: NETWORK },
    });
  } catch (err) {
    console.error(`Render failed for ${decoded}:`, err.message);
    if (err.message.includes("Too many concurrent")) {
      return res.status(503).json({ error: err.message });
    }
    // Attempt refund on crash
    const payerAddress = getPayerAddress(req);
    let refund = null;
    if (payerAddress) {
      const refundHash = await sendRefund(payerAddress, REFUND_AMOUNT, "refund:render_crash");
      refund = refundHash
        ? { transaction: refundHash, amount: `${REFUND_AMOUNT} USDC`, reason: "render_crash" }
        : { error: "Refund failed — contact support" };
    }
    res.status(500).json({ error: "Render failed", message: err.message, refund });
  }
});

const server = app.listen(Number(PORT), () => {
  console.log(`RenderGate listening on http://localhost:${PORT}`);
  console.log(`  Pay ${PRICE} USDC on ${NETWORK} per render`);
  console.log(`  Payments go to ${PAY_TO}`);
});

for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, async () => {
    console.log(`${sig} received, shutting down...`);
    server.close();
    await closeBrowser();
    process.exit(0);
  });
}
