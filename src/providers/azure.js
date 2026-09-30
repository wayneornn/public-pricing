import { DefaultAzureCredential } from "@azure/identity";
import { createInventoryItem } from "../core/inventory.js";
import { hasEnvValue, truthyEnv } from "../core/env.js";
import { numberOrNull, round } from "../core/num.js";
import { normalizedList, parseEnvList } from "../core/format.js";
import { cacheKeyForList, cachedApiStage } from "../core/apiCache.js";

export const AZURE_PROVIDER_ID = "azure";
export const AZURE_CRAWLER_SCHEDULE = Object.freeze({
  resourceSkus: "daily",
  retailPricing: "every_12_hours",
  spotPricing: "every_1_hour"
});

export const AZURE_STAGE_TTLS_MS = Object.freeze({
  skus: 24 * 60 * 60 * 1000,
  prices: 12 * 60 * 60 * 1000,
  spotPrices: 60 * 60 * 1000
});

const AZURE_MANAGEMENT_SCOPE = "https://management.azure.com/.default";
const AZURE_RESOURCE_SKUS_API_VERSION = "2025-04-01";
const AZURE_RETAIL_PRICES_URL = "https://prices.azure.com/api/retail/prices";

export function hasAzureConfiguration(env = process.env) {
  const hasServicePrincipal = hasEnvValue(env.AZURE_TENANT_ID)
    && hasEnvValue(env.AZURE_CLIENT_ID)
    && hasEnvValue(env.AZURE_CLIENT_SECRET);
  const hasFederatedCredential = hasEnvValue(env.AZURE_TENANT_ID)
    && hasEnvValue(env.AZURE_CLIENT_ID)
    && hasEnvValue(env.AZURE_FEDERATED_TOKEN_FILE);
  return hasEnvValue(env.AZURE_SUBSCRIPTION_ID)
    && (
      truthyEnv(env.AZURE_GPU_INVENTORY_ENABLED)
      || hasEnvValue(env.AZURE_ACCESS_TOKEN)
      || hasServicePrincipal
      || hasFederatedCredential
    );
}

export async function get_regions(env = process.env, options = {}) {
  const selected = normalizedList(options.regions).length ? normalizedList(options.regions) : parseEnvList(env.AZURE_GPU_REGIONS);
  if (selected.length) return selected;
  const skus = await get_skus(env, options);
  return [...new Set(skus.flatMap((sku) => sku.locations || []).filter(Boolean))].sort();
}

export async function get_skus(env = process.env, options = {}) {
  const rows = await cachedAzureStage(env, "skus", AZURE_STAGE_TTLS_MS.skus, options, async () => {
    const rawSkus = options.skus || await fetchResourceSkus(env, options);
    return rawSkus
      .filter((sku) => String(sku.resourceType || "").toLowerCase() === "virtualmachines")
      .filter(isAzureGpuSku)
      .sort((left, right) => String(left.name).localeCompare(String(right.name)));
  });
  return Array.isArray(rows) ? rows : [];
}

export async function get_offerings(skus, env = process.env, options = {}) {
  const regions = normalizedList(options.regions).length ? normalizedList(options.regions) : parseEnvList(env.AZURE_GPU_REGIONS);
  const rows = [];
  for (const sku of skus || []) {
    rows.push(...azureSkuToOfferings(sku, regions));
  }
  return rows.sort(compareAzureRows);
}

export async function get_prices(region, skuNames, env = process.env, options = {}) {
  const names = new Set(normalizedList(skuNames));
  const rows = await cachedAzureStage(env, `prices/${region}/${cacheKeyForList([...names])}`, AZURE_STAGE_TTLS_MS.prices, options, async () => {
    const items = options.retailItems || await fetchRetailPriceItems(region, env, options);
    return parseRetailPrices(items, names, { spot: false });
  });
  return new Map((Array.isArray(rows) ? rows : []).map((row) => [row.sku_name, row]));
}

