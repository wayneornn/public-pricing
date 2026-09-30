import { createInventoryItem } from "../../../core/inventory.js";
import { extractGpuCount } from "../../../core/taxonomy.js";
import { jsonFetch, safeJsonFetch, pickArray } from "../http.js";
import { buildGpuLabel, compactMetadata, fabricDataNote, fabricFromText, nonNegativeNumber, numberOrNull, parseMemoryGb, truthyEnv } from "../format.js";

const GCORE_API_BASE_URL = "https://api.gcore.com";

export const gcoreConnector = {
  id: "gcore",
  name: "Gcore",
  envVars: ["GCORE_API_KEY"],
  async fetch(env) {
    const key = env.GCORE_API_KEY;
    if (!key) return [];
    const headers = { Authorization: gcoreAuthorization(key) };
    const projects = await fetchGcoreProjects(env, headers);
    const regions = await fetchGcoreRegions(env, headers);
    const selectedProjects = truthyEnv(env.GCORE_ALL_PROJECTS) ? projects : projects.slice(0, 1);
    const items = [];
    for (const project of selectedProjects) {
      for (const region of regions) {
        const flavors = await fetchGcoreGpuFlavors(project.id, region.id, headers, env);
        items.push(...flavors.map((raw) => gcoreFlavorToItem(raw, project, region)));
      }
    }
    return items;
  }
};

async function fetchGcoreProjects(env, headers) {
  if (env.GCORE_PROJECT_ID) {
    return env.GCORE_PROJECT_ID.split(",").map((id) => ({ id: id.trim(), name: id.trim() })).filter((project) => project.id);
  }
  const base = (env.GCORE_API_BASE_URL || GCORE_API_BASE_URL).replace(/\/$/, "");
  const data = await jsonFetch(`${base}/cloud/v1/projects?limit=1000`, { headers });
  const projects = pickArray(data, ["results", "projects", "data"])
    .filter((project) => !project.deleted_at && !/deleted/i.test(String(project.state || "")))
    .sort((left, right) => Number(Boolean(right.is_default)) - Number(Boolean(left.is_default)));
  return projects.map((project) => ({ id: project.id, name: project.name || String(project.id) })).filter((project) => project.id);
}

async function fetchGcoreRegions(env, headers) {
  if (env.GCORE_REGION_IDS) {
    return env.GCORE_REGION_IDS.split(",").map((id) => ({ id: id.trim(), display_name: id.trim() })).filter((region) => region.id);
  }
  const base = (env.GCORE_API_BASE_URL || GCORE_API_BASE_URL).replace(/\/$/, "");
  const data = await jsonFetch(`${base}/cloud/v1/regions?limit=1000`, { headers });
  return pickArray(data, ["results", "regions", "data"])
    .filter((region) => region.state ? /active/i.test(region.state) : true)
    .filter((region) => region.has_ai_gpu || region.has_ai || region.has_baremetal)
    .map((region) => ({
      id: region.id,
      display_name: region.display_name || region.name || region.keystone_name || String(region.id),
      country: region.country,
      zone: region.zone,
      raw: region
    }))
    .filter((region) => region.id);
}

async function fetchGcoreGpuFlavors(projectId, regionId, headers, env) {
  const results = [];
  const base = (env.GCORE_API_BASE_URL || GCORE_API_BASE_URL).replace(/\/$/, "");
  for (const kind of ["baremetal", "virtual"]) {
    const url = new URL(`${base}/cloud/v3/gpu/${kind}/${projectId}/${regionId}/flavors`);
    url.searchParams.set("hide_disabled", "true");
    url.searchParams.set("include_prices", "true");
    url.searchParams.set("include_capacity", "true");
    const data = await safeJsonFetch(url.toString(), { headers });
    results.push(...pickArray(data, ["results", "flavors", "data"]).map((raw) => ({ ...raw, gcoreKind: kind })));
  }
  return results.filter((raw) => !raw.disabled && gcoreGpuCount(raw) > 0);
}

