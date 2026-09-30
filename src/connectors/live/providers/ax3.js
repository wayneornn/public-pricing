import { createInventoryItem } from "../../../core/inventory.js";
import { buildGpuLabel, compactMetadata, numberOrNull, round, truthyEnv } from "../format.js";

const AX3_PRICING_URL = "https://www.ax3.ai/pricing";

export const ax3Connector = {
  id: "ax3",
  name: "Ax3.Ai",
  envVars: ["AX3_ENABLED"],
  async fetch(env) {
    if (!truthyEnv(env.AX3_ENABLED)) return [];
    const url = env.AX3_PRICING_URL || AX3_PRICING_URL;
    const response = await fetch(url, {
      headers: { Accept: "text/html", "User-Agent": "gpu-deal-terminal" },
      signal: AbortSignal.timeout(Number(env.AX3_TIMEOUT_MS || 30_000))
    });
    if (!response.ok) throw new Error(`ax3 pricing page ${response.status}`);
    return ax3HtmlToItems(await response.text(), { url });
  }
};

export function ax3HtmlToItems(htmlText = "", { url = AX3_PRICING_URL } = {}) {
  return extractAx3PriceRows(htmlText)
    .map((row) => ax3RowToItem(row, { url }))
    .filter(Boolean);
}

export function extractAx3PriceRows(htmlText = "") {
  const text = cleanText(htmlText);
  const start = text.indexOf("Starting at $");
  const header = start >= 0 ? text.slice(start, start + 600) : text;
  const prices = [...header.matchAll(/Starting at\s*\$([0-9]+(?:\.[0-9]+)?)\/hr\*/gi)].map((m) => numberOrNull(m[1]));
  const labels = [...header.matchAll(/\b(GB300|B300|H200|H100|MI3XX)\b\s+Available Now/gi)].map((m) => m[1].toUpperCase());
  const count = Math.min(labels.length, prices.length);
  const rows = [];
  for (let i = 0; i < count; i++) rows.push({ model: labels[i], pricePerGpuHour: prices[i] });
  return rows;
}

function ax3RowToItem(row, { url }) {
  const pricePerGpuHour = numberOrNull(row.pricePerGpuHour);
  if (!row.model || pricePerGpuHour == null || pricePerGpuHour <= 0) return null;
  const gpuLabel = buildGpuLabel({ count: 1, model: row.model });

  return createInventoryItem({
    provider: "Ax3.Ai",
    providerId: "ax3",
    rawOfferId: `ax3:${slug(row.model)}`,
    gpuLabel,
    gpuCount: 1,
    vramGbEach: null,
    pricePerGpuHour: round(pricePerGpuHour, 4),
    totalHourlyPrice: round(pricePerGpuHour, 4),
    region: "Ax3 global regions",
    formFactor: "vm",
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
      "Ax3 public pricing page publishes per-GPU starting hourly USD prices by model",
      "Regional capacity table is model-level context only; no exact deploy listing route is exposed, so rows are a price catalog"
    ],
    metadata: compactMetadata({
      gpuModel: row.model,
      priceQualifier: "starting_at",
      billingGranularity: "hourly",
      sourceUrl: url
    }),
    rawPayload: { ...row, sourceUrl: url }
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
