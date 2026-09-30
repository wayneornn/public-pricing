import { createInventoryItem } from "../../../core/inventory.js";
import { jsonFetch, pickArray } from "../http.js";
import { buildGpuLabel, compactMetadata, fabricFromText, shadeformPriceToDollars } from "../format.js";

export const shadeformConnector = {
  id: "shadeform",
  name: "Shadeform",
  envVars: ["SHADEFORM_API_KEY"],
  async fetch(env) {
    const key = env.SHADEFORM_API_KEY;
    if (!key) return [];
    const data = await jsonFetch("https://api.shadeform.ai/v1/instances/types?available=true&sort=price", {
      headers: { "X-API-KEY": key }
    });
    const instanceTypes = pickArray(data, ["instance_types", "data"]);
    return instanceTypes
      .filter((raw) => Number(raw.configuration?.num_gpus ?? raw.num_gpus ?? 0) > 0)
      .flatMap((raw) => {
        const config = raw.configuration || {};
        const slots = Array.isArray(raw.availability) && raw.availability.length
          ? raw.availability
          : [{ region: raw.region, display_name: raw.region, available: raw.available !== false }];
        const hourlyPrice = shadeformPriceToDollars(raw.hourly_price);
        const gpuCount = Number(config.num_gpus ?? raw.num_gpus ?? 1);
        return slots
          .filter((slot) => slot.available !== false)
          .map((slot) => createInventoryItem({
            provider: "Shadeform",
            rawOfferId: `${raw.cloud}:${raw.shade_instance_type}:${slot.region || raw.region || "unknown"}`,
            gpuLabel: buildGpuLabel({
              count: gpuCount,
              model: config.gpu_type || raw.gpu_type || raw.shade_instance_type,
              vramGb: config.vram_per_gpu_in_gb,
              variant: raw.shade_instance_type || config.interconnect || raw.interconnect
            }),
            gpuCount,
            vramGbEach: config.vram_per_gpu_in_gb,
            pricePerGpuHour: hourlyPrice && gpuCount ? hourlyPrice / gpuCount : null,
            totalHourlyPrice: hourlyPrice,
            region: slot.display_name || slot.region || raw.region,
            formFactor: raw.deployment_type,
            interconnect: config.nvlink || raw.nvlink || /nvlink/i.test(raw.shade_instance_type || "") ? "NVLink" : config.interconnect || raw.interconnect,
            cpu: config.vcpus || raw.vcpus ? `${config.vcpus || raw.vcpus} vCPU` : "",
            ramGb: config.memory_in_gb || raw.memory_in_gb,
            storage: config.storage_in_gb || raw.storage_in_gb ? `${config.storage_in_gb || raw.storage_in_gb} GB` : "",
            networkFabric: fabricFromText(config.network_type, config.network, raw.network_type, raw.network),
            availability: "available",
            availabilityCount: 1,
            checkoutUrl: buildShadeformUrl(raw, slot),
            checkoutSemantics: "manual_provider",
            sourceMode: "live",
            listingType: raw.deployment_type || "instance_type",
            priceScope: "node_total",
            metadata: compactMetadata({
              cloud: raw.cloud,
              cloudInstanceType: raw.cloud_instance_type,
              shadeInstanceType: raw.shade_instance_type,
              gpuManufacturer: config.gpu_manufacturer,
              osOptions: config.os_options,
              bootTimeSeconds: raw.boot_time,
              providerAvailability: slot,
              rawConfiguration: config
            }),
            specs: {
              provider: {
                rawConfiguration: config
              }
            },
            rawPayload: raw
          }));
      });
  }
};

function buildShadeformUrl(raw, slot) {
  const params = new URLSearchParams();
  if (raw.cloud) params.set("cloud", raw.cloud);
  if (raw.shade_instance_type) params.set("shade_instance_type", raw.shade_instance_type);
  if (slot?.region) params.set("region", slot.region);
  const query = params.toString();
  return `https://www.shadeform.ai/${query ? `?${query}` : ""}`;
}