function gcoreFlavorToItem(raw, project, region) {
  const gpuCount = gcoreGpuCount(raw);
  const totalHourlyPrice = gcoreHourlyPrice(raw);
  const capacity = nonNegativeNumber(raw.capacity ?? raw.available_capacity ?? raw.stock ?? raw.available);
  const hasCapacitySignal = capacity !== null;
  const networkBandwidth = raw.hardware_description?.network || raw.hardware_properties?.nic_eth || "";
  const networkFabric = fabricFromText(raw.hardware_properties?.nic_ib, raw.hardware_properties?.nic_eth, raw.hardware_description?.network, raw.supported_features?.join?.(" "));
  return createInventoryItem({
    provider: "Gcore",
    providerId: "gcore",
    rawOfferId: `${raw.gcoreKind}:${project.id}:${region.id}:${raw.name || raw.flavor_id || raw.resource_class}`,
    gpuLabel: buildGpuLabel({
      count: gpuCount,
      model: raw.hardware_properties?.gpu_model || raw.hardware_description?.gpu || raw.name || raw.flavor_name,
      variant: raw.name || raw.flavor_name || raw.resource_class
    }),
    gpuCount,
    pricePerGpuHour: totalHourlyPrice && gpuCount ? totalHourlyPrice / gpuCount : null,
    totalHourlyPrice,
    region: region.display_name,
    country: region.country,
    formFactor: raw.gcoreKind === "baremetal" ? "bare_metal" : "vm",
    interconnect: gcoreGpuInterconnect(raw),
    cpu: raw.hardware_description?.cpu || raw.hardware_description?.vcpus || "",
    ramGb: parseMemoryGb(raw.hardware_description?.ram),
    storage: raw.hardware_description?.disk || raw.hardware_description?.local_storage || "",
    networkBandwidth,
    networkFabric,
    availability: hasCapacitySignal ? (capacity === 0 ? "unavailable" : "available") : "unknown",
    availabilityCount: capacity,
    currency: raw.price?.currency_code || raw.currency || "USD",
    checkoutUrl: buildGcoreUrl(project, region, raw),
    checkoutSemantics: "manual_provider",
    sourceMode: "live",
    listingType: raw.gcoreKind === "baremetal" ? "gpu_bare_metal_flavor" : "gpu_virtual_flavor",
    priceScope: totalHourlyPrice ? "node_total" : "unknown",
    availabilitySemantics: hasCapacitySignal ? "sku_capacity" : "region_offering",
    dataNotes: [
      totalHourlyPrice ? "" : "Price unavailable from API",
      fabricDataNote(networkFabric, raw.hardware_properties?.gpu_model || raw.hardware_description?.gpu || raw.name || raw.flavor_name, gpuCount),
      hasCapacitySignal ? "" : "Capacity unavailable from API"
    ].filter(Boolean),
    metadata: compactMetadata({
      project: {
        id: project.id,
        name: project.name
      },
      region: {
        id: region.id,
        name: region.display_name,
        zone: region.zone,
        country: region.country
      },
      flavorName: raw.name,
      architecture: raw.architecture,
      capacity: raw.capacity,
      reservedCapacity: raw.reserved_capacity,
      price: raw.price,
      hardwareDescription: raw.hardware_description,
      hardwareProperties: raw.hardware_properties,
      networkFabric,
      supportedFeatures: raw.supported_features
    }),
    rawPayload: raw
  });
}

function gcoreAuthorization(key) {
  return /^apikey\s/i.test(String(key || "")) ? key : `apikey ${key}`;
}

function gcoreGpuCount(raw) {
  return Number(raw.hardware_properties?.gpu_count || raw.gpu_count || extractGpuCount(raw.hardware_description?.gpu || raw.name || raw.flavor_name, 0)) || 0;
}

function gcoreHourlyPrice(raw) {
  return numberOrNull(
    raw.price_per_hour
    ?? raw.pricePerHour
    ?? raw.price?.price_per_hour
    ?? raw.total_price_per_hour
    ?? raw.per_hour?.flavor
    ?? raw.prices?.per_hour?.flavor
    ?? raw.pricing?.price_per_hour
  );
}

function gcoreGpuInterconnect(raw) {
  const text = `${raw.name || ""} ${raw.flavor_name || ""} ${raw.resource_class || ""} ${raw.hardware_description?.gpu || ""}`;
  if (/nvlink|sxm|hgx/i.test(text)) return "NVLink";
  if (/pcie|pci-e/i.test(text)) return "PCIe";
  return "";
}

function buildGcoreUrl(project, region, raw) {
  const params = new URLSearchParams();
  if (project.id) params.set("project_id", String(project.id));
  if (region.id) params.set("region_id", String(region.id));
  if (raw.name || raw.flavor_id) params.set("flavor", raw.name || raw.flavor_id);
  const query = params.toString();
  return `https://cloud.gcore.com/cloud/gpu${query ? `?${query}` : ""}`;
}
