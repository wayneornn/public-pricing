import { createInventoryItem } from "../../../core/inventory.js";
import { buildGpuLabel, compactMetadata, numberOrNull, round, truthyEnv } from "../format.js";

// WhiteFiber (whitefiber.com) — NVIDIA Blackwell GPU cloud/clusters. No public pricing API,
// but the public /pricing page server-renders one card per GPU binding a model heading to a
// "Starting at $X/HR" per-GPU floor:
//   <h3 class="text-size-large">B200</h3> ... Starting at ... <p class="pricing-value">$2.50/HR</p>
// The h3 model headings and pricing-value prices appear once per card in document order, so we
// pair them positionally (same approach as the Valdi connector). These are per-GPU starting
// floors → emitted as a non-orderable lowest-SKU price catalog. Enable with WHITEFIBER_ENABLED=1.
const WHITEFIBER_PRICING_URL = "https://www.whitefiber.com/pricing";

export const whitefiberConnector = {
  id: "whitefiber",
  name: "WhiteFiber",
  envVars: ["WHITEFIBER_ENABLED"],
  async fetch(env) {
    if (!truthyEnv(env.WHITEFIBER_ENABLED)) return [];
    const url = env.WHITEFIBER_PRICING_URL || WHITEFIBER_PRICING_URL;
    const response = await fetch(url, {
      headers: { Accept: "text/html", "User-Agent": "gpu-deal-terminal" },
      signal: AbortSignal.timeout(Number(env.WHITEFIBER_TIMEOUT_MS || 30_000))
    });
    if (!response.ok) throw new Error(`whitefiber pricing page ${response.status}`);
    return whitefiberHtmlToItems(await response.text(), { url });
  }
};

export function whitefiberHtmlToItems(htmlText = "", { url = WHITEFIBER_PRICING_URL } = {}) {
  return extractWhitefiberCards(htmlText)
    .map((card) => whitefiberCardToItem(card, { url }))
    .filter(Boolean);
}

// The h3 model headings and `pricing-value` prices each appear once per pricing card in the
// same document order, so we pair them positionally.
export function extractWhitefiberCards(htmlText = "") {
  const models = [...htmlText.matchAll(/<h3[^>]*>([^<]+)<\/h3>/gi)].map((m) =>
    decodeEntities(m[1]).replace(/\s+/g, " ").trim()
  );
  const prices = [...htmlText.matchAll(/pricing-value[^>]*>\s*\$([0-9]+(?:\.[0-9]+)?)\s*\/\s*HR/gi)].map((m) =>
    numberOrNull(m[1])
  );

  const cards = [];
  const count = Math.min(models.length, prices.length);
  for (let i = 0; i < count; i++) cards.push({ model: models[i], startingPricePerGpuHourUsd: prices[i] });
  return cards;
}

function whitefiberCardToItem(card, { url }) {
  const pricePerGpuHour = numberOrNull(card.startingPricePerGpuHourUsd);
  if (!card.model || pricePerGpuHour == null || pricePerGpuHour <= 0) return null;

  const model = card.model.replace(/\bNVIDIA\b/gi, "").replace(/\s+/g, " ").trim();
  const gpuLabel = buildGpuLabel({ count: 1, model });

  return createInventoryItem({
    provider: "WhiteFiber",
    providerId: "whitefiber",
    rawOfferId: `card:${slug(card.model)}`,
    gpuLabel,
    gpuCount: 1,
    vramGbEach: null,
    pricePerGpuHour,
    totalHourlyPrice: round(pricePerGpuHour, 4),
    region: "WhiteFiber",
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
      `WhiteFiber "Starting at $X/HR" per-GPU floor for ${model} parsed from the public pricing page`,
      "Starting/from price (per-GPU floor); exhaustive per-config rates are not published",
      "No public provisioning/pricing API and no live stock or deploy route, so rows are a price catalog"
    ],
    metadata: compactMetadata({
      gpuModel: card.model,
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
