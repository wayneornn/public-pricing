import { createInventoryItem } from "../../../core/inventory.js";
import { buildGpuLabel, compactMetadata, numberOrNull, round, truthyEnv } from "../format.js";

// FlexAI — cross-cloud training/inference orchestration. Despite the "$0.025/compute unit"
// marketing tagline, real per-GPU on-demand $/hr are published on the public pricing page as
// schema.org Offer objects in an application/ld+json block:
//   {"@type":"Offer","name":"NVIDIA H100 SXM","priceCurrency":"USD","price":"2.10", ...}
// `price` is the per-GPU on-demand hourly USD rate. (The page also shows a second, lower
// price column per GPU — spot/reserved — which is not in the canonical Offer set.) It is an
// orchestration layer with no live stock or exact deploy listing route, so rows are a price
// catalog (provider_console), not orderable. Enable with FLEXAI_ENABLED=1 (opt-in).
const FLEXAI_PRICING_URL = "https://flex.ai/pricing";

export const flexaiConnector = {
  id: "flexai",
  name: "FlexAI",
  envVars: ["FLEXAI_ENABLED"],
  async fetch(env) {
    if (!truthyEnv(env.FLEXAI_ENABLED)) return [];
    const url = env.FLEXAI_PRICING_URL || FLEXAI_PRICING_URL;
    const response = await fetch(url, {
      headers: { Accept: "text/html", "User-Agent": "gpu-deal-terminal" },
      signal: AbortSignal.timeout(Number(env.FLEXAI_TIMEOUT_MS || 30_000))
    });
    if (!response.ok) throw new Error(`flexai pricing page ${response.status}`);
    return flexaiHtmlToItems(await response.text(), { url });
  }
};

export function flexaiHtmlToItems(htmlText = "", { url = FLEXAI_PRICING_URL } = {}) {
  return extractFlexaiOffers(htmlText)
    .map((offer) => flexaiOfferToItem(offer, { url }))
    .filter(Boolean);
}

export function extractFlexaiOffers(htmlText = "") {
  const offers = [];
  const seen = new Set();
  const offerRe = /"@type":"Offer","name":"([^"]+)"[^}]*?"priceCurrency":"([^"]+)"[^}]*?"price":"([0-9]*\.?[0-9]+)"/g;
  let match;
  while ((match = offerRe.exec(htmlText)) !== null) {
    const name = decodeEntities(match[1]).trim();
    if (seen.has(name)) continue;
    seen.add(name);
    offers.push({ name, currency: match[2].toUpperCase(), pricePerGpuHour: numberOrNull(match[3]) });
  }
  return offers;
}

function flexaiOfferToItem(offer, { url }) {
  const pricePerGpuHour = numberOrNull(offer.pricePerGpuHour);
  if (!offer.name || pricePerGpuHour == null || pricePerGpuHour <= 0) return null;

  const model = offer.name.replace(/\bNVIDIA\b/gi, "").replace(/\s+/g, " ").trim();
  const gpuLabel = buildGpuLabel({ count: 1, model });

  return createInventoryItem({
    provider: "FlexAI",
    providerId: "flexai",
    rawOfferId: `offer:${slug(offer.name)}`,
    gpuLabel,
    gpuCount: 1,
    vramGbEach: null,
    pricePerGpuHour,
    totalHourlyPrice: round(pricePerGpuHour, 4),
    region: "FlexAI",
    formFactor: "vm",
    networkFabric: "Not exposed",
    currency: offer.currency || "USD",
    availability: "unknown",
    availabilityCount: null,
    checkoutUrl: url,
    sourceMode: "live",
    listingType: "gpu_sku_pricing",
    priceScope: "gpu_sku_only",
    availabilitySemantics: "price_only",
    dataNotes: [
      "FlexAI per-GPU on-demand hourly price parsed from the public pricing page's schema.org Offer block",
      "The page's secondary (lower) per-GPU price column (spot/reserved) is not emitted",
      "Cross-cloud orchestration layer with no live stock or exact deploy listing route, so rows are a price catalog"
    ],
    metadata: compactMetadata({
      offerName: offer.name,
      pricePerGpuHourUsd: pricePerGpuHour,
      billingGranularity: "hourly",
      sourceUrl: url
    }),
    rawPayload: { ...offer, sourceUrl: url }
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
