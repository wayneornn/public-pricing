import { createInventoryItem } from "../../../core/inventory.js";
import { jsonFetch } from "../http.js";
import { buildGpuLabel, compactMetadata, fabricDataNote, numberOrNull, round } from "../format.js";

// Oblivus GPU cloud. Verified against the live API (Postman collection + real calls):
//   GET https://api.oblivus.com/v2/cloud/metadata/   -> data.gpu.<FLAVOR> specs + price
//   GET https://api.oblivus.com/v2/cloud/stock/list/ -> data.gpu.<FLAVOR>.<LOCATION>.virtualservers
//   Auth: header `apiKey: <key>` (NOT Bearer).
// metadata gives per-GPU `hourlyCost` (USD) + monthly tiers + `network` + a
// `configurations[]` array (x1..x8 with GPUAmount/vCPU/RAM/storage). stock gives the
// count of deployable VMs per flavor per location.
//
// We emit one row per (configuration, location-with-stock); price-per-GPU = hourlyCost,
// node total = hourlyCost * GPUAmount. Oblivus is genuinely orderable supply, but we do
// not have a verified deploy deep-link, so per the repo's checkout-truth rule these are
// a priced catalog (provider_console), not a claimed prefilled checkout.
const OBLIVUS_API_BASE_URL = "https://api.oblivus.com/v2";

export const oblivusConnector = {
  id: "oblivus",
  name: "Oblivus",
  envVars: ["OBLIVUS_API_KEY", "OBLIVUS_TOKEN"],
  async fetch(env) {
    const key = env.OBLIVUS_API_KEY || env.OBLIVUS_TOKEN;
    if (!key) return [];
    const base = (env.OBLIVUS_API_BASE_URL || OBLIVUS_API_BASE_URL).replace(/\/$/, "");
    const headers = { apiKey: key, Accept: "application/json" };
    const timeoutMs = Number(env.OBLIVUS_TIMEOUT_MS || 30_000);
    const [metadata, stock] = await Promise.all([
      jsonFetch(`${base}/cloud/metadata/`, { headers, timeoutMs }),
      jsonFetch(`${base}/cloud/stock/list/`, { headers, timeoutMs })
    ]);
    return oblivusToItems(metadata?.data?.gpu || {}, stock?.data?.gpu || {});
  }
};

export function oblivusToItems(metaGpu = {}, stockGpu = {}) {
  const items = [];
  for (const [flavor, meta] of Object.entries(metaGpu)) {
    const pricePerGpuHour = numberOrNull(meta.hourlyCost);
    if (pricePerGpuHour == null) continue;
    const stockByLocation = stockGpu[flavor] || {};
    const availableLocations = Object.entries(stockByLocation)
      .map(([loc, v]) => [loc, Number(v?.virtualservers || 0)])
      .filter(([, count]) => count > 0);
    for (const config of meta.configurations || []) {
      if (availableLocations.length) {
        for (const [location, count] of availableLocations) {
          items.push(oblivusRow(flavor, meta, config, pricePerGpuHour, { location, count }));
        }
      } else {
        // SKU exists in the catalog but no location currently has stock.
        items.push(oblivusRow(flavor, meta, config, pricePerGpuHour, { location: "", count: 0 }));
      }
    }
  }
  return items.filter(Boolean);
}

function oblivusRow(flavor, meta, config, pricePerGpuHour, stock) {
  const gpuCount = numberOrNull(config.GPUAmount) || 1;
  const vramGbEach = oblivusVramGb(flavor, meta.metaName);
  const gpuLabel = buildGpuLabel({ count: gpuCount, model: meta.metaName || flavor, vramGb: vramGbEach });
  const hasStock = stock.count > 0;

  return createInventoryItem({
    provider: "Oblivus",
    providerId: "oblivus",
    rawOfferId: `${config.flavorID || flavor}${stock.location ? `:${stock.location}` : ""}`,
    gpuLabel,
    gpuCount,
    vramGbEach,
    pricePerGpuHour,
    totalHourlyPrice: round(pricePerGpuHour * gpuCount, 4),
    region: stock.location || "Oblivus",
    formFactor: "vm",
    interconnect: oblivusInterconnect(flavor),
    cpu: config.vCPU ? `${config.vCPU} vCPU` : "",
    ramGb: numberOrNull(config.RAM),
    storage: oblivusStorage(config),
    networkBandwidth: meta.network || "",
    networkFabric: "Not exposed",
    currency: "USD",
    availability: stock.location ? (hasStock ? "available" : "unavailable") : "unknown",
    availabilityCount: stock.location ? stock.count : null,
    checkoutUrl: "https://console.oblivus.com/cloud/deploy",
    sourceMode: "live",
    listingType: "gpu_flavor_configuration",
    priceScope: "node_total",
    availabilitySemantics: "sku_capacity",
    dataNotes: [
      "Oblivus per-GPU on-demand price (hourlyCost); monthly-commit tiers also exist",
      stock.location ? `${stock.count} deployable at ${stock.location}` : "No location currently reports stock",
      meta.network ? `Network: ${meta.network}` : "",
      fabricDataNote("Not exposed", gpuLabel, gpuCount)
    ].filter(Boolean),
    metadata: compactMetadata({
      flavor,
      flavorID: config.flavorID,
      metaName: meta.metaName,
      hourlyCostPerGpu: meta.hourlyCost,
      monthlyTiers: { "1m": meta["1m"], "3m": meta["3m"], "12m": meta["12m"], "36m": meta["36m"] },
      network: meta.network,
      vCPU: config.vCPU,
      ramGb: config.RAM,
      rootStorageGb: config.rootStorage,
      ephemeralStorageGb: config.ephemeralStorage,
      gpuAmount: config.GPUAmount,
      location: stock.location,
      stockCount: stock.count
    }),
    rawPayload: { flavor, configuration: config, hourlyCost: meta.hourlyCost, network: meta.network, location: stock.location, stock: stock.count }
  });
}

function oblivusVramGb(flavor = "", metaName = "") {
  const match = `${flavor} ${metaName}`.match(/(\d{2,3})\s*GB/i);
  return match ? Number(match[1]) : null;
}

function oblivusInterconnect(flavor = "") {
  if (/sxm|nvlink/i.test(flavor)) return "NVLink";
  if (/pcie/i.test(flavor)) return "PCIe";
  return "";
}

function oblivusStorage(config = {}) {
  const root = numberOrNull(config.rootStorage);
  const ephemeral = numberOrNull(config.ephemeralStorage);
  return [root ? `${root} GB root` : "", ephemeral ? `${ephemeral} GB ephemeral` : ""].filter(Boolean).join(" + ");
}