export async function get_spot_prices(region, skuNames, env = process.env, options = {}) {
  const names = new Set(normalizedList(skuNames));
  const rows = await cachedAzureStage(env, `spot-prices/${region}/${cacheKeyForList([...names])}`, AZURE_STAGE_TTLS_MS.spotPrices, options, async () => {
    const items = options.retailItems || await fetchRetailPriceItems(region, env, options);
    return parseRetailPrices(items, names, { spot: true });
  });
  return new Map((Array.isArray(rows) ? rows : []).map((row) => [row.sku_name, row]));
}

export async function crawl(env = process.env, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const skus = filterSelectedSkus(await get_skus(env, options), options.skuNames || parseEnvList(env.AZURE_GPU_SKUS));
  const offerings = await get_offerings(skus, env, options);
  const rows = [];
  const offeringsByRegion = groupBy(offerings, (offering) => offering.region);

  for (const [region, regionOfferings] of offeringsByRegion) {
    const skuNames = [...new Set(regionOfferings.map((offering) => offering.sku_name))];
    const [prices, spotPrices] = await Promise.all([
      get_prices(region, skuNames, env, options),
      get_spot_prices(region, skuNames, env, options)
    ]);
    for (const offering of regionOfferings) {
      const price = prices.get(offering.sku_name);
      const spotPrice = spotPrices.get(offering.sku_name);
      rows.push({
        provider: AZURE_PROVIDER_ID,
        region: offering.region,
        availability_zone: offering.availability_zone,
        sku_name: offering.sku_name,
        gpu_model: offering.gpu_model,
        gpu_count: offering.gpu_count,
        gpu_memory_gb: offering.gpu_memory_gb,
        vcpu: offering.vcpu,
        ram_gb: offering.ram_gb,
        network: offering.network,
        network_fabric: offering.network_fabric,
        local_storage: offering.local_storage,
        offered: offering.offered,
        restriction_reason: offering.restriction_reason,
        on_demand_price_usd_per_hour: price?.on_demand_price_usd_per_hour ?? null,
        spot_price_usd_per_hour: spotPrice?.spot_price_usd_per_hour ?? null,
        last_seen: now.toISOString(),
        metadata: {
          accelerated_networking: offering.accelerated_networking,
          premium_storage: offering.premium_storage,
          generation: offering.generation,
          capabilities: offering.capabilities,
          restrictions: offering.restrictions,
          rawResourceSku: offering.rawSku,
          onDemandPrice: price || null,
          spotPrice: spotPrice || null,
          rawOnDemandPrice: price?.rawPrice || null,
          rawSpotPrice: spotPrice?.rawPrice || null
        }
      });
    }
  }

  return rows.sort(compareAzureRows);
}

