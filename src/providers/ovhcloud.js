import { createHash } from "node:crypto";
import { createInventoryItem } from "../core/inventory.js";
import { numberOrNull, parseMemoryGb, round } from "../core/num.js";
import { compactMetadata, parseEnvList, pickArray, truncate } from "../core/format.js";

export const OVHCLOUD_PROVIDER_ID = "ovhcloud";

const OVH_API_BASE_URL = "https://eu.api.ovh.com/1.0";
const OVH_CONSOLE_URL = "https://www.ovh.com/manager/#/public-cloud";
const DEFAULT_TIMEOUT_MS = 12_000;

export function hasOvhCloudConfiguration(env = process.env) {
  return Boolean(ovhApplicationKey(env) && ovhApplicationSecret(env) && ovhConsumerKey(env));
}

export async function crawl(env = process.env, options = {}) {
  if (!hasOvhCloudConfiguration(env) && !options.fetcher) return [];
  const projects = await get_projects(env, options);
  const projectIds = normalizeProjectIds(projects, env);
  const projectFlavors = await Promise.all(projectIds.map(async (projectId) => ({
    projectId,
    flavors: await get_flavors(projectId, env, options)
  })));
  return projectFlavors.flatMap(({ projectId, flavors }) => ovhCloudFlavorsToItems(flavors, projectId, env));
}

export async function get_projects(env = process.env, options = {}) {
  const configured = configuredProjectIds(env);
  if (configured.length) return configured;
  return pickArray(await ovhJsonFetch("/cloud/project", env, options), ["data", "projects"]);
}

export async function get_flavors(projectId, env = process.env, options = {}) {
  if (!projectId) return [];
  return pickArray(await ovhJsonFetch(`/cloud/project/${encodeURIComponent(projectId)}/flavor`, env, options), ["data", "flavors"]);
}

export function ovhCloudFlavorsToItems(flavors, projectId, env = process.env) {
  return (flavors || [])
    .filter(isOvhCloudGpuFlavor)
    .map((flavor) => ovhCloudFlavorToInventoryItem(flavor, projectId, env));
}

export function ovhCloudFlavorToInventoryItem(flavor, projectId, env = process.env) {
  const gpu = parseOvhCloudGpu(flavor);
  const price = parseOvhCloudPrice(flavor.hourly ?? flavor.price ?? flavor.hourlyPrice);
  const region = flavor.region || flavor.regionName || flavor.location || "Unknown";
  const flavorName = flavor.name || flavor.technicalName || flavor.id || "gpu-flavor";
  const available = flavor.available === true || String(flavor.available || "").toLowerCase() === "true";
  const bandwidth = ovhBandwidthLabel(flavor.bandwidth ?? flavor.network ?? flavor.networkPerformance);
  const ramGb = memoryGb(flavor.ram ?? flavor.memory ?? flavor.memory_mb);
  const diskGb = numberOrNull(flavor.disk ?? flavor.disk_gb ?? flavor.rootDisk);
  return createInventoryItem({
    provider: "OVHcloud",
    providerId: OVHCLOUD_PROVIDER_ID,
    rawOfferId: `${projectId}:${region}:${flavorName}`,
    gpuLabel: buildOvhGpuLabel(gpu, flavorName),
    gpuVariant: ovhGpuVariant(flavor),
    gpuCount: gpu.count,
    vramGbEach: gpu.vramGbEach,
    totalHourlyPrice: price.amount,
    pricePerGpuHour: price.amount && gpu.count ? price.amount / gpu.count : null,
    region,
    formFactor: "vm",
    interconnect: gpu.interconnect || "PCIe",
    cpu: flavor.vcpus ? `${flavor.vcpus} vCPU` : "",
    ramGb,
    storage: diskGb ? `${diskGb} GB root` : "",
    localStorage: diskGb ? `${diskGb} GB root` : "",
    networkBandwidth: bandwidth,
    networkFabric: bandwidth || "Not exposed",
    availability: available ? "available" : "unavailable",
    availabilityCount: available ? 1 : 0,
    currency: price.currency || env.OVH_CURRENCY || "EUR",
    checkoutUrl: buildOvhConsoleUrl(projectId, flavor, env),
    checkoutSemantics: "provider_console",
    orderable: false,
    sourceMode: "live",
    listingType: "public_cloud_flavor",
    availabilitySemantics: "region_offering",
    priceScope: price.amount ? "node_total" : "unknown",
    priceSemantics: price.amount ? "node_total" : "unknown",
    marketType: "catalog",
    dataNotes: [
      "Public Cloud flavor catalog",
      "OVH flavor available flag is not exact live checkout capacity",
      "Do not treat as checkout-grade supply",
      gpu.inferred ? "GPU model inferred from OVH flavor family" : "",
      bandwidth ? "" : "Network fabric not exposed by flavor API"
    ].filter(Boolean),
    metadata: compactMetadata({
      table: "ovhcloud_inventory",
      projectId,
      flavorName,
      technicalName: flavor.technicalName,
      type: flavor.type,
      region,
      available: flavor.available,
      hourly: flavor.hourly,
      monthly: flavor.monthly,
      planCodes: flavor.planCodes,
      quota: flavor.quota,
      rawGpu: flavor.gpu
    }),
    specs: {
      provider: {
        projectId,
        flavor
      },
      network: {
        bandwidth: flavor.bandwidth,
        network: flavor.network,
        networkPerformance: flavor.networkPerformance
      },
      pricing: {
        hourly: flavor.hourly,
        monthly: flavor.monthly,
        planCodes: flavor.planCodes
      }
    },
    rawPayload: {
      projectId,
      flavor
    }
  });
}

