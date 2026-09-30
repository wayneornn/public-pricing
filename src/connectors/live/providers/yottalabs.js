import { createInventoryItem } from "../../../core/inventory.js";
import { buildGpuLabel, compactMetadata, numberOrNull, round, truthyEnv } from "../format.js";

// Yotta Labs (yottalabs.ai) — on-demand GPU cloud. No public pricing API, but the public
// /pricing page server-renders a GPU table binding each model to an on-demand $/hr:
//   <tr><td>RTX 4090</td><td>24 GB</td><td>115 GB</td><td>30</td><td>$0.48/hr</td><td>—</td>...
// Columns: GPU Model | VRAM | RAM | vCPU | On-demand | Spot. We emit the per-GPU on-demand
// rate only (spot is dropped — the repo never surfaces spot pricing). Single-GPU configs, so
// the on-demand price is the per-GPU rate. Enable with YOTTALABS_ENABLED=1 (opt-in).
const YOTTALABS_PRICING_URL = "https://www.yottalabs.ai/pricing";

export const yottalabsConnector = {
  id: "yottalabs",
  name: "Yotta Labs",
  envVars: ["YOTTALABS_ENABLED"],
  async fetch(env) {
    if (!truthyEnv(env.YOTTALABS_ENABLED)) return [];
    const url = env.YOTTALABS_PRICING_URL || YOTTALABS_PRICING_URL;
    const response = await fetch(url, {
      headers: { Accept: "text/html", "User-Agent": "gpu-deal-terminal" },
      signal: AbortSignal.timeout(Number(env.YOTTALABS_TIMEOUT_MS || 30_000))
    });
    if (!response.ok) throw new Error(`yottalabs pricing page ${response.status}`);
    return yottalabsHtmlToItems(await response.text(), { url });
  }
};

export function yottalabsHtmlToItems(htmlText = "", { url = YOTTALABS_PRICING_URL } = {}) {
  return extractYottalabsRows(htmlText)
    .map((row) => yottalabsRowToItem(row, { url }))
    .filter(Boolean);
}

// A GPU row has a VRAM cell ("24 GB") and an on-demand price cell ("$0.48/hr"); the storage
// and token-price tables on the same page do not, so this shape filters them out.
export function extractYottalabsRows(htmlText = "") {
  const rows = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = trRe.exec(htmlText)) !== null) {
    const cells = [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) =>
      decodeEntities(c[1].replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim()
    );
    if (cells.length < 5) continue;
    const vramMatch = cells[1].match(/(\d+)\s*GB/i);
    const priceMatch = cells[4].match(/\$\s*([0-9]+(?:\.[0-9]+)?)\s*\/?\s*hr/i);
    if (!vramMatch || !priceMatch) continue;

    const model = cells[0].replace(/\b(popular|new|recommended)\b/gi, "").replace(/\s+/g, " ").trim();
    if (!model) continue;
    rows.push({
      model,
      vramGbEach: numberOrNull(vramMatch[1]),
      onDemandPricePerGpuHour: numberOrNull(priceMatch[1])
    });
  }
  return rows;
}

function yottalabsRowToItem(row, { url }) {
  const pricePerGpuHour = numberOrNull(row.onDemandPricePerGpuHour);
  if (!row.model || pricePerGpuHour == null || pricePerGpuHour <= 0) return null;

  const gpuLabel = buildGpuLabel({ count: 1, model: row.model, vramGb: row.vramGbEach });
  return createInventoryItem({
    provider: "Yotta Labs",
    providerId: "yottalabs",
    rawOfferId: `gpu:${slug(row.model)}`,
    gpuLabel,
    gpuCount: 1,
    vramGbEach: row.vramGbEach,
    pricePerGpuHour,
    totalHourlyPrice: round(pricePerGpuHour, 4),
    region: "Yotta Labs",
    formFactor: "container",
    networkFabric: "Not exposed",
    currency: "USD",
    availability: "unknown",
    availabilityCount: null,
    checkoutUrl: url,
    sourceMode: "live",
    listingType: "gpu_sku_pricing",
    priceScope: "gpu_sku",
    availabilitySemantics: "price_only",
    dataNotes: [
      `Yotta Labs ${row.model} on-demand per-GPU/hr parsed from the public pricing table`,
      "On-demand rate only; spot pricing is intentionally not surfaced",
      "No public provisioning/pricing API and no live stock or deploy route, so rows are a price catalog"
    ],
    metadata: compactMetadata({
      gpuModel: row.model,
      vramGbEach: row.vramGbEach,
      onDemandPricePerGpuHourUsd: pricePerGpuHour,
      billingGranularity: "hourly",
      sourceUrl: url
    }),
    rawPayload: { ...row, sourceUrl: url }
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