// Published Azure VM sizes whose GPU count is part of the size name, not inferred.
// Used when Resource SKUs (which need a subscription) are unavailable. Retail
// prices still come from the public prices.azure.com API.
export const AZURE_PUBLIC_GPU_SKUS = Object.freeze({
  Standard_NC40ads_H100_v5: { gpu_model: "H100 NVL", gpu_count: 1, gpu_memory_gb: 94, interconnect: "NVLink", network_fabric: "Not exposed" },
  Standard_NC80adis_H100_v5: { gpu_model: "H100 NVL", gpu_count: 2, gpu_memory_gb: 94, interconnect: "NVLink", network_fabric: "Not exposed" },
  Standard_ND96is_H100_v5: { gpu_model: "H100 SXM", gpu_count: 8, gpu_memory_gb: 80, interconnect: "NVLink", network_fabric: "Not exposed" },
  Standard_ND96is_noIB_H100_v5: { gpu_model: "H100 SXM", gpu_count: 8, gpu_memory_gb: 80, interconnect: "NVLink", network_fabric: "Not exposed" },
  Standard_ND96isf_H100_v5: { gpu_model: "H100 SXM", gpu_count: 8, gpu_memory_gb: 80, interconnect: "NVLink", network_fabric: "Not exposed" },
  Standard_ND96isr_H100_v5: { gpu_model: "H100 SXM", gpu_count: 8, gpu_memory_gb: 80, interconnect: "NVLink", network_fabric: "InfiniBand" },
  Standard_ND96isrf_H100_v5: { gpu_model: "H100 SXM", gpu_count: 8, gpu_memory_gb: 80, interconnect: "NVLink", network_fabric: "InfiniBand" },
  Standard_NC24ads_A100_v4: { gpu_model: "A100", gpu_count: 1, gpu_memory_gb: 80, interconnect: "PCIe", network_fabric: "Not exposed" },
  Standard_NC48ads_A100_v4: { gpu_model: "A100", gpu_count: 2, gpu_memory_gb: 80, interconnect: "PCIe", network_fabric: "Not exposed" },
  Standard_NC96ads_A100_v4: { gpu_model: "A100", gpu_count: 4, gpu_memory_gb: 80, interconnect: "PCIe", network_fabric: "Not exposed" },
  Standard_ND96asr_v4: { gpu_model: "A100", gpu_count: 8, gpu_memory_gb: 40, interconnect: "NVLink", network_fabric: "InfiniBand" },
  Standard_ND96asr_A100_v4: { gpu_model: "A100", gpu_count: 8, gpu_memory_gb: 40, interconnect: "NVLink", network_fabric: "InfiniBand" },
  Standard_ND96ams_A100_v4: { gpu_model: "A100", gpu_count: 8, gpu_memory_gb: 80, interconnect: "NVLink", network_fabric: "Not exposed" },
  Standard_ND96amsr_A100_v4: { gpu_model: "A100", gpu_count: 8, gpu_memory_gb: 80, interconnect: "NVLink", network_fabric: "InfiniBand" },
  Standard_ND96isr_H200_v5: { gpu_model: "H200", gpu_count: 8, gpu_memory_gb: 141, interconnect: "NVLink", network_fabric: "InfiniBand" },
  Standard_ND96isrf_H200_v5: { gpu_model: "H200", gpu_count: 8, gpu_memory_gb: 141, interconnect: "NVLink", network_fabric: "InfiniBand" },
  Standard_ND96is_MI300X_v5: { gpu_model: "MI300X", gpu_count: 8, gpu_memory_gb: 192, interconnect: "Unknown", network_fabric: "Not exposed" },
  Standard_ND96isr_MI300X_v5: { gpu_model: "MI300X", gpu_count: 8, gpu_memory_gb: 192, interconnect: "Unknown", network_fabric: "InfiniBand" }
});

const AZURE_PUBLIC_PRODUCT_FILTERS = Object.freeze(["H100", "A100", "H200", "MI300X"]);

export async function crawlPublicRetail(env = process.env, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const items = options.retailItems || (await Promise.all(
    AZURE_PUBLIC_PRODUCT_FILTERS.map((productName) => fetchRetailProductItems(productName, env))
  )).flat();
  return azurePublicRetailItemsToRows(items, { now });
}

export function azurePublicRetailItemsToRows(items, { now = new Date() } = {}) {
  const seenAt = now instanceof Date ? now : new Date(now);
  const seen = new Map();
  for (const item of items || []) {
    if (!isPublicOnDemandRetailItem(item)) continue;
    const spec = AZURE_PUBLIC_GPU_SKUS[item.armSkuName];
    if (!spec || !item.armRegionName) continue;
    const price = numberOrNull(item.retailPrice ?? item.unitPrice);
    if (price == null) continue;
    const key = `${item.armSkuName}:${item.armRegionName}`;
    const existing = seen.get(key);
    if (existing && existing.on_demand_price_usd_per_hour <= price) continue;
    seen.set(key, {
      provider: AZURE_PROVIDER_ID,
      region: item.armRegionName,
      availability_zone: "regional",
      sku_name: item.armSkuName,
      gpu_model: spec.gpu_model,
      gpu_count: spec.gpu_count,
      gpu_memory_gb: spec.gpu_memory_gb,
      interconnect: spec.interconnect,
      network_fabric: spec.network_fabric,
      offered: null,
      availability: "unknown",
      restriction_reason: "",
      on_demand_price_usd_per_hour: price,
      spot_price_usd_per_hour: null,
      price_source: "retail_prices",
      last_seen: seenAt.toISOString(),
      metadata: {
        priceSource: "azure_retail_prices",
        productName: item.productName,
        meterName: item.meterName,
        rawOnDemandPrice: item
      }
    });
  }
  return [...seen.values()].sort(compareAzureRows);
}

