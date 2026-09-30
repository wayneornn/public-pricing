import { createInventoryItem } from "../core/inventory.js";
import { numberOrNull } from "../core/num.js";
import { compactMetadata, inferGpuCount, parseEnvList, pickArray, truncate } from "../core/format.js";

export const NSCALE_PROVIDER_ID = "nscale";

const NSCALE_IDENTITY_API_BASE_URL = "https://identity.nks.europe-west4.nscale.com";
const NSCALE_COMPUTE_API_BASE_URL = "https://compute.nks.europe-west4.nscale.com";
const NSCALE_CONSOLE_URL = "https://console.nscale.com";
const DEFAULT_TIMEOUT_MS = 12_000;

export function hasNscaleConfiguration(env = process.env) {
  return !falsyEnv(env.NSCALE_COMPUTE_ENABLED) && Boolean(nscaleToken(env));
}

export async function crawl(env = process.env, options = {}) {
  if (!nscaleToken(env) && !options.fetcher) return [];
  const organizations = await get_organizations(env, options);
  const selectedOrganizations = organizationsFromEnv(env, organizations);
  const rows = [];
  for (const organization of selectedOrganizations) {
    const regions = await get_regions(organization.id, env, options);
    for (const region of regions) {
      const flavors = await get_flavors(organization.id, region.id, env, options);
      rows.push(...flavors
        .filter(isNscaleGpuFlavor)
        .map((flavor) => nscaleFlavorToInventoryItem(flavor, region, organization, env)));
    }
  }
  return rows;
}

export async function get_organizations(env = process.env, options = {}) {
  if (env.NSCALE_ORGANIZATION_ID || env.NSCALE_ORGANIZATION_IDS) {
    return parseEnvList(env.NSCALE_ORGANIZATION_IDS || env.NSCALE_ORGANIZATION_ID).map((id) => ({ id, name: id }));
  }
  const data = await nscaleJsonFetch(identityBaseUrl(env), "/api/v1/organizations", env, options);
  return pickArray(data, ["data"]).map(nscaleResourceSummary);
}

export async function get_regions(organizationId, env = process.env, options = {}) {
  const data = await nscaleJsonFetch(computeBaseUrl(env), `/api/v1/organizations/${encodeURIComponent(organizationId)}/regions`, env, options);
  return pickArray(data, ["data"]).map(nscaleResourceSummary);
}

export async function get_flavors(organizationId, regionId, env = process.env, options = {}) {
  const data = await nscaleJsonFetch(
    computeBaseUrl(env),
    `/api/v1/organizations/${encodeURIComponent(organizationId)}/regions/${encodeURIComponent(regionId)}/flavors`,
    env,
    options
  );
  return pickArray(data, ["data"]);
}

export function nscaleFlavorToInventoryItem(flavor, region, organization, env = process.env) {
  const spec = flavor.spec || flavor;
  const metadata = flavor.metadata || {};
  const gpu = spec.gpu || spec.accelerator || {};
  const gpuCount = numberOrNull(gpu.physicalCount ?? gpu.physical_count ?? gpu.count ?? gpu.logicalCount) || inferGpuCount(metadata.name || spec.name) || 1;
  const totalHourlyPrice = nscaleHourlyPrice(flavor);
  return createInventoryItem({
    provider: "Nscale",
    providerId: NSCALE_PROVIDER_ID,
    rawOfferId: `${organization.id}:${region.id}:${metadata.id || metadata.name || spec.name}`,
    gpuLabel: buildNscaleGpuLabel(gpu, metadata.name || spec.name, gpuCount),
    gpuCount,
    vramGbEach: numberOrNull(gpu.memory ?? gpu.memoryGb ?? gpu.memory_gb),
    totalHourlyPrice,
    pricePerGpuHour: totalHourlyPrice && gpuCount ? totalHourlyPrice / gpuCount : null,
    region: region.name || region.id,
    formFactor: nscaleFormFactor(flavor),
    interconnect: gpu.interconnect || gpu.socket || metadata.name || spec.name,
    cpu: spec.cpus ? `${spec.cpus} vCPU` : "",
    ramGb: numberOrNull(spec.memory),
    storage: spec.disk ? `${spec.disk} GB` : "",
    localStorage: spec.disk ? `${spec.disk} GB` : "",
    networkBandwidth: nscaleNetworkLabel(spec, region),
    networkFabric: nscaleNetworkFabric(spec, region),
    availability: "available",
    availabilityCount: null,
    checkoutUrl: buildNscaleUrl(flavor, region, organization, env),
    checkoutSemantics: "provider_console",
    sourceMode: "live",
    listingType: "flavor_region",
    availabilitySemantics: "region_offering",
    priceScope: totalHourlyPrice ? "node_total" : "unknown",
    priceSemantics: totalHourlyPrice ? "node_total" : "unknown",
    marketType: "catalog",
    dataNotes: [
      "Accessible compute flavor/region only",
      "No immediate capacity or checkout listing exposed by this API path",
      totalHourlyPrice ? "" : "Price not exposed"
    ].filter(Boolean),
    metadata: compactMetadata({
      table: "nscale_inventory",
      organization,
      region,
      flavorId: metadata.id,
      flavorName: metadata.name,
      creationTime: metadata.creationTime,
      cpuFamily: spec.cpuFamily,
      architecture: spec.architecture,
      rawGpu: gpu
    }),
    specs: {
      provider: {
        organization,
        region,
        flavor
      },
      accelerator: gpu
    },
    rawPayload: {
      organization,
      region,
      flavor
    }
  });
}

