import { createInventoryItem } from "../../../core/inventory.js";
import { buildGpuLabel, compactMetadata, numberOrNull, round, truthyEnv } from "../format.js";

// CoreWeave — Kubernetes-native GPU cloud. Onboarding is enterprise/sales, and there is
// no public instance-type/pricing JSON API, but the public pricing page renders a static
// card grid (no JS hydration needed) where each GPU card carries a labeled price block:
//   <h3 class="table-model-name">NVIDIA HGX H100</h3> ...
//   On-Demand Price: $49.24 / Hour   Spot Price: $19.71 / Hour   ...
//   8 GPU Count   80 VRAM   128 vCPUs   ...
// We read the labeled On-Demand Price (whole-instance/node hourly USD) plus GPU Count and
// VRAM. Per-GPU = On-Demand / GPU Count. Spot rows are dropped. There is no live stock or
// exact deploy listing route, so rows are a price catalog (provider_console), not orderable.
// Enable with COREWEAVE_ENABLED=1 (opt-in so default/offline runs make no network call).
const COREWEAVE_PRICING_URL = "https://www.coreweave.com/pricing";

export const coreweaveConnector = {
  id: "coreweave",
  name: "CoreWeave",
  envVars: ["COREWEAVE_ENABLED"],
  async fetch(env) {
    if (!truthyEnv(env.COREWEAVE_ENABLED)) return [];
    const url = env.COREWEAVE_PRICING_URL || COREWEAVE_PRICING_URL;
    const response = await fetch(url, {
      headers: { Accept: "text/html", "User-Agent": "gpu-deal-terminal" },
      signal: AbortSignal.timeout(Number(env.COREWEAVE_TIMEOUT_MS || 30_000))
    });
    if (!response.ok) throw new Error(`coreweave pricing page ${response.status}`);
    return coreweaveHtmlToItems(await response.text(), { url });
  }
};

export function coreweaveHtmlToItems(htmlText = "", { url = COREWEAVE_PRICING_URL } = {}) {
  return extractCoreweaveCards(htmlText)
    .map((card) => coreweaveCardToItem(card, { url }))
    .filter(Boolean);
}

// Each card is delimited by the model-name heading. The detail card (the one that also
// carries the labeled "On-Demand Price:" block) is the one we keep; the summary card for
// the same model has no labels. We dedupe by model so a model appears once.
export function extractCoreweaveCards(htmlText = "") {
  const cards = [];
  const seen = new Set();
  const blockRe = /class="table-model-name"[^>]*>\s*NVIDIA\s+([^<]+?)\s*<\/h3>([\s\S]*?)(?=class="table-model-name"|class="table-grid"|$)/gi;
  let match;
  while ((match = blockRe.exec(htmlText)) !== null) {
    const model = decodeEntities(match[1]).trim();
    const text = stripTags(match[2]);
    const priceMatch = /On-Demand Price:\s*\$([0-9][0-9,]*(?:\.[0-9]+)?)\s*\/\s*Hour/i.exec(text);
    if (!priceMatch) continue; // summary card / unpriced (e.g. GB300) — keep only labeled detail cards
    if (seen.has(model)) continue;
    seen.add(model);
    const gpuCountMatch = /([0-9][0-9,]*)\s+GPU Count/i.exec(text);
    const vramMatch = /([0-9][0-9,]*)\s+VRAM/i.exec(text);
    cards.push({
      gpuModel: model,
      onDemandPriceUsdPerHour: parseNumber(priceMatch[1]),
      gpuCount: gpuCountMatch ? parseNumber(gpuCountMatch[1]) : null,
      vramGbEach: vramMatch ? parseNumber(vramMatch[1]) : null
    });
  }
  return cards;
}

function coreweaveCardToItem(card, { url }) {
  const nodePrice = numberOrNull(card.onDemandPriceUsdPerHour);
  if (!card.gpuModel || nodePrice == null || nodePrice <= 0) return null;

  const gpuCount = numberOrNull(card.gpuCount) || 1;
  const pricePerGpuHour = round(nodePrice / gpuCount, 4);
  const gpuLabel = buildGpuLabel({ count: gpuCount, model: card.gpuModel, vramGb: card.vramGbEach });

  return createInventoryItem({
    provider: "CoreWeave",
    providerId: "coreweave",
    rawOfferId: `gpu:${slug(card.gpuModel)}`,
    gpuLabel,
    gpuCount,
    vramGbEach: card.vramGbEach,
    pricePerGpuHour,
    totalHourlyPrice: nodePrice,
    region: "CoreWeave Cloud",
    formFactor: "bare_metal",
    networkFabric: "Not exposed",
    currency: "USD",
    availability: "unknown",
    availabilityCount: null,
    checkoutUrl: url,
    sourceMode: "live",
    listingType: "gpu_sku_pricing",
    priceScope: "node_total",
    availabilitySemantics: "price_only",
    dataNotes: [
      "CoreWeave On-Demand Price (whole-instance hourly USD) parsed from the public pricing page card; per-GPU = On-Demand / GPU Count",
      "Spot Price and Inference Single CPU Price rows are not emitted",
      "No public instance-type/pricing API and no live stock/exact deploy listing route (enterprise onboarding), so rows are a price catalog"
    ],
    metadata: compactMetadata({
      gpuModel: card.gpuModel,
      gpuCount,
      vramGbEach: card.vramGbEach,
      onDemandPriceUsdPerHour: nodePrice,
      pricePerGpuHourUsd: pricePerGpuHour,
      sourceUrl: url
    }),
    rawPayload: { ...card, sourceUrl: url }
  });
}

function stripTags(value = "") {
  return decodeEntities(String(value).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function parseNumber(value) {
  return numberOrNull(String(value).replace(/,/g, ""));
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