async function fetchRetailProductItems(productName, env) {
  const params = new URLSearchParams();
  params.set("$filter", `serviceName eq 'Virtual Machines' and contains(productName,'${productName}') and priceType eq 'Consumption'`);
  let next = `${env.AZURE_RETAIL_PRICES_URL || AZURE_RETAIL_PRICES_URL}?${params.toString()}`;
  const rows = [];
  for (let page = 0; page < 20 && next; page += 1) {
    const response = await fetch(next, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`Azure Retail Prices failed: ${response.status} ${response.statusText}`);
    const body = await response.json();
    rows.push(...(body.Items || body.items || []));
    next = body.NextPageLink || body.nextPageLink || "";
  }
  return rows;
}

function isPublicOnDemandRetailItem(item) {
  if (!isRetailVmHourlyUsd(item)) return false;
  if (/windows/i.test(item.productName || "")) return false;
  if (isSpotRetailItem(item) || /low priority/i.test(`${item.meterName || ""} ${item.skuName || ""} ${item.productName || ""}`)) return false;
  if (item.type && !/^Consumption$/i.test(item.type)) return false;
  return true;
}

export function azureInventoryRowToInventoryItem(row, env = process.env) {
  return createInventoryItem({
    provider: "Azure",
    providerId: AZURE_PROVIDER_ID,
    rawOfferId: `${row.region}:${row.availability_zone}:${row.sku_name}`,
    gpuLabel: azureGpuLabel(row),
    gpuCount: row.gpu_count,
    vramGbEach: row.gpu_memory_gb,
    pricePerGpuHour: row.on_demand_price_usd_per_hour && row.gpu_count ? row.on_demand_price_usd_per_hour / row.gpu_count : null,
    totalHourlyPrice: row.on_demand_price_usd_per_hour,
    region: row.region,
    formFactor: "vm",
    interconnect: row.interconnect || (/sxm|nd/i.test(`${row.gpu_model} ${row.sku_name}`) ? "NVLink" : "PCIe"),
    cpu: row.vcpu ? `${row.vcpu} vCPU` : "",
    ramGb: row.ram_gb,
    storage: row.local_storage,
    networkBandwidth: row.network,
    networkFabric: row.network_fabric || "Not exposed",
    availability: row.availability || (row.offered ? "available" : "unavailable"),
    availabilityCount: null,
    currency: "USD",
    checkoutUrl: buildAzureVmUrl(row.region, row.sku_name, env),
    sourceMode: row.price_source === "retail_prices" ? "catalog" : "live",
    listingType: row.price_source === "retail_prices" ? "azure_retail_price" : "azure_resource_sku_offering",
    priceScope: "node_total",
    dataNotes: [
      ...(row.price_source === "retail_prices"
        ? ["Azure Retail Prices API", "Published VM list price, capacity not checked"]
        : ["Azure official Resource SKUs and Retail Prices APIs", "Offered SKU/zone, not capacity checked"]),
      row.network_fabric ? `Fabric: ${row.network_fabric}` : "Fabric not exposed",
      row.restriction_reason ? `Restriction: ${row.restriction_reason}` : "",
      row.spot_price_usd_per_hour != null ? `Spot: $${row.spot_price_usd_per_hour}/hr` : ""
    ].filter(Boolean),
    metadata: {
      table: "azure_inventory",
      region: row.region,
      availabilityZone: row.availability_zone,
      skuName: row.sku_name,
      restrictionReason: row.restriction_reason,
      acceleratedNetworking: row.metadata?.accelerated_networking,
      premiumStorage: row.metadata?.premium_storage,
      networkFabric: row.network_fabric,
      generation: row.metadata?.generation,
      rawResourceSku: row.metadata?.rawResourceSku,
      onDemandPrice: row.metadata?.onDemandPrice,
      spotPrice: row.metadata?.spotPrice,
      rawOnDemandPrice: row.metadata?.rawOnDemandPrice,
      rawSpotPrice: row.metadata?.rawSpotPrice,
      spotPriceUsdPerHour: row.spot_price_usd_per_hour,
      lastSeen: row.last_seen
    },
    lastSeenAt: row.last_seen,
    rawPayload: row
  });
}

