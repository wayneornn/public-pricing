import { createInventoryItem } from "../../../core/inventory.js";
import { jsonFetch, pickArray } from "../http.js";
import { compactMetadata, dailyToHourly, fabricFromText, firstGpu, formatBandwidth, normalizeMbToGb } from "../format.js";

export const cloreConnector = {
  id: "clore-ai",
  name: "Clore.ai",
  envVars: ["CLORE_API_KEY"],
  async fetch(env) {
    const key = env.CLORE_API_KEY;
    if (!key) return [];
    const data = await jsonFetch("https://api.clore.ai/v1/marketplace", {
      headers: { auth: key }
    });
    const offers = pickArray(data, ["market.offers", "offers", "servers", "data"]);
    return offers.map((raw) => {
      const gpu = firstGpu(raw);
      const gpuCount = raw.gpu_count || raw.num_gpus || raw.gpus?.length || raw.specs?.gpus?.length || raw.gpu_array?.length || 1;
      const totalPricePerHour = raw.price_per_hour
        || raw.usd_per_hour
        || raw.hourly_price
        || raw.price_hourly
        || raw.price?.usd?.on_demand_usd
        || raw.price?.usd?.on_demand_clore
        || dailyToHourly(raw.price);
      const networkBandwidth = formatBandwidth(raw.specs?.net?.down, raw.specs?.net?.up);
      const networkFabric = fabricFromText(raw.specs?.net?.type, raw.specs?.net?.name, networkBandwidth);
      return createInventoryItem({
        provider: "Clore.ai",
        rawOfferId: raw.offer_id ?? raw.id ?? raw.server_id,
        gpuLabel: raw.specs?.gpu || gpu.name || raw.gpu_array?.join(", ") || raw.gpu || raw.gpu_model || raw.name,
        gpuCount,
        vramGbEach: normalizeMbToGb(gpu.mem || raw.specs?.gpuram || raw.gpu_ram),
        pricePerGpuHour: totalPricePerHour ? totalPricePerHour / gpuCount : null,
        totalHourlyPrice: totalPricePerHour,
        region: raw.specs?.net?.cc || raw.country || raw.region || raw.location,
        formFactor: "container",
        interconnect: raw.nvlink ? "NVLink" : "PCIe",
        cpu: raw.specs?.cpu || raw.cpu || raw.cpu_name || "",
        ramGb: normalizeMbToGb(raw.specs?.ram || raw.ram),
        storage: raw.specs?.disk || (raw.disk ? `${raw.disk} GB` : ""),
        networkBandwidth,
        networkFabric,
        availability: raw.rented ? "unavailable" : "available",
        checkoutUrl: buildCloreUrl(raw),
        sourceMode: "live",
        listingType: raw.gigaspot ? "spot_server" : "marketplace_server",
        priceScope: "node_total",
        dataNotes: [
          raw.gigaspot ? "Spot" : "",
          raw.reliability ? `Reliability: ${raw.reliability}` : "",
          raw.rating?.avg ? `Rating: ${raw.rating.avg}` : ""
        ].filter(Boolean),
        specs: {
          gpu: {
            pcieRevision: raw.specs?.pcie_rev,
            pcieWidth: raw.specs?.pcie_width,
            powerLimitWatts: raw.specs?.pl,
            stockPowerLimitWatts: raw.specs?.stock_pl
          },
          machine: {
            diskSpeed: raw.specs?.disk_speed,
            xfs: raw.specs?.xfs,
            network: raw.specs?.net
          }
        },
        metadata: compactMetadata({
          serverId: raw.id,
          owner: raw.owner,
          reliability: raw.reliability,
          rating: raw.rating,
          cudaVersion: raw.cuda_version,
          backendVersion: raw.specs?.backend_version,
          allowedCoins: raw.allowed_coins,
          priceBreakdown: raw.price,
          network: {
            countryCode: raw.specs?.net?.cc,
            downMbps: raw.specs?.net?.down,
            upMbps: raw.specs?.net?.up,
            testHistory: raw.specs?.net?.test_history
          },
          diskSpeed: raw.specs?.disk_speed,
          pcie: {
            revision: raw.specs?.pcie_rev,
            width: raw.specs?.pcie_width
          },
          powerLimits: {
            current: raw.specs?.pl,
            stock: raw.specs?.stock_pl
          },
          overclock: {
            current: raw.oc,
            stock: raw.specs?.stock_oc,
            autoprice: raw.autoprice
          },
          xfs: raw.specs?.xfs
        }),
        rawPayload: raw
      });
    });
  }
};

function buildCloreUrl(raw) {
  if (!raw.id) return "https://clore.ai/marketplace";
  return `https://clore.ai/marketplace?server=${encodeURIComponent(raw.id)}`;
}
