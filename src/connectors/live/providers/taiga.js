import { createInventoryItem } from "../../../core/inventory.js";
import { buildGpuLabel, compactMetadata, numberOrNull, round, truthyEnv } from "../format.js";

// Northern Data / Taiga Cloud (northerndata.de) — European GPU cloud. No public pricing API,
// but the public Taiga Cloud pricing page server-renders GPU tables (bare-metal and on-demand)
// binding each model to a per-GPU "$/GPU/h" rate:
//   <tr><td>NVIDIA H100 SXM</td><td>8</td><td>640</td><td>112</td>...<td>from $2.40</td></tr>
// Columns: Model | GPUs | vRAM(GB) total | CPUs | RAM | Local Storage | $/GPU/h. The price is
// a per-GPU "from" floor. Rows with a populated CPUs cell are bare-metal; on-demand rows leave
// CPUs blank. Emitted as a non-orderable price catalog. Enable with TAIGA_ENABLED=1 (opt-in).
const TAIGA_PRICING_URL = "https://northerndata.de/taiga-cloud-ai-pricing-2026";

export const taigaConnector = {
  id: "taiga",
  name: "Northern Data / Taiga Cloud",
  envVars: ["TAIGA_ENABLED"],
  async fetch(env) {
    if (!truthyEnv(env.TAIGA_ENABLED)) return [];
    const url = env.TAIGA_PRICING_URL || TAIGA_PRICING_URL;
    const response = await fetch(url, {
      headers: { Accept: "text/html", "User-Agent": "gpu-deal-terminal" },
      signal: AbortSignal.timeout(Number(env.TAIGA_TIMEOUT_MS || 30_000))
    });
    if (!response.ok) throw new Error(`taiga pricing page ${response.status}`);
    return taigaHtmlToItems(await response.text(), { url });
  }
};

export function taigaHtmlToItems(htmlText = "", { url = TAIGA_PRICING_URL } = {}) {
  return extractTaigaRows(htmlText)
    .map((row) => taigaRowToItem(row, { url }))
    .filter(Boolean);
}

// A GPU row's first cell names an NVIDIA/AMD model and its last cell carries the "$/GPU/h"
// rate; the CPU-only "big.*" and service tables on the same page do not match this shape.
export function extractTaigaRows(htmlText = "") {
  const rows = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = trRe.exec(htmlText)) !== null) {
    const cells = [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) =>
      decodeEntities(c[1].replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim()
    );
    if (cells.length < 4) continue;
    const modelMatch = cells[0].match(/^(NVIDIA|AMD)\s+(.+)$/i);
    if (!modelMatch) continue;
    const priceMatch = cells[cells.length - 1].match(/\$\s*([0-9]+(?:\.[0-9]+)?)/);
    if (!priceMatch) continue;

    const gpuCount = numberOrNull(cells[1]);
    const vramTotal = numberOrNull(cells[2]);
    const cpus = numberOrNull(cells[3]);
    rows.push({
      model: modelMatch[2].replace(/\s+/g, " ").trim(),
      gpuCount,
      vramGbEach: gpuCount && vramTotal ? Math.round(vramTotal / gpuCount) : null,
      formFactor: cpus && cpus > 0 ? "bare_metal" : "vm",
      pricePerGpuHour: numberOrNull(priceMatch[1]),
      isFrom: /from/i.test(cells[cells.length - 1])
    });
  }
  return rows;
}

function taigaRowToItem(row, { url }) {
  const pricePerGpuHour = numberOrNull(row.pricePerGpuHour);
  if (!row.model || pricePerGpuHour == null || pricePerGpuHour <= 0) return null;

  const gpuCount = row.gpuCount && row.gpuCount > 0 ? row.gpuCount : 1;
  const gpuLabel = buildGpuLabel({ count: gpuCount, model: row.model, vramGb: row.vramGbEach });

  return createInventoryItem({
    provider: "Northern Data / Taiga Cloud",
    providerId: "taiga",
    rawOfferId: `${row.formFactor}:${slug(row.model)}`,
    gpuLabel,
    gpuCount,
    vramGbEach: row.vramGbEach,
    pricePerGpuHour,
    totalHourlyPrice: round(pricePerGpuHour * gpuCount, 4),
    region: "Europe",
    formFactor: row.formFactor,
    networkFabric: "Not exposed",
    currency: "USD",
    availability: "unknown",
    availabilityCount: null,
    checkoutUrl: url,
    sourceMode: "live",
    listingType: "gpu_sku_pricing",
    priceScope: row.isFrom ? "gpu_sku_lowest" : "gpu_sku",
    availabilitySemantics: "price_only",
    dataNotes: [
      `Taiga Cloud ${row.model} ${row.formFactor === "bare_metal" ? "bare-metal" : "on-demand"} per-GPU/hr parsed from the public pricing table`,
      row.isFrom ? "'from' price (per-GPU floor); higher-volume pricing is sales-gated" : "Per-GPU hourly rate from the public pricing table",
      "No public provisioning/pricing API and no live stock or deploy route, so rows are a price catalog"
    ],
    metadata: compactMetadata({
      gpuModel: row.model,
      gpuCount,
      vramGbEach: row.vramGbEach,
      pricePerGpuHourUsd: pricePerGpuHour,
      priceQualifier: row.isFrom ? "starts_at" : "exact",
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