export function isOvhCloudGpuFlavor(flavor) {
  if (!flavor || typeof flavor !== "object") return false;
  if (numberOrNull(gpuCountField(flavor)) > 0) return true;
  const text = ovhFlavorText(flavor);
  return /\b(gpu|h100|h200|a100|l40s|l40|l4|v100s?|rtx\s?5000|t1[-.]|t2[-.])\b/i.test(text);
}

export function parseOvhCloudGpu(flavor) {
  const text = ovhFlavorText(flavor);
  const count = numberOrNull(gpuCountField(flavor)) || extractExplicitGpuCount(text) || 1;
  const mapped = mapOvhFlavorFamily(text);
  const explicitModel = normalizeGpuModel(text);
  const vramGbEach = parseMemoryGb(flavor.gpu?.memory ?? flavor.gpu_memory_gb ?? text) || mapped.vramGbEach || null;
  return {
    count,
    model: explicitModel || mapped.model || "GPU",
    vramGbEach,
    interconnect: inferOvhInterconnect(text),
    inferred: !explicitModel && Boolean(mapped.model)
  };
}

export function parseOvhCloudPrice(value) {
  if (value === null || value === undefined || value === "") return { amount: null, currency: null };
  if (typeof value === "number") return { amount: numberOrNull(value), currency: null };
  if (typeof value === "string") return parsePriceString(value);
  if (typeof value === "object") {
    const nested = value.value ?? value.price ?? value.amount ?? value.text ?? value.display ?? value.hourly;
    const parsed = parseOvhCloudPrice(nested);
    return {
      amount: parsed.amount,
      currency: value.currencyCode || value.currency || parsed.currency || null
    };
  }
  return { amount: null, currency: null };
}

export function buildOvhSignature({ applicationSecret, consumerKey, method, url, body = "", timestamp }) {
  const payload = [applicationSecret, consumerKey, method.toUpperCase(), url, body, timestamp].join("+");
  return `$1$${createHash("sha1").update(payload).digest("hex")}`;
}

async function ovhJsonFetch(path, env, options = {}) {
  const method = options.method || "GET";
  const body = options.body || "";
  const url = buildOvhUrl(path, env);
  const timestamp = String(options.timestamp || await ovhTimestamp(env, options));
  const fetcher = options.fetcher || fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(options.timeoutMs || env.OVH_TIMEOUT_MS || DEFAULT_TIMEOUT_MS));
  try {
    const response = await fetcher(url, {
      method,
      body: body || undefined,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Ovh-Application": ovhApplicationKey(env) || "",
        "X-Ovh-Consumer": ovhConsumerKey(env) || "",
        "X-Ovh-Timestamp": timestamp,
        "X-Ovh-Signature": buildOvhSignature({
          applicationSecret: ovhApplicationSecret(env) || "",
          consumerKey: ovhConsumerKey(env) || "",
          method,
          url,
          body,
          timestamp
        }),
        ...(options.headers || {})
      }
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`OVHcloud API ${response.status} ${response.statusText}${text ? `: ${truncate(text)}` : ""}`);
    return text ? JSON.parse(text) : null;
  } finally {
    clearTimeout(timeout);
  }
}