export function isNscaleGpuFlavor(flavor) {
  const spec = flavor?.spec || flavor || {};
  const gpu = spec.gpu || spec.accelerator || {};
  if (numberOrNull(gpu.physicalCount ?? gpu.physical_count ?? gpu.count ?? gpu.logicalCount)) return true;
  const text = `${flavor?.metadata?.name || ""} ${spec.name || ""} ${gpu.vendor || ""} ${gpu.model || ""}`;
  return /\b(gpu|h100|h200|a100|l40s|l40|l4|v100|t4|mi300|mi325|b200|b300)\b/i.test(text);
}

async function nscaleJsonFetch(baseUrl, path, env, options = {}) {
  const fetcher = options.fetcher || fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(options.timeoutMs || env.NSCALE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS));
  try {
    const response = await fetcher(new URL(path, baseUrl).toString(), {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${nscaleToken(env) || ""}`,
        ...(options.headers || {})
      }
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Nscale API ${response.status} ${response.statusText}${body ? `: ${truncate(body)}` : ""}`);
    }
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function nscaleToken(env) {
  return env.NSCALE_SERVICE_TOKEN || env.NSCALE_API_TOKEN || env.NSCALE_TOKEN;
}

function falsyEnv(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ["0", "false", "no", "off"].includes(normalized);
}

function organizationsFromEnv(env, organizations) {
  const requested = parseEnvList(env.NSCALE_ORGANIZATION_IDS || env.NSCALE_ORGANIZATION_ID);
  if (!requested.length) return organizations;
  const byId = new Map(organizations.map((organization) => [organization.id, organization]));
  return requested.map((id) => byId.get(id) || { id, name: id });
}

function nscaleResourceSummary(resource) {
  const metadata = resource.metadata || resource;
  return {
    id: metadata.id || resource.id || metadata.name,
    name: metadata.name || resource.name || metadata.id || resource.id,
    description: metadata.description || resource.description,
    spec: resource.spec || {},
    raw: resource
  };
}

function buildNscaleGpuLabel(gpu, flavorName, gpuCount) {
  const model = [gpu.vendor, gpu.model].filter(Boolean).join(" ") || flavorName || "GPU";
  const memory = numberOrNull(gpu.memory ?? gpu.memoryGb ?? gpu.memory_gb);
  return [
    gpuCount && gpuCount > 1 ? `${gpuCount}x` : "",
    model,
    memory ? `${memory}GB` : ""
  ].filter(Boolean).join(" ");
}

function nscaleHourlyPrice(flavor) {
  const spec = flavor?.spec || flavor || {};
  return numberOrNull(
    spec.hourlyPrice
      ?? spec.hourly_price
      ?? spec.pricePerHour
      ?? spec.price_per_hour
      ?? spec.price?.hourly
      ?? spec.pricing?.hourly
      ?? flavor?.hourlyPrice
  );
}

function nscaleFormFactor(flavor) {
  const text = `${flavor?.metadata?.name || ""} ${flavor?.spec?.type || ""}`;
  if (/bare|metal/i.test(text)) return "bare_metal";
  return "vm";
}

function nscaleNetworkLabel(spec, region) {
  const parts = [];
  if (spec.network) parts.push(typeof spec.network === "string" ? spec.network : JSON.stringify(spec.network));
  if (region.spec?.features?.physicalNetworks) parts.push("physical networks");
  return parts.join(" / ");
}

function nscaleNetworkFabric(spec, region) {
  const text = `${JSON.stringify(spec.network || {})} ${JSON.stringify(region.spec?.features || {})}`;
  if (/infiniband|\bib\b|ndr|hdr|edr/i.test(text)) return "InfiniBand";
  if (/rdma/i.test(text)) return "RDMA";
  if (/ethernet|\bgbe\b|gigabit ethernet|nic_eth|eth_|_eth/i.test(text)) return "Ethernet";
  return "Not exposed";
}

function buildNscaleUrl(flavor, region, organization, env) {
  const base = (env.NSCALE_CONSOLE_URL || NSCALE_CONSOLE_URL).replace(/\/$/, "");
  const params = new URLSearchParams();
  if (organization.id) params.set("organization", organization.id);
  if (region.id) params.set("region", region.id);
  const flavorId = flavor.metadata?.id || flavor.metadata?.name || flavor.spec?.name;
  if (flavorId) params.set("flavor", flavorId);
  const query = params.toString();
  return `${base}/compute/instances/new${query ? `?${query}` : ""}`;
}

function identityBaseUrl(env) {
  return (env.NSCALE_IDENTITY_API_BASE_URL || NSCALE_IDENTITY_API_BASE_URL).replace(/\/$/, "");
}

function computeBaseUrl(env) {
  return (env.NSCALE_COMPUTE_API_BASE_URL || env.NSCALE_API_BASE_URL || NSCALE_COMPUTE_API_BASE_URL).replace(/\/$/, "");
}

