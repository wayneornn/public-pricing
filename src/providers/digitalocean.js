import { createInventoryItem } from "../core/inventory.js";
import { numberOrNull, parseMemoryGb } from "../core/num.js";
import { compactMetadata, pickArray } from "../core/format.js";

export const DIGITALOCEAN_PROVIDER_ID = "digitalocean";

const DIGITALOCEAN_API_BASE_URL = "https://api.digitalocean.com";
const DIGITALOCEAN_CONSOLE_URL = "https://cloud.digitalocean.com/droplets/new";
const DEFAULT_TIMEOUT_MS = 12_000;

export function hasDigitalOceanConfiguration(env = process.env) {
  return Boolean(digitalOceanToken(env));
}

export async function crawl(env = process.env, options = {}) {
  if (!digitalOceanToken(env) && !options.fetcher) return [];
  const [sizes, regions] = await Promise.all([
    get_sizes(env, options),
    get_regions(env, options)
  ]);
  return sizes.flatMap((size) => digitalOceanSizeToItems(size, regions, env));
}

export async function get_sizes(env = process.env, options = {}) {
  return digitalOceanPagedFetch("/v2/sizes", "sizes", env, options);
}

export async function get_regions(env = process.env, options = {}) {
  return digitalOceanPagedFetch("/v2/regions", "regions", env, options);
}

export function digitalOceanSizeToItems(size, regions = [], env = process.env) {
  if (!isDigitalOceanGpuSize(size)) return [];
  const gpu = parseDigitalOceanGpu(size);
  const sizeRegions = digitalOceanSizeRegions(size, regions);
  const hourlyPrice = numberOrNull(size.price_hourly ?? size.priceHourly);
  const memoryGb = digitalOceanMemoryGb(size.memory);
  return sizeRegions.map((region) => createInventoryItem({
    provider: "DigitalOcean",
    providerId: DIGITALOCEAN_PROVIDER_ID,
    rawOfferId: `${size.slug || size.id || size.name}:${region.slug || region.name || "unknown"}`,
    gpuLabel: buildDigitalOceanGpuLabel(gpu, size),
    gpuCount: gpu.count,
    vramGbEach: gpu.vramGbEach,
    totalHourlyPrice: hourlyPrice,
    pricePerGpuHour: hourlyPrice && gpu.count ? hourlyPrice / gpu.count : null,
    region: region.name ? `${region.name} (${region.slug})` : region.slug,
    formFactor: "vm",
    interconnect: gpu.interconnect || "",
    cpu: size.vcpus ? `${size.vcpus} vCPU` : "",
    ramGb: memoryGb,
    storage: digitalOceanStorageLabel(size),
    localStorage: digitalOceanStorageLabel(size),
    networkBandwidth: size.transfer ? `${size.transfer} TB transfer` : "",
    networkFabric: "Not exposed",
    availability: region.available === false ? "unavailable" : "available",
    availabilityCount: null,
    checkoutUrl: buildDigitalOceanUrl(size, region, env),
    checkoutSemantics: "provider_console",
    sourceMode: "live",
    listingType: "droplet_size_region",
    availabilitySemantics: "region_offering",
    priceScope: hourlyPrice ? "node_total" : "unknown",
    priceSemantics: hourlyPrice ? "node_total" : "unknown",
    marketType: "catalog",
    dataNotes: [
      "Catalog/region offering only",
      "Live capacity is not exposed by the Sizes API",
      "Do not treat as checkout-grade supply"
    ],
    metadata: compactMetadata({
      table: "digitalocean_inventory",
      slug: size.slug,
      description: size.description,
      sizeClass: size.size_class,
      diskInfo: size.disk_info,
      gpuInfo: size.gpu_info,
      transfer: size.transfer,
      priceMonthly: size.price_monthly,
      region
    }),
    specs: {
      provider: {
        size,
        region
      },
      storage: {
        diskInfo: size.disk_info
      }
    },
    rawPayload: {
      size,
      region
    }
  }));
}

export function isDigitalOceanGpuSize(size) {
  if (size?.gpu_info && typeof size.gpu_info === "object") return true;
  const text = `${size?.slug || ""} ${size?.name || ""} ${size?.description || ""} ${size?.size_class || ""}`;
  return /\b(gpu|h100|h200|a100|l40s|l40|l4|v100|t4|mi300|mi325)\b/i.test(text);
}

