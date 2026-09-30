import { createInventoryItem } from "../core/inventory.js";
import { numberOrNull, parseMemoryGb, round } from "../core/num.js";
import { compactMetadata } from "../core/format.js";

export const LATITUDE_PROVIDER_ID = "latitude";
const LATITUDE_API_BASE_URL = "https://api.latitude.sh";
const DEFAULT_TIMEOUT_MS = 12_000;

export function hasLatitudeConfiguration(env = process.env) {
  return Boolean(latitudeApiKey(env));
}

export async function crawl(env = process.env, options = {}) {
  const key = latitudeApiKey(env);
  if (!key) return [];
  const [plans, regions] = await Promise.all([
    get_plans(env, options),
    get_regions(env, options)
  ]);
  const regionMap = latitudeRegionsToMap(regions);
  return plans.flatMap((plan) => latitudePlanToItems(plan, regionMap, env));
}

export async function get_plans(env = process.env, options = {}) {
  const key = latitudeApiKey(env);
  if (!key && !options.fetcher) return [];
  return latitudePagedFetch("/plans", env, {
    ...options,
    query: {
      "filter[gpu]": "true",
      ...(options.query || {})
    }
  });
}

export async function get_regions(env = process.env, options = {}) {
  const key = latitudeApiKey(env);
  if (!key && !options.fetcher) return [];
  return latitudePagedFetch("/regions", env, options);
}

export function latitudePlanToItems(plan, regionMap = new Map(), env = process.env) {
  const metadata = parseLatitudePlanMetadata(plan);
  if (!metadata || metadata.gpu_count <= 0) return [];

  return metadata.regions.flatMap((region) => {
    const availableLocations = uniqueList(region.locations?.available || region.deploys_instantly || []);
    const inStockLocations = uniqueList(region.locations?.in_stock || []);
    const deploysInstantly = uniqueList(region.deploys_instantly || []);
    const locations = availableLocations.length ? availableLocations : inStockLocations;
    return locations.map((location) => {
      const regionInfo = regionMap.get(location) || {};
      const price = latitudeHourlyPrice(region, env.LATITUDE_CURRENCY || "USD");
      const inStock = inStockLocations.length ? inStockLocations.includes(location) : region.stock_level !== "unavailable";
      return createInventoryItem({
        provider: "Latitude.sh",
        providerId: LATITUDE_PROVIDER_ID,
        rawOfferId: `${metadata.slug}:${location}`,
        gpuLabel: buildLatitudeGpuLabel(metadata),
        gpuCount: metadata.gpu_count,
        vramGbEach: metadata.gpu_memory_gb,
        pricePerGpuHour: price && metadata.gpu_count ? price / metadata.gpu_count : null,
        totalHourlyPrice: price,
        region: [regionInfo.name || region.name, location].filter(Boolean).join(" / ") || location,
        country: regionInfo.country || "",
        formFactor: "bare_metal",
        interconnect: metadata.gpu_interconnect || metadata.name,
        cpu: latitudeCpuLabel(metadata.cpu),
        ramGb: metadata.ram_gb,
        storage: latitudeStorageLabel(metadata.drives),
        networkBandwidth: latitudeNetworkLabel(metadata.nics),
        networkFabric: latitudeNetworkFabric(metadata.nics),
        availability: inStock ? "available" : "unavailable",
        availabilityCount: null,
        checkoutUrl: buildLatitudeUrl(metadata.slug, location, env),
        checkoutSemantics: "manual_provider",
        sourceMode: "live",
        listingType: "plan_location",
        priceScope: price ? "node_total" : "unknown",
        availabilitySemantics: "sku_capacity",
        dataNotes: [
          region.stock_level ? `Stock: ${region.stock_level}` : "",
          deploysInstantly.includes(location) ? "Deploys instantly" : "",
          latitudeFabricDataNote(latitudeNetworkFabric(metadata.nics), metadata),
          price ? "" : "Price not returned"
        ].filter(Boolean),
        metadata: compactMetadata({
          table: "latitude_inventory",
          planId: metadata.id,
          slug: metadata.slug,
          name: metadata.name,
          features: metadata.features,
          location,
          region: region.name,
          regionInfo,
          stockLevel: region.stock_level,
          deploysInstantly: deploysInstantly.includes(location),
          pricing: region.pricing,
          specs: metadata.specs
        }),
        rawPayload: {
          plan,
          region,
          location
        }
      });
    });
  });
}

export function parseLatitudePlanMetadata(plan) {
  const attributes = plan.attributes || plan;
  const specs = attributes.specs || {};
  const gpu = specs.gpu || attributes.gpu || {};
  const gpuCount = numberOrNull(gpu.count ?? attributes.gpu_count);
  const gpuType = gpu.type || attributes.gpu_type || "";
  if (!gpuCount && !gpuType) return null;
  return {
    id: plan.id || attributes.id || attributes.slug,
    slug: attributes.slug || plan.id || attributes.name,
    name: attributes.name || attributes.slug || plan.id,
    features: Array.isArray(attributes.features) ? attributes.features : [],
    specs,
    gpu_count: gpuCount || 1,
    gpu_model: gpuType || attributes.name || attributes.slug,
    gpu_memory_gb: parseMemoryGb(gpu.vram_per_gpu ?? gpu.vramPerGpu ?? attributes.vram_per_gpu),
    gpu_interconnect: gpu.interconnect || "",
    cpu: specs.cpu || {},
    ram_gb: parseMemoryGb(specs.memory?.total ?? attributes.memory_gb),
    drives: Array.isArray(specs.drives) ? specs.drives : [],
    nics: Array.isArray(specs.nics) ? specs.nics : [],
    regions: Array.isArray(attributes.regions) ? attributes.regions : []
  };
}