export function parseAzureSkuMetadata(sku) {
  const capabilities = capabilitiesToMap(sku.capabilities);
  const skuName = sku.name || "";
  const mapping = mapAzureGpuSku(skuName, capabilities);
  if (!mapping) return null;
  return {
    sku_name: skuName,
    gpu_model: mapping.gpu_model,
    gpu_count: firstNumberCapability(capabilities, ["GPUs", "GpuCount", "GPU", "Accelerators"]) ?? mapping.gpu_count ?? null,
    gpu_memory_gb: firstNumberCapability(capabilities, ["GPUMemoryGB", "GpuMemoryGB", "GPU Memory", "GpuMemory"]) ?? mapping.gpu_memory_gb ?? null,
    vcpu: firstNumberCapability(capabilities, ["vCPUs", "vCPUsAvailable", "VCpus"]),
    ram_gb: firstNumberCapability(capabilities, ["MemoryGB", "MemoryInMB"], { memoryMbToGb: true }),
    accelerated_networking: booleanCapability(capabilities, ["AcceleratedNetworkingEnabled", "AcceleratedNetworking"]),
    premium_storage: booleanCapability(capabilities, ["PremiumIO", "PremiumStorage"]),
    local_storage: localStorageFromCapabilities(capabilities),
    generation: capabilities.HyperVGenerations || capabilities.VMGeneration || "",
    capabilities
  };
}

export function mapAzureGpuSku(skuName, capabilities = {}) {
  const normalized = stripStandardPrefix(skuName).toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  const capGpuCount = firstNumberCapability(capabilities, ["GPUs", "GpuCount", "GPU", "Accelerators"]);
  if (!capGpuCount && !/^N[CDVG]/.test(normalized)) return null;

  const count = capGpuCount ?? fallbackGpuCountFromSku(normalized);
  if (/NC.*T4.*V3/.test(normalized)) return { gpu_model: "T4", gpu_count: count, gpu_memory_gb: 16 };
  if (/NV.*A10.*V5/.test(normalized)) return { gpu_model: "A10", gpu_count: count, gpu_memory_gb: scaledMemory(24, count) };
  if (/ND.*A100.*V4/.test(normalized)) return { gpu_model: "A100", gpu_count: count, gpu_memory_gb: 80 };
  if (/NC.*A100.*V4/.test(normalized)) return { gpu_model: "A100", gpu_count: count, gpu_memory_gb: 80 };
  if (/ND.*H100.*V5/.test(normalized)) return { gpu_model: "H100 SXM", gpu_count: count, gpu_memory_gb: 80 };
  if (/NC.*H100.*V5/.test(normalized)) return { gpu_model: "H100", gpu_count: count, gpu_memory_gb: 80 };
  if (/A100/.test(normalized)) return { gpu_model: "A100", gpu_count: count, gpu_memory_gb: 80 };
  if (/H100/.test(normalized)) return { gpu_model: "H100", gpu_count: count, gpu_memory_gb: 80 };
  if (/A10/.test(normalized)) return { gpu_model: "A10", gpu_count: count, gpu_memory_gb: scaledMemory(24, count) };
  if (/T4/.test(normalized)) return { gpu_model: "T4", gpu_count: count, gpu_memory_gb: 16 };
  if (/V100/.test(normalized) || /^NC.*V3/.test(normalized) || /^ND.*V2/.test(normalized)) return { gpu_model: "V100", gpu_count: count, gpu_memory_gb: 16 };
  if (/P100/.test(normalized) || /^NC.*V2/.test(normalized)) return { gpu_model: "P100", gpu_count: count, gpu_memory_gb: 16 };
  if (/K80/.test(normalized) || /^NC/.test(normalized)) return { gpu_model: "K80", gpu_count: count, gpu_memory_gb: 12 };
  if (/M60/.test(normalized) || /^NV.*V3/.test(normalized)) return { gpu_model: "M60", gpu_count: count, gpu_memory_gb: 8 };
  if (/MI25/.test(normalized) || /^NV.*V4/.test(normalized)) return { gpu_model: "MI25", gpu_count: count, gpu_memory_gb: 16 };
  return capGpuCount ? { gpu_model: "Azure GPU", gpu_count: capGpuCount, gpu_memory_gb: null } : null;
}

