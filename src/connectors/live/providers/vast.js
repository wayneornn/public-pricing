import { createInventoryItem } from "../../../core/inventory.js";
import { jsonFetch, pickArray } from "../http.js";
import { compactMetadata, fabricFromText, formatBandwidth, normalizeMbToGb } from "../format.js";

export const vastConnector = {
  id: "vast-ai",
  name: "Vast.ai",
  envVars: ["VAST_API_KEY"],
  async fetch(env) {
    const key = env.VAST_API_KEY;
    if (!key) return [];
    const data = await jsonFetch("https://console.vast.ai/api/v0/bundles/", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        limit: 1000,
        type: "ondemand",
        verified: { eq: true },
        rentable: { eq: true },
        rented: { eq: false }
      })
    });
    const offers = pickArray(data, ["offers", "bundles", "data"]);
    return offers.map((raw) => {
      const gpuCount = raw.num_gpus || raw.gpu_count || 1;
      const totalHourlyPrice = raw.dph_total || raw.dph_base || raw.price_per_hour;
      const networkBandwidth = formatBandwidth(raw.inet_down, raw.inet_up);
      const networkFabric = fabricFromText(raw.network, networkBandwidth);
      return createInventoryItem({
        provider: "Vast.ai",
        rawOfferId: raw.id ?? raw.ask_contract_id ?? raw.machine_id,
        gpuLabel: raw.gpu_name || raw.gpu_name_s || raw.gpu_names || raw.gpu_model || raw.cuda_max_good,
        gpuCount,
        vramGbEach: normalizeMbToGb(raw.gpu_ram),
        pricePerGpuHour: totalHourlyPrice ? totalHourlyPrice / gpuCount : null,
        totalHourlyPrice,
        region: raw.geolocation || raw.country || raw.datacenter || raw.region,
        formFactor: "container",
        interconnect: raw.pcie_bw ? "PCIe" : raw.nvlink ? "NVLink" : "",
        cpu: raw.cpu_name || raw.cpu_cores ? `${raw.cpu_cores || ""} ${raw.cpu_name || "CPU"}`.trim() : "",
        ramGb: normalizeMbToGb(raw.cpu_ram),
        storage: raw.disk_space ? `${raw.disk_space} GB` : "",
        networkBandwidth,
        networkFabric,
        availability: raw.available === false ? "unavailable" : "available",
        checkoutUrl: buildVastUrl(raw),
        sourceMode: "live",
        listingType: raw.hosting_type || raw.resource_type || "marketplace_offer",
        priceScope: "node_total",
        minTerm: raw.duration ? `${raw.duration}` : "",
        dataNotes: [
          raw.verification ? `Verification: ${raw.verification}` : "",
          raw.reliability ? `Reliability: ${Math.round(Number(raw.reliability) * 100)}%` : "",
          raw.discounted_hourly ? "Discounted" : ""
        ].filter(Boolean),
        specs: {
          gpu: {
            pcieBandwidth: raw.pcie_bw,
            pciGeneration: raw.pci_gen,
            nvlinkBandwidth: raw.bw_nvlink,
            memoryBandwidth: raw.gpu_mem_bw,
            powerWatts: raw.gpu_max_power,
            computeCapability: raw.compute_cap
          },
          machine: {
            diskBandwidth: raw.disk_bw,
            internet: {
              downMbps: raw.inet_down,
              upMbps: raw.inet_up,
              downCostPerTb: raw.internet_down_cost_per_tb,
              upCostPerTb: raw.internet_up_cost_per_tb
            },
            ports: {
              directPortCount: raw.direct_port_count,
              staticIp: raw.static_ip,
              publicIpAvailable: Boolean(raw.public_ipaddr)
            }
          }
        },
        metadata: compactMetadata({
          machineId: raw.machine_id,
          askContractId: raw.ask_contract_id,
          bundleId: raw.bundle_id,
          hostId: raw.host_id,
          clusterId: raw.cluster_id,
          gpuIds: raw.gpu_ids,
          reliability: raw.reliability,
          reliability2: raw.reliability2,
          expectedReliability: raw.expected_reliability,
          targetReliability: raw.target_reliability,
          verification: raw.verification,
          score: raw.score,
          dlperf: raw.dlperf,
          dlperfPerDollar: raw.dlperf_per_dphtotal,
          flopsPerDollar: raw.flops_per_dphtotal,
          computeCapability: raw.compute_cap,
          gpuArchitecture: raw.gpu_arch,
          gpuPowerWatts: raw.gpu_max_power,
          gpuMemoryBandwidth: raw.gpu_mem_bw,
          pciGeneration: raw.pci_gen,
          pcieBandwidth: raw.pcie_bw,
          nvlinkBandwidth: raw.bw_nvlink,
          diskBandwidth: raw.disk_bw,
          networkDiskBandwidth: {
            min: raw.nw_disk_min_bw,
            avg: raw.nw_disk_avg_bw,
            max: raw.nw_disk_max_bw
          },
          network: {
            downMbps: raw.inet_down,
            upMbps: raw.inet_up,
            downCostPerTb: raw.internet_down_cost_per_tb,
            upCostPerTb: raw.internet_up_cost_per_tb
          },
          software: {
            cudaMax: raw.cuda_max_good,
            driverVersion: raw.driver_version || raw.driver_vers,
            osVersion: raw.os_version
          },
          ports: {
            directPortCount: raw.direct_port_count,
            staticIp: raw.static_ip,
            publicIpAvailable: Boolean(raw.public_ipaddr)
          },
          pricingBreakdown: {
            base: raw.dph_base,
            total: raw.dph_total,
            adjustedTotal: raw.dph_total_adj,
            discountedTotal: raw.discounted_dph_total || raw.discounted_hourly,
            storageCost: raw.storage_cost,
            storageTotalCost: raw.storage_total_cost,
            minBid: raw.min_bid
          }
        }),
        rawPayload: raw
      });
    });
  }
};

function buildVastUrl(raw) {
  if (!raw.id) return "https://cloud.vast.ai/create/";
  const params = new URLSearchParams({
    id: String(raw.id),
    offer_id: String(raw.id),
    ask_id: String(raw.ask_contract_id || raw.id)
  });
  if (raw.machine_id) params.set("machine_id", String(raw.machine_id));
  return `https://cloud.vast.ai/create/?${params.toString()}`;
}
