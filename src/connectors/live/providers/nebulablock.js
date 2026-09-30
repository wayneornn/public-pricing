import { createInventoryItem } from "../../../core/inventory.js";
import { jsonFetch } from "../http.js";
import { buildGpuLabel, compactMetadata, numberOrNull, round, truthyEnv } from "../format.js";

// Nebula Block (nebulablock.com) — sovereign GPU cloud / marketplace. Public no-auth JSON API:
//   GET https://api.nebulablock.com/api/v1/computing/products
//   -> { status, message, data: { <COUNTRY>: { <gpu_type>: [ { id, price_per_hour, gpu,
//        gpu_type, gpu_count, vram?, cpu, ram, disk_size, region, country, stock,
//        is_available, is_spot } ] } } }
// `price_per_hour` is the whole-instance hourly USD; per-GPU = price_per_hour / gpu_count. We
// drop is_spot rows (the repo never surfaces spot). The API exposes stock + is_available but
// no exact deploy URL, so rows are a priced capacity catalog (provider_console), not orderable.
// Opt-in via NEBULABLOCK_ENABLED=1 (public API, no key).
const NEBULABLOCK_API_URL = "https://api.nebulablock.com/api/v1/computing/products";
const NEBULABLOCK_CONSOLE_URL = "https://nebulablock.com/";

export const nebulablockConnector = {
  id: "nebulablock",
  name: "Nebula Block",
  envVars: ["NEBULABLOCK_ENABLED"],
  async fetch(env) {
    if (!truthyEnv(env.NEBULABLOCK_ENABLED)) return [];
    const url = env.NEBULABLOCK_API_URL || NEBULABLOCK_API_URL;
    const payload = await jsonFetch(url, {
      headers: { Accept: "application/json" },
      timeoutMs: Number(env.NEBULABLOCK_TIMEOUT_MS || 30_000)
    });
    return nebulablockToItems(payload);
  }
};

export function nebulablockToItems(payload = {}) {
  const data = payload && typeof payload.data === "object" ? payload.data : {};
  const items = [];
  for (const byGpu of Object.values(data)) {
    if (!byGpu || typeof byGpu !== "object") continue;
    for (const products of Object.values(byGpu)) {
      if (!Array.isArray(products)) continue;
      for (const product of products) {
        const item = nebulablockRow(product);
        if (item) items.push(item);
      }
    }
  }
  return items;
}

function nebulablockRow(product = {}) {
  if (product.is_spot === true) return null; // spot/interruptible supply must never be emitted
  const totalHourly = numberOrNull(product.price_per_hour);
  const gpuCount = numberOrNull(product.gpu_count) || 1;
  const model = cleanModel(product.gpu_type || product.gpu);
  if (!model || totalHourly == null || totalHourly <= 0) return null;

  // gpu string like "A100-80G-PCIe" → VRAM 80, variant PCIe.
  const gpuStr = String(product.gpu || "");
  const vramMatch = gpuStr.match(/(\d+)\s*G\b/i);
  const vramGbEach = numberOrNull(product.vram) || (vramMatch ? numberOrNull(vramMatch[1]) : null);
  const variant = /pcie/i.test(gpuStr) ? "PCIe" : /sxm/i.test(gpuStr) ? "SXM" : undefined;
  const pricePerGpuHour = round(totalHourly / gpuCount, 4);
  const stock = numberOrNull(product.stock);
  const available = product.is_available === true && (stock == null || stock > 0);
  const gpuLabel = buildGpuLabel({ count: gpuCount, model, vramGb: vramGbEach, variant });

  return createInventoryItem({
    provider: "Nebula Block",
    providerId: "nebulablock",
    rawOfferId: String(product.id || `${product.region || product.country}:${gpuStr}:${gpuCount}`),
    gpuLabel,
    gpuCount,
    vramGbEach,
    pricePerGpuHour,
    totalHourlyPrice: round(totalHourly, 4),
    region: product.region || product.country || "Nebula Block",
    formFactor: /bare/i.test(product.product_type || "") ? "bare_metal" : "vm",
    cpu: numberOrNull(product.cpu) ? `${numberOrNull(product.cpu)} vCPU` : "",
    ramGb: numberOrNull(product.ram),
    storage: numberOrNull(product.disk_size) ? `${numberOrNull(product.disk_size)} GB` : "",
    networkFabric: "Not exposed",
    currency: "USD",
    availability: available ? "available" : "unavailable",
    availabilityCount: stock,
    checkoutUrl: NEBULABLOCK_CONSOLE_URL,
    sourceMode: "live",
    listingType: "gpu_sku_pricing",
    priceScope: "node_total",
    availabilitySemantics: "sku_capacity",
    dataNotes: [
      "Nebula Block public products API: whole-instance hourly USD (per-GPU = price/gpu_count) with live stock/is_available",
      "Spot rows dropped; provisioning needs the console + funded wallet (no exact deploy URL), so rows are a priced capacity catalog (provider_console), not orderable"
    ],
    metadata: compactMetadata({
      id: product.id,
      gpu: product.gpu,
      gpuType: product.gpu_type,
      gpuCount,
      vramGbEach,
      pricePerGpuHourUsd: pricePerGpuHour,
      country: product.country,
      region: product.region,
      stock,
      isAvailable: product.is_available,
      cpu: numberOrNull(product.cpu),
      ramGb: numberOrNull(product.ram),
      diskGb: numberOrNull(product.disk_size)
    }),
    rawPayload: { ...product }
  });
}

function cleanModel(value = "") {
  return String(value || "")
    .replace(/-\d+G(?:-\w+)?$/i, "")
    .replace(/\b(NVIDIA|AMD|Instinct)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}
