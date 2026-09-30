import { createInventoryItem } from "../../../core/inventory.js";
import { buildGpuLabel, compactMetadata, numberOrNull, round, truthyEnv } from "../format.js";

// ionstream.ai — bare-metal NVIDIA GPU systems (L40S / H200 / B200). The "API" in
// marketing copy is a WordPress site with no public catalog/pricing API (no api/console/
// docs subdomain). The homepage publishes per-GPU "Pricing starts at $X p/hr" floors in
// repeatable solution cards:
//   <... solutions-item__title> NVIDIA <model> ... Pricing starts at $<price> p/hr ...
// These are per-GPU on-demand *starting/from* floors (reserved/spot tiers also exist), so
// rows are emitted as a lowest-SKU price catalog (provider_console), not orderable. No key
// needed; enable with IONSTREAM_ENABLED=1 (kept opt-in so default/offline runs make no
// network call).
const IONSTREAM_HOME_URL = "https://ionstream.ai/";
const CARD_RE = /solutions-item__title[^>]*>\s*(?:<[^>]+>\s*)*(?:NVIDIA\s*)?(L40S|H200|H100|B200|MI300X|MI355X)\b[\s\S]{0,400}?Pricing starts at\s*\$([0-9]+(?:\.[0-9]+)?)\s*p\/?hr/gi;

export const ionstreamConnector = {
  id: "ionstream",
  name: "ionstream.ai",
  envVars: ["IONSTREAM_ENABLED"],
  async fetch(env) {
    if (!truthyEnv(env.IONSTREAM_ENABLED)) return [];
    const url = env.IONSTREAM_HOME_URL || IONSTREAM_HOME_URL;
    const response = await fetch(url, {
      headers: { Accept: "text/html", "User-Agent": "gpu-deal-terminal" },
      signal: AbortSignal.timeout(Number(env.IONSTREAM_TIMEOUT_MS || 30_000))
    });
    if (!response.ok) throw new Error(`ionstream home page ${response.status}`);
    return ionstreamHtmlToItems(await response.text(), { url });
  }
};

export function ionstreamHtmlToItems(htmlText = "", { url = IONSTREAM_HOME_URL } = {}) {
  return extractIonstreamCards(htmlText)
    .map((card) => ionstreamCardToItem(card, { url }))
    .filter(Boolean);
}

export function extractIonstreamCards(htmlText = "") {
  const cards = [];
  const seen = new Set();
  let match;
  CARD_RE.lastIndex = 0;
  while ((match = CARD_RE.exec(htmlText)) !== null) {
    const model = match[1].toUpperCase();
    if (seen.has(model)) continue; // one row per model (cards can repeat across sections)
    seen.add(model);
    cards.push({ gpuModel: model, startingPricePerGpuHourUsd: numberOrNull(match[2]) });
  }
  return cards;
}

function ionstreamCardToItem(card, { url }) {
  const pricePerGpuHour = numberOrNull(card.startingPricePerGpuHourUsd);
  if (!card.gpuModel || pricePerGpuHour == null || pricePerGpuHour <= 0) return null;

  const gpuLabel = buildGpuLabel({ count: 1, model: card.gpuModel });

  return createInventoryItem({
    provider: "ionstream.ai",
    providerId: "ionstream",
    rawOfferId: `card:${card.gpuModel.toLowerCase()}`,
    gpuLabel,
    gpuCount: 1,
    vramGbEach: null, // not exposed on the card; taxonomy fills known models
    pricePerGpuHour,
    totalHourlyPrice: round(pricePerGpuHour, 4),
    region: "ionstream.ai",
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
      `ionstream.ai "Pricing starts at" per-GPU/hr floor parsed from the public homepage solution card`,
      "Starting/from price (on-demand floor); reserved 1-3yr and spot tiers also exist and are not captured",
      "Marketing site with no public catalog/pricing API; page lists a starting price but no live stock or exact deploy listing route"
    ],
    metadata: compactMetadata({
      gpuModel: card.gpuModel,
      startingPricePerGpuHourUsd: pricePerGpuHour,
      priceQualifier: "starts_at",
      billingGranularity: "hourly",
      sourceUrl: url
    }),
    rawPayload: { ...card, sourceUrl: url }
  });
}
