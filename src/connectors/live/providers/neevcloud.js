import { createInventoryItem } from "../../../core/inventory.js";
import { jsonFetch } from "../http.js";
import { buildGpuLabel, compactMetadata, numberOrNull, round } from "../format.js";

// NeevCloud (neevcloud.com) — Indian AI GPU cloud. The marketing site is Cloudflare-walled,
// but the public API gateway api.ai.neevcloud.com is reachable and documented (OpenAPI at
// docs.ai.neevcloud.com/api-reference). The Inventory endpoint returns priced, capacity-aware
// deployable GPU configs:
//   GET https://api.ai.neevcloud.com/inventory/api/v1beta1/inventory[?page=N]
//   -> { data: [ { config_id, gpu_model, gpu_vendor, vram_gib, default_cpu_cores,
//        default_memory_gib, price_per_gpu_per_hour, region, min_gpu_count, max_gpu_count,
//        available_gpu_count, total_gpu_count, availability, instance_type, type } ],
//        pagination: { current_page, total_pages, ... } }
// Auth is Authorization: Bearer <token>, where the token is a NeevCloud personal access token
// (pat-nc-*) or the console-login access_token JWT. The inference keys (sk-nc-*) are rejected
// here. `price_per_gpu_per_hour` is USD per GPU; the feed carries live availability counts but
// provisioning is an API mutation with no prefilled deploy URL, so rows are a priced capacity
// catalog (provider_console), not orderable. Set NEEVCLOUD_API_KEY (or NEEVCLOUD_PAT) to enable.
const NEEVCLOUD_API_BASE_URL = "https://api.ai.neevcloud.com";
const NEEVCLOUD_CONSOLE_URL = "https://ai.neevcloud.com/";
const MAX_PAGES = 20;

export const neevcloudConnector = {
  id: "neevcloud",
  name: "NeevCloud",
  envVars: ["NEEVCLOUD_API_KEY", "NEEVCLOUD_PAT", "NEEVCLOUD_TOKEN"],
  async fetch(env) {
    const token = env.NEEVCLOUD_API_KEY || env.NEEVCLOUD_PAT || env.NEEVCLOUD_TOKEN;
    if (!token) return [];
    const base = (env.NEEVCLOUD_API_BASE_URL || NEEVCLOUD_API_BASE_URL).replace(/\/$/, "");
    const timeoutMs = Number(env.NEEVCLOUD_TIMEOUT_MS || 30_000);
    const headers = { Accept: "application/json", Authorization: `Bearer ${token}` };

    const rows = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const payload = await jsonFetch(`${base}/inventory/api/v1beta1/inventory?page=${page}`, { headers, timeoutMs });
      const data = Array.isArray(payload?.data) ? payload.data : [];
      rows.push(...data);
      const totalPages = numberOrNull(payload?.pagination?.total_pages) || 1;
      if (page >= totalPages || data.length === 0) break;
    }
    return neevcloudInventoryToItems(rows);
  }
};

export function neevcloudInventoryToItems(rows = []) {
  return rows.map((row) => neevcloudRow(row)).filter(Boolean);
}

function neevcloudRow(row = {}) {
  const perGpuHour = numberOrNull(row.price_per_gpu_per_hour);
  const model = cleanModel(row.gpu_model);
  if (!model || perGpuHour == null || perGpuHour <= 0) return null;

  const vramGbEach = numberOrNull(row.vram_gib);
  const availableCount = numberOrNull(row.available_gpu_count);
  const gpuLabel = buildGpuLabel({ count: 1, model, vramGb: vramGbEach });
  const region = row.region || "NeevCloud";

  return createInventoryItem({
    provider: "NeevCloud",
    providerId: "neevcloud",
    rawOfferId: String(row.config_id || `${region}:${model}`),
    gpuLabel,
    gpuCount: 1,
    vramGbEach,
    pricePerGpuHour: perGpuHour,
    totalHourlyPrice: round(perGpuHour, 4),
    region,
    formFactor: row.instance_type === "vm" ? "vm" : "container",
    cpu: numberOrNull(row.default_cpu_cores) ? `${numberOrNull(row.default_cpu_cores)} vCPU` : "",
    ramGb: numberOrNull(row.default_memory_gib),
    networkFabric: "Not exposed",
    currency: "USD",
    availability: availableCount && availableCount > 0 ? "available" : "unavailable",
    availabilityCount: availableCount,
    checkoutUrl: NEEVCLOUD_CONSOLE_URL,
    sourceMode: "live",
    listingType: "gpu_sku_pricing",
    priceScope: "gpu_sku",
    availabilitySemantics: "sku_capacity",
    dataNotes: [
      "NeevCloud Inventory API per-GPU hourly USD price with live available_gpu_count",
      "Provisioning is an API mutation with no prefilled deploy URL, so rows are a priced capacity catalog (provider_console), not orderable",
      `Availability tier reported as "${row.availability ?? "unknown"}" (${availableCount ?? 0}/${numberOrNull(row.total_gpu_count) ?? 0} GPUs)`
    ],
    metadata: compactMetadata({
      configId: row.config_id,
      gpuModel: row.gpu_model,
      gpuVendor: row.gpu_vendor,
      vramGbEach,
      pricePerGpuPerHourUsd: perGpuHour,
      region,
      instanceType: row.instance_type,
      minGpuCount: numberOrNull(row.min_gpu_count),
      maxGpuCount: numberOrNull(row.max_gpu_count),
      availableGpuCount: availableCount,
      totalGpuCount: numberOrNull(row.total_gpu_count),
      availabilityTier: row.availability,
      cpuCores: numberOrNull(row.default_cpu_cores),
      memoryGib: numberOrNull(row.default_memory_gib)
    }),
    rawPayload: { ...row }
  });
}

// Model strings read e.g. "NVIDIA A100", "NVIDIA GeForce RTX 5090", "Tesla T4". Drop the
// vendor/brand prefixes so taxonomy reads the model token.
function cleanModel(value = "") {
  return String(value || "")
    .replace(/\b(NVIDIA|AMD|GeForce|Tesla)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}
