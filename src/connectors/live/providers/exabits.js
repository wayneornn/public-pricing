import { createInventoryItem } from "../../../core/inventory.js";
import { jsonFetch } from "../http.js";
import { buildGpuLabel, compactMetadata, fabricDataNote, numberOrNull, round, truthyEnv } from "../format.js";

// Exabits Cloud — GPU VM flavors. Public REST API (gpu-api.exabits.ai) but auth-gated:
// every call needs Authorization: Bearer <api_token> (an API Token generated in the
// Exabits console; preferred over the 30-min access_token/refresh_token login pair).
// Schema is from the official docs (https://gpu-api.exabits.ai/api-reference/flavors):
//   GET https://gpu-api.exabits.ai/api/v1/flavors[?region_id=…]
//   -> { status, message, data: [ { region, products: [ { id, name, region_name,
//        region_id, price, cpu, disk, ephemeral, ram, gpu, gpu_count, stock_available,
//        bandwidth, cycle } ] } ] }
// Per the docs `price` is "the price value for the GPU per hour" (per-GPU), so node total
// = price × gpu_count. GPU models with a "-spot" suffix are spot instances and are dropped
// at ingestion. The API exposes a stock_available boolean but no live checkout mapping, so
// rows are a region-offering price catalog (provider_console), not orderable. Set
// EXABITS_API_TOKEN to enable.
const EXABITS_API_BASE_URL = "https://gpu-api.exabits.ai/api/v1";

export const exabitsConnector = {
  id: "exabits",
  name: "Exabits",
  envVars: ["EXABITS_API_TOKEN", "EXABITS_API_KEY"],
  async fetch(env) {
    const token = env.EXABITS_API_TOKEN || env.EXABITS_API_KEY;
    if (!token) return [];
    const base = (env.EXABITS_API_BASE_URL || EXABITS_API_BASE_URL).replace(/\/$/, "");
    const timeoutMs = Number(env.EXABITS_TIMEOUT_MS || 30_000);
    const payload = await jsonFetch(`${base}/flavors`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      timeoutMs
    });
    return exabitsToItems(payload);
  }
};

export function exabitsToItems(payload = {}) {
  const groups = Array.isArray(payload?.data) ? payload.data : [];
  const items = [];
  for (const group of groups) {
    const products = Array.isArray(group?.products) ? group.products : [];
    for (const product of products) {
      const row = exabitsRow(product, group);
      if (row) items.push(row);
    }
  }
  return items;
}

function exabitsRow(product = {}, group = {}) {
  const gpuRaw = String(product.gpu || "");
  if (!gpuRaw) return null;
  if (/-spot$/i.test(gpuRaw)) return null; // spot/interruptible supply must never be emitted

  const perGpuHour = numberOrNull(product.price); // docs: price is per-GPU per hour
  if (perGpuHour == null || perGpuHour <= 0) return null;

  const gpuCount = numberOrNull(product.gpu_count) || 1;
  const model = gpuRaw.replace(/-spot$/i, "");
  const gpuLabel = buildGpuLabel({ count: gpuCount, model });
  const region = product.region_name || group.region || product.region || "Exabits";
  const stockAvailable = product.stock_available === true;

  return createInventoryItem({
    provider: "Exabits",
    providerId: "exabits",
    rawOfferId: String(product.id || `${region}:${gpuRaw}:${gpuCount}`),
    gpuLabel,
    gpuCount,
    vramGbEach: null, // not exposed by the flavors API; not guessed
    pricePerGpuHour: perGpuHour,
    totalHourlyPrice: round(perGpuHour * gpuCount, 4),
    region,
    formFactor: "vm",
    interconnect: gpuCount > 1 ? "NVLink" : "PCIe",
    cpu: numberOrNull(product.cpu) ? `${numberOrNull(product.cpu)} vCPU` : "",
    ramGb: numberOrNull(product.ram),
    storage: numberOrNull(product.disk) ? `${numberOrNull(product.disk)} GB` : "",
    networkBandwidth: product.bandwidth || "",
    networkFabric: "Not exposed",
    currency: "USD",
    availability: stockAvailable ? "available" : "unavailable",
    availabilityCount: null,
    checkoutUrl: "https://console.exabits.ai/",
    sourceMode: "live",
    listingType: "gpu_sku_pricing",
    priceScope: "node_total",
    availabilitySemantics: "region_offering",
    dataNotes: [
      "Exabits flavors API price (per-GPU/hr per docs → node total = price × gpu_count); stock_available is a boolean, not a live-bookable count",
      fabricDataNote("Not exposed", gpuLabel, gpuCount)
    ].filter(Boolean),
    metadata: compactMetadata({
      flavorId: product.id,
      flavorName: product.name,
      regionId: product.region_id,
      gpu: gpuRaw,
      gpuCount,
      pricePerGpuHour: perGpuHour,
      cpu: numberOrNull(product.cpu),
      ramGb: numberOrNull(product.ram),
      diskGb: numberOrNull(product.disk),
      ephemeralGb: numberOrNull(product.ephemeral),
      bandwidth: product.bandwidth,
      cycle: product.cycle,
      stockAvailable
    }),
    rawPayload: { ...product, region: region }
  });
}
