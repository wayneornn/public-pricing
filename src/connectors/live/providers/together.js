import { createInventoryItem } from "../../../core/inventory.js";
import { extractGpuCount } from "../../../core/taxonomy.js";
import { safeJsonFetch, pickArray } from "../http.js";
import { buildGpuLabel, compactMetadata, numberOrNull } from "../format.js";

const TOGETHER_API_BASE_URLS = ["https://api.together.xyz/v1", "https://api.together.ai/v1"];

export const togetherConnector = {
  id: "together-ai",
  name: "Together AI",
  envVars: ["TOGETHER_API_KEY"],
  async fetch(env) {
    const key = env.TOGETHER_API_KEY;
    if (!key) return [];
    const regions = await fetchTogetherRegions(env, key);
    return regions.flatMap((region) => togetherRegionToItems(region, env));
  }
};

async function fetchTogetherRegions(env, key) {
  const customBase = env.TOGETHER_API_BASE_URL ? [env.TOGETHER_API_BASE_URL] : [];
  const bases = [...customBase, ...TOGETHER_API_BASE_URLS].map((base) => base.replace(/\/$/, ""));
  for (const base of bases) {
    const data = await safeJsonFetch(`${base}/compute/regions`, {
      headers: { Authorization: `Bearer ${key}` }
    });
    const regions = pickArray(data, ["regions", "data", "results"]);
    if (regions.length) return regions;
  }
  return [];
}

function togetherRegionToItems(region, env) {
  const instanceTypes = region.supported_instance_types || region.supportedInstanceTypes || region.gpu_types || [];
  return instanceTypes.map((instanceType) => {
    const gpuCount = extractGpuCount(instanceType, 1);
    const pricePerGpuHour = togetherPriceOverride(instanceType, env);
    return createInventoryItem({
      provider: "Together AI",
      providerId: "together-ai",
      rawOfferId: `${region.name}:${instanceType}`,
      gpuLabel: buildGpuLabel({
        count: gpuCount,
        model: instanceType,
        variant: instanceType
      }),
      gpuCount,
      pricePerGpuHour,
      totalHourlyPrice: pricePerGpuHour && gpuCount ? pricePerGpuHour * gpuCount : null,
      region: region.name,
      formFactor: "vm",
      interconnect: instanceType,
      networkFabric: "Not exposed",
      availability: "available",
      checkoutUrl: buildTogetherUrl(region, instanceType),
      sourceMode: "catalog",
      listingType: "supported_cluster_sku",
      priceScope: pricePerGpuHour ? "gpu_sku_only" : "unknown",
      dataNotes: [
        "Supported cluster SKU",
        "Stock not returned",
        "NIC/fabric not returned",
        pricePerGpuHour ? "Manual price override" : "Price not returned"
      ],
      metadata: compactMetadata({
        regionId: region.id,
        regionName: region.name,
        instanceType,
        supportedInstanceTypes: region.supported_instance_types || region.supportedInstanceTypes,
        driverVersions: region.driver_versions
      }),
      rawPayload: region
    });
  });
}

function togetherPriceOverride(instanceType, env) {
  const key = `TOGETHER_PRICE_${String(instanceType || "").toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
  return numberOrNull(env[key]);
}

function buildTogetherUrl(region, instanceType) {
  const params = new URLSearchParams();
  if (region.name) params.set("region", region.name);
  if (instanceType) params.set("gpu_type", instanceType);
  const query = params.toString();
  return `https://api.together.ai/gpu-clusters${query ? `?${query}` : ""}`;
}
