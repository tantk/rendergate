import "dotenv/config";
import express from "express";
import { paymentMiddlewareFromConfig } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactStellarScheme } from "@x402/stellar/exact/server";
import { renderUrl, closeBrowser } from "./renderer.js";
import { isFailedRender, sendRefund } from "./refund.js";

const PORT = process.env.PORT || 3001;
const PRICE = "$0.001";
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
    // Block private/link-local IP ranges
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

// Extract payer address from the PAYMENT-RESPONSE header set by x402 middleware
function getPayerFromResponse(res) {
  try {
    const header = res.getHeader("PAYMENT-RESPONSE");
    if (!header) return null;
    const decoded = JSON.parse(Buffer.from(header, "base64").toString());
    return decoded?.payer || null;
  } catch {
    return null;
  }
}

// Protected render endpoint
app.get("/render", async (req, res) => {
  const decoded = req.decodedUrl;

  try {
    console.log(`Rendering: ${decoded}`);
    const start = Date.now();
    const result = await renderUrl(decoded);
    const elapsed = Date.now() - start;

    // Check if the render actually succeeded
    const failReason = isFailedRender(result.content, result.title);
    const payerAddress = getPayerFromResponse(res);
    if (failReason && payerAddress) {
      console.log(`Bad render (${failReason}) for ${decoded} — refunding ${payerAddress}`);
      const refundHash = await sendRefund(payerAddress, "0.001", `refund:${failReason}`);

      return res.json({
        ...result,
        renderTimeMs: elapsed,
        payment: { price: PRICE, network: NETWORK },
        refund: {
          reason: failReason,
          transaction: refundHash,
          amount: "0.001 USDC",
          message: "Page was blocked or empty — payment refunded",
        },
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
    res.status(500).json({ error: "Render failed", message: err.message });
  }
});

const server = app.listen(Number(PORT), () => {
  console.log(`RenderGate listening on http://localhost:${PORT}`);
  console.log(`  Pay ${PRICE} USDC on ${NETWORK} per render`);
  console.log(`  Payments go to ${PAY_TO}`);
});

process.on("SIGTERM", async () => {
  console.log("Shutting down...");
  server.close();
  await closeBrowser();
  process.exit(0);
});
