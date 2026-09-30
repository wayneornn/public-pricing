import { createInventoryItem } from "../../../core/inventory.js";
import { buildGpuLabel, compactMetadata, numberOrNull, round, truthyEnv } from "../format.js";

const HIGHRESO_HOME_URL = "https://highreso.jp/en/";
const MINUTES_PER_HOUR = 60;
const HOURS_PER_MONTH = 730;

export const highresoConnector = {
  id: "highreso",
  name: "HIGHRESO / GPUSOROBAN",
  envVars: ["HIGHRESO_ENABLED"],
  async fetch(env) {
    if (!truthyEnv(env.HIGHRESO_ENABLED)) return [];
    const url = env.HIGHRESO_HOME_URL || HIGHRESO_HOME_URL;
    const response = await fetch(url, {
      headers: { Accept: "text/html", "User-Agent": "gpu-deal-terminal" },
      signal: AbortSignal.timeout(Number(env.HIGHRESO_TIMEOUT_MS || 30_000))
    });
    if (!response.ok) throw new Error(`highreso home page ${response.status}`);
    return highresoHtmlToItems(await response.text(), { url });
  }
};

export function highresoHtmlToItems(htmlText = "", { url = HIGHRESO_HOME_URL } = {}) {
  return extractHighresoOffers(htmlText)
    .map((offer) => highresoOfferToItem(offer, { url }))
    .filter(Boolean);
}

export function extractHighresoOffers(htmlText = "") {
  const rows = [];
  const articles = [...String(htmlText).matchAll(/<article\b[^>]*class="[^"]*\bcard\b[^"]*"[^>]*>([\s\S]*?)<\/article>/gi)].map((match) => match[1]);
  const textArticles = articles.map((article) => cleanText(article));
  const b200 = textArticles.find((article) => /B200 Compute Cluster/i.test(article))?.match(/B200 Compute Cluster[\s\S]*?GPU NVIDIA B200 SXM × (\d+) \/ node[\s\S]*?GPU memory ([\d,]+) GB \/ node[\s\S]*?Interconnect ([\s\S]*?) Pricing from ¥([0-9,]+) \/ GPU \/ min/i);
  if (b200) {
    rows.push({
      model: "B200 SXM",
      gpuCount: numberOrNull(b200[1]),
      vramGbEach: round(numberOrNull(b200[2].replace(/,/g, "")) / numberOrNull(b200[1]), 2),
      networkFabric: b200[3].trim(),
      pricePerGpuHour: numberOrNull(b200[4].replace(/,/g, "")) * MINUTES_PER_HOUR,
      nativePrice: numberOrNull(b200[4].replace(/,/g, "")),
      nativeUnit: "JPY/GPU/min",
      priceQualifier: "from"
    });
  }
  const h200 = textArticles.find((article) => /AI Supercomputer Cloud/i.test(article))?.match(/AI Supercomputer Cloud[\s\S]*?GPU NVIDIA H200 SXM × (\d+) \/ node[\s\S]*?GPU memory ([\d,]+) GB \/ node[\s\S]*?Interconnect ([\s\S]*?) Pricing ¥([0-9,]+) \/ month \/ node/i);
  if (h200) {
    const gpuCount = numberOrNull(h200[1]);
    const monthlyNode = numberOrNull(h200[4].replace(/,/g, ""));
    rows.push({
      model: "H200 SXM",
      gpuCount,
      vramGbEach: round(numberOrNull(h200[2].replace(/,/g, "")) / gpuCount, 2),
      networkFabric: h200[3].trim(),
      pricePerGpuHour: round(monthlyNode / HOURS_PER_MONTH / gpuCount, 4),
      totalHourlyPrice: round(monthlyNode / HOURS_PER_MONTH, 4),
      nativePrice: monthlyNode,
      nativeUnit: "JPY/node/month",
      priceQualifier: "monthly_equivalent"
    });
  }
  const a100 = textArticles.find((article) => /High Performance Computing Cloud/i.test(article))?.match(/High Performance Computing Cloud[\s\S]*?GPU lineup ([\s\S]*?) Top config ([\s\S]*?) vCPU[\s\S]*?Pricing from ¥([0-9,]+) \/ hour/i);
  if (a100) {
    rows.push({
      model: "A4000 / A100",
      gpuCount: 1,
      vramGbEach: null,
      networkFabric: "Not exposed",
      pricePerGpuHour: numberOrNull(a100[3].replace(/,/g, "")),
      nativePrice: numberOrNull(a100[3].replace(/,/g, "")),
      nativeUnit: "JPY/hour",
      priceQualifier: "from",
      gpuLineup: a100[1].trim(),
      topConfig: a100[2].trim()
    });
  }
  return rows;
}

function highresoOfferToItem(offer, { url }) {
  const pricePerGpuHour = numberOrNull(offer.pricePerGpuHour);
  if (!offer.model || pricePerGpuHour == null || pricePerGpuHour <= 0) return null;
  const gpuCount = offer.gpuCount || 1;
  const totalHourlyPrice = numberOrNull(offer.totalHourlyPrice) || round(pricePerGpuHour * gpuCount, 4);
  const gpuLabel = buildGpuLabel({ count: gpuCount, model: offer.model, vramGb: offer.vramGbEach });

  return createInventoryItem({
    provider: "HIGHRESO / GPUSOROBAN",
    providerId: "highreso",
    rawOfferId: `highreso:${slug(offer.model)}:${offer.nativeUnit}`,
    gpuLabel,
    gpuCount,
    vramGbEach: offer.vramGbEach,
    pricePerGpuHour: round(pricePerGpuHour, 4),
    totalHourlyPrice,
    region: "Japan",
    formFactor: gpuCount >= 8 ? "bare_metal" : "vm",
    networkFabric: offer.networkFabric || "Not exposed",
    currency: "JPY",
    availability: "unknown",
    availabilityCount: null,
    checkoutUrl: url,
    sourceMode: "live",
    listingType: "gpu_sku_pricing",
    priceScope: offer.nativeUnit === "JPY/node/month" ? "monthly_node_equivalent" : "gpu_sku_lowest",
    availabilitySemantics: "price_only",
    dataNotes: [
      "HIGHRESO public page publishes yen-denominated GPU cloud prices; minute/month rates are normalized to hourly for comparison",
      "No public stock or exact deploy listing route is exposed, so rows are a price catalog"
    ],
    metadata: compactMetadata({
      gpuModel: offer.model,
      gpuLineup: offer.gpuLineup,
      topConfig: offer.topConfig,
      nativePrice: offer.nativePrice,
      nativeUnit: offer.nativeUnit,
      priceQualifier: offer.priceQualifier,
      sourceUrl: url
    }),
    rawPayload: { ...offer, sourceUrl: url }
  });
}

function cleanText(htmlText = "") {
  return String(htmlText)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function slug(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
