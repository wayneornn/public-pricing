import { createInventoryItem } from "../../../core/inventory.js";
import { extractGpuCount } from "../../../core/taxonomy.js";
import { jsonFetch, pickArray } from "../http.js";
import { buildGpuLabel, compactMetadata, fabricDataNote, fabricFromText, numberOrNull, truthyEnv } from "../format.js";

const VOLTAGE_PARK_API_BASE_URL = "https://api.voltagegpu.com/api/volt";

export const voltageParkConnector = {
  id: "voltage-park",
  name: "Voltage Park",
  envVars: ["VOLTAGE_PARK_API_KEY", "VOLTAGEGPU_API_KEY"],
  async fetch(env) {
    const key = env.VOLTAGE_PARK_API_KEY || env.VOLTAGEGPU_API_KEY;
    if (!key) return [];
    if (!/^volt_/i.test(key) || truthyEnv(env.VOLTAGE_PARK_USE_ON_DEMAND)) {
      const onDemandItems = await fetchVoltageParkOnDemand(env, key);
      if (onDemandItems.length || !/^volt_/i.test(key)) return onDemandItems;
    }
    const machines = await fetchVoltageGpuMachines(env, key);
    return machines.map((raw) => voltageParkMachineToItem(raw));
  }
};

function voltageParkMachineToItem(raw) {
  const gpuCount = voltageParkGpuCount(raw);
  const totalHourlyPrice = numberOrNull(raw.price ?? raw.rental_rate ?? raw.hourly_price ?? raw.cost_per_hour);
  const availabilityCount = numberOrNull(raw.available_gpu_count ?? raw.availableGpuCount ?? raw.total_gpu_count ?? raw.totalGpuCount ?? raw.stock);
  const explicitlyRentable = raw.rentable === true || raw.deployable === true || raw.orderable === true;
  const networkFabric = fabricFromText(raw.network, raw.network_type, raw.connectivity, raw.interconnect);
  return createInventoryItem({
    provider: "Voltage Park",
    providerId: "voltage-park",
    rawOfferId: raw.resource_name || raw.resourceName || raw.id || raw.name,
    gpuLabel: buildGpuLabel({
      count: gpuCount,
      model: raw.gpu_type || raw.gpuType || raw.name,
      vramGb: raw.vram_gb || raw.vramGb,
      variant: raw.resource_name || raw.name
    }),
    gpuCount,
    vramGbEach: raw.vram_gb || raw.vramGb,
    pricePerGpuHour: totalHourlyPrice && gpuCount ? totalHourlyPrice / gpuCount : null,
    totalHourlyPrice,
    region: raw.region || raw.datacenter || raw.location || "VoltageGPU",
    formFactor: "container",
    interconnect: voltageParkGpuInterconnect(raw.interconnect || raw.name || raw.gpu_type || raw.gpuType),
    cpu: raw.vcpu || raw.vcpus ? `${raw.vcpu || raw.vcpus} vCPU` : "",
    ramGb: raw.memory || raw.memory_gb || raw.ram_gb || raw.ramGb,
    storage: raw.storage || raw.disk ? `${raw.storage || raw.disk} GB` : "",
    networkBandwidth: raw.bandwidth || raw.network_bandwidth || "",
    networkFabric,
    availability: explicitlyRentable && availabilityCount !== 0 ? "available" : raw.available === false || availabilityCount === 0 ? "unavailable" : "unknown",
    availabilityCount,
    checkoutUrl: buildVoltageParkUrl(raw),
    sourceMode: "live",
    listingType: raw.confidential_compute ? "confidential_machine" : "machine",
    priceScope: "node_total",
    availabilitySemantics: explicitlyRentable ? "host_capacity" : "unknown",
    checkoutSemantics: explicitlyRentable ? undefined : "provider_console",
    dataNotes: [
      raw.confidential_compute ? "Confidential compute" : "",
      fabricDataNote(networkFabric, raw.gpu_type || raw.gpuType || raw.name, gpuCount),
      explicitlyRentable ? "" : "No explicit rentable/deployable signal returned"
    ].filter(Boolean),
    metadata: compactMetadata({
      resourceName: raw.resource_name || raw.resourceName,
      machineId: raw.id,
      gpuType: raw.gpu_type || raw.gpuType,
      confidentialCompute: raw.confidential_compute,
      rawAvailability: {
        available: raw.available,
        availableGpuCount: raw.available_gpu_count ?? raw.availableGpuCount,
        totalGpuCount: raw.total_gpu_count ?? raw.totalGpuCount,
        stock: raw.stock
      },
      pricing: {
        price: raw.price,
        rentalRate: raw.rental_rate,
        hourlyPrice: raw.hourly_price,
        costPerHour: raw.cost_per_hour
      },
      networkFabric
    }),
    rawPayload: raw
  });
}

