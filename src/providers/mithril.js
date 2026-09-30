import { createInventoryItem } from "../core/inventory.js";
import { numberOrNull } from "../core/num.js";
import { compactMetadata, inferGpuCount, pickArray } from "../core/format.js";

export const MITHRIL_PROVIDER_ID = "mithril";

const MITHRIL_API_BASE_URL = "https://api.mithril.ai";
const MITHRIL_CONSOLE_URL = "https://app.mlfoundry.com";
const DEFAULT_TIMEOUT_MS = 12_000;

export function hasMithrilConfiguration(env = process.env) {
  return Boolean(mithrilToken(env));
}

export async function crawl(env = process.env, options = {}) {
  if (!mithrilToken(env) && !options.fetcher) return [];
  const [instanceTypes, availability, projects] = await Promise.all([
    get_instance_types(env, options),
    get_spot_availability(env, options),
    get_projects(env, options).catch(() => [])
  ]);
  return mithrilSpotAvailabilityToItems(availability, instanceTypes, projects, env);
}

export async function get_instance_types(env = process.env, options = {}) {
  return pickArray(await mithrilJsonFetch("/v2/instance-types", env, options), ["data"]);
}

export async function get_spot_availability(env = process.env, options = {}) {
  return pickArray(await mithrilJsonFetch("/v2/spot/availability", env, options), ["data", "availability", "items"]);
}

export async function get_projects(env = process.env, options = {}) {
  return pickArray(await mithrilJsonFetch("/v2/projects", env, options), ["data", "projects"]);
}

export function mithrilSpotAvailabilityToItems(availabilityRows, instanceTypes, projects = [], env = process.env) {
  const typeMap = new Map((instanceTypes || []).map((type) => [type.fid || type.id || type.name, type]));
  const project = projects.find((candidate) => candidate.fid === env.MITHRIL_PROJECT_ID) || projects[0] || null;
  return (availabilityRows || [])
    .filter((row) => numberOrNull(row.capacity) > 0)
    .map((row) => mithrilSpotRowToInventoryItem(row, typeMap.get(row.instance_type) || {}, project, env))
    .filter(Boolean);
}

export function mithrilSpotRowToInventoryItem(row, instanceType = {}, project = null, env = process.env) {
  const gpuCount = numberOrNull(instanceType.num_gpus ?? instanceType.gpu_count ?? row.num_gpus) || inferGpuCount(instanceType.name) || 1;
  const price = parseMoney(row.last_instance_price ?? row.lowest_allocated_price ?? row.spot_price ?? row.price);
  const capacity = numberOrNull(row.capacity);
  const gpuModel = instanceType.gpu_type || row.gpu_type || instanceType.name || row.instance_type;
  const gpuSocket = instanceType.gpu_socket || instanceType.socket || "";
  return createInventoryItem({
    provider: "Mithril",
    providerId: MITHRIL_PROVIDER_ID,
    rawOfferId: `${row.fid || "spot"}:${row.instance_type}:${row.region}`,
    gpuLabel: buildMithrilGpuLabel({
      count: gpuCount,
      model: gpuModel,
      memoryGb: numberOrNull(instanceType.gpu_memory_gb ?? row.gpu_memory_gb),
      socket: gpuSocket
    }),
    gpuCount,
    vramGbEach: numberOrNull(instanceType.gpu_memory_gb ?? row.gpu_memory_gb),
    totalHourlyPrice: price,
    pricePerGpuHour: price && gpuCount ? price / gpuCount : null,
    region: row.region,
    formFactor: "vm",
    interconnect: gpuSocket || instanceType.name,
    cpu: instanceType.num_cpus ? `${instanceType.num_cpus} vCPU` : "",
    ramGb: numberOrNull(instanceType.ram_gb),
    storage: instanceType.local_storage_gb ? `${instanceType.local_storage_gb} GB local` : "",
    localStorage: instanceType.local_storage_gb ? `${instanceType.local_storage_gb} GB` : "",
    networkBandwidth: mithrilNetworkBandwidth(instanceType),
    networkFabric: instanceType.network_type || (numberOrNull(instanceType.ib_count) ? "InfiniBand" : "Not exposed"),
    availability: "available",
    availabilityCount: capacity,
    checkoutUrl: buildMithrilUrl(row, project, env),
    checkoutSemantics: "provider_console",
    orderable: false,
    sourceMode: "live",
    listingType: "spot_auction",
    availabilitySemantics: "sku_capacity",
    priceScope: "spot",
    priceSemantics: "spot",
    marketType: "spot",
    dataNotes: [
      "Spot auction availability",
      "API capacity only; no verified exact checkout listing route",
      row.lowest_allocated_price ? `Lowest allocated price: ${row.lowest_allocated_price}` : "",
      row.adjustable_memory ? "Adjustable memory" : "",
      project?.fid ? `Project detected: ${project.name || project.fid}` : "Select project in provider console/API"
    ].filter(Boolean),
    metadata: compactMetadata({
      table: "mithril_inventory",
      auctionFid: row.fid,
      instanceTypeFid: row.instance_type,
      defaultImageVersion: row.default_image_version,
      adjustableMemory: row.adjustable_memory,
      lowestAllocatedPrice: row.lowest_allocated_price,
      project,
      instanceType
    }),
    specs: {
      provider: {
        auction: row,
        instanceType,
        project
      },
      network: {
        type: instanceType.network_type,
        ibCount: instanceType.ib_count,
        bridgeCount: instanceType.bridge_count
      }
    },
    rawPayload: {
      auction: row,
      instanceType,
      project
    }
  });
}

async function mithrilJsonFetch(path, env, options = {}) {
  const fetcher = options.fetcher || fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(options.timeoutMs || env.MITHRIL_TIMEOUT_MS || DEFAULT_TIMEOUT_MS));
  try {
    const response = await fetcher(new URL(path, apiBaseUrl(env)).toString(), {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${mithrilToken(env) || ""}`,
        ...(options.headers || {})
      }
    });
    if (!response.ok) throw new Error(`Mithril API ${response.status} ${response.statusText}`);
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function mithrilToken(env) {
  return env.MITHRIL_API_KEY || env.MITHRIL_TOKEN;
}

function apiBaseUrl(env) {
  return (env.MITHRIL_API_BASE_URL || MITHRIL_API_BASE_URL).replace(/\/$/, "");
}

function buildMithrilUrl(row, project, env) {
  const base = (env.MITHRIL_CONSOLE_URL || MITHRIL_CONSOLE_URL).replace(/\/$/, "");
  const params = new URLSearchParams();
  if (project?.fid) params.set("project", project.fid);
  if (row.instance_type) params.set("instance_type", row.instance_type);
  if (row.region) params.set("region", row.region);
  if (row.fid) params.set("auction", row.fid);
  const query = params.toString();
  return `${base}/spot${query ? `?${query}` : ""}`;
}

function buildMithrilGpuLabel({ count, model, memoryGb, socket }) {
  return [
    count && count > 1 ? `${count}x` : "",
    String(model || "").replace(/\./g, " "),
    socket,
    memoryGb ? `${memoryGb}GB` : ""
  ].filter(Boolean).join(" ");
}

function mithrilNetworkBandwidth(instanceType) {
  const parts = [];
  if (instanceType.network_type) parts.push(instanceType.network_type);
  if (numberOrNull(instanceType.ib_count)) parts.push(`${instanceType.ib_count} IB NICs`);
  if (numberOrNull(instanceType.bridge_count)) parts.push(`${instanceType.bridge_count} bridges`);
  return parts.join(" / ");
}

function parseMoney(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replace(/[$,\s]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

