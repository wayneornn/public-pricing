import { createInventoryItem } from "../../../core/inventory.js";
import { jsonFetch } from "../http.js";
import { buildGpuLabel, compactMetadata, numberOrNull, round, truthyEnv } from "../format.js";

// Hivenet — "Compute with Hivenet" distributed GPU cloud (RTX 4090 / RTX 5090).
//
// Verified against the live API — PUBLIC (no auth), the same endpoint the pricing page
// (compute.hivenet.com/pricing) calls to fill its specMap:
//   GET https://api.hivecompute.ai/presets/pricing
//   -> [ { id, name, cpu, memory(GB), gpu: [ { model } ], disk(GB), hourly_price,
//          hourly_price_discounted, bandwidth(Mbps), location } ]
// gpu[] length is the GPU count; hourly_price is the whole-preset (node total) rate.
// Prices are in EUR (the page renders each value with a literal "€" prefix). The API
// exposes price + specs + location but no live capacity or exact deploy listing route, so
// rows are a region-offering price catalog (provider_console), not orderable. €0/demo
// presets are dropped. No key needed; enable with HIVENET_ENABLED=1 (kept opt-in so
// default/offline runs make no network call).
const HIVENET_API_URL = "https://api.hivecompute.ai/presets/pricing";
const HIVENET_CONSOLE_URL = "https://console.hivecompute.ai/";

export const hivenetConnector = {
  id: "hivenet",
  name: "Hivenet",
  envVars: ["HIVENET_ENABLED"],
  async fetch(env) {
    if (!truthyEnv(env.HIVENET_ENABLED)) return [];
    const url = env.HIVENET_API_URL || HIVENET_API_URL;
    const timeoutMs = Number(env.HIVENET_TIMEOUT_MS || 30_000);
    const payload = await jsonFetch(url, { headers: { Accept: "application/json" }, timeoutMs });
    return hivenetToItems(payload, { consoleUrl: env.HIVENET_CONSOLE_URL || HIVENET_CONSOLE_URL });
  }
};

export function hivenetToItems(payload = [], { consoleUrl = HIVENET_CONSOLE_URL } = {}) {
  const presets = Array.isArray(payload) ? payload : Array.isArray(payload?.presets) ? payload.presets : [];
  return presets.map((preset) => hivenetPresetToItem(preset, { consoleUrl })).filter(Boolean);
}

function hivenetPresetToItem(preset = {}, { consoleUrl }) {
  const gpus = Array.isArray(preset.gpu) ? preset.gpu : [];
  if (!gpus.length) return null; // CPU-only presets are not GPU supply

  const gpuCount = gpus.length;
  const model = String(gpus[0]?.model || "").trim();
  if (!model) return null;

  const totalHourlyPrice = numberOrNull(preset.hourly_price);
  if (totalHourlyPrice == null || totalHourlyPrice <= 0) return null; // €0 demo/test presets dropped

  const pricePerGpuHour = round(totalHourlyPrice / gpuCount, 4);
  const region = preset.location || "Hivenet";
  const vcpu = numberOrNull(preset.cpu);
  const ramGb = numberOrNull(preset.memory);
  const diskGb = numberOrNull(preset.disk);
  const bandwidth = numberOrNull(preset.bandwidth);
  const discounted = numberOrNull(preset.hourly_price_discounted);
  const gpuLabel = buildGpuLabel({ count: gpuCount, model });

  return createInventoryItem({
    provider: "Hivenet",
    providerId: "hivenet",
    rawOfferId: String(preset.id || `${preset.name || model}:${region}`),
    gpuLabel,
    gpuCount,
    vramGbEach: null, // not exposed by the API; taxonomy fills known consumer models
    pricePerGpuHour,
    totalHourlyPrice,
    region,
    formFactor: "vm",
    interconnect: "PCIe", // consumer RTX cards (no NVLink)
    cpu: vcpu ? `${vcpu} vCPU` : "",
    ramGb,
    storage: diskGb ? `${diskGb} GB` : "",
    networkBandwidth: bandwidth ? `${bandwidth} Mbps` : "",
    networkFabric: "Not exposed",
    currency: "EUR",
    availability: "unknown",
    availabilityCount: null,
    checkoutUrl: consoleUrl,
    sourceMode: "live",
    listingType: "gpu_sku_pricing",
    priceScope: "node_total",
    availabilitySemantics: "region_offering",
    dataNotes: [
      "Hivenet public presets/pricing API: per-preset hourly EUR price + specs + location, but no live capacity signal",
      "hourly_price is the whole-preset (node total) rate; per-GPU = hourly_price / GPU count",
      discounted ? `Prepaid-credit discounted rate available: €${discounted}/hr (node total)` : ""
    ].filter(Boolean),
    metadata: compactMetadata({
      presetId: preset.id,
      presetName: preset.name,
      model,
      gpuCount,
      hourlyPriceEur: totalHourlyPrice,
      hourlyPriceDiscountedEur: discounted,
      pricePerGpuHourEur: pricePerGpuHour,
      cpu: vcpu,
      memoryGb: ramGb,
      diskGb,
      bandwidthMbps: bandwidth,
      location: region
    }),
    rawPayload: { ...preset }
  });
}
