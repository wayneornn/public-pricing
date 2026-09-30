import { createInventoryItem } from "../../../core/inventory.js";
import { buildGpuLabel, compactMetadata, numberOrNull, round, truthyEnv } from "../format.js";

// Turboscale (turboscale.com) — GPU cloud (on-demand/custom clusters). No public pricing API,
// but the public /pricing page server-renders a table:
//   GPUs | VRAM/GPU | vCPUs | RAM GB | Storage SSD | Storage NVMe | Bandwidth | Price USD
//   <tr><td>1 × NVIDIA H100</td><td>80</td>...<td>3.24/h</td></tr>
// The first cell is "<N> × <model>" and the last cell is the whole-config hourly USD price;
// per-GPU = price / N. Emitted as a non-orderable price catalog. Enable with TURBOSCALE_ENABLED=1.
const TURBOSCALE_PRICING_URL = "https://www.turboscale.com/pricing";

export const turboscaleConnector = {
  id: "turboscale",
  name: "Turboscale",
  envVars: ["TURBOSCALE_ENABLED"],
  async fetch(env) {
    if (!truthyEnv(env.TURBOSCALE_ENABLED)) return [];
    const url = env.TURBOSCALE_PRICING_URL || TURBOSCALE_PRICING_URL;
    const response = await fetch(url, {
      headers: { Accept: "text/html", "User-Agent": "gpu-deal-terminal" },
      signal: AbortSignal.timeout(Number(env.TURBOSCALE_TIMEOUT_MS || 30_000))
    });
    if (!response.ok) throw new Error(`turboscale pricing page ${response.status}`);
    return turboscaleHtmlToItems(await response.text(), { url });
  }
};

export function turboscaleHtmlToItems(htmlText = "", { url = TURBOSCALE_PRICING_URL } = {}) {
  return extractTurboscaleRows(htmlText)
    .map((row) => turboscaleRowToItem(row, { url }))
    .filter(Boolean);
}

// A GPU row's first cell is "<N> × <vendor> <model>" and its last cell carries "<price>/h"; the
// header row and any non-GPU rows do not match this shape.
export function extractTurboscaleRows(htmlText = "") {
  const rows = [];
  const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = trRe.exec(htmlText)) !== null) {
    const cells = [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) =>
      c[1].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()
    );
    if (cells.length < 3) continue;
    const head = cells[0].match(/^(\d+)\s*[×x]\s*(.+)$/i);
    if (!head) continue;
    const priceCell = cells[cells.length - 1].match(/([0-9]+(?:\.[0-9]+)?)\s*\/\s*h/i);
    if (!priceCell) continue;

    rows.push({
      gpuCount: numberOrNull(head[1]),
      model: head[2].replace(/\b(NVIDIA|AMD)\b/gi, "").replace(/\s+/g, " ").trim(),
      vramGbEach: numberOrNull(cells[1]),
      // Same GPU+count can repeat with different storage tiers (and thus price); capture both
      // so they stay distinct rows rather than colliding on the offer id.
      storageSsdGb: numberOrNull(cells[4]),
      storageNvmeGb: numberOrNull(cells[5]),
      totalHourlyPrice: numberOrNull(priceCell[1])
    });
  }
  return rows;
}

function turboscaleRowToItem(row, { url }) {
  const totalHourly = numberOrNull(row.totalHourlyPrice);
  if (!row.model || totalHourly == null || totalHourly <= 0) return null;

  const gpuCount = row.gpuCount && row.gpuCount > 0 ? row.gpuCount : 1;
  const pricePerGpuHour = round(totalHourly / gpuCount, 4);
  const gpuLabel = buildGpuLabel({ count: gpuCount, model: row.model, vramGb: row.vramGbEach });

  return createInventoryItem({
    provider: "Turboscale",
    providerId: "turboscale",
    rawOfferId: `${gpuCount}x-${slug(row.model)}-ssd${row.storageSsdGb || 0}-nvme${row.storageNvmeGb || 0}-${totalHourly}`,
    gpuLabel,
    gpuCount,
    vramGbEach: row.vramGbEach,
    pricePerGpuHour,
    totalHourlyPrice: round(totalHourly, 4),
    region: "Turboscale",
    formFactor: "vm",
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
      `Turboscale ${gpuCount}x ${row.model} whole-config hourly USD parsed from the public pricing table (per-GPU = price/${gpuCount})`,
      "No public provisioning/pricing API and no live stock or deploy route, so rows are a price catalog"
    ],
    metadata: compactMetadata({
      gpuModel: row.model,
      gpuCount,
      vramGbEach: row.vramGbEach,
      storageSsdGb: row.storageSsdGb,
      storageNvmeGb: row.storageNvmeGb,
      totalHourlyUsd: totalHourly,
      pricePerGpuHourUsd: pricePerGpuHour,
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
