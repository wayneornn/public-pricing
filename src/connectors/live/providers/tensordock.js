import { createInventoryItem } from "../../../core/inventory.js";
import { jsonFetch, pickArray } from "../http.js";
import { buildGpuLabel, compactMetadata, fabricDataNote, fabricFromText, numberOrNull } from "../format.js";

const TENSORDOCK_API_BASE_URL = "https://dashboard.tensordock.com/api/v2";
const TENSORDOCK_TIMEOUT_MS = 60_000;

export const tensordockConnector = {
  id: "tensordock",
  name: "TensorDock",
  envVars: ["TENSORDOCK_API_TOKEN"],
  async fetch(env) {
    const key = env.TENSORDOCK_API_TOKEN;
    if (!key) return [];
    const base = (env.TENSORDOCK_API_BASE_URL || TENSORDOCK_API_BASE_URL).replace(/\/$/, "");
    const data = await jsonFetch(`${base}/locations`, {
      timeoutMs: Number(env.TENSORDOCK_TIMEOUT_MS || TENSORDOCK_TIMEOUT_MS),
      headers: { Authorization: `Bearer ${key}` }
    });
    return tensordockLocationsToItems(pickArray(data, ["data.locations", "locations", "data"]), env);
  }
};

export function tensordockLocationsToItems(locations) {
  return locations.flatMap((location) => {
    const gpus = Array.isArray(location.gpus) ? location.gpus : [];
    return gpus
      .filter((gpu) => Number(gpu.max_count || gpu.availableCount || 0) > 0)
      .map((gpu) => tensordockLocationGpuToItem(location, gpu));
  });
}

function tensordockLocationGpuToItem(location, gpu) {
  // TensorDock is a per-GPU marketplace: `max_count` is how many of this GPU are
  // currently available to rent at the location, NOT a fixed multi-GPU node. The
  // rentable/priced unit is a single GPU, so the offering is one GPU with an
  // availability count of `max_count`. Rendering it as an "Nx" node would
  // misrepresent loose, unclustered GPUs as a clustered cluster node and would
  // corrupt GPU-count spec matching.
  const availableCount = Number(gpu.max_count || gpu.availableCount || 0);
  const gpuCount = 1;
  const pricePerGpuHour = numberOrNull(gpu.price_per_hr);
  const resources = gpu.resources || {};
  const locationLabel = [location.city, location.stateprovince, location.country].filter(Boolean).join(", ") || location.id;
  const networkBandwidth = tensordockBandwidth(location);
  const networkFabric = fabricFromText(gpu.network_features && JSON.stringify(gpu.network_features), location.network_features && JSON.stringify(location.network_features), networkBandwidth);
  return createInventoryItem({
    provider: "TensorDock",
    providerId: "tensordock",
    rawOfferId: `${location.id || location.uuid || "location"}:${gpu.v0Name || gpu.displayName}`,
    gpuLabel: buildGpuLabel({
      count: gpuCount,
      model: gpu.displayName || gpu.v0Name,
      variant: gpu.displayName || gpu.v0Name
    }),
    gpuCount,
    pricePerGpuHour,
    totalHourlyPrice: pricePerGpuHour,
    region: locationLabel,
    country: location.country,
    formFactor: "vm",
    interconnect: gpu.displayName || gpu.v0Name,
    cpu: resources.max_vcpus ? `up to ${resources.max_vcpus} vCPU` : "",
    ramGb: resources.max_ram_gb,
    storage: resources.max_storage_gb ? `up to ${resources.max_storage_gb} GB` : "",
    networkBandwidth,
    networkFabric,
    availability: availableCount > 0 ? "available" : "unavailable",
    availabilityCount: availableCount,
    checkoutUrl: buildTensorDockUrl(location, gpu),
    checkoutSemantics: "manual_provider",
    sourceMode: "live",
    listingType: "location_gpu_offering",
    priceScope: "gpu_sku_only",
    availabilitySemantics: "sku_capacity",
    dataNotes: [
      "GPU price only",
      "CPU/RAM/storage priced separately",
      availableCount > 1 ? `Up to ${availableCount} GPUs provisionable in one VM (priced per GPU)` : "",
      fabricDataNote(networkFabric, gpu.displayName || gpu.v0Name, gpuCount),
      location.tier ? `Location tier ${location.tier}` : ""
    ].filter(Boolean),
    metadata: compactMetadata({
      locationId: location.id || location.uuid,
      location: {
        city: location.city,
        stateprovince: location.stateprovince,
        country: location.country,
        tier: location.tier,
        organization: location.organization,
        organizationName: location.organizationName,
        hasNetworkStorage: location.has_network_storage
      },
      gpuSku: gpu.v0Name,
      displayName: gpu.displayName,
      maxCount: gpu.max_count,
      resources: gpu.resources,
      pricing: gpu.pricing,
      networkFeatures: gpu.network_features
    }),
    rawPayload: { location, gpu }
  });
}

function tensordockBandwidth(location) {
  const down = numberOrNull(location.network_speed_gbps);
  const up = numberOrNull(location.network_speed_upload_gbps);
  const parts = [];
  if (down) parts.push(`${down} Gbps down`);
  if (up) parts.push(`${up} Gbps up`);
  return parts.join(" / ");
}

function buildTensorDockUrl(location, gpu) {
  const params = new URLSearchParams();
  if (location.id || location.uuid) params.set("location_id", location.id || location.uuid);
  if (gpu.v0Name) params.set("gpu", gpu.v0Name);
  if (gpu.max_count) params.set("max_count", String(gpu.max_count));
  const query = params.toString();
  return `https://dashboard.tensordock.com/deploy${query ? `?${query}` : ""}`;
}
