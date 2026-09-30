import { createInventoryItem } from "../../../core/inventory.js";
import { buildGpuLabel, compactMetadata, numberOrNull, round, truthyEnv } from "../format.js";

// Northflank — GPU PaaS (deploy platform on managed/BYO cloud).
//
// The public API does not expose Northflank's managed GPU prices: GET
// api.northflank.com/v1/plans returns only CPU compute plans (no GPU), and GET
// api.northflank.com/v1/cloud-providers/node-types returns an unpriced hardware spec
// catalog across hyperscalers (gcp/aws/azure/oci/coreweave/civo) that duplicates instance
// types already covered directly. Northflank's own all-inclusive (GPU+CPU+RAM+storage,
// per-second) managed GPU prices are published as rendered cards on the pricing page:
//   <h4>NVIDIA H100 80GB</h4> ... $<2.74> / hour
// We scrape those cards. It is a deploy platform with no live stock or exact listing
// route, so rows are a price catalog (provider_console), not orderable. Opt-in via
// NORTHFLANK_ENABLED.
const NORTHFLANK_PRICING_URL = "https://northflank.com/pricing";

export const northflankConnector = {
  id: "northflank",
  name: "Northflank",
  envVars: ["NORTHFLANK_ENABLED"],
  async fetch(env) {
    if (!truthyEnv(env.NORTHFLANK_ENABLED)) return [];
    const url = env.NORTHFLANK_PRICING_URL || NORTHFLANK_PRICING_URL;
    const response = await fetch(url, {
      headers: { Accept: "text/html", "User-Agent": "gpu-deal-terminal" },
      signal: AbortSignal.timeout(Number(env.NORTHFLANK_TIMEOUT_MS || 30_000))
    });
    if (!response.ok) throw new Error(`northflank pricing page ${response.status}`);
    return northflankHtmlToItems(await response.text(), { url });
  }
};

export function northflankHtmlToItems(htmlText = "", { url = NORTHFLANK_PRICING_URL } = {}) {
  return extractNorthflankGpuCards(htmlText)
    .map((card) => northflankCardToItem(card, { url }))
    .filter(Boolean);
}

// Each GPU is a rendered card: an <h4>NVIDIA <model> <vram>GB</h4> heading followed,
// within the same card block, by a "$<price> / hour" amount. The lookahead bounds each
// card so a heading only ever binds to its own price.
export function extractNorthflankGpuCards(htmlText = "") {
  const cards = [];
  const cardRe = /<h4[^>]*>NVIDIA ([^<]+)<\/h4>([\s\S]*?)(?=<h4[^>]*>NVIDIA |$)/g;
  let match;
  while ((match = cardRe.exec(htmlText)) !== null) {
    const heading = decodeEntities(match[1]).trim();
    const priceMatch = /\$\s*<span>\s*([0-9]+(?:\.[0-9]+)?)\s*<\/span>\s*<span>\s*\/\s*hour/i.exec(match[2]);
    if (!priceMatch) continue; // unpriced (e.g. "Contact"/coming-soon) cards are skipped
    const vramMatch = /(\d+)\s*GB\s*$/i.exec(heading);
    cards.push({
      heading,
      gpuModel: heading.replace(/\s*\d+\s*GB\s*$/i, "").trim(),
      vramGbEach: vramMatch ? numberOrNull(vramMatch[1]) : null,
      pricePerGpuHourUsd: numberOrNull(priceMatch[1])
    });
  }
  return cards;
}

function northflankCardToItem(card, { url }) {
  const pricePerGpuHour = numberOrNull(card.pricePerGpuHourUsd);
  if (!card.gpuModel || pricePerGpuHour == null || pricePerGpuHour <= 0) return null;

  const gpuLabel = buildGpuLabel({ count: 1, model: card.gpuModel, vramGb: card.vramGbEach });

  return createInventoryItem({
    provider: "Northflank",
    providerId: "northflank",
    rawOfferId: `gpu:${slug(card.heading)}`,
    gpuLabel,
    gpuCount: 1,
    vramGbEach: card.vramGbEach,
    pricePerGpuHour,
    totalHourlyPrice: round(pricePerGpuHour, 4),
    region: "Northflank Managed Cloud",
    formFactor: "container",
    networkFabric: "Not exposed",
    currency: "USD",
    availability: "unknown",
    availabilityCount: null,
    checkoutUrl: url,
    sourceMode: "live",
    listingType: "gpu_sku_pricing",
    priceScope: "gpu_sku_only",
    availabilitySemantics: "price_only",
    dataNotes: [
      "Northflank all-inclusive managed GPU price (GPU+CPU+RAM+storage, billed per second) parsed from the public pricing page card",
      "Public API exposes only CPU compute plans (/v1/plans) and an unpriced hardware catalog (/v1/cloud-providers/node-types); no managed GPU price endpoint",
      "Deploy PaaS: page lists a price but no live stock/capacity or exact deploy listing route"
    ],
    metadata: compactMetadata({
      heading: card.heading,
      gpuModel: card.gpuModel,
      vramGbEach: card.vramGbEach,
      pricePerGpuHourUsd: pricePerGpuHour,
      billingGranularity: "per-second",
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
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, " ");
}
