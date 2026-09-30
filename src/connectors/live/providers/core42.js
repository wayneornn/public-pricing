import { createInventoryItem } from "../../../core/inventory.js";
import { buildGpuLabel, compactMetadata, numberOrNull, round, truthyEnv } from "../format.js";

// Core42 — UAE-based AI cloud (G42). Pay-as-you-go is console-signup only with no public
// pricing API, but the public AI Cloud product page renders per-GPU "From $X/hr" cards:
//   <div class="slide-right-title"><h5>NVIDIA H100</h5></div>
//   <div class="slide-sub-title"><h6>Price: From $2.50/hr</h6></div>
// These are per-GPU on-demand *starting/from* floors (some SKUs, e.g. GB300 and Cerebras
// WSE-3, are "On Request" and dropped). Rows are emitted as a lowest-SKU price catalog
// (provider_console), not orderable. Enable with CORE42_ENABLED=1 (opt-in).
const CORE42_PRICING_URL = "https://www.core42.ai/products/ai-cloud";

export const core42Connector = {
  id: "core42",
  name: "Core42",
  envVars: ["CORE42_ENABLED"],
  async fetch(env) {
    if (!truthyEnv(env.CORE42_ENABLED)) return [];
    const url = env.CORE42_PRICING_URL || CORE42_PRICING_URL;
    const response = await fetch(url, {
      headers: { Accept: "text/html", "User-Agent": "gpu-deal-terminal" },
      signal: AbortSignal.timeout(Number(env.CORE42_TIMEOUT_MS || 30_000))
    });
    if (!response.ok) throw new Error(`core42 product page ${response.status}`);
    return core42HtmlToItems(await response.text(), { url });
  }
};

export function core42HtmlToItems(htmlText = "", { url = CORE42_PRICING_URL } = {}) {
  return extractCore42Cards(htmlText)
    .map((card) => core42CardToItem(card, { url }))
    .filter(Boolean);
}

// Each card binds a model heading to the immediately-following price sub-title. Cards whose
// sub-title is "On Request" (no $/hr) are skipped.
export function extractCore42Cards(htmlText = "") {
  const cards = [];
  const seen = new Set();
  const cardRe = /slide-right-title"[^>]*>\s*<h\d[^>]*>([^<]+)<\/h\d>[\s\S]*?slide-sub-title"[^>]*>\s*<h\d[^>]*>([^<]*)<\/h\d>/gi;
  let match;
  while ((match = cardRe.exec(htmlText)) !== null) {
    const model = decodeEntities(match[1]).trim();
    const priceText = decodeEntities(match[2]).trim();
    const priceMatch = /\$\s*([0-9]+(?:\.[0-9]+)?)\s*\/\s*hr/i.exec(priceText);
    if (!model || !priceMatch) continue; // "On Request" / unpriced cards skipped
    if (seen.has(model)) continue;
    seen.add(model);
    cards.push({ gpuModel: model, startingPricePerGpuHourUsd: numberOrNull(priceMatch[1]) });
  }
  return cards;
}

function core42CardToItem(card, { url }) {
  const pricePerGpuHour = numberOrNull(card.startingPricePerGpuHourUsd);
  if (!card.gpuModel || pricePerGpuHour == null || pricePerGpuHour <= 0) return null;

  const model = card.gpuModel.replace(/\b(NVIDIA|AMD)\b/gi, "").replace(/\s+/g, " ").trim();
  const gpuLabel = buildGpuLabel({ count: 1, model });

  return createInventoryItem({
    provider: "Core42",
    providerId: "core42",
    rawOfferId: `card:${slug(card.gpuModel)}`,
    gpuLabel,
    gpuCount: 1,
    vramGbEach: null,
    pricePerGpuHour,
    totalHourlyPrice: round(pricePerGpuHour, 4),
    region: "Core42 AI Cloud",
    formFactor: "bare_metal",
    networkFabric: "Not exposed",
    currency: "USD",
    availability: "unknown",
    availabilityCount: null,
    checkoutUrl: url,
    sourceMode: "live",
    listingType: "gpu_sku_pricing",
    priceScope: "gpu_sku_lowest",
    availabilitySemantics: "price_only",
    dataNotes: [
      `Core42 "From $X/hr" per-GPU floor parsed from the public AI Cloud product page card`,
      "Starting/from price (on-demand floor); 'On Request' SKUs (e.g. GB300, Cerebras WSE-3) are not captured",
      "Console-signup only with no public pricing API and no live stock or exact deploy listing route"
    ],
    metadata: compactMetadata({
      gpuModel: card.gpuModel,
      startingPricePerGpuHourUsd: pricePerGpuHour,
      priceQualifier: "from",
      billingGranularity: "hourly",
      sourceUrl: url
    }),
    rawPayload: { ...card, sourceUrl: url }
  });
}

function slug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function decodeEntities(value = "") {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x27;|&#39;/g, "'");
}