export function parseDigitalOceanGpu(size) {
  const info = size?.gpu_info || {};
  const text = `${info.model || ""} ${size?.slug || ""} ${size?.name || ""} ${size?.description || ""}`;
  return {
    count: numberOrNull(info.count) || extractCount(text) || 1,
    model: normalizeGpuModel(info.model || text),
    vramGbEach: parseMemoryGb(info.vram?.amount ?? info.vram_gb ?? info.memory ?? text),
    interconnect: info.interconnect || info.interface || ""
  };
}

function digitalOceanToken(env) {
  return env.DIGITALOCEAN_TOKEN || env.DIGITALOCEAN_API_TOKEN || env.DO_API_TOKEN || env.DIGITALOCEAN_API_KEY;
}

async function digitalOceanPagedFetch(path, arrayKey, env, options = {}) {
  const rows = [];
  let url = new URL(path, apiBaseUrl(env));
  url.searchParams.set("per_page", env.DIGITALOCEAN_PAGE_SIZE || "200");
  for (let page = 0; page < 50 && url; page += 1) {
    const data = await digitalOceanJsonFetch(url.toString(), env, options);
    rows.push(...pickArray(data, [arrayKey, "data"]));
    const next = data.links?.pages?.next;
    url = next ? new URL(next) : null;
  }
  return rows;
}

async function digitalOceanJsonFetch(url, env, options = {}) {
  const fetcher = options.fetcher || fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(options.timeoutMs || env.DIGITALOCEAN_TIMEOUT_MS || DEFAULT_TIMEOUT_MS));
  try {
    const response = await fetcher(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${digitalOceanToken(env) || ""}`,
        ...(options.headers || {})
      }
    });
    if (!response.ok) throw new Error(`DigitalOcean API ${response.status} ${response.statusText}`);
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function digitalOceanSizeRegions(size, regions) {
  const bySlug = new Map((regions || []).map((region) => [region.slug || region.name, region]));
  const fromSize = Array.isArray(size.regions) ? size.regions : [];
  if (fromSize.length) {
    return fromSize.map((slug) => bySlug.get(slug) || { slug, name: slug, available: true });
  }
  return (regions || []).filter((region) => Array.isArray(region.sizes) && region.sizes.includes(size.slug));
}

function buildDigitalOceanGpuLabel(gpu, size) {
  const parts = [];
  if (gpu.count && gpu.count > 1) parts.push(`${gpu.count}x`);
  parts.push(gpu.model || normalizeGpuModel(size.slug || size.name || "GPU"));
  if (gpu.vramGbEach) parts.push(`${gpu.vramGbEach}GB`);
  return parts.filter(Boolean).join(" ");
}

function buildDigitalOceanUrl(size, region, env) {
  const base = env.DIGITALOCEAN_CONSOLE_URL || DIGITALOCEAN_CONSOLE_URL;
  const params = new URLSearchParams();
  if (size.slug) params.set("size", size.slug);
  if (region.slug) params.set("region", region.slug);
  const query = params.toString();
  return `${base}${query ? `?${query}` : ""}`;
}

function digitalOceanMemoryGb(value) {
  const memory = numberOrNull(value);
  if (!memory) return null;
  return memory > 512 ? Math.round((memory / 1024) * 100) / 100 : memory;
}

function digitalOceanStorageLabel(size) {
  const diskInfo = Array.isArray(size.disk_info) ? size.disk_info : [];
  if (diskInfo.length) {
    return diskInfo
      .map((disk) => `${disk.size?.amount || disk.amount || ""}${String(disk.size?.unit || disk.unit || "GB").toUpperCase()} ${disk.type || "disk"}`.trim())
      .filter(Boolean)
      .join(" + ");
  }
  return size.disk ? `${size.disk} GB` : "";
}

function normalizeGpuModel(value) {
  const text = String(value || "").replace(/^nvidia[_ -]?/i, "").replace(/[_-]+/g, " ").trim();
  const match = text.match(/\b(B300|B200|H200|H100|A100|L40S|L40|L4|V100|T4|MI325X|MI300X|MI250)\b/i);
  if (match) return match[1].toUpperCase();
  return text || "GPU";
}

function extractCount(text) {
  const match = String(text || "").match(/\b(\d+)\s*x\b|\bx\s*(\d+)\b/i);
  return numberOrNull(match?.[1] || match?.[2]);
}

function apiBaseUrl(env) {
  return (env.DIGITALOCEAN_API_BASE_URL || DIGITALOCEAN_API_BASE_URL).replace(/\/$/, "");
}
