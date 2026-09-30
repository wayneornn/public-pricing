import { createInventoryItem } from "../../../core/inventory.js";
import { buildGpuLabel, compactMetadata, numberOrNull, truthyEnv } from "../format.js";

const SLYD_COMPUTE_URL = "https://slyd.com/marketplace/compute";

export const slydConnector = {
  id: "slyd",
  name: "SLYD",
  envVars: ["SLYD_ENABLED"],
  async fetch(env) {
    if (!truthyEnv(env.SLYD_ENABLED)) return [];
    const url = env.SLYD_COMPUTE_URL || SLYD_COMPUTE_URL;
    const response = await fetch(url, {
      headers: { Accept: "text/html", "User-Agent": "gpu-deal-terminal" },
      signal: AbortSignal.timeout(Number(env.SLYD_TIMEOUT_MS || 30_000))
    });
    if (!response.ok) throw new Error(`slyd compute marketplace ${response.status}`);
    return slydHtmlToItems(await response.text(), { url });
  }
};

export function slydHtmlToItems(htmlText = "", { url = SLYD_COMPUTE_URL } = {}) {
  return extractSlydCards(htmlText)
    .map((card, index) => slydCardToItem(card, { url, index }))
    .filter(Boolean);
}

export function extractSlydCards(htmlText = "") {
  const marker = '<div class="slyd-server-card"><div class="slyd-server-card__glow">';
  return String(htmlText)
    .split(marker)
    .slice(1)
    .map((chunk) => `${marker}${chunk.split('<div class="compute-more-gpus">')[0]}`)
    .map(cardFromHtml)
    .filter((card) => card.title && card.pricePerGpuHour != null);
}

function cardFromHtml(segment = "") {
  const specs = {};
  for (const match of segment.matchAll(/slyd-server-card__spec-label">([^<]+)<\/div>\s*<div class="slyd-server-card__spec-value">([^<]+)<\/div>/gi)) {
    specs[cleanText(match[1])] = cleanText(match[2]);
  }
  const buttonTag = segment.match(/<a\b[^>]*slyd-server-card__button[^>]*>/i)?.[0] || "";
  return {
    status: cleanText(segment.match(/slyd-server-card__status-text">([^<]+)</i)?.[1]),
    tier: cleanText(segment.match(/slyd-server-card__tier[^>]*>([^<]+)</i)?.[1]),
    title: cleanText(segment.match(/slyd-server-card__title">([^<]+)</i)?.[1]),
    category: cleanText(segment.match(/slyd-server-card__category">([^<]+)</i)?.[1]),
    specs,
    location: cleanText(segment.match(/slyd-server-card__location[\s\S]*?<\/svg>\s*([^<]+)<\/div>/i)?.[1]),
    pricePerGpuHour: numberOrNull(segment.match(/slyd-server-card__price-amount">\s*\$([0-9]+(?:\.[0-9]+)?)/i)?.[1]),
    checkoutPath: cleanText(buttonTag.match(/\bhref="([^"]+)"/i)?.[1])
  };
}

function slydCardToItem(card, { url, index }) {
  const parsedGpu = parseGpu(card.specs["GPU Configuration"] || card.title);
  if (!parsedGpu.model || card.pricePerGpuHour == null || card.pricePerGpuHour <= 0) return null;
  const vramGbEach = parsedGpu.vramGbEach || numberOrNull(card.specs["Video Memory"]?.match(/([0-9]+)\s*GB/i)?.[1]);

  return createInventoryItem({
    provider: "SLYD",
    providerId: "slyd",
    rawOfferId: `slyd:${index}:${slug(card.title)}:${slug(card.location)}:${card.pricePerGpuHour}`,
    gpuLabel: buildGpuLabel({ count: parsedGpu.count, model: parsedGpu.model, vramGb: vramGbEach }),
    gpuCount: parsedGpu.count,
    vramGbEach,
    pricePerGpuHour: card.pricePerGpuHour,
    totalHourlyPrice: card.pricePerGpuHour * parsedGpu.count,
    region: card.location || "SLYD marketplace",
    formFactor: "vm",
    cpu: card.specs["CPU Cores"] || "",
    ramGb: numberOrNull(card.specs["System RAM"]?.match(/([0-9]+)\s*GB/i)?.[1]),
    networkFabric: "Not exposed",
    currency: "USD",
    availability: /available/i.test(card.status) ? "available" : "unknown",
    availabilityCount: null,
    checkoutUrl: absoluteUrl(card.checkoutPath || url),
    sourceMode: "live",
    listingType: "gpu_sku_pricing",
    priceScope: "gpu_only",
    availabilitySemantics: "sku_capacity",
    priceSemantics: "on_demand",
    dataNotes: [
      "SLYD public compute marketplace page exposes server cards with hourly USD rates and available-now status",
      "Deploy links route through login/generic marketplace filters, so rows are not checkout-proof exact listings"
    ],
    metadata: compactMetadata({
      tier: card.tier,
      category: card.category,
      specs: card.specs,
      sourceUrl: url
    }),
    rawPayload: { ...card, sourceUrl: url }
  });
}

function parseGpu(value = "") {
  const text = cleanText(value);
  const countMatch = text.match(/^([0-9]+)\s*x\s+(.+)$/i);
  const count = numberOrNull(countMatch?.[1]) || 1;
  const label = countMatch ? countMatch[2] : text;
  const vramGbEach = numberOrNull(label.match(/([0-9]+)\s*GB/i)?.[1]);
  const model = label
    .replace(/^NVIDIA\s+/i, "")
    .replace(/\s+[0-9]+\s*GB\b/ig, "")
    .replace(/\s+/g, " ")
    .trim();
  return { count, model, vramGbEach };
}

function absoluteUrl(value = "") {
  if (/^https?:\/\//i.test(value)) return value;
  return new URL(value || SLYD_COMPUTE_URL, "https://slyd.com").toString();
}

function cleanText(value = "") {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function slug(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
