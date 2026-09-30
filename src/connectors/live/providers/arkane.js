import { createInventoryItem } from "../../../core/inventory.js";
import { buildGpuLabel, compactMetadata, fabricDataNote, numberOrNull, parseMemoryGb, truthyEnv } from "../format.js";

// Arkane Cloud documents authenticated compute APIs for deploy/list/manage, but
// no safe read-only endpoint for available GPU shapes, prices, regions, or stock.
// The official public pricing page publishes the GPU price/spec table.
const ARKANE_PRICING_URL = "https://arkanecloud.com/pricing/";

export const arkaneConnector = {
  id: "arkane-cloud",
  name: "Arkane Cloud",
  envVars: ["ARKANE_ENABLED"],
  async fetch(env) {
    if (!truthyEnv(env.ARKANE_ENABLED)) return [];
    const url = env.ARKANE_PRICING_URL || ARKANE_PRICING_URL;
    const response = await fetch(url, {
      headers: { Accept: "text/html", "User-Agent": "gpu-deal-terminal" },
      signal: AbortSignal.timeout(Number(env.ARKANE_TIMEOUT_MS || 30_000))
    });
    if (!response.ok) throw new Error(`arkane pricing page ${response.status}`);
    return arkaneHtmlToItems(await response.text(), { url });
  }
};

export function arkaneHtmlToItems(htmlText = "", { url = ARKANE_PRICING_URL } = {}) {
  return extractArkaneGpuRows(htmlText)
    .map((row) => arkaneRowToItem(row, { url }))
    .filter(Boolean);
}

export function extractArkaneGpuRows(htmlText = "") {
  const tables = [...String(htmlText).matchAll(/<table\b[\s\S]*?<\/table>/gi)].map((match) => match[0]);
  const gpuTable = tables.find((table) => /GPU type/i.test(table) && /Price per GPU/i.test(table));
  if (!gpuTable) return [];

  const rows = [];
  for (const rowMatch of gpuTable.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const rowHtml = rowMatch[1];
    const heading = cleanHtml(rowHtml.match(/<th[^>]*>([\s\S]*?)<\/th>/i)?.[1]);
    const cells = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => cleanHtml(cell[1]));
    if (!heading || cells.length < 4 || !/\$/.test(cells[0])) continue;

    rows.push({
      gpuType: heading,
      pricePerGpuHourUsd: parseUsdHourly(cells[0]),
      vcpu: numberOrNull(cells[1]),
      ramGb: parseMemoryGb(cells[2]),
      vramGbEach: parseMemoryGb(cells[3])
    });
  }
  return rows;
}

function arkaneRowToItem(row, { url }) {
  const model = normalizeModel(row.gpuType);
  const pricePerGpuHour = numberOrNull(row.pricePerGpuHourUsd);
  const vramGbEach = numberOrNull(row.vramGbEach);
  if (!model || !pricePerGpuHour) return null;

  const gpuCount = 1;
  const gpuLabel = buildGpuLabel({ count: gpuCount, model, vramGb: vramGbEach });
  const networkFabric = "Not exposed";

  return createInventoryItem({
    provider: "Arkane Cloud",
    providerId: "arkane-cloud",
    rawOfferId: stableOfferId(row.gpuType),
    gpuLabel,
    gpuCount,
    vramGbEach,
    pricePerGpuHour,
    totalHourlyPrice: pricePerGpuHour,
    region: "Arkane Cloud regions",
    formFactor: "vm",
    interconnect: "Not exposed",
    cpu: row.vcpu ? `${row.vcpu} vCPU` : "",
    ramGb: row.ramGb,
    storage: "",
    networkFabric,
    currency: "USD",
    availability: "unknown",
    availabilityCount: null,
    checkoutUrl: url,
    sourceMode: "live",
    listingType: "gpu_sku_pricing",
    priceScope: "gpu_sku_only",
    availabilitySemantics: "price_only",
    dataNotes: [
      "Arkane Cloud per-GPU on-demand USD price/specs parsed from the official public pricing table; usage is billed by minute for active GPU servers",
      "Arkane documents authenticated compute deploy/list APIs, but no public catalog/availability endpoint for GPU shapes, prices, regions, or stock was found",
      "Pricing page Deploy flow routes through the provider console rather than an exact public listing URL",
      "GPU count options and region-specific availability are not exposed by the public pricing table",
      fabricDataNote(networkFabric, gpuLabel, gpuCount)
    ].filter(Boolean),
    metadata: compactMetadata({
      gpuType: row.gpuType,
      pricePerGpuHourUsd: pricePerGpuHour,
      vcpu: row.vcpu,
      ramGb: row.ramGb,
      vramGbEach,
      sourceUrl: url,
      billingGranularity: "per-minute"
    }),
    rawPayload: { ...row, sourceUrl: url }
  });
}

function normalizeModel(value) {
  return String(value || "")
    .replace(/^NVIDIA\s+/i, "")
    .replace(/\bADA\b/i, "Ada")
    .replace(/\s+/g, " ")
    .trim();
}

function stableOfferId(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function parseUsdHourly(value) {
  return numberOrNull(String(value || "").match(/\$?\s*([0-9]+(?:\.[0-9]+)?)\s*\/?\s*hr/i)?.[1]);
}

function cleanHtml(value = "") {
  return String(value)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}
