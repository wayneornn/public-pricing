import { createInventoryItem } from "../../../core/inventory.js";
import { jsonFetch, pickArray } from "../http.js";
import {
  buildGpuLabel,
  compactMetadata,
  fabricDataNote,
  fabricFromText,
  numberOrNull,
  resourceRange,
  round
} from "../format.js";

export const primeConnector = {
  id: "prime-intellect",
  name: "Prime Intellect",
  envVars: ["PRIME_INTELLECT_API_KEY"],
  async fetch(env) {
    const key = env.PRIME_INTELLECT_API_KEY;
    if (!key) return [];
    const offers = await fetchPrimeAvailability(key);
    return offers.filter(isPrimeGpuOffer).map((raw) => {
      const gpuCount = Number(raw.gpuCount || 1);
      const baseHourlyPrice = numberOrNull(raw.prices?.onDemand || raw.pricePerHour);
      const defaultResourceHourlyPrice = primeDefaultResourceHourlyPrice(raw);
      const totalHourlyPrice = baseHourlyPrice != null ? round(baseHourlyPrice + defaultResourceHourlyPrice, 4) : null;
      const vramGbEach = raw.gpuMemory && gpuCount ? Number(raw.gpuMemory) / gpuCount : null;
      const networkFabric = fabricFromText(raw.networkType, raw.network, raw.internetSpeed, raw.interconnectType, raw.interconnect);
      return createInventoryItem({
        provider: "Prime Intellect",
        rawOfferId: raw.id || `${raw.provider}:${raw.cloudId}:${raw.dataCenter}:${gpuCount}:${raw.socket || "gpu"}`,
        gpuLabel: buildGpuLabel({
          count: gpuCount,
          model: String(raw.gpuType || raw.cloudId || "").replace(/_/g, " "),
          vramGb: vramGbEach,
          variant: raw.socket
        }),
        gpuCount,
        vramGbEach,
        pricePerGpuHour: totalHourlyPrice && gpuCount ? totalHourlyPrice / gpuCount : null,
        totalHourlyPrice,
        region: raw.dataCenter || raw.region || raw.country,
        country: raw.country,
        formFactor: "container",
        interconnect: raw.interconnectType || raw.interconnect || raw.socket,
        cpu: raw.vcpu?.defaultCount ? `${raw.vcpu.defaultCount} vCPU` : "",
        ramGb: raw.memory?.defaultCount,
        storage: raw.disk?.defaultCount ? `${raw.disk.defaultCount} GB` : "",
        networkBandwidth: raw.internetSpeed || "",
        networkFabric,
        currency: raw.prices?.currency || "USD",
        availability: /out|none|unavailable/i.test(raw.stockStatus || "") ? "unavailable" : "available",
        availabilityCount: raw.stockStatus ? 1 : null,
        checkoutUrl: buildPrimeUrl(raw),
        checkoutSemantics: "manual_provider",
        sourceMode: "live",
        listingType: raw.security || raw.provider || "gpu_availability",
        priceScope: raw.prices?.isVariable ? "node_total_variable" : "node_total",
        dataNotes: [
          defaultResourceHourlyPrice ? `Includes default resource add-ons: $${round(defaultResourceHourlyPrice, 4)}/hr` : "",
          fabricDataNote(networkFabric, `${raw.gpuType || ""} ${raw.cloudId || ""}`, gpuCount),
          raw.isSpot ? "Spot" : "",
          raw.prices?.isVariable ? "Variable price" : "",
          raw.provisioningTime ? `Provisioning: ${raw.provisioningTime}` : ""
        ].filter(Boolean),
        metadata: compactMetadata({
          cloudId: raw.cloudId,
          provider: raw.provider,
          dataCenter: raw.dataCenter,
          internetSpeed: raw.internetSpeed,
          security: raw.security,
          isSpot: raw.isSpot,
          stockStatus: raw.stockStatus,
          provisioningTime: raw.provisioningTime,
          prepaidTime: raw.prepaidTime,
          images: raw.images,
          prices: raw.prices,
          baseHourlyPrice,
          defaultResourceHourlyPrice,
          resourceRanges: {
            vcpu: resourceRange(raw.vcpu),
            memory: resourceRange(raw.memory),
            disk: resourceRange(raw.disk),
            sharedDisk: resourceRange(raw.sharedDisk)
          },
          networkFabric
        }),
        specs: {
          network: {
            fabric: networkFabric,
            internetSpeed: raw.internetSpeed,
            interconnectType: raw.interconnectType || raw.interconnect
          }
        },
        rawPayload: raw
      });
    });
  }
};

export function primeDefaultResourceHourlyPrice(raw = {}) {
  const total = ["vcpu", "memory", "disk", "sharedDisk"]
    .map((key) => primeResourceHourlyPrice(raw[key]))
    .reduce((sum, value) => sum + value, 0);
  return round(total, 6);
}

function primeResourceHourlyPrice(resource) {
  if (!resource || resource.defaultIncludedInPrice !== false) return 0;
  const defaultCount = numberOrNull(resource.defaultCount);
  const pricePerUnit = numberOrNull(resource.pricePerUnit);
  return defaultCount && pricePerUnit ? defaultCount * pricePerUnit : 0;
}

async function fetchPrimeAvailability(key) {
  const pageSize = 100;
  const offers = [];
  for (let page = 1; page <= 20; page += 1) {
    const url = new URL("https://api.primeintellect.ai/api/v1/availability/gpus");
    url.searchParams.set("page", String(page));
    url.searchParams.set("page_size", String(pageSize));
    const data = await jsonFetch(url.toString(), {
      headers: { Authorization: `Bearer ${key}` }
    });
    const items = pickArray(data, ["items", "data"]);
    offers.push(...items);
    const total = Number(data.totalCount || data.total_count || 0);
    if (!items.length || (total && offers.length >= total)) break;
  }
  return offers;
}

function isPrimeGpuOffer(raw) {
  const gpuType = String(raw.gpuType || raw.cloudId || "");
  return Number(raw.gpuCount || 0) > 0
    && Number(raw.gpuMemory || 0) > 0
    && !/cpu/i.test(gpuType);
}

function buildPrimeUrl(raw) {
  const params = new URLSearchParams();
  if (raw.cloudId) params.set("cloudId", raw.cloudId);
  if (raw.gpuType) params.set("gpuType", raw.gpuType);
  if (raw.gpuCount) params.set("gpuCount", String(raw.gpuCount));
  if (raw.provider) params.set("provider", raw.provider);
  if (raw.dataCenter) params.set("dataCenter", raw.dataCenter);
  const query = params.toString();
  return `https://app.primeintellect.ai/dashboard/create${query ? `?${query}` : ""}`;
}
