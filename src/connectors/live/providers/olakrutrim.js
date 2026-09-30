import { createInventoryItem } from "../../../core/inventory.js";
import { buildGpuLabel, compactMetadata, numberOrNull, round, truthyEnv } from "../format.js";

// Ola Krutrim (olakrutrim.com) — Indian GPU cloud. No public pricing API, but the public
// /pricing page server-renders GPU instance tables binding each instance to an INR/hr rate:
//   <tr><td>H100 × 2</td><td>400</td><td>160</td><td>48</td><td>₹426 /hr</td>...</tr>
// Columns: Instance | RAM(GB) | GPU memory(GB) total | vCPUs | <one or more price columns>.
// The first price column is the on-demand whole-instance INR/hr rate. We keep whole-GPU rows
// ("× N") and skip fractional Tiny/Nano/Mini MIG slices. Prices stay in INR (converted to USD
// downstream via core FX). Emitted as a non-orderable price catalog. Enable with
// OLAKRUTRIM_ENABLED=1 (opt-in).
const OLAKRUTRIM_PRICING_URL = "https://www.olakrutrim.com/pricing";
const GPU_MODEL_RE = /\b(H200|H100|A100|A40|L40S|L40|L4|MI\d{3}X?)\b/i;

export const olakrutrimConnector = {
  id: "olakrutrim",
  name: "Ola Krutrim",
  envVars: ["OLAKRUTRIM_ENABLED"],
  async fetch(env) {
    if (!truthyEnv(env.OLAKRUTRIM_ENABLED)) return [];
    const url = env.OLAKRUTRIM_PRICING_URL || OLAKRUTRIM_PRICING_URL;
    const response = await fetch(url, {
      headers: { Accept: "text/html", "User-Agent": "gpu-deal-terminal" },
      signal: AbortSignal.timeout(Number(env.OLAKRUTRIM_TIMEOUT_MS || 30_000))
    });
    if (!response.ok) throw new Error(`olakrutrim pricing page ${response.status}`);
    return olakrutrimHtmlToItems(await response.text(), { url });
  }
};

export function olakrutrimHtmlToItems(htmlText = "", { url = OLAKRUTRIM_PRICING_URL } = {}) {
  return extractOlakrutrimRows(htmlText)
    .map((row) => olakrutrimRowToItem(row, { url }))
    .filter(Boolean);
}

// A GPU instance row names a model with a "× N" GPU count and carries at least one INR/hr
// price cell; the CPU-only and storage tables on the same page do not match this shape, and
// fractional Tiny/Nano/Mini MIG rows have no "× N" and are skipped.
export function extractOlakrutrimRows(htmlText = "") {
  const rows = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = trRe.exec(htmlText)) !== null) {
    const cells = [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) =>
      decodeEntities(c[1].replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim()
    );
    if (cells.length < 5) continue;
    const instance = cells[0];
    if (!GPU_MODEL_RE.test(instance)) continue;
    const countMatch = instance.match(/[×x]\s*(\d+)/);
    if (!countMatch) continue;

    // First INR/hr cell after the spec columns is the on-demand whole-instance price.
    const priceCell = cells.slice(1).find((c) => /₹\s*[\d,]+(?:\.\d+)?\s*\/\s*hr/.test(c));
    if (!priceCell) continue;
    const priceInr = numberOrNull(priceCell.match(/₹\s*([\d,]+(?:\.\d+)?)/)[1].replace(/,/g, ""));
    if (priceInr == null || priceInr <= 0) continue;

    const gpuCount = numberOrNull(countMatch[1]) || 1;
    const vramTotal = numberOrNull(cells[2]);
    const modelMatch = instance.match(GPU_MODEL_RE);
    rows.push({
      rowIndex: rows.length,
      instance,
      model: modelMatch[1].toUpperCase(),
      gpuCount,
      vramGbEach: vramTotal && gpuCount ? Math.round(vramTotal / gpuCount) : null,
      totalHourlyInr: priceInr
    });
  }
  return rows;
}

function olakrutrimRowToItem(row, { url }) {
  const totalHourlyInr = numberOrNull(row.totalHourlyInr);
  if (!row.model || totalHourlyInr == null || totalHourlyInr <= 0) return null;

  const gpuCount = row.gpuCount && row.gpuCount > 0 ? row.gpuCount : 1;
  const pricePerGpuHour = round(totalHourlyInr / gpuCount, 4);
  const gpuLabel = buildGpuLabel({ count: gpuCount, model: row.model, vramGb: row.vramGbEach });

  return createInventoryItem({
    provider: "Ola Krutrim",
    providerId: "olakrutrim",
    rawOfferId: `${slug(row.instance)}-${row.rowIndex ?? 0}-inr${totalHourlyInr}`,
    gpuLabel,
    gpuCount,
    vramGbEach: row.vramGbEach,
    pricePerGpuHour,
    totalHourlyPrice: round(totalHourlyInr, 4),
    region: "India",
    formFactor: "vm",
    networkFabric: "Not exposed",
    currency: "INR",
    availability: "unknown",
    availabilityCount: null,
    checkoutUrl: url,
    sourceMode: "live",
    listingType: "gpu_sku_pricing",
    priceScope: "node_total",
    availabilitySemantics: "price_only",
    dataNotes: [
      `Ola Krutrim "${row.instance}" on-demand whole-instance INR/hr parsed from the public pricing table`,
      "On-demand rate (lowest committed-term rates are cheaper); INR converted to USD via core FX",
      "No public provisioning/pricing API and no live stock or deploy route, so rows are a price catalog"
    ],
    metadata: compactMetadata({
      instance: row.instance,
      gpuModel: row.model,
      gpuCount,
      vramGbEach: row.vramGbEach,
      totalHourlyInr,
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
    .replace(/&#8377;|&#x20b9;/gi, "₹")
    .replace(/&#215;|&#xd7;/gi, "×")
    .replace(/&#x27;|&#39;/g, "'");
}
