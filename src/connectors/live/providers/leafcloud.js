import { createInventoryItem } from "../../../core/inventory.js";
import { buildGpuLabel, compactMetadata, fabricDataNote, numberOrNull, truthyEnv } from "../format.js";

// leafcloud (Amsterdam, OpenStack). OpenStack has no pricing API and the flavor list is
// Keystone-auth-gated, but leafcloud publishes its own per-GPU hourly EUR prices in the
// pricing page's embedded data (Astro island JSON). We scrape that single structured
// row — more fragile than a JSON API, so it's opt-in (LEAFCLOUD_ENABLED=1) and emits a
// region-offering price catalog (provider_console), not orderable capacity.
//
// Verified live: the page exposes
//   {"provider":[0,"Leafcloud"],"rtx6000":[0,"€2.76"],"h100":[0,"€4.12"],
//    "a100":[0,"€1.61"],"a30":[0,"€0.60"],"location":[0,"ams-1 (Amsterdam)"]}
const LEAFCLOUD_PRICING_URL = "https://leaf.cloud/pricing/";
const COLUMN_MODELS = {
  rtx6000: { model: "RTX PRO 6000", vramGb: 96 },
  h100: { model: "H100", vramGb: 80 },
  a100: { model: "A100", vramGb: 80 },
  a30: { model: "A30", vramGb: 24 }
};

export const leafcloudConnector = {
  id: "leafcloud",
  name: "leafcloud",
  envVars: ["LEAFCLOUD_ENABLED"],
  async fetch(env) {
    if (!truthyEnv(env.LEAFCLOUD_ENABLED)) return [];
    const url = env.LEAFCLOUD_PRICING_URL || LEAFCLOUD_PRICING_URL;
    const response = await fetch(url, {
      headers: { Accept: "text/html", "User-Agent": "gpu-deal-terminal" },
      signal: AbortSignal.timeout(Number(env.LEAFCLOUD_TIMEOUT_MS || 30_000))
    });
    if (!response.ok) throw new Error(`leafcloud pricing page ${response.status}`);
    return leafcloudHtmlToItems(await response.text());
  }
};

export function leafcloudHtmlToItems(htmlText = "") {
  const text = unescapeHtml(htmlText);
  const start = text.indexOf('"provider":[0,"Leafcloud"],"rtx6000"');
  if (start === -1) return [];
  const block = text.slice(start, start + 500);
  const region = block.match(/"location":\[0,"([^"]*)"\]/)?.[1] || "Amsterdam";

  const items = [];
  for (const [column, spec] of Object.entries(COLUMN_MODELS)) {
    const raw = block.match(new RegExp(`"${column}":\\[0,"\\u20ac?\\s*([0-9]+[.,][0-9]+)"\\]`))?.[1];
    const price = numberOrNull(String(raw || "").replace(",", "."));
    if (price == null || price <= 0) continue; // "N/A"/missing columns skipped
    items.push(leafcloudRow(column, spec, price, region));
  }
  return items;
}

function leafcloudRow(column, spec, price, region) {
  const gpuLabel = buildGpuLabel({ count: 1, model: spec.model, vramGb: spec.vramGb });
  return createInventoryItem({
    provider: "leafcloud",
    providerId: "leafcloud",
    rawOfferId: `${column}:${region}`,
    gpuLabel,
    gpuCount: 1,
    vramGbEach: spec.vramGb,
    pricePerGpuHour: price,
    totalHourlyPrice: price,
    region,
    formFactor: "vm",
    interconnect: "PCIe",
    networkFabric: "Not exposed",
    currency: "EUR",
    availability: "unknown",
    availabilityCount: null,
    checkoutUrl: "https://create.leaf.cloud/",
    sourceMode: "live",
    listingType: "gpu_price_listing",
    priceScope: "node_total",
    availabilitySemantics: "region_offering",
    dataNotes: [
      "leafcloud published per-GPU hourly price (full VM included); scraped from pricing page",
      "OpenStack flavor capacity not exposed without project credentials",
      fabricDataNote("Not exposed", gpuLabel, 1)
    ].filter(Boolean),
    metadata: compactMetadata({ column, model: spec.model, vramGb: spec.vramGb, region, unitPriceEur: price }),
    rawPayload: { column, model: spec.model, region, unitPriceEur: price }
  });
}

function unescapeHtml(value) {
  return String(value)
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&amp;/g, "&");
}
