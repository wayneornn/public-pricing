import { createInventoryItem } from "../../../core/inventory.js";
import { buildGpuLabel, compactMetadata, numberOrNull, round, truthyEnv } from "../format.js";

const AIRON_HOME_URL = "https://www.airon.ai/";

export const aironConnector = {
  id: "airon",
  name: "Airon",
  envVars: ["AIRON_ENABLED"],
  async fetch(env) {
    if (!truthyEnv(env.AIRON_ENABLED)) return [];
    const url = env.AIRON_HOME_URL || AIRON_HOME_URL;
    const response = await fetch(url, {
      headers: { Accept: "text/html", "User-Agent": "gpu-deal-terminal" },
      signal: AbortSignal.timeout(Number(env.AIRON_TIMEOUT_MS || 30_000))
    });
    if (!response.ok) throw new Error(`airon home page ${response.status}`);
    return aironHtmlToItems(await response.text(), { url });
  }
};

export function aironHtmlToItems(htmlText = "", { url = AIRON_HOME_URL } = {}) {
  return extractAironOffers(htmlText)
    .map((offer) => aironOfferToItem(offer, { url }))
    .filter(Boolean);
}

export function extractAironOffers(htmlText = "") {
  const offers = [];
  const scripts = [...String(htmlText).matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const match of scripts) {
    try {
      const json = JSON.parse(decodeEntities(match[1]).trim());
      collectOffers(json, offers);
    } catch {
      // Ignore unrelated malformed structured-data blocks.
    }
  }
  return offers;
}

function collectOffers(value, offers) {
  if (Array.isArray(value)) {
    for (const entry of value) collectOffers(entry, offers);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (value.itemOffered?.name && value.itemOffered?.offers?.price) {
    offers.push({
      name: value.itemOffered.name,
      description: value.itemOffered.description,
      price: numberOrNull(value.itemOffered.offers.price),
      currency: value.itemOffered.offers.priceCurrency || "USD"
    });
  }
  for (const entry of Object.values(value)) collectOffers(entry, offers);
}

function aironOfferToItem(offer, { url }) {
  const pricePerGpuHour = numberOrNull(offer.price);
  if (!offer.name || pricePerGpuHour == null || pricePerGpuHour <= 0) return null;
  const availableGpuCounts = extractGpuCounts(offer.description);
  const gpuCount = 1;
  const model = offer.name.replace(/\bNVIDIA\b|®|™/gi, "").replace(/\s+/g, " ").trim();
  const gpuLabel = buildGpuLabel({ count: gpuCount, model });

  return createInventoryItem({
    provider: "Airon",
    providerId: "airon",
    rawOfferId: `airon:${slug(model)}`,
    gpuLabel,
    gpuCount,
    vramGbEach: vramFromText(`${offer.name} ${offer.description}`),
    pricePerGpuHour: round(pricePerGpuHour, 4),
    totalHourlyPrice: round(pricePerGpuHour * gpuCount, 4),
    region: "Sweden",
    formFactor: /hgx|gb200|b200/i.test(offer.name) ? "bare_metal" : "vm",
    networkFabric: /nvlink/i.test(offer.description) ? "NVLink" : "Not exposed",
    currency: offer.currency || "USD",
    availability: "unknown",
    availabilityCount: null,
    checkoutUrl: url,
    sourceMode: "live",
    listingType: "gpu_sku_pricing",
    priceScope: "gpu_sku_lowest",
    availabilitySemantics: "price_only",
    dataNotes: [
      "Airon public structured data publishes per-GPU hourly USD starting prices",
      "No live stock or exact deploy listing route is exposed publicly, so rows are a price catalog"
    ],
    metadata: compactMetadata({
      gpuModel: offer.name,
      description: offer.description,
      availableGpuCounts,
      priceQualifier: "from",
      billingGranularity: "hourly",
      sourceUrl: url
    }),
    rawPayload: { ...offer, sourceUrl: url }
  });
}

function extractGpuCounts(value = "") {
  return [...String(value).matchAll(/(\d+)\s*x/gi)].map((match) => numberOrNull(match[1])).filter(Boolean);
}

function vramFromText(value = "") {
  const match = String(value).match(/(\d+)\s*GB/i);
  return match ? numberOrNull(match[1]) : null;
}

function slug(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function decodeEntities(value = "") {
  return String(value).replace(/&quot;/g, "\"").replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'");
}
