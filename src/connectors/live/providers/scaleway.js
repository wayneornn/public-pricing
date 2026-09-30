import { createInventoryItem } from "../../../core/inventory.js";
import { safeJsonFetch } from "../http.js";
import { buildGpuLabel, bytesToGb, compactMetadata, fabricDataNote, fabricFromText, formatBitsPerSecond, numberOrNull } from "../format.js";

const SCALEWAY_INSTANCE_API_BASE_URL = "https://api.scaleway.com/instance/v1";
const SCALEWAY_DEFAULT_ZONES = [
  "fr-par-1",
  "fr-par-2",
  "fr-par-3",
  "nl-ams-1",
  "nl-ams-2",
  "nl-ams-3",
  "pl-waw-1",
  "pl-waw-2",
  "pl-waw-3"
];

export const scalewayConnector = {
  id: "scaleway",
  name: "Scaleway",
  envVars: ["SCW_SECRET_KEY", "SCW_ACCESS_KEY", "SCW_PROJECT_ID", "SCW_ZONES"],
  async fetch(env) {
    const zones = (env.SCW_ZONES || env.SCALEWAY_ZONES || SCALEWAY_DEFAULT_ZONES.join(","))
      .split(",")
      .map((zone) => zone.trim())
      .filter(Boolean);
    const headers = env.SCW_SECRET_KEY ? { "X-Auth-Token": env.SCW_SECRET_KEY } : {};
    const zoneData = await Promise.all(zones.map(async (zone) => {
      const [products, availability] = await Promise.all([
        safeJsonFetch(`${SCALEWAY_INSTANCE_API_BASE_URL}/zones/${encodeURIComponent(zone)}/products/servers`, { headers }),
        safeJsonFetch(`${SCALEWAY_INSTANCE_API_BASE_URL}/zones/${encodeURIComponent(zone)}/products/servers/availability`, { headers })
      ]);
      return { zone, products, availability };
    }));
    return zoneData.flatMap((entry) => scalewayZoneToItems(entry, env));
  }
};

function scalewayZoneToItems({ zone, products, availability }, env) {
  const servers = products?.servers || {};
  const availabilityByServer = availability?.servers || {};
  return Object.entries(servers)
    .filter(([, raw]) => Number(raw.gpu || 0) > 0)
    .map(([commercialType, raw]) => {
      const status = availabilityByServer[commercialType]?.availability || "unknown";
      const networkBandwidth = scalewayNetwork(raw);
      const networkFabric = fabricFromText(raw.network?.type, raw.network?.sum_internal_bandwidth, networkBandwidth);
      return createInventoryItem({
        provider: "Scaleway",
        providerId: "scaleway",
        rawOfferId: `${zone}:${commercialType}`,
        gpuLabel: scalewayGpuLabel(commercialType, raw),
        gpuCount: raw.gpu,
        vramGbEach: bytesToGb(raw.gpu_info?.gpu_memory),
        totalHourlyPrice: numberOrNull(raw.hourly_price),
        region: zone,
        formFactor: "vm",
        interconnect: scalewayInterconnect(commercialType, raw),
        cpu: raw.ncpus ? `${raw.ncpus} vCPU` : "",
        ramGb: bytesToGb(raw.ram),
        storage: scalewayStorage(raw),
        networkBandwidth,
        networkFabric,
        availability: scalewayAvailability(status),
        availabilityCount: scalewayAvailability(status) === "available" ? 1 : 0,
        currency: env.SCW_CURRENCY || "EUR",
        checkoutUrl: buildScalewayUrl(commercialType, zone, env),
        sourceMode: "live",
        listingType: "instance_commercial_type",
        priceScope: raw.hourly_price ? "node_total" : "unknown",
        availabilitySemantics: "sku_capacity",
        dataNotes: [
          `Availability: ${status}`,
          fabricDataNote(networkFabric, scalewayGpuLabel(commercialType, raw), raw.gpu),
          raw.monthly_price ? `Monthly: ${raw.monthly_price}` : ""
        ].filter(Boolean),
        metadata: compactMetadata({
          zone,
          commercialType,
          arch: raw.arch,
          altNames: raw.alt_names,
          gpuInfo: raw.gpu_info,
          migProfile: raw.mig_profile,
          capabilities: raw.capabilities,
          network: raw.network,
          hourlyPrice: raw.hourly_price,
          monthlyPrice: raw.monthly_price,
          availability: status
        }),
        rawPayload: { commercialType, zone, ...raw, availability: availabilityByServer[commercialType] }
      });
    });
}

function scalewayGpuLabel(commercialType, raw) {
  return buildGpuLabel({
    count: raw.gpu,
    model: raw.gpu_info?.gpu_name || commercialType,
    vramGb: bytesToGb(raw.gpu_info?.gpu_memory),
    variant: commercialType
  });
}

function scalewayInterconnect(commercialType, raw) {
  const text = `${commercialType} ${raw.gpu_info?.gpu_name || ""}`;
  if (/sxm|b300|h100|h200|b200/i.test(text)) return "NVLink";
  return "PCIe";
}

function scalewayStorage(raw) {
  const scratch = bytesToGb(raw.scratch_storage_max_size);
  if (scratch) return `${Math.round(scratch)} GB scratch`;
  const maxVolume = raw.volumes_constraint?.max_size || raw.per_volume_constraint?.l_ssd?.max_size;
  const volumeGb = bytesToGb(maxVolume);
  return volumeGb ? `up to ${Math.round(volumeGb)} GB block` : "";
}

function scalewayNetwork(raw) {
  const network = raw.network || {};
  const parts = [];
  if (network.sum_internal_bandwidth) parts.push(`${formatBitsPerSecond(network.sum_internal_bandwidth)} internal`);
  if (network.sum_internet_bandwidth) parts.push(`${formatBitsPerSecond(network.sum_internet_bandwidth)} internet`);
  return parts.join(" / ");
}

function scalewayAvailability(status) {
  if (/^(available|scarce)$/i.test(String(status || ""))) return "available";
  if (/shortage|unavailable|sold|none/i.test(String(status || ""))) return "unavailable";
  return "unknown";
}

function buildScalewayUrl(commercialType, zone, env) {
  const params = new URLSearchParams();
  if (commercialType) params.set("commercial_type", commercialType);
  if (zone) params.set("zone", zone);
  if (env.SCW_PROJECT_ID) params.set("project_id", env.SCW_PROJECT_ID);
  const query = params.toString();
  return `https://console.scaleway.com/instance/servers/create${query ? `?${query}` : ""}`;
}
