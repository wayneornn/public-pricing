import { createInventoryItem } from "../../../core/inventory.js";
import { jsonFetch, pickArray } from "../http.js";
import { buildGpuLabel, compactMetadata, cudoGpuLabel, fabricDataNote, fabricFromText, moneyValue } from "../format.js";

export const cudoConnector = {
  id: "cudo",
  name: "CUDO Compute",
  envVars: ["CUDO_API_KEY"],
  async fetch(env) {
    const key = env.CUDO_API_KEY;
    if (!key) return [];
    const headers = { Authorization: `Bearer ${key}` };
    const vmData = await jsonFetch("https://rest.compute.cudo.org/v1/vms/machine-types", { headers });
    const vmItems = cudoVmMachineTypesToItems(pickArray(vmData, ["machineTypes", "data"]));

    const machineItems = await fetchCudoBareMetal(headers);
    return [...vmItems, ...machineItems];
  }
};

// CUDO VM machine-types are configurable: `maxGpuFree` is how many GPUs are
// currently free in the datacenter pool, NOT a fixed multi-GPU node. You pick
// how many GPUs (1..maxGpuFree) when creating a VM, and pricing is per GPU. So
// the rentable/priced unit is a single GPU with an availability count of
// `maxGpuFree`. Rendering it as an "Nx" node (the previous behavior) would
// misrepresent loose pool capacity as a clustered node and fabricate a node
// total, repeating the TensorDock (C1) pool-as-node bug.
export function cudoVmMachineTypesToItems(rows = []) {
  return rows
    .filter((raw) => raw.gpuModel || raw.gpuModelId)
    .filter((raw) => Number(raw.maxGpuFree ?? raw.totalGpuFree ?? 0) > 0)
    .map((raw) => cudoVmMachineTypeToItem(raw));
}

function cudoVmMachineTypeToItem(raw) {
  const availableCount = Number(raw.maxGpuFree ?? raw.totalGpuFree ?? 0);
  const gpuCount = 1;
  const pricePerGpuHour = moneyValue(raw.gpuPriceHr);
  const gpuLabel = buildGpuLabel({
    count: gpuCount,
    model: raw.gpuModel || cudoGpuLabel(raw.gpuModelId),
    variant: raw.gpuModelId || raw.gpuModel
  });
  const networkFabric = fabricFromText(raw.networkType, raw.network);
  return createInventoryItem({
    provider: "CUDO Compute",
    providerId: "cudo",
    rawOfferId: `vm:${raw.machineType}:${raw.dataCenterId}`,
    gpuLabel,
    gpuCount,
    pricePerGpuHour,
    totalHourlyPrice: pricePerGpuHour,
    region: raw.dataCenterId,
    formFactor: "vm",
    interconnect: raw.gpuModel || raw.gpuModelId,
    cpu: raw.maxVcpuFree ? `up to ${raw.maxVcpuFree} vCPU free` : "",
    ramGb: raw.maxMemoryGibFree,
    storage: raw.maxStorageGibFree ? `${raw.maxStorageGibFree} GB free` : "",
    networkFabric,
    availability: availableCount > 0 ? "available" : "unavailable",
    availabilityCount: availableCount,
    checkoutUrl: buildCudoUrl(raw, "vm"),
    checkoutSemantics: "manual_provider",
    sourceMode: "live",
    listingType: "vm_machine_type",
    priceScope: "gpu_sku_only",
    dataNotes: [
      "GPU price only",
      "CPU/RAM/storage/IP priced separately",
      availableCount > 1 ? `Up to ${availableCount} GPUs provisionable in one VM (priced per GPU)` : "",
      fabricDataNote(networkFabric, gpuLabel, gpuCount)
    ].filter(Boolean),
    metadata: compactMetadata({
      dataCenterId: raw.dataCenterId,
      machineType: raw.machineType,
      architecture: raw.architecture,
      gpuModelId: raw.gpuModelId,
      networkType: raw.networkType,
      renewableEnergy: raw.renewableEnergy,
      freeCapacity: {
        gpu: raw.maxGpuFree ?? raw.totalGpuFree,
        vcpu: raw.maxVcpuFree ?? raw.totalVcpuFree,
        memoryGib: raw.maxMemoryGibFree ?? raw.totalMemoryGibFree,
        storageGib: raw.maxStorageGibFree ?? raw.totalStorageGibFree
      },
      pricingComponents: {
        gpuPriceHr: moneyValue(raw.gpuPriceHr),
        vcpuPriceHr: moneyValue(raw.vcpuPriceHr),
        memoryGibPriceHr: moneyValue(raw.memoryGibPriceHr),
        minStorageGibPriceHr: moneyValue(raw.minStorageGibPriceHr),
        ipv4PriceHr: moneyValue(raw.ipv4PriceHr)
      },
      sizingRules: {
        minVcpu: raw.minVcpu,
        minMemoryGib: raw.minMemoryGib,
        minVcpuPerGpu: raw.minVcpuPerGpu,
        maxVcpuPerGpu: raw.maxVcpuPerGpu,
        minVcpuPerMemoryGib: raw.minVcpuPerMemoryGib,
        maxVcpuPerMemoryGib: raw.maxVcpuPerMemoryGib
      }
    }),
    rawPayload: raw
  });
}

