import { createInventoryItem } from "../../../core/inventory.js";
import { extractGpuCount } from "../../../core/taxonomy.js";
import { jsonFetch, pickArray } from "../http.js";
import { buildGpuLabel, centsToDollars, compactMetadata, fabricDataNote, fabricFromText, fabricIsExposed, nonNegativeNumber } from "../format.js";

const MASSED_COMPUTE_API_BASE_URL = "https://vm.massedcompute.com";

export const massedComputeConnector = {
  id: "massed-compute",
  name: "Massed Compute",
  envVars: ["MASSED_COMPUTE_API_KEY"],
  async fetch(env) {
    const key = env.MASSED_COMPUTE_API_KEY;
    if (!key) return [];
    const base = (env.MASSED_COMPUTE_API_BASE_URL || MASSED_COMPUTE_API_BASE_URL).replace(/\/$/, "");
    const data = await jsonFetch(`${base}/api/v1/gpu-inventory`, {
      headers: { Authorization: `Bearer ${key}` }
    });
    return massedInventoryToItems(data, env);
  }
};

export function massedInventoryToItems(data, env = {}) {
  const inventory = data?.gpu_inventory || data?.gpuInventory || data?.inventory || data;
  if (!inventory || typeof inventory !== "object" || Array.isArray(inventory)) return [];
  return Object.entries(inventory)
    .filter(([productName]) => /^gpu_/i.test(productName))
    .flatMap(([productName, raw]) => massedInventoryEntryToItems(productName, raw, env));
}

function massedInventoryEntryToItems(productName, raw = {}, env = {}) {
  const instanceType = raw.instance_type || raw.instanceType || raw;
  const regions = pickArray(raw, ["regions_with_capacity_available", "regionsWithCapacityAvailable", "regions", "available_regions"]);
  const capacityAvailable = nonNegativeNumber(raw.capacity_available ?? raw.capacityAvailable ?? raw.available ?? raw.available_count);
  const totalHourlyPrice = centsToDollars(instanceType.price_cents_per_hour ?? instanceType.priceCentsPerHour ?? instanceType.price_cents);
  const gpuCount = massedGpuCount(instanceType, productName);
  if (!gpuCount || !regions.length) return [];
  const gpuLabel = massedGpuLabel(instanceType, productName);
  const networkFabric = massedNetworkFabric(instanceType, productName, raw);
  const networkBandwidth = massedNetworkBandwidth(instanceType, raw);

  return regions.map((region) => createInventoryItem({
    provider: "Massed Compute",
    providerId: "massed-compute",
    rawOfferId: `${productName}:${region.name || region.description || "any"}`,
    gpuLabel,
    gpuCount,
    vramGbEach: massedVramGb(instanceType, productName),
    pricePerGpuHour: totalHourlyPrice ? totalHourlyPrice / gpuCount : null,
    totalHourlyPrice,
    region: [region.description, region.name].filter(Boolean).join(" / ") || region.name || "any",
    formFactor: "vm",
    interconnect: massedInterconnect(instanceType, productName),
    cpu: instanceType.specs?.vcpu_count ? `${instanceType.specs.vcpu_count} vCPU` : "",
    ramGb: instanceType.specs?.memory_gib,
    storage: instanceType.specs?.storage_gb ? `${instanceType.specs.storage_gb} GB` : "",
    networkBandwidth,
    networkFabric,
    availability: capacityAvailable > 0 ? "available" : "unavailable",
    availabilityCount: regions.length === 1 ? capacityAvailable : null,
    checkoutUrl: buildMassedComputeUrl(productName, region.name, env),
    sourceMode: "live",
    listingType: /spot/i.test(productName || instanceType.description || "") ? "spot_gpu_inventory_sku" : "gpu_inventory_sku",
    priceScope: "node_total",
    availabilitySemantics: "sku_capacity",
    checkoutSemantics: "manual_provider",
    dataNotes: [
      capacityAvailable != null && regions.length > 1 ? `Capacity count ${capacityAvailable} is aggregate across listed regions` : "",
      fabricDataNote(networkFabric, gpuLabel, gpuCount),
      /spot/i.test(productName || instanceType.description || "") ? "Spot" : ""
    ].filter(Boolean),
    metadata: compactMetadata({
      productName,
      region,
      aggregateCapacityAvailable: capacityAvailable,
      instanceTypeName: instanceType.name,
      description: instanceType.description,
      specs: instanceType.specs,
      networkFabric,
      priceCentsPerHour: instanceType.price_cents_per_hour ?? instanceType.priceCentsPerHour
    }),
    specs: {
      provider: {
        rawSpecs: instanceType.specs
      },
      network: {
        fabric: networkFabric,
        bandwidth: networkBandwidth,
        ibListed: fabricIsExposed(networkFabric) && /infiniband|\bib\b|ndr|hdr|edr|rdma|roce/i.test(networkFabric)
      }
    },
    rawPayload: { productName, ...raw }
  }));
}

function massedGpuLabel(instanceType = {}, productName = "") {
  return buildGpuLabel({
    count: massedGpuCount(instanceType, productName),
    model: instanceType.description || productName,
    vramGb: massedVramGb(instanceType, productName),
    variant: productName
  });
}

function massedGpuCount(instanceType = {}, productName = "") {
  return extractGpuCount(`${instanceType.description || ""} ${instanceType.name || ""} ${productName}`, 0);
}

function massedVramGb(instanceType = {}, productName = "") {
  const text = `${instanceType.description || ""} ${instanceType.name || ""} ${productName}`;
  return Number(text.match(/\((\d+(?:\.\d+)?)\s*GB\)/i)?.[1] || text.match(/\b(\d+(?:\.\d+)?)\s*GB\b/i)?.[1] || 0) || null;
}

function massedInterconnect(instanceType = {}, productName = "") {
  const text = `${instanceType.description || ""} ${instanceType.name || ""} ${productName}`;
  if (/nvlink|nvl|dgx|sxm/i.test(text)) return "NVLink";
  return "PCIe";
}

function massedNetworkFabric(instanceType = {}, productName = "", raw = {}) {
  const specs = instanceType.specs || {};
  return fabricFromText(
    specs.network_fabric,
    specs.networkFabric,
    specs.network_type,
    specs.networkType,
    specs.nic,
    specs.nics,
    specs.interconnect,
    raw.network,
    raw.network_type,
    raw.networkType,
    productName
  );
}

function massedNetworkBandwidth(instanceType = {}, raw = {}) {
  const specs = instanceType.specs || {};
  return specs.network_bandwidth
    || specs.networkBandwidth
    || specs.network_gbps && `${specs.network_gbps} Gbps`
    || raw.network_bandwidth
    || raw.networkBandwidth
    || "";
}

function buildMassedComputeUrl(productName, regionName, env = {}) {
  const base = (env.MASSED_COMPUTE_WEB_BASE_URL || "https://vm.massedcompute.com").replace(/\/$/, "");
  const params = new URLSearchParams();
  if (productName) params.set("productName", productName);
  if (regionName) params.set("regionName", regionName);
  const query = params.toString();
  return `${base}/deploy${query ? `?${query}` : ""}`;
}