async function fetchVoltageParkOnDemand(env, key) {
  const base = (env.VOLTAGE_PARK_ON_DEMAND_BASE_URL || "https://cloud-api.voltagepark.com/api/v1").replace(/\/$/, "");
  const locations = [];
  const limit = 15;
  for (let offset = 0; offset < 150; offset += limit) {
    const url = new URL(`${base}/locations/`);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(offset));
    const data = await jsonFetch(url.toString(), {
      headers: { Authorization: `Bearer ${key}` }
    });
    locations.push(...pickArray(data, ["results", "locations", "data"]));
    if (!data.has_next) break;
  }
  return locations.flatMap((location) => voltageParkLocationToItems(location));
}

async function fetchVoltageGpuMachines(env, key) {
  const base = (env.VOLTAGE_PARK_API_BASE_URL || VOLTAGE_PARK_API_BASE_URL).replace(/\/$/, "");
  const data = await jsonFetch(`${base}/machines`, {
    headers: { "X-API-Key": key }
  });
  return pickArray(data, ["machines", "items", "data", "results"]).filter((raw) => voltageParkGpuCount(raw) > 0);
}

function voltageParkLocationToItems(location) {
  const hostnodes = Array.isArray(location.hostnodes) ? location.hostnodes : [];
  return hostnodes.flatMap((hostnode) => {
    const gpuResources = hostnode.available_resources?.gpus || {};
    return Object.entries(gpuResources).flatMap(([gpuKey, gpuResource]) => {
      const gpuCount = Number(gpuResource?.count || 0);
      if (!gpuCount) return [];
      const gpuPrice = numberOrNull(hostnode.pricing?.per_gpu_hr?.[gpuKey]);
      const totalHourlyPrice = voltageParkHostnodeTotalPrice(hostnode, gpuKey, gpuCount);
      const networkFabric = fabricFromText(location.network, location.network_type, location.connectivity, hostnode.network, hostnode.network_type, hostnode.connectivity);
      return createInventoryItem({
        provider: "Voltage Park",
        providerId: "voltage-park",
        rawOfferId: `${location.id}:${hostnode.id}:${gpuKey}`,
        gpuLabel: buildGpuLabel({
          count: gpuCount,
          model: gpuKey,
          variant: gpuKey
        }),
        gpuCount,
        pricePerGpuHour: totalHourlyPrice ? totalHourlyPrice / gpuCount : gpuPrice,
        totalHourlyPrice: totalHourlyPrice || (gpuPrice ? gpuPrice * gpuCount : null),
        region: [location.city, location.region, location.country].filter(Boolean).join(", ") || location.id,
        country: location.country,
        formFactor: "vm",
        interconnect: gpuKey,
        cpu: hostnode.available_resources?.vcpu_count ? `${hostnode.available_resources.vcpu_count} vCPU` : "",
        ramGb: hostnode.available_resources?.ram_gb,
        storage: hostnode.available_resources?.storage_gb ? `${hostnode.available_resources.storage_gb} GB` : "",
        networkBandwidth: hostnode.available_resources?.network_bandwidth || "",
        networkFabric,
        availability: "unknown",
        availabilityCount: gpuCount,
        checkoutUrl: buildVoltageParkOnDemandUrl(location, hostnode, gpuKey),
        sourceMode: "live",
        listingType: "vm_hostnode",
        priceScope: totalHourlyPrice ? "node_total" : "gpu_sku_only",
        checkoutSemantics: "provider_console",
        dataNotes: [
          totalHourlyPrice ? "Node total includes GPU, CPU, RAM, and storage components" : "GPU price only",
          fabricDataNote(networkFabric, gpuKey, gpuCount),
          "Live Voltage Park API VM hostnode capacity; not the public bare-metal Ethernet rental picker",
          "Public console may not expose an exact deep link"
        ],
        metadata: compactMetadata({
          locationId: location.id,
          hostnodeId: hostnode.id,
          gpuKey,
          availablePorts: hostnode.available_ports,
          availableResources: hostnode.available_resources,
          pricingComponents: hostnode.pricing,
          totalHourlyComponents: {
            gpu: (numberOrNull(hostnode.pricing?.per_gpu_hr?.[gpuKey]) || 0) * gpuCount,
            cpu: (numberOrNull(hostnode.pricing?.per_vcpu_hr) || 0) * Number(hostnode.available_resources?.vcpu_count || 0),
            ram: (numberOrNull(hostnode.pricing?.per_gb_ram_hr) || 0) * Number(hostnode.available_resources?.ram_gb || 0),
            storage: (numberOrNull(hostnode.pricing?.per_gb_storage_hr) || 0) * Number(hostnode.available_resources?.storage_gb || 0)
          },
          location: {
            city: location.city,
            region: location.region,
            country: location.country
          },
          networkFabric
        }),
        rawPayload: {
          location,
          hostnode,
          gpuKey
        }
      });
    });
  });
}

