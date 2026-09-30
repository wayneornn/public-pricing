import { createInventoryItem } from "../../../core/inventory.js";
import { jsonFetch, pickArray } from "../http.js";
import { compactMetadata, fabricDataNote, fabricFromText } from "../format.js";

export const sesterceConnector = {
  id: "sesterce",
  name: "Sesterce",
  envVars: ["SESTERCE_API_KEY"],
  async fetch(env) {
    const key = env.SESTERCE_API_KEY;
    if (!key) return [];
    const base = (env.SESTERCE_API_BASE_URL || "https://api.cloud.sesterce.com").replace(/\/$/, "");
    const data = await jsonFetch(`${base}/gpu-cloud/instances/offers?available=true&sort=price`, {
      headers: { "X-API-KEY": key }
    });
    const offers = Array.isArray(data) ? data : pickArray(data, ["data", "offers"]);
    return offers.filter((raw) => Number(raw.gpuCount || 0) > 0 && !/^cpu$/i.test(raw.gpuName || raw.gpuModel || raw.instanceId || "")).flatMap((raw) => {
      const availability = Array.isArray(raw.availability) && raw.availability.length ? raw.availability : [{ name: raw.region || "Unknown", available: raw.available !== false }];
      const networkFabric = fabricFromText(raw.configuration?.network, raw.configuration?.networkType, raw.configuration?.interconnect, raw.network, raw.networkType);
      return availability.map((slot) => createInventoryItem({
        provider: "Sesterce",
        rawOfferId: `${raw.instanceId || raw._id || raw.id}:${slot.region || slot.name}`,
        gpuLabel: raw.gpuName || raw.gpuModel || raw.instanceId,
        gpuCount: raw.gpuCount,
        vramGbEach: raw.configuration?.vRamGB || raw.vramPerGpu,
        totalHourlyPrice: raw.hourlyPrice,
        region: slot.name || slot.region,
        country: slot.countryCode,
        formFactor: raw.deploymentType,
        interconnect: raw.nvlink ? "NVLink" : raw.configuration?.interconnect,
        cpu: raw.configuration?.vCpu ? `${raw.configuration.vCpu} vCPU` : "",
        ramGb: raw.configuration?.ramGB,
        storage: raw.configuration?.storageGB ? `${raw.configuration.storageGB} GB` : "",
        networkBandwidth: raw.configuration?.networkBandwidth || raw.networkBandwidth || "",
        networkFabric,
        availability: slot.available ? "available" : "unavailable",
        checkoutUrl: buildSesterceUrl(raw, slot),
        checkoutSemantics: "manual_provider",
        sourceMode: "live",
        listingType: raw.deploymentType || "instance_offer",
        priceScope: "node_total",
        dataNotes: [
          fabricDataNote(networkFabric, raw.gpuName || raw.gpuModel || raw.instanceId, raw.gpuCount)
        ].filter(Boolean),
        metadata: compactMetadata({
          instanceId: raw.instanceId,
          cloudProvider: raw.cloud,
          cloudInitAvailable: raw.cloudInitAvailable,
          osOptions: raw.configuration?.os,
          providerAvailability: slot,
          configuration: raw.configuration
        }),
        rawPayload: raw
      }));
    });
  }
};

function buildSesterceUrl(raw, slot) {
  const params = new URLSearchParams();
  if (raw.instanceId) params.set("instanceId", raw.instanceId);
  if (slot?.region) params.set("region", slot.region);
  if (raw.deploymentType) params.set("deploymentType", raw.deploymentType);
  if (raw.cloud?._id) params.set("cloudProvider", raw.cloud._id);
  const query = params.toString();
  return `https://cloud.sesterce.com/clusters${query ? `?${query}` : ""}`;
}