async function ovhTimestamp(env, options = {}) {
  if (options.timestamp) return options.timestamp;
  if (env.OVH_API_TIMESTAMP) return env.OVH_API_TIMESTAMP;
  const fetcher = options.fetcher || fetch;
  const response = await fetcher(buildOvhUrl("/auth/time", env), { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`OVHcloud time API ${response.status} ${response.statusText}`);
  const text = await response.text();
  return JSON.parse(text);
}

function normalizeProjectIds(projects, env) {
  const configured = configuredProjectIds(env);
  const source = configured.length ? configured : pickArray(projects, ["data", "projects"]);
  return source
    .map((project) => {
      if (typeof project === "string") return project;
      return project.serviceName || project.projectId || project.id || project.name;
    })
    .filter(Boolean);
}

function configuredProjectIds(env) {
  return parseEnvList(
    env.OVH_PUBLIC_CLOUD_PROJECT_IDS
      || env.OVH_PUBLIC_CLOUD_PROJECT_ID
      || env.OVH_CLOUD_PROJECT_IDS
      || env.OVH_CLOUD_PROJECT_ID
      || env.OVH_PROJECT_IDS
      || env.OVH_PROJECT_ID
  );
}

function buildOvhUrl(path, env) {
  const base = (env.OVH_API_BASE_URL || OVH_API_BASE_URL).replace(/\/$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

function buildOvhConsoleUrl(projectId, flavor, env) {
  const base = (env.OVH_CONSOLE_URL || OVH_CONSOLE_URL).replace(/\/$/, "");
  const params = new URLSearchParams();
  if (projectId) params.set("project", projectId);
  if (flavor?.name) params.set("flavor", flavor.name);
  if (flavor?.region) params.set("region", flavor.region);
  const query = params.toString();
  return `${base}${query ? `?${query}` : ""}`;
}

function ovhApplicationKey(env) {
  return env.OVH_APPLICATION_KEY || env.OVH_APP_KEY;
}

function ovhApplicationSecret(env) {
  return env.OVH_APPLICATION_SECRET || env.OVH_APP_SECRET;
}

function ovhConsumerKey(env) {
  return env.OVH_CONSUMER_KEY;
}

function gpuCountField(flavor) {
  if (flavor?.gpu && typeof flavor.gpu === "object") return flavor.gpu.count ?? flavor.gpu.number ?? flavor.gpu.quantity;
  return flavor?.gpu ?? flavor?.gpus ?? flavor?.gpuCount ?? flavor?.gpu_count;
}

function ovhFlavorText(flavor) {
  const planCodes = flavor?.planCodes && typeof flavor.planCodes === "object"
    ? Object.values(flavor.planCodes).join(" ")
    : "";
  const gpuObject = flavor?.gpu && typeof flavor.gpu === "object" ? Object.values(flavor.gpu).join(" ") : "";
  return [
    flavor?.name,
    flavor?.technicalName,
    flavor?.id,
    flavor?.type,
    flavor?.description,
    flavor?.osType,
    planCodes,
    gpuObject
  ].filter(Boolean).join(" ");
}

function buildOvhGpuLabel(gpu, flavorName) {
  return [
    gpu.count && gpu.count > 1 ? `${gpu.count}x` : "",
    gpu.model,
    gpu.vramGbEach ? `${gpu.vramGbEach}GB` : "",
    flavorName
  ].filter(Boolean).join(" ");
}

function normalizeGpuModel(text) {
  const normalized = String(text || "").replace(/[_-]+/g, " ");
  const match = normalized.match(/\b(GB300|GB200|B300|B200|H200|H100|A100|L40S|L40|L4|V100S?|RTX\s?5000)\b/i);
  if (!match) return "";
  const model = match[1].replace(/\s+/g, " ").toUpperCase();
  return model === "V100S" ? "V100" : model;
}

function mapOvhFlavorFamily(text) {
  const name = String(text || "").toLowerCase();
  if (/\bt1(?:-|\b)/.test(name)) return { model: "V100", vramGbEach: 16 };
  if (/\bt2(?:-|\b)/.test(name)) return { model: "V100", vramGbEach: 32 };
  if (/\brtx\s?5000/.test(name)) return { model: "RTX 5000", vramGbEach: 16 };
  return { model: "", vramGbEach: null };
}

function inferOvhInterconnect(text) {
  if (/sxm|hgx|nvlink/i.test(text)) return "NVLink";
  if (/infiniband|\bib\b|rdma/i.test(text)) return "InfiniBand";
  return "PCIe";
}

function ovhGpuVariant(flavor) {
  const text = ovhFlavorText(flavor);
  if (/sxm|hgx/i.test(text)) return "SXM";
  if (/pcie|pci-e|pci_passthrough/i.test(text)) return "PCIe";
  return "";
}

function ovhBandwidthLabel(value) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "object") return Object.values(value).filter(Boolean).join(" / ");
  const numeric = numberOrNull(value);
  if (numeric) return numeric >= 1000 ? `${numeric / 1000} Gbps` : `${numeric} Mbps`;
  return String(value);
}

function parsePriceString(value) {
  const text = String(value || "");
  const match = text.match(/(\d+(?:[.,]\d+)?)/);
  const amount = match ? Number(match[1].replace(",", ".")) : null;
  let currency = null;
  if (/€|eur/i.test(text)) currency = "EUR";
  if (/\$|usd/i.test(text)) currency = "USD";
  const code = text.match(/\b([A-Z]{3})\b/);
  if (code) currency = code[1];
  return { amount: numberOrNull(amount), currency };
}

function memoryGb(value) {
  const parsed = numberOrNull(value);
  if (!parsed) return null;
  return parsed > 512 ? round(parsed / 1024, 2) : parsed;
}

function extractExplicitGpuCount(text) {
  const match = String(text || "").match(/\b(\d+)\s*x\s*(?:nvidia\s*)?(?:h100|h200|a100|l40s|l40|l4|v100s?|rtx|gpu)\b/i);
  return numberOrNull(match?.[1]);
}

