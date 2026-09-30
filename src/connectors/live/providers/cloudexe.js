import { createInventoryItem } from "../../../core/inventory.js";
import { buildGpuLabel, compactMetadata, numberOrNull, round, truthyEnv } from "../format.js";

const CLOUDEXE_HOME_URL = "https://cloudexe.tech/";

export const cloudexeConnector = {
  id: "cloudexe",
  name: "Cloudexe",
  envVars: ["CLOUDEXE_ENABLED"],
  async fetch(env) {
    if (!truthyEnv(env.CLOUDEXE_ENABLED)) return [];
    const url = env.CLOUDEXE_HOME_URL || CLOUDEXE_HOME_URL;
    const response = await fetch(url, {
      headers: { Accept: "text/html", "User-Agent": "gpu-deal-terminal" },
      signal: AbortSignal.timeout(Number(env.CLOUDEXE_TIMEOUT_MS || 30_000))
    });
    if (!response.ok) throw new Error(`cloudexe home page ${response.status}`);
    return cloudexeHtmlToItems(await response.text(), { url });
  }
};

export function cloudexeHtmlToItems(htmlText = "", { url = CLOUDEXE_HOME_URL } = {}) {
  return extractCloudexeTiers(htmlText)
    .map((tier) => cloudexeTierToItem(tier, { url }))
    .filter(Boolean);
}

export function extractCloudexeTiers(htmlText = "") {
  const currentRows = extractCurrentCloudexeRows(htmlText);
  if (currentRows.length) return currentRows;

  const rows = [];
  const cardRe = /<div class="price-tier">([^<]+)<\/div>[\s\S]*?<div class="price-amount">\$([0-9]+(?:\.[0-9]+)?)<span class="price-unit">\/([^<]+)<\/span>/gi;
  let match;
  while ((match = cardRe.exec(htmlText)) !== null) {
    rows.push({
      tier: cleanText(match[1]),
      model: modelFromUnit(match[3]) || "H100",
      vramGbEach: null,
      pricePerGpuHour: numberOrNull(match[2]),
      unit: cleanText(match[3])
    });
  }
  return rows.filter((row) => /on-demand/i.test(row.tier) || !/silver|spot/i.test(row.tier));
}

function cloudexeTierToItem(tier, { url }) {
  const pricePerGpuHour = numberOrNull(tier.pricePerGpuHour);
  const model = normalizeGpuModel(tier.model || modelFromUnit(tier.unit));
  if (pricePerGpuHour == null || pricePerGpuHour <= 0 || !model) return null;
  const gpuLabel = buildGpuLabel({ count: 1, model, vramGb: tier.vramGbEach });

  return createInventoryItem({
    provider: "Cloudexe",
    providerId: "cloudexe",
    rawOfferId: `cloudexe:${slug(tier.tier)}:${slug(model)}`,
    gpuLabel,
    gpuCount: 1,
    vramGbEach: tier.vramGbEach,
    pricePerGpuHour: round(pricePerGpuHour, 4),
    totalHourlyPrice: round(pricePerGpuHour, 4),
    region: "Cloudexe",
    formFactor: "container",
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
      "Cloudexe public home page publishes per-GPU hourly prices by tier",
      "Spot/savings tiers are dropped when an on-demand tier is exposed",
      "No public stock or exact deploy listing route is exposed, so rows are a price catalog"
    ],
    metadata: compactMetadata({
      tier: tier.tier,
      gpuModel: model,
      vramGbEach: tier.vramGbEach,
      unit: tier.unit,
      billingGranularity: "hourly",
      sourceUrl: url
    }),
    rawPayload: { ...tier, sourceUrl: url }
  });
}

function extractCurrentCloudexeRows(htmlText = "") {
  const rows = [];
  const sectionRe = /<div class="pricing-type">([^<]+)<\/div>([\s\S]*?)(?=<div class="pricing-type">|<\/section>|$)/gi;
  let sectionMatch;
  while ((sectionMatch = sectionRe.exec(htmlText)) !== null) {
    const tier = cleanText(sectionMatch[1]);
    if (!/on-demand/i.test(tier)) continue;
    const section = sectionMatch[2];
    const rowRe = /<div class="gpu-name">([^<]+)<\/div>\s*<div class="gpu-spec">([^<]*)<\/div>[\s\S]*?<div class="price-val">\$([0-9]+(?:\.[0-9]+)?)<span class="price-unit">([^<]+)<\/span>/gi;
    let rowMatch;
    while ((rowMatch = rowRe.exec(section)) !== null) {
      rows.push({
        tier,
        model: normalizeGpuModel(rowMatch[1]),
        vramGbEach: parseVramGb(rowMatch[2]),
        pricePerGpuHour: numberOrNull(rowMatch[3]),
        unit: cleanText(rowMatch[4])
      });
    }
  }
  return rows;
}

function normalizeGpuModel(value = "") {
  const text = cleanText(value).toUpperCase();
  return /^(H100|H200|B200)$/.test(text) ? text : "";
}

function modelFromUnit(value = "") {
  return String(value).match(/\b(H100|H200|B200)\b/i)?.[1]?.toUpperCase() || "";
}

function parseVramGb(value = "") {
  return numberOrNull(String(value).match(/(\d+(?:\.\d+)?)\s*GB/i)?.[1]);
}

function cleanText(value = "") {
  return String(value).replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

function slug(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