export function azureSkuToOfferings(sku, selectedRegions = []) {
  const metadata = parseAzureSkuMetadata(sku);
  if (!metadata) return [];
  const selected = new Set(normalizedList(selectedRegions));
  const rows = [];
  const locationInfo = Array.isArray(sku.locationInfo) && sku.locationInfo.length
    ? sku.locationInfo
    : (sku.locations || []).map((location) => ({ location, zones: [] }));

  for (const location of locationInfo) {
    const region = location.location;
    if (!region || (selected.size && !selected.has(region))) continue;
    const zones = Array.isArray(location.zones) && location.zones.length ? location.zones : ["regional"];
    for (const zone of zones) {
      const restriction = restrictionForLocation(sku.restrictions || [], region, zone);
      rows.push({
        provider: AZURE_PROVIDER_ID,
        region,
        availability_zone: zone,
        sku_name: metadata.sku_name,
        gpu_model: metadata.gpu_model,
        gpu_count: metadata.gpu_count,
        gpu_memory_gb: metadata.gpu_memory_gb,
        vcpu: metadata.vcpu,
        ram_gb: metadata.ram_gb,
        network: String(metadata.accelerated_networking) === "true" ? "Accelerated Networking" : "",
        network_fabric: azureNetworkFabric(metadata),
        local_storage: metadata.local_storage,
        offered: true,
        restriction_reason: restriction?.reason || "",
        accelerated_networking: metadata.accelerated_networking,
        premium_storage: metadata.premium_storage,
        generation: metadata.generation,
        capabilities: metadata.capabilities,
        restrictions: sku.restrictions || [],
        rawSku: sku
      });
    }
  }
  return rows;
}

export function parseRetailPrices(items, skuNames = new Set(), { spot = false } = {}) {
  const names = skuNames instanceof Set ? skuNames : new Set(normalizedList(skuNames));
  const bySku = new Map();
  for (const item of items || []) {
    const skuName = item.armSkuName || item.skuName;
    if (!skuName || (names.size && !names.has(skuName))) continue;
    if (!isRetailVmHourlyUsd(item)) continue;
    if (isSpotRetailItem(item) !== spot) continue;
    if (/windows/i.test(item.productName || "")) continue;
    const price = numberOrNull(item.retailPrice ?? item.unitPrice);
    if (price == null) continue;
    const row = {
      sku_name: skuName,
      region: item.armRegionName,
      retailPrice: numberOrNull(item.retailPrice),
      unitPrice: numberOrNull(item.unitPrice),
      currencyCode: item.currencyCode,
      meterName: item.meterName,
      productName: item.productName,
      on_demand_price_usd_per_hour: spot ? null : price,
      spot_price_usd_per_hour: spot ? price : null,
      rawPrice: item
    };
    const existing = bySku.get(skuName);
    if (!existing || preferredRetailRow(row, existing, spot)) bySku.set(skuName, row);
  }
  return [...bySku.values()].sort((left, right) => left.sku_name.localeCompare(right.sku_name));
}

async function fetchResourceSkus(env, options) {
  const subscriptionId = env.AZURE_SUBSCRIPTION_ID;
  if (!subscriptionId) throw new Error("AZURE_SUBSCRIPTION_ID is required for Azure Resource SKUs");
  const token = await getAzureAccessToken(env, options);
  const url = new URL(`${env.AZURE_MANAGEMENT_BASE_URL || "https://management.azure.com"}/subscriptions/${encodeURIComponent(subscriptionId)}/providers/Microsoft.Compute/skus`);
  url.searchParams.set("api-version", env.AZURE_RESOURCE_SKUS_API_VERSION || AZURE_RESOURCE_SKUS_API_VERSION);
  const rows = [];
  let next = url.toString();
  while (next) {
    const response = await fetch(next, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) throw new Error(`Azure Resource SKUs failed: ${response.status} ${response.statusText}`);
    const body = await response.json();
    rows.push(...(body.value || []));
    next = body.nextLink || "";
  }
  return rows;
}

