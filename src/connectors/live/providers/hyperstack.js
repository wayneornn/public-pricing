import { createInventoryItem } from "../../../core/inventory.js";
import { jsonFetch, safeJsonFetch, pickArray } from "../http.js";
import { buildGpuLabel, compactMetadata, fabricDataNote, fabricFromText, numberOrNull } from "../format.js";

const HYPERSTACK_API_BASE_URL = "https://infrahub-api.nexgencloud.com/v1";

export const hyperstackConnector = {
  id: "hyperstack",
  name: "Hyperstack",
  envVars: ["HYPERSTACK_API_KEY"],
  async fetch(env) {
    const key = env.HYPERSTACK_API_KEY;
    if (!key) return [];
    const base = (env.HYPERSTACK_API_BASE_URL || HYPERSTACK_API_BASE_URL).replace(/\/$/, "");
    const headers = { api_key: key };
    const [flavorsData, pricebookData] = await Promise.all([
      jsonFetch(`${base}/core/flavors`, { headers }),
      safeJsonFetch(`${base}/pricebook`, { headers })
    ]);
    const priceMap = hyperstackPriceMap(pricebookData);
    return flattenHyperstackFlavors(flavorsData)
      .filter((raw) => Number(raw.gpu_count || raw.gpuCount || 0) > 0 && String(raw.gpu || "").trim())
      .map((raw) => hyperstackFlavorToItem(raw, priceMap));
  }
};

function flattenHyperstackFlavors(data) {
  const groups = pickArray(data, ["data", "results", "flavors"]);
  const flavors = [];
  for (const group of groups) {
    if (Array.isArray(group.flavors)) {
      for (const flavor of group.flavors) {
        flavors.push({
          ...flavor,
          gpu: flavor.gpu || group.gpu,
          region_name: flavor.region_name || group.region_name
        });
      }
    } else {
      flavors.push(group);
    }
  }
  return flavors;
}

export function hyperstackFlavorToItem(raw, priceMap) {
  const gpuCount = Number(raw.gpu_count || raw.gpuCount || 1);
  const pricing = hyperstackFlavorPricing(raw, priceMap);
  const stock = hyperstackStockAvailability(raw.stock_available);
  const labels = raw.labels?.map((label) => label.label || label);
  const networkFabric = fabricFromText(
    raw.network,
    raw.network_type,
    Array.isArray(labels) ? labels.join(" ") : ""
  );
  const notes = [];
  if (pricing.scope === "gpu_sku_only") notes.push("GPU pricebook component", "CPU/RAM/disk may apply");
  if (!pricing.totalHourlyPrice) notes.push("Price unavailable from API");
  if (raw.features?.api_only) notes.push("API-only flavor");
  if (raw.features?.network_optimised) notes.push("Provider API marks flavor network-optimized; fabric not implied");
  if (stock.availability === "unknown") notes.push("Stock availability not returned");
  const fabricNote = fabricDataNote(networkFabric, raw.gpu || raw.display_name || raw.name, gpuCount);
  if (fabricNote) notes.push(fabricNote);
  return createInventoryItem({
    provider: "Hyperstack",
    providerId: "hyperstack",
    rawOfferId: [raw.id, raw.name, raw.region_name].filter(Boolean).join(":") || `${raw.gpu}:${raw.region_name}:${gpuCount}`,
    gpuLabel: buildGpuLabel({
      count: gpuCount,
      model: raw.gpu || raw.display_name || raw.name,
      variant: raw.display_name || raw.name
    }),
    gpuCount,
    pricePerGpuHour: pricing.pricePerGpuHour,
    totalHourlyPrice: pricing.totalHourlyPrice,
    region: raw.region_name,
    formFactor: "vm",
    interconnect: raw.display_name || raw.name || raw.gpu,
    cpu: raw.cpu ? `${raw.cpu} vCPU` : "",
    ramGb: raw.ram,
    storage: hyperstackStorage(raw),
    networkBandwidth: raw.network || raw.bandwidth || "",
    networkFabric,
    availability: stock.availability,
    availabilityCount: stock.availability === "available" ? null : 0,
    checkoutUrl: buildHyperstackUrl(raw),
    checkoutSemantics: "manual_provider",
    sourceMode: "live",
    listingType: "flavor",
    priceScope: pricing.scope,
    availabilitySemantics: stock.hasStockSignal ? "sku_capacity" : "region_offering",
    dataNotes: notes,
    metadata: compactMetadata({
      flavorId: raw.id,
      name: raw.name,
      displayName: raw.display_name,
      regionName: raw.region_name,
      features: raw.features,
      labels,
      networkFabric,
      diskGb: raw.disk,
      ephemeralGb: raw.ephemeral,
      stockAvailable: raw.stock_available,
      pricing
    }),
    rawPayload: raw
  });
}

