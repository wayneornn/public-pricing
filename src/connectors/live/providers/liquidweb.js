import { createInventoryItem } from "../../../core/inventory.js";
import { buildGpuLabel, compactMetadata, numberOrNull, round, truthyEnv } from "../format.js";

// LiquidWeb — managed GPU hosting. There is no public GPU pricing API (the page's
// schema.org Product block carries only a single aggregate "from" price), but the public
// GPU hosting page renders one card per config where the heading binds a model + VRAM to
// a list and discounted hourly price:
//   ... (x2) H100 NVL 94GB ... $6.85/hr  25% off  $5.14/hr
//   ... L40S Ada 48GB ... $1.92/hr  25% off  $1.44/hr
// We read the model, an optional "(xN)" GPU count, the in-name VRAM, and the discounted
// (current) hourly USD price (whole-instance; per-GPU = price / count). It is managed
// hosting with no live stock/exact deploy listing route, so rows are a price catalog
// (provider_console), not orderable. Enable with LIQUIDWEB_ENABLED=1 (opt-in).
const LIQUIDWEB_PRICING_URL = "https://www.liquidweb.com/gpu-hosting/";

export const liquidwebConnector = {
  id: "liquidweb",
  name: "LiquidWeb",
  envVars: ["LIQUIDWEB_ENABLED"],
  async fetch(env) {
    if (!truthyEnv(env.LIQUIDWEB_ENABLED)) return [];
    const url = env.LIQUIDWEB_PRICING_URL || LIQUIDWEB_PRICING_URL;
    const response = await fetch(url, {
      headers: { Accept: "text/html", "User-Agent": "gpu-deal-terminal" },
      signal: AbortSignal.timeout(Number(env.LIQUIDWEB_TIMEOUT_MS || 30_000))
    });
    if (!response.ok) throw new Error(`liquidweb pricing page ${response.status}`);
    return liquidwebHtmlToItems(await response.text(), { url });
  }
};

export function liquidwebHtmlToItems(htmlText = "", { url = LIQUIDWEB_PRICING_URL } = {}) {
  return extractLiquidwebCards(htmlText)
    .map((card) => liquidwebCardToItem(card, { url }))
    .filter(Boolean);
}

// Each card heading reads "[(xN) ]<MODEL> <VRAM>GB" and is immediately followed (after
// markup) by "$<list>/hr" then, when discounted, "<pct>% off $<discounted>/hr". The
// heading text and its price pair are bound by capturing the heading then the next price(s)
// in the same block.
export function extractLiquidwebCards(htmlText = "") {
  const cards = [];
  const seen = new Set();
  const text = stripTags(htmlText);
  // The model is a GPU token (contains a digit, e.g. H100/L40S/L4/A100) optionally followed
  // by one trailing word (NVL/Ada). Anchoring on the digit-bearing token keeps the flattened
  // marketing copy that precedes a card ("BEST FOR HEAVY WORKLOADS", "1 TB Out bandwidth")
  // out of the model name.
  const cardRe = /(?:\(x(\d+)\)\s*)?([A-Z][A-Za-z]*\d[A-Za-z0-9]*(?:\s+[A-Za-z]+)?)\s+(\d+)\s*GB\s*\$([0-9]+(?:\.[0-9]+)?)\/hr(?:\s*\d+%\s*off\s*\$([0-9]+(?:\.[0-9]+)?)\/hr)?/g;
  let match;
  while ((match = cardRe.exec(text)) !== null) {
    const model = match[2].trim();
    const vramGbEach = numberOrNull(match[3]);
    const gpuCount = match[1] ? numberOrNull(match[1]) : 1;
    const listPrice = numberOrNull(match[4]);
    const discountedPrice = match[5] != null ? numberOrNull(match[5]) : null;
    const key = `${gpuCount}x-${model}-${vramGbEach}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cards.push({
      gpuModel: `${model} ${vramGbEach}GB`.trim(),
      gpuCount,
      vramGbEach,
      listPriceUsdPerHour: listPrice,
      pricePerInstanceHourUsd: discountedPrice ?? listPrice
    });
  }
  return cards;
}

function liquidwebCardToItem(card, { url }) {
  const instancePrice = numberOrNull(card.pricePerInstanceHourUsd);
  if (!card.gpuModel || instancePrice == null || instancePrice <= 0) return null;

  const gpuCount = numberOrNull(card.gpuCount) || 1;
  const pricePerGpuHour = round(instancePrice / gpuCount, 4);
  const gpuLabel = buildGpuLabel({ count: gpuCount, model: card.gpuModel, vramGb: card.vramGbEach });

  return createInventoryItem({
    provider: "LiquidWeb",
    providerId: "liquidweb",
    rawOfferId: `gpu:${slug(`${gpuCount}x-${card.gpuModel}`)}`,
    gpuLabel,
    gpuCount,
    vramGbEach: card.vramGbEach,
    pricePerGpuHour,
    totalHourlyPrice: instancePrice,
    region: "LiquidWeb",
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
      "LiquidWeb discounted (current) hourly USD price parsed from the public GPU hosting page card; per-GPU = price / GPU count",
      "Page schema.org block carries only an aggregate 'from' price; the per-config list/discount prices come from the card headings",
      "Managed hosting with no public pricing API and no live stock/exact deploy listing route, so rows are a price catalog"
    ],
    metadata: compactMetadata({
      gpuModel: card.gpuModel,
      gpuCount,
      vramGbEach: card.vramGbEach,
      listPriceUsdPerHour: card.listPriceUsdPerHour,
      pricePerInstanceHourUsd: instancePrice,
      pricePerGpuHourUsd: pricePerGpuHour,
      sourceUrl: url
    }),
    rawPayload: { ...card, sourceUrl: url }
  });
}

function stripTags(value = "") {
  return decodeEntities(String(value).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
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