async function fetchRetailPriceItems(region, env, options) {
  const params = new URLSearchParams();
  params.set("$filter", `serviceName eq 'Virtual Machines' and armRegionName eq '${region}'`);
  if (hasEnvValue(env.AZURE_RETAIL_CURRENCY) && env.AZURE_RETAIL_CURRENCY !== "USD") {
    params.set("currencyCode", `'${env.AZURE_RETAIL_CURRENCY}'`);
  }
  let next = options.retailUrl || `${env.AZURE_RETAIL_PRICES_URL || AZURE_RETAIL_PRICES_URL}?${params.toString()}`;
  const rows = [];
  while (next) {
    const response = await fetch(next);
    if (!response.ok) throw new Error(`Azure Retail Prices failed: ${response.status} ${response.statusText}`);
    const body = await response.json();
    rows.push(...(body.Items || body.items || []));
    next = body.NextPageLink || body.nextPageLink || "";
  }
  return rows;
}

async function getAzureAccessToken(env, options) {
  if (hasEnvValue(env.AZURE_ACCESS_TOKEN)) return env.AZURE_ACCESS_TOKEN;
  if (options.credential?.getToken) {
    const token = await options.credential.getToken(AZURE_MANAGEMENT_SCOPE);
    return token?.token;
  }
  syncAzureSdkEnv(env);
  const credential = new DefaultAzureCredential();
  const token = await credential.getToken(AZURE_MANAGEMENT_SCOPE);
  return token?.token;
}

function isAzureGpuSku(sku) {
  const metadata = parseAzureSkuMetadata(sku);
  if (!metadata) return false;
  return /^Standard_N[CDVG]/i.test(sku.name || "") || Number(metadata.gpu_count) > 0;
}

function capabilitiesToMap(capabilities = []) {
  return Object.fromEntries((capabilities || []).map((capability) => [capability.name, capability.value]));
}

function firstNumberCapability(capabilities, names, options = {}) {
  for (const name of names) {
    if (!hasEnvValue(capabilities[name])) continue;
    const parsed = numberOrNull(String(capabilities[name]).replace(/,/g, ""));
    if (parsed == null) continue;
    return options.memoryMbToGb && /MB$/i.test(name) ? round(parsed / 1024, 2) : parsed;
  }
  return null;
}

function booleanCapability(capabilities, names) {
  for (const name of names) {
    if (hasEnvValue(capabilities[name])) return /true|yes|supported|enabled/i.test(String(capabilities[name]));
  }
  return null;
}

function azureNetworkFabric(metadata) {
  const text = [
    metadata.sku_name,
    metadata.gpu_model,
    JSON.stringify(metadata.capabilities || {})
  ].join(" ");
  if (/\binfiniband\b|\bib\b|rdma|ndr|hdr|edr/i.test(text)) return "InfiniBand";
  if (/\bEFA\b/i.test(text)) return "EFA";
  if (/^Standard_ND/i.test(metadata.sku_name || "") && /\b(?:H100|A100|V100)\b/i.test(text)) return "InfiniBand";
  if (metadata.accelerated_networking) return "Ethernet";
  return "Not exposed";
}

function localStorageFromCapabilities(capabilities) {
  const resourceMb = firstNumberCapability(capabilities, ["MaxResourceVolumeMB", "ResourceDiskSizeInMB"]);
  const storageGb = firstNumberCapability(capabilities, ["MaxResourceVolumeGB", "LocalStorageGB"]);
  if (storageGb) return `${round(storageGb, 2)} GB`;
  if (resourceMb) return `${round(resourceMb / 1024, 2)} GB`;
  return "";
}

