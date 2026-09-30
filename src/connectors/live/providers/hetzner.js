import { createInventoryItem } from "../../../core/inventory.js";
import { buildGpuLabel, compactMetadata, fabricDataNote, numberOrNull, round, truthyEnv } from "../format.js";

// Hetzner dedicated GPU servers. The product page uses this public Robot endpoint
// to check upfront availability before submitting an order form. It exposes live
// per-location quantities and native hourly/monthly EUR prices, but the public
// configurator/order flow is not an exact listing URL, so rows stay non-orderable.
const HETZNER_AVAILABLE_CONFIGURATIONS_URL =
  "https://robot-ws.your-server.de/order/server/available_configurations?currency=EUR";

const GPU_BY_PRODUCT = {
  GEX44: { model: "RTX 4000 SFF Ada", vramGb: 20 },
  GEX131: { model: "RTX PRO 6000 Blackwell Max-Q", vramGb: 96 }
};

export const hetznerConnector = {
  id: "hetzner",
  name: "Hetzner",
  envVars: ["HETZNER_ENABLED"],
  async fetch(env) {
    if (!truthyEnv(env.HETZNER_ENABLED)) return [];
    const url = env.HETZNER_AVAILABLE_CONFIGURATIONS_URL || HETZNER_AVAILABLE_CONFIGURATIONS_URL;
    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "gpu-deal-terminal" },
      signal: AbortSignal.timeout(Number(env.HETZNER_TIMEOUT_MS || 30_000))
    });
    if (!response.ok) throw new Error(`hetzner available configurations ${response.status}`);
    return hetznerConfigurationsToItems(await response.json());
  }
};

export function hetznerConfigurationsToItems(payload = []) {
  const rows = Array.isArray(payload) ? payload : [];
  const items = [];
  for (const row of rows) {
    const productName = String(row.product_name || serverComponent(row)?.name_en || "").trim();
    const productKey = hetznerGpuProductKey(productName);
    if (!productKey) continue;
    for (const [location, availability] of Object.entries(row.availabilities || {})) {
      const item = hetznerRowToItem(row, productName, productKey, location, availability);
      if (item) items.push(item);
    }
  }
  return items;
}

function hetznerRowToItem(row, productName, productKey, location, availability = {}) {
  const gpu = GPU_BY_PRODUCT[productKey];
  const hourlyPrice = numberOrNull(availability.price?.hourly);
  if (!hourlyPrice) return null;

  const gpuCount = 1;
  const gpuLabel = buildGpuLabel({ count: gpuCount, model: gpu.model, vramGb: gpu.vramGb });
  const cpu = component(row, "cpu");
  const ramGb = sumComponentsGb(row, "ram");
  const storage = storageSummary(row);
  const availabilityCount = nonNegativeInteger(availability.quantity);
  const available = availabilityCount == null ? "unknown" : availabilityCount > 0 ? "available" : "unavailable";
  const networkFabric = "Not exposed";

  return createInventoryItem({
    provider: "Hetzner",
    providerId: "hetzner",
    rawOfferId: `${row.configuration_id}:${location}`,
    gpuLabel,
    gpuCount,
    vramGbEach: gpu.vramGb,
    pricePerGpuHour: hourlyPrice,
    totalHourlyPrice: hourlyPrice,
    region: location,
    zone: location,
    formFactor: "bare_metal",
    interconnect: "Not exposed",
    cpu: cpu ? `${cpu.name_en || cpu.name_de || "CPU"} (${cpu.cores || "?"} cores / ${cpu.threads || "?"} threads)` : "",
    ramGb,
    storage,
    networkFabric,
    currency: "EUR",
    availability: available,
    availabilityCount,
    checkoutUrl: `https://www.hetzner.com/dedicated-rootserver/${productKey.toLowerCase()}/configurator/`,
    sourceMode: "live",
    listingType: "dedicated_gpu_server_capacity",
    priceScope: "node_total",
    availabilitySemantics: "sku_capacity",
    dataNotes: [
      "Hetzner public Robot available_configurations endpoint exposes per-location quantity and native hourly/monthly EUR price for GEX dedicated GPU servers",
      "Configurator URL is product-level and not an exact listing/order URL, so this row is provider_console only",
      "GPU model/VRAM mapped from Hetzner GEX product pages; the availability endpoint does not include a GPU component object",
      fabricDataNote(networkFabric, gpuLabel, gpuCount)
    ].filter(Boolean),
    metadata: compactMetadata({
      productName,
      productKey,
      configurationId: row.configuration_id,
      location,
      monthlyEur: numberOrNull(availability.price?.monthly),
      hourlyEur: hourlyPrice,
      setupEur: numberOrNull(availability.price?.setup),
      quantity: availabilityCount,
      cpu,
      ramGb,
      storageComponents: components(row, ["ssd", "hdd"]),
      rawAvailability: availability
    }),
    rawPayload: { productName, productKey, location, configurationId: row.configuration_id, configuration: row.configuration, availability }
  });
}

function hetznerGpuProductKey(productName = "") {
  if (GPU_BY_PRODUCT[productName]) return productName;
  const base = String(productName).match(/^GEX\d+/i)?.[0]?.toUpperCase();
  return GPU_BY_PRODUCT[base] ? base : null;
}

function component(row, type) {
  return components(row, [type])[0] || null;
}

function serverComponent(row) {
  return component(row, "server");
}

function components(row, types) {
  const wanted = new Set(types);
  return Array.isArray(row.configuration) ? row.configuration.filter((part) => wanted.has(part?.type)) : [];
}

function sumComponentsGb(row, type) {
  const total = components(row, [type]).reduce((sum, part) => sum + sizeToGb(part), 0);
  return total > 0 ? round(total, 2) : null;
}

function storageSummary(row) {
  const disks = components(row, ["ssd", "hdd"]);
  if (!disks.length) return "";
  const grouped = new Map();
  for (const disk of disks) {
    const name = disk.name_en || disk.name_de || `${disk.size || ""} ${disk.unit || ""} ${disk.type || ""}`.trim();
    grouped.set(name, (grouped.get(name) || 0) + 1);
  }
  return [...grouped.entries()].map(([name, count]) => `${count}x ${name}`).join(" + ");
}

function sizeToGb(part = {}) {
  const size = Number(part.size);
  if (!Number.isFinite(size) || size <= 0) return 0;
  const unit = String(part.unit || "").toLowerCase();
  if (unit === "tb" || unit === "tib") return size * 1024;
  if (unit === "mb" || unit === "mib") return size / 1024;
  return size;
}

function nonNegativeInteger(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
}
