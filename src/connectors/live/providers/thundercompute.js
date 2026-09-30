import { createInventoryItem } from "../../../core/inventory.js";
import { jsonFetch } from "../http.js";
import { buildGpuLabel, compactMetadata, fabricDataNote, numberOrNull, round, truthyEnv } from "../format.js";

// Thunder Compute. Verified against the live API — both endpoints are PUBLIC (no auth):
//   GET https://api.thundercompute.com:8443/v1/pricing  -> { pricing: { "<sku>": usdPerHour } }
//   GET https://api.thundercompute.com:8443/v1/specs    -> { specs:   { "<sku>": {displayName,vramGB,gpuCount,mode,...} } }
// SKU keys are "<gpu>_x<count>_<mode>" (mode = production|prototyping) and join across
// both maps. The API exposes price + specs but no live capacity, so rows are a priced
// catalog (provider_console), not orderable. No key needed; enable with
// THUNDERCOMPUTE_ENABLED=1 (kept opt-in so default/offline runs make no network call).
const THUNDER_API_BASE_URL = "https://api.thundercompute.com:8443/v1";
const SKU_RE = /^([a-z0-9]+)_x(\d+)_(production|prototyping)$/;

export const thundercomputeConnector = {
  id: "thunder-compute",
  name: "Thunder Compute",
  envVars: ["THUNDERCOMPUTE_ENABLED", "THUNDER_ENABLED"],
  async fetch(env) {
    if (!truthyEnv(env.THUNDERCOMPUTE_ENABLED) && !truthyEnv(env.THUNDER_ENABLED)) return [];
    const base = (env.THUNDER_API_BASE_URL || THUNDER_API_BASE_URL).replace(/\/$/, "");
    const timeoutMs = Number(env.THUNDER_TIMEOUT_MS || 30_000);
    const [pricing, specs] = await Promise.all([
      jsonFetch(`${base}/pricing`, { headers: { Accept: "application/json" }, timeoutMs }),
      jsonFetch(`${base}/specs`, { headers: { Accept: "application/json" }, timeoutMs })
    ]);
    return thundercomputeToItems(pricing?.pricing || {}, specs?.specs || {});
  }
};

export function thundercomputeToItems(pricing = {}, specs = {}) {
  const items = [];
  for (const [sku, price] of Object.entries(pricing)) {
    const match = SKU_RE.exec(sku);
    if (!match) continue; // skip non-GPU rows (disk_gb, additional_vcpus, snapshot_gb, bare aliases)
    const hourly = numberOrNull(price);
    if (hourly == null || hourly <= 0) continue;
    items.push(thundercomputeRow(sku, match, hourly, specs[sku]));
  }
  return items.filter(Boolean);
}

function thundercomputeRow(sku, [, gpuToken, countStr, mode], hourly, spec = {}) {
  const gpuCount = Number(countStr) || spec.gpuCount || 1;
  const model = spec.displayName || THUNDER_MODELS[gpuToken] || gpuToken;
  const vramGbEach = numberOrNull(spec.vramGB) || THUNDER_VRAM[gpuToken] || null;
  const gpuLabel = buildGpuLabel({ count: gpuCount, model, vramGb: vramGbEach });
  const vcpu = Array.isArray(spec.vcpuOptions) && spec.vcpuOptions.length ? Math.max(...spec.vcpuOptions) : null;

  return createInventoryItem({
    provider: "Thunder Compute",
    providerId: "thunder-compute",
    rawOfferId: sku,
    gpuLabel,
    gpuCount,
    vramGbEach,
    pricePerGpuHour: round(hourly / gpuCount, 4),
    totalHourlyPrice: hourly,
    region: "Thunder Compute",
    formFactor: "vm",
    interconnect: gpuCount > 1 ? "NVLink" : "PCIe",
    cpu: vcpu ? `${vcpu} vCPU` : "",
    ramGb: vcpu && spec.ramPerVCPUGiB ? vcpu * Number(spec.ramPerVCPUGiB) : null,
    storage: spec.storageGB?.max ? `${spec.storageGB.max} GB` : "",
    networkFabric: "Not exposed",
    currency: "USD",
    availability: "unknown",
    availabilityCount: null,
    checkoutUrl: "https://console.thundercompute.com/",
    sourceMode: "live",
    listingType: "gpu_sku_pricing",
    priceScope: "node_total",
    availabilitySemantics: "catalog_only",
    dataNotes: [
      `Thunder ${mode} mode (public pricing/specs API; no live capacity signal)`,
      mode === "prototyping" ? "Prototyping = lower-cost time-shared GPU" : "Production = dedicated GPU",
      fabricDataNote("Not exposed", gpuLabel, gpuCount)
    ].filter(Boolean),
    metadata: compactMetadata({
      sku,
      mode,
      displayName: spec.displayName,
      vramGB: spec.vramGB,
      gpuCount: spec.gpuCount,
      vcpuOptions: spec.vcpuOptions,
      ramPerVCPUGiB: spec.ramPerVCPUGiB,
      storageGB: spec.storageGB,
      ephemeralStorageGB: spec.ephemeralStorageGB,
      hourlyUsd: hourly
    }),
    rawPayload: { sku, mode, hourly, ...spec }
  });
}

const THUNDER_MODELS = {
  a100xl: "A100",
  a6000: "RTX A6000",
  h100: "H100",
  l40: "L40",
  l40s: "L40S"
};

const THUNDER_VRAM = {
  a100xl: 80,
  a6000: 48,
  h100: 80,
  l40: 48,
  l40s: 48
};
