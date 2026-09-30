import { createInventoryItem } from "../../../core/inventory.js";
import { buildGpuLabel, compactMetadata, numberOrNull, round, truthyEnv } from "../format.js";

// Neysa (neysa.ai) — Nebula AI GPU cloud. No public pricing API, but the public /pricing page
// (WordPress) server-renders one card per GPU binding a model+VRAM heading to a "Starts at $X
// / hour" per-GPU floor:
//   <p ...>H100 SXM (80GB)</p> Starts at $4.39 / hour
// These are per-GPU starting/from floors → emitted as a non-orderable lowest-SKU price
// catalog. Enable with NEYSA_ENABLED=1 (opt-in).
const NEYSA_PRICING_URL = "https://neysa.ai/pricing";

export const neysaConnector = {
  id: "neysa",
  name: "Neysa",
  envVars: ["NEYSA_ENABLED"],
  async fetch(env) {
    if (!truthyEnv(env.NEYSA_ENABLED)) return [];
    const url = env.NEYSA_PRICING_URL || NEYSA_PRICING_URL;
    const response = await fetch(url, {
      headers: { Accept: "text/html", "User-Agent": "gpu-deal-terminal" },
      signal: AbortSignal.timeout(Number(env.NEYSA_TIMEOUT_MS || 30_000))
    });
    if (!response.ok) throw new Error(`neysa pricing page ${response.status}`);
    return neysaHtmlToItems(await response.text(), { url });
  }
};

export function neysaHtmlToItems(htmlText = "", { url = NEYSA_PRICING_URL } = {}) {
  return extractNeysaCards(htmlText)
    .map((card) => neysaCardToItem(card, { url }))
    .filter(Boolean);
}

// Each card is a "<model> (<vram>GB)" heading immediately followed by a "Starts at $X / hour"
// per-GPU floor; we capture the (model, vram, price) triple per card.
export function extractNeysaCards(htmlText = "") {
  const cards = [];
  const re = />\s*([A-Za-z0-9][^<>]*?\(\s*(\d+)\s*GB\s*\))\s*<\/p>[\s\S]{0,250}?Starts at[\s\S]{0,40}?\$([0-9]+(?:\.[0-9]+)?)[\s\S]{0,30}?\/\s*hour/gi;
  let m;
  while ((m = re.exec(htmlText)) !== null) {
    cards.push({
      heading: decodeEntities(m[1]).replace(/\s+/g, " ").trim(),
      vramGbEach: numberOrNull(m[2]),
      startingPricePerGpuHourUsd: numberOrNull(m[3])
    });
  }
  return cards;
}

function neysaCardToItem(card, { url }) {
  const pricePerGpuHour = numberOrNull(card.startingPricePerGpuHourUsd);
  if (!card.heading || pricePerGpuHour == null || pricePerGpuHour <= 0) return null;

  // Heading reads e.g. "H100 SXM (80GB)" — drop the VRAM paren from the model token.
  const model = card.heading.replace(/\(\s*\d+\s*GB\s*\)/i, "").replace(/\s+/g, " ").trim();
  const gpuLabel = buildGpuLabel({ count: 1, model, vramGb: card.vramGbEach });

  return createInventoryItem({
    provider: "Neysa",
    providerId: "neysa",
    rawOfferId: `card:${slug(card.heading)}`,
    gpuLabel,
    gpuCount: 1,
    vramGbEach: card.vramGbEach,
    pricePerGpuHour,
    totalHourlyPrice: round(pricePerGpuHour, 4),
    region: "Neysa",
    formFactor: "vm",
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
      `Neysa "Starts at $X / hour" per-GPU floor for ${model} parsed from the public pricing page`,
      "Starting/from price (on-demand floor); exhaustive per-config rates are not published",
      "No public provisioning/pricing API and no live stock or deploy route, so rows are a price catalog"
    ],
    metadata: compactMetadata({
      gpuModel: card.heading,
      vramGbEach: card.vramGbEach,
      startingPricePerGpuHourUsd: pricePerGpuHour,
      priceQualifier: "starts_at",
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
