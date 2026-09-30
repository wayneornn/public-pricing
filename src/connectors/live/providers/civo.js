import { createInventoryItem } from "../../../core/inventory.js";
import { jsonFetch, pickArray } from "../http.js";
import { buildGpuLabel, compactMetadata, fabricDataNote, numberOrNull, round } from "../format.js";

// Civo exposes a GPU instance/Kubernetes catalog via GET /v2/sizes, and which regions
// can actually run GPUs via GET /v2/regions (features.gpu). Verified against the live
// API: GPU sizes carry gpu_count + gpu_type (e.g. "nvidia.com/AD102GL_L40S") but the
// sizes endpoint exposes NO price, and /v2/charges is account usage, not a price
// catalog. So Civo rows are emitted as an unpriced region offering — we never invent a
// price. Auth is `Authorization: bearer <key>` (Civo uses lowercase "bearer").
const CIVO_API_BASE_URL = "https://api.civo.com/v2";

export const civoConnector = {
  id: "civo",
  name: "Civo",
  envVars: ["CIVO_API_KEY", "CIVO_TOKEN"],
  async fetch(env) {
    const key = env.CIVO_API_KEY || env.CIVO_TOKEN;
    if (!key) return [];
    const base = (env.CIVO_API_BASE_URL || CIVO_API_BASE_URL).replace(/\/$/, "");
    const headers = {
      Authorization: `bearer ${key}`,
      Accept: "application/json"
    };
    const timeoutMs = Number(env.CIVO_TIMEOUT_MS || 30_000);
    const [sizes, regions] = await Promise.all([
      jsonFetch(`${base}/sizes`, { headers, timeoutMs }),
      jsonFetch(`${base}/regions`, { headers, timeoutMs })
    ]);
    return civoSizesToItems(pickArray(sizes, ["items", "data"]), pickArray(regions, ["items", "data"]), env);
  }
};

export function civoSizesToItems(sizes = [], regions = [], env = {}) {
  const gpuRegions = (regions || []).filter((region) => region?.features?.gpu === true);
  const gpuSizes = (sizes || []).filter(civoIsGpuSize);
  const items = [];
  for (const size of gpuSizes) {
    if (gpuRegions.length) {
      for (const region of gpuRegions) items.push(civoSizeToItem(size, region, env));
    } else {
      // GPU SKU exists in the catalog but no region currently advertises GPU capacity.
      items.push(civoSizeToItem(size, null, env));
    }
  }
  return items.filter(Boolean);
}

function civoSizeToItem(size, region, env = {}) {
  const gpuCount = Number(size.gpu_count) || 0;
  if (!gpuCount) return null;
  const model = civoGpuModel(size.gpu_type, size.nice_name, size.name);
  const vramGbEach = civoVramGb(size.nice_name);
  const ramGb = numberOrNull(size.ram_mb) ? round(Number(size.ram_mb) / 1024, 0) : null;
  const isKube = /kube/i.test(size.name || "") || String(size.type || "").toLowerCase() === "kubernetes";
  const regionCode = region?.code || "";
  const available = region ? region.out_of_capacity !== true && size.selectable !== false : false;
  const gpuLabel = buildGpuLabel({ count: gpuCount, model, vramGb: vramGbEach });

  return createInventoryItem({
    provider: "Civo",
    providerId: "civo",
    rawOfferId: `${size.name}${regionCode ? `:${regionCode}` : ""}`,
    gpuLabel,
    gpuCount,
    vramGbEach,
    region: regionCode || "Civo",
    country: region?.country ? String(region.country).toUpperCase() : "",
    formFactor: isKube ? "container" : "vm",
    interconnect: gpuCount > 1 ? "NVLink" : "PCIe",
    cpu: size.cpu_cores ? `${size.cpu_cores} vCPU` : "",
    ramGb,
    storage: size.disk_gb ? `${size.disk_gb} GB` : "",
    networkBandwidth: size.transfer_tb ? `${size.transfer_tb} TB transfer` : "",
    networkFabric: "Not exposed",
    currency: "USD",
    availability: region ? (available ? "available" : "unavailable") : "unknown",
    availabilityCount: null,
    checkoutUrl: civoCheckoutUrl(size, regionCode, isKube),
    sourceMode: "live",
    listingType: isKube ? "kubernetes_node_size" : "instance_size",
    priceScope: "unpriced_capacity",
    priceSemantics: "unpriced",
    availabilitySemantics: "region_offering",
    dataNotes: [
      "Civo /v2/sizes catalog — API does not expose price (see civo.com/pricing)",
      region ? `Region ${regionCode} advertises GPU capacity` : "No Civo region currently advertises GPU capacity",
      isKube ? "Kubernetes node-pool size" : "VM instance size",
      fabricDataNote("Not exposed", gpuLabel, gpuCount)
    ].filter(Boolean),
    metadata: compactMetadata({
      sizeName: size.name,
      niceName: size.nice_name,
      type: size.type,
      gpuType: size.gpu_type,
      gpuCount: size.gpu_count,
      cpuCores: size.cpu_cores,
      ramMb: size.ram_mb,
      diskGb: size.disk_gb,
      transferTb: size.transfer_tb,
      selectable: size.selectable,
      region: regionCode,
      regionCountry: region?.country,
      regionOutOfCapacity: region?.out_of_capacity
    }),
    rawPayload: { ...size, _region: region || null }
  });
}

function civoIsGpuSize(size = {}) {
  return Number(size.gpu_count) > 0
    || /gpu/i.test(String(size.gpu_type || ""))
    || /\bgpu\b|l40s|h100|h200|a100|b200/i.test(String(size.name || ""));
}

function civoGpuModel(gpuType = "", niceName = "", name = "") {
  const text = `${gpuType} ${niceName} ${name}`;
  if (/h200/i.test(text)) return "H200";
  if (/h100/i.test(text)) return "H100";
  if (/b200/i.test(text)) return "B200";
  if (/a100/i.test(text)) return "A100";
  if (/l40s/i.test(text)) return "L40S";
  if (/l40/i.test(text)) return "L40";
  if (/a40/i.test(text)) return "A40";
  // gpu_type is shaped like "nvidia.com/AD102GL_L40S"; fall back to the trailing token.
  const token = String(gpuType).split(/[/_]/).filter(Boolean).pop();
  return token || "GPU";
}

function civoVramGb(niceName = "") {
  const match = String(niceName).match(/(\d{2,3})\s*GB/i);
  return match ? Number(match[1]) : null;
}

function civoCheckoutUrl(size, regionCode, isKube) {
  const base = "https://dashboard.civo.com";
  const path = isKube ? "/kubernetes/new" : "/instances/create";
  const params = new URLSearchParams();
  if (size.name) params.set("size", size.name);
  if (regionCode) params.set("region", regionCode);
  const query = params.toString();
  return `${base}${path}${query ? `?${query}` : ""}`;
}