async function fetchCudoBareMetal(headers) {
  try {
    const data = await jsonFetch("https://rest.compute.cudo.org/v1/machines-types?pageSize=200", { headers });
    return pickArray(data, ["machineTypes", "data"])
      .filter((raw) => Number(raw.gpus || 0) > 0)
      .map((raw) => {
        const totalHourlyPrice = moneyValue(raw.prices?.find((price) => price.commitmentTerm === "COMMITMENT_TERM_NONE")?.priceHr)
          || moneyValue(raw.prices?.[0]?.priceHr);
        const gpuCount = Number(raw.gpus || 1);
        const gpuLabel = buildGpuLabel({
          count: gpuCount,
          model: cudoGpuLabel(raw.gpuModelId),
          variant: raw.gpuModelId
        });
        const networkFabric = fabricFromText(raw.networkType, raw.network);
        return createInventoryItem({
          provider: "CUDO Compute",
          providerId: "cudo",
          rawOfferId: `bare-metal:${raw.id}:${raw.dataCenterId}`,
          gpuLabel,
          gpuCount,
          pricePerGpuHour: totalHourlyPrice && gpuCount ? totalHourlyPrice / gpuCount : null,
          totalHourlyPrice,
          region: raw.dataCenterId,
          formFactor: "bare_metal",
          interconnect: raw.gpuModelId,
          cpu: raw.cpuCores ? `${raw.cpuCores} ${raw.cpuModel || "CPU"}` : raw.cpuModel,
          ramGb: raw.memoryGib,
          storage: raw.diskSizeGib ? `${raw.disks || ""}x ${raw.diskSizeGib} GB`.trim() : "",
          networkFabric,
          availability: Number(raw.machinesFree || 0) > 0 ? "available" : "unavailable",
          availabilityCount: raw.machinesFree,
          checkoutUrl: buildCudoUrl(raw, "bare-metal"),
          checkoutSemantics: "manual_provider",
          sourceMode: "live",
          listingType: "bare_metal_machine_type",
          priceScope: "node_total",
          dataNotes: [
            fabricDataNote(networkFabric, gpuLabel, gpuCount)
          ].filter(Boolean),
          metadata: compactMetadata({
            dataCenterId: raw.dataCenterId,
            machineTypeId: raw.id,
            architecture: raw.architecture,
            gpuModelId: raw.gpuModelId,
            networkType: raw.networkType,
            machinesFree: raw.machinesFree,
            disks: raw.disks,
            diskSizeGib: raw.diskSizeGib,
            cpuSpeedMhz: raw.cpuSpeedMhz,
            renewableEnergy: raw.renewableEnergy,
            prices: raw.prices,
            pricingComponents: raw.prices?.map((price) => ({
              commitmentTerm: price.commitmentTerm,
              priceHr: moneyValue(price.priceHr),
              gpuPriceHr: moneyValue(price.gpuPriceHr),
              vcpuPriceHr: moneyValue(price.vcpuPriceHr),
              memoryGibPriceHr: moneyValue(price.memoryGibPriceHr),
              ipv4PriceHr: moneyValue(price.ipv4PriceHr)
            }))
          }),
          rawPayload: raw
        });
      });
  } catch {
    return [];
  }
}

function buildCudoUrl(raw, kind) {
  const params = new URLSearchParams();
  if (kind) params.set("kind", kind);
  if (raw.machineType || raw.id) params.set("machineType", raw.machineType || raw.id);
  if (raw.dataCenterId) params.set("dataCenterId", raw.dataCenterId);
  const query = params.toString();
  return `https://www.cudocompute.com/console${query ? `?${query}` : ""}`;
}