function hyperstackFlavorPricing(raw, priceMap) {
  const gpuCount = Number(raw.gpu_count || raw.gpuCount || 1);
  const direct = numberOrNull(raw.price_per_hour ?? raw.hourly_price ?? raw.pricePerHour ?? raw.price);
  if (direct) {
    return {
      totalHourlyPrice: direct,
      pricePerGpuHour: gpuCount ? direct / gpuCount : direct,
      scope: "node_total"
    };
  }

  const gpuRate = findPriceRate(priceMap, [
    raw.gpu,
    raw.display_name,
    raw.name,
    String(raw.gpu || "").replace(/\s+/g, "-")
  ]);
  if (gpuRate) {
    return {
      totalHourlyPrice: gpuRate * gpuCount,
      pricePerGpuHour: gpuRate,
      scope: "gpu_sku_only"
    };
  }

  return {
    totalHourlyPrice: null,
    pricePerGpuHour: null,
    scope: "unknown"
  };
}

function hyperstackStockAvailability(value) {
  if (value === true) return { availability: "available", hasStockSignal: true };
  if (value === false) return { availability: "unavailable", hasStockSignal: true };
  const text = String(value ?? "").trim();
  if (!text) return { availability: "unknown", hasStockSignal: false };
  if (/available|in_stock|stock/i.test(text) && !/unavailable|out|none|false/i.test(text)) {
    return { availability: "available", hasStockSignal: true };
  }
  if (/unavailable|out|none|false|sold/i.test(text)) {
    return { availability: "unavailable", hasStockSignal: true };
  }
  return { availability: "unknown", hasStockSignal: false };
}

function hyperstackPriceMap(pricebookData) {
  const map = new Map();
  collectPriceRates(pricebookData, map);
  return map;
}

function collectPriceRates(value, map) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectPriceRates(item, map);
    return;
  }
  const name = value.name || value.resource_name || value.resourceName || value.label || value.type;
  const rate = numberOrNull(value.discounted_rate ?? value.rate ?? value.value ?? value.original_value ?? value.price_per_hour ?? value.hourly_price ?? value.price);
  if (name && rate) map.set(normalizePriceKey(name), rate);
  for (const child of Object.values(value)) collectPriceRates(child, map);
}

function findPriceRate(priceMap, aliases) {
  const normalizedAliases = aliases.map((alias) => normalizePriceKey(alias)).filter(Boolean);
  for (const alias of normalizedAliases) {
    if (priceMap.has(alias)) return priceMap.get(alias);
  }
  for (const alias of normalizedAliases) {
    for (const [key, rate] of priceMap.entries()) {
      if (alias.length >= 4 && key.includes(alias)) return rate;
      if (key.length >= 4 && alias.includes(key)) return rate;
    }
  }
  return null;
}

function normalizePriceKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/nvidia|tesla|gpu|gb|gib|memory|vram/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function hyperstackStorage(raw) {
  const root = raw.disk ? `${raw.disk} GB root` : "";
  const ephemeral = raw.ephemeral ? `${raw.ephemeral} GB ephemeral` : "";
  return [root, ephemeral].filter(Boolean).join(", ");
}

function buildHyperstackUrl(raw) {
  const params = new URLSearchParams();
  if (raw.name) params.set("flavor", raw.name);
  if (raw.region_name) params.set("region", raw.region_name);
  const query = params.toString();
  return `https://console.hyperstack.cloud/deploy-vm${query ? `?${query}` : ""}`;
}