export function latitudeRegionsToMap(regions) {
  const map = new Map();
  for (const raw of regions || []) {
    const attributes = raw.attributes || raw;
    const codes = uniqueList([
      attributes.slug,
      attributes.code,
      attributes.facility,
      attributes.name,
      raw.id
    ]);
    for (const code of codes) {
      map.set(code, {
        id: raw.id,
        name: attributes.name,
        slug: attributes.slug,
        facility: attributes.facility,
        country: attributes.country?.name || attributes.country,
        type: attributes.type
      });
    }
  }
  return map;
}

export function latitudeHourlyPrice(region, currency = "USD") {
  const pricing = region?.pricing || {};
  const currencyPricing = pricing[currency] || pricing[String(currency).toUpperCase()] || pricing.USD || {};
  const hourly = numberOrNull(currencyPricing.hour);
  if (hourly) return hourly;
  const monthly = numberOrNull(currencyPricing.month);
  if (monthly) return round(monthly / 730, 4);
  const yearly = numberOrNull(currencyPricing.year);
  return yearly ? round(yearly / 8760, 4) : null;
}

async function latitudePagedFetch(path, env, options = {}) {
  const pageSize = Number(options.pageSize || env.LATITUDE_PAGE_SIZE || 100);
  const rows = [];
  for (let page = 1; page <= Number(options.maxPages || 50); page += 1) {
    const url = new URL(`${(env.LATITUDE_API_BASE_URL || LATITUDE_API_BASE_URL).replace(/\/$/, "")}${path}`);
    url.searchParams.set("page[size]", String(pageSize));
    url.searchParams.set("page[number]", String(page));
    for (const [key, value] of Object.entries(options.query || {})) {
      if (value !== null && value !== undefined && value !== "") url.searchParams.set(key, String(value));
    }
    const data = await latitudeJsonFetch(url.toString(), env, options);
    const pageRows = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    rows.push(...pageRows);
    if (pageRows.length < pageSize || !hasNextLatitudePage(data, page)) break;
  }
  return rows;
}

async function latitudeJsonFetch(url, env, options = {}) {
  if (options.fetcher) return options.fetcher(url);
  const key = latitudeApiKey(env);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(options.timeoutMs || env.LATITUDE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS));
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/vnd.api+json, application/json",
        Authorization: `Bearer ${key}`
      }
    });
    if (!response.ok) throw new Error(`Latitude.sh ${response.status} ${response.statusText}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function hasNextLatitudePage(data, currentPage) {
  if (data?.links?.next) return true;
  const meta = data?.meta || {};
  const totalPages = Number(meta.total_pages || meta.totalPages || meta.pagination?.total_pages || meta.pagination?.totalPages);
  if (Number.isFinite(totalPages) && totalPages > 0) return currentPage < totalPages;
  return true;
}

function latitudeApiKey(env) {
  return env.LATITUDE_API_KEY || env.LATITUDESH_BEARER || "";
}

function buildLatitudeGpuLabel(metadata) {
  return [
    metadata.gpu_count ? `${metadata.gpu_count}x` : "",
    normalizeGpuModelText(metadata.gpu_model),
    metadata.gpu_memory_gb ? `${Math.round(Number(metadata.gpu_memory_gb))}GB` : "",
    metadata.gpu_interconnect || ""
  ].filter(Boolean).join(" ");
}

function latitudeCpuLabel(cpu) {
  const totalCores = numberOrNull(cpu.cores) && numberOrNull(cpu.count)
    ? Number(cpu.cores) * Number(cpu.count)
    : numberOrNull(cpu.cores);
  return [
    totalCores ? `${totalCores} cores` : "",
    cpu.type || "",
    cpu.clock ? `${cpu.clock} GHz` : ""
  ].filter(Boolean).join(" ");
}

function latitudeStorageLabel(drives) {
  return (drives || []).map((drive) => [
    drive.count ? `${drive.count}x` : "",
    drive.size || "",
    drive.type || ""
  ].filter(Boolean).join(" ")).filter(Boolean).join(", ");
}

function latitudeNetworkLabel(nics) {
  return (nics || []).map((nic) => [
    nic.count ? `${nic.count}x` : "",
    nic.type || ""
  ].filter(Boolean).join(" ")).filter(Boolean).join(", ");
}

function latitudeNetworkFabric(nics) {
  const text = JSON.stringify(nics || []);
  if (/\binfiniband\b|\bib\b|ndr|hdr|edr/i.test(text)) return "InfiniBand";
  if (/\brdma\b/i.test(text)) return "RDMA";
  if (/\broce\b/i.test(text)) return "RoCE";
  if (/\befa\b/i.test(text)) return "EFA";
  if (/ethernet|\bgbe\b|gigabit ethernet|nic_eth|eth_|_eth/i.test(text)) return "Ethernet";
  return "Not exposed";
}

function latitudeFabricDataNote(fabric, metadata) {
  const highEnd = Number(metadata.gpu_count || 0) >= 2 && /\b(?:GB300|GB200|B300|B200|H200|H100|A100)\b/i.test(metadata.gpu_model || metadata.name || "");
  return highEnd && /not exposed|unknown/i.test(fabric) ? "No IB/RDMA fabric listed by provider API" : "";
}

function buildLatitudeUrl(slug, location, env) {
  const base = env.LATITUDE_DEPLOY_URL || "https://metal.new";
  const params = new URLSearchParams();
  if (slug) params.set("plan", slug);
  if (location) params.set("location", location);
  const query = params.toString();
  return `${base}${query ? `?${query}` : ""}`;
}

function normalizeGpuModelText(value) {
  return String(value || "")
    .replace(/^nvidia[-_\s]*/i, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueList(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean))];
}

