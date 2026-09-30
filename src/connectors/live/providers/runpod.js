import { createInventoryItem } from "../../../core/inventory.js";
import { jsonFetch, pickArray } from "../http.js";
import { compactMetadata, fabricDataNote } from "../format.js";

export const runpodConnector = {
  id: "runpod",
  name: "Runpod",
  envVars: ["RUNPOD_API_KEY"],
  async fetch(env) {
    const key = env.RUNPOD_API_KEY;
    if (!key) return [];
    const query = `
      query {
        gpuTypes {
          id
          displayName
          memoryInGb
          lowestPrice(input: { gpuCount: 1, secureCloud: true }) {
            stockStatus
            uninterruptablePrice
            availableGpuCounts
          }
        }
      }
    `;
    const data = await jsonFetch("https://api.runpod.io/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ query })
    });
    if (data.errors?.length) {
      throw new Error(data.errors.map((error) => error.message).join("; "));
    }
    const gpuTypes = pickArray(data, ["data.gpuTypes", "gpuTypes"]).filter((raw) => raw.lowestPrice?.uninterruptablePrice);
    return gpuTypes.map((raw) => createInventoryItem({
      provider: "Runpod",
      rawOfferId: raw.id || raw.gpuTypeId || raw.displayName || raw.name,
      gpuLabel: raw.displayName || raw.name || raw.id,
      gpuCount: raw.gpuCount || 1,
      vramGbEach: raw.memoryInGb || raw.vramGb,
      pricePerGpuHour: raw.lowestPrice?.uninterruptablePrice || raw.securePrice || raw.communityPrice || raw.pricePerHr,
      region: raw.dataCenterId || raw.dataCenterIds || raw.region || "Runpod secure cloud",
      formFactor: "container",
      interconnect: raw.id || raw.displayName || "",
      networkFabric: "Not exposed",
      availability: runpodStockAvailability(raw.lowestPrice?.stockStatus),
      availabilityCount: raw.lowestPrice?.availableGpuCounts?.length || null,
      checkoutUrl: `https://www.runpod.io/console/gpu-cloud?gpuTypeId=${encodeURIComponent(raw.id || raw.displayName || "")}`,
      checkoutSemantics: "manual_provider",
      sourceMode: "live",
      listingType: "gpu_type_lowest_price",
      priceScope: "gpu_sku_lowest",
      dataNotes: [
        fabricDataNote("Not exposed", raw.displayName || raw.name || raw.id, raw.gpuCount || 1),
        "Runpod gpuTypes API does not expose NIC/fabric detail"
      ].filter(Boolean),
      metadata: compactMetadata({
        gpuTypeId: raw.id,
        displayName: raw.displayName,
        memoryInGb: raw.memoryInGb,
        stockStatus: raw.lowestPrice?.stockStatus,
        availableGpuCounts: raw.lowestPrice?.availableGpuCounts,
        lowestPrice: raw.lowestPrice
      }),
      rawPayload: raw
    }));
  }
};

function runpodStockAvailability(value) {
  const text = String(value || "").trim();
  if (!text) return "unavailable";
  if (/out|none|unavailable|sold|false|0/i.test(text)) return "unavailable";
  return "available";
}