function restrictionForLocation(restrictions, region, zone) {
  for (const restriction of restrictions || []) {
    const info = restriction.restrictionInfo || {};
    const locations = new Set([...(restriction.values || []), ...(info.locations || [])]);
    const zones = new Set(info.zones || []);
    const locationMatches = !locations.size || locations.has(region);
    const zoneMatches = restriction.type !== "Zone" || zone === "regional" || !zones.size || zones.has(zone);
    if (locationMatches && zoneMatches) {
      return {
        reason: [restriction.reasonCode, restriction.type, [...locations].join(","), [...zones].join(",")]
          .filter(Boolean)
          .join(": ")
      };
    }
  }
  return null;
}

function isRetailVmHourlyUsd(item) {
  return item.serviceName === "Virtual Machines"
    && item.currencyCode === "USD"
    && /hour/i.test(item.unitOfMeasure || "1 Hour")
    && !item.reservationTerm
    && numberOrNull(item.retailPrice ?? item.unitPrice) != null;
}

function isSpotRetailItem(item) {
  return /spot/i.test(`${item.meterName || ""} ${item.productName || ""} ${item.skuName || ""}`);
}

function preferredRetailRow(candidate, existing, spot) {
  const field = spot ? "spot_price_usd_per_hour" : "on_demand_price_usd_per_hour";
  if (/^Consumption$/i.test(candidate.rawPrice?.type || "") && !/^Consumption$/i.test(existing.rawPrice?.type || "")) return true;
  return Number(candidate[field]) < Number(existing[field]);
}

function stripStandardPrefix(value) {
  return String(value || "").replace(/^Standard_/i, "");
}

function fallbackGpuCountFromSku(normalizedSku) {
  if (/ND.*(?:96|112)/.test(normalizedSku)) return 8;
  if (/NC.*(?:96|80)/.test(normalizedSku)) return 4;
  if (/NC.*48/.test(normalizedSku)) return 2;
  return 1;
}

function scaledMemory(fullGpuMemoryGb, count) {
  if (!count || count >= 1) return fullGpuMemoryGb;
  return round(fullGpuMemoryGb * count, 2);
}

function azureGpuLabel(row) {
  return [
    row.gpu_count ? `${row.gpu_count}x` : "",
    row.gpu_model || "Azure GPU",
    row.gpu_memory_gb ? `${Math.round(Number(row.gpu_memory_gb))}GB` : "",
    row.sku_name
  ].filter(Boolean).join(" ");
}

function buildAzureVmUrl(region, skuName, env) {
  const params = new URLSearchParams();
  if (region) params.set("region", region);
  if (skuName) params.set("size", skuName);
  const base = env.AZURE_PORTAL_VM_CREATE_URL || "https://portal.azure.com/#create/Microsoft.VirtualMachine";
  return `${base}${params.toString() ? `?${params.toString()}` : ""}`;
}

function cachedAzureStage(env, key, ttlMs, options, loader) {
  return cachedApiStage({
    env, key, ttlMs, options, loader,
    disableKey: "AZURE_GPU_DISABLE_CACHE",
    cacheDirKey: "AZURE_GPU_CACHE_DIR",
    cacheDirDefault: ".cache/azure-api",
    allowStaleKey: "AZURE_GPU_ALLOW_STALE_ON_ERROR"
  });
}

function filterSelectedSkus(skus, selected) {
  const names = new Set(normalizedList(selected));
  if (!names.size) return skus;
  return skus.filter((sku) => names.has(sku.name));
}

function groupBy(values, keyFn) {
  const map = new Map();
  for (const value of values) {
    const key = keyFn(value);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(value);
  }
  return map;
}

function compareAzureRows(left, right) {
  return left.region.localeCompare(right.region)
    || left.availability_zone.localeCompare(right.availability_zone)
    || left.sku_name.localeCompare(right.sku_name);
}

function syncAzureSdkEnv(env) {
  for (const key of ["AZURE_TENANT_ID", "AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET", "AZURE_CLIENT_CERTIFICATE_PATH", "AZURE_FEDERATED_TOKEN_FILE", "AZURE_AUTHORITY_HOST"]) {
    if (hasEnvValue(env[key]) && !hasEnvValue(process.env[key])) process.env[key] = env[key];
  }
}