function voltageParkHostnodeTotalPrice(hostnode, gpuKey, gpuCount) {
  const resources = hostnode.available_resources || {};
  const pricing = hostnode.pricing || {};
  const gpuTotal = (numberOrNull(pricing.per_gpu_hr?.[gpuKey]) || 0) * gpuCount;
  const cpuTotal = (numberOrNull(pricing.per_vcpu_hr) || 0) * Number(resources.vcpu_count || 0);
  const ramTotal = (numberOrNull(pricing.per_gb_ram_hr) || 0) * Number(resources.ram_gb || 0);
  const storageTotal = (numberOrNull(pricing.per_gb_storage_hr) || 0) * Number(resources.storage_gb || 0);
  const total = gpuTotal + cpuTotal + ramTotal + storageTotal;
  return total > 0 ? total : null;
}

function voltageParkGpuInterconnect(value = "") {
  const text = String(value || "");
  if (/nvlink|sxm|hgx/i.test(text)) return "NVLink";
  if (/pcie|pci-e/i.test(text)) return "PCIe";
  return text || "";
}

function buildVoltageParkOnDemandUrl(location, hostnode, gpuKey) {
  const params = new URLSearchParams();
  if (location.id) params.set("location_id", location.id);
  if (hostnode.id) params.set("hostnode_id", hostnode.id);
  if (gpuKey) params.set("gpu", gpuKey);
  const query = params.toString();
  return `https://cloud.voltagepark.com/${query ? `?${query}` : ""}`;
}

function voltageParkGpuCount(raw) {
  return Number(raw.gpu_count || raw.gpuCount || raw.k || extractGpuCount(raw.name || raw.resource_name || raw.gpu_type, 0)) || 0;
}

function buildVoltageParkUrl(raw) {
  const params = new URLSearchParams();
  if (raw.resource_name || raw.resourceName) params.set("resource_name", raw.resource_name || raw.resourceName);
  const query = params.toString();
  return `https://console.voltagegpu.com/${query ? `?${query}` : ""}`;
}
