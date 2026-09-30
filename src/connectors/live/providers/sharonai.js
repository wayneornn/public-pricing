import { createInventoryItem } from "../../../core/inventory.js";
import { jsonFetch } from "../http.js";
import { buildGpuLabel, compactMetadata, fabricDataNote, numberOrNull, round } from "../format.js";

// Sharon AI (sharonai.cloud) — enterprise accelerated-compute platform built on the
// Rafay PaaS control plane (apiVersion paas.envmgmt.io/v1). The developer surface lives
// on the .cloud TLD (docs.sharonai.cloud); the marketing site sharonai.com has no API.
//
// We read the system catalog of compute profiles, which is the GPU SKU list *with*
// per-instance hourly pricing. Verified live against a real response:
//   GET https://console.compute.sharonai.cloud
//        /apis/paas.envmgmt.io/v1/projects/<project>/computeprofiles?limit=200
//        -H "X-API-KEY: ra2.<key>"   (key from portal.sharonai.cloud → Compute → API & Registry Keys)
//   -> { apiVersion, kind:"ComputeProfileList", metadata:{count,limit},
//        items:[ { metadata:{ name:"od-ssd-h100-vm-8", displayName:"Ubuntu On-Demand 8 x H100 VM - 1x IPv4", ... },
//                  spec:{ variables:[ {name:"Guest GPU Count",value:"8"},
//                                     {name:"Guest CPU Count",value:"112"},
//                                     {name:"Guest Memory Size",value:"720000"} ] },
//                  status:{ globalSettings:{ billing:{ currency:["AUD"],
//                            ratecard:{ instance:[{currency:"AUD",price:31.49,time_unit:"h"}] } } } } } ] }
//
// `ratecard.instance[0].price` is the whole-instance hourly rate (CPU+RAM+GPUs bundled) in
// AUD — node total, converted to USD by the repo FX (FX_AUD_USD). Public IP and disk are
// separate ratecard dimensions, not included here. The API exposes price but no live
// capacity, so rows are a region-offering price catalog (provider_console), not orderable.
// Requires the API key; set SHARONAI_API_KEY to enable.
const SHARONAI_BASE_URL = "https://console.compute.sharonai.cloud";
const SHARONAI_PROJECT = "defaultproject";
// displayName carries the authoritative "<count> x <MODEL>" tuple, e.g.
// "Ubuntu On-Demand 8 x H100 VM - 1x IPv4" or "On-Demand Developer Pod - 2 x L40S GPU".
const DISPLAY_GPU_RE = /(\d+)\s*[x×]\s*([A-Za-z][A-Za-z0-9]+)/i;
// Fallback: the profile id encodes the model, e.g. od-ssd-h100-vm-8 / od-service-l40s-1-devpod.
const NAME_MODEL_RE = /(h100|h200|l40s|a40|a100|mi300x|rtx\d+)/i;
const KNOWN_VRAM = { H100: 80, H200: 141, L40S: 48, A40: 48, A100: 80 };

export const sharonaiConnector = {
  id: "sharon-ai",
  name: "Sharon AI",
  envVars: ["SHARONAI_API_KEY", "SHARONAI_TOKEN"],
  async fetch(env) {
    const key = env.SHARONAI_API_KEY || env.SHARONAI_TOKEN;
    if (!key) return [];
    const base = (env.SHARONAI_BASE_URL || SHARONAI_BASE_URL).replace(/\/$/, "");
    const project = env.SHARONAI_PROJECT || SHARONAI_PROJECT;
    const timeoutMs = Number(env.SHARONAI_TIMEOUT_MS || 30_000);
    const url = `${base}/apis/paas.envmgmt.io/v1/projects/${project}/computeprofiles?limit=200`;
    const payload = await jsonFetch(url, {
      headers: { Accept: "application/json", "X-API-KEY": key },
      timeoutMs
    });
    return sharonaiToItems(payload, project);
  }
};

export function sharonaiToItems(payload = {}, project = SHARONAI_PROJECT) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const rows = [];
  for (const item of items) {
    const row = sharonaiRow(item, project);
    if (row) rows.push(row);
  }
  return rows;
}

function instanceRate(item = {}) {
  const card = item?.status?.globalSettings?.billing?.ratecard?.instance;
  const entry = Array.isArray(card) ? card[0] : null;
  if (!entry) return null;
  if (entry.time_unit && String(entry.time_unit).toLowerCase() !== "h") return null; // only hourly
  const price = numberOrNull(entry.price);
  if (price == null || price <= 0) return null;
  return { price, currency: String(entry.currency || "AUD").toUpperCase() };
}

function variableMap(item = {}) {
  const vars = Array.isArray(item?.spec?.variables) ? item.spec.variables : [];
  const map = {};
  for (const v of vars) if (v && v.name != null) map[v.name] = v.value;
  return map;
}

function sharonaiRow(item = {}, project = SHARONAI_PROJECT) {
  const meta = item?.metadata || {};
  const name = String(meta.name || "");
  const displayName = String(meta.displayName || "");

  const rate = instanceRate(item);
  if (!rate) return null;

  const display = DISPLAY_GPU_RE.exec(displayName);
  const modelToken = display?.[2] || NAME_MODEL_RE.exec(name)?.[1];
  if (!modelToken) return null; // never emit a GPU row whose model we cannot identify
  const model = normalizeModel(modelToken);

  const vars = variableMap(item);
  // count: prefer the Guest GPU Count variable, fall back to the displayName tuple
  const gpuCount = numberOrNull(vars["Guest GPU Count"]) || numberOrNull(display?.[1]) || 1;
  const vramGbEach = KNOWN_VRAM[model.toUpperCase()] || null;
  const cpu = numberOrNull(vars["Guest CPU Count"]);
  const ramMb = numberOrNull(vars["Guest Memory Size"]);
  const ramGb = ramMb != null ? Math.round(ramMb / 1000) : null;

  const gpuLabel = buildGpuLabel({ count: gpuCount, model, vramGb: vramGbEach });
  const isDevpod = /devpod|service/i.test(name);

  return createInventoryItem({
    provider: "Sharon AI",
    providerId: "sharon-ai",
    rawOfferId: `${project}:${name || displayName}`,
    gpuLabel,
    gpuCount,
    vramGbEach,
    pricePerGpuHour: round(rate.price / gpuCount, 4),
    totalHourlyPrice: rate.price,
    region: "Australia",
    formFactor: isDevpod ? "container" : "vm",
    interconnect: gpuCount > 1 ? "NVLink" : "PCIe",
    cpu: cpu ? `${cpu} vCPU` : "",
    ramGb,
    storage: "",
    networkFabric: "Not exposed",
    currency: rate.currency,
    availability: "unknown",
    availabilityCount: null,
    checkoutUrl: "https://portal.sharonai.cloud/",
    sourceMode: "live",
    listingType: "gpu_sku_pricing",
    priceScope: "node_total",
    availabilitySemantics: "region_offering",
    dataNotes: [
      "Sharon AI compute-profile catalog instance price (whole VM/pod incl. all GPUs) from the Rafay PaaS API; public IP + disk billed separately; no live capacity signal",
      fabricDataNote("Not exposed", gpuLabel, gpuCount)
    ].filter(Boolean),
    metadata: compactMetadata({
      profileName: name,
      displayName,
      profileId: meta.id,
      gpuModel: model,
      gpuCount,
      cpu,
      ramGb,
      vramGb: vramGbEach,
      formFactor: isDevpod ? "devpod" : "vm",
      instancePriceAud: rate.price,
      currency: rate.currency
    }),
    rawPayload: { name, displayName, instancePrice: rate.price, currency: rate.currency }
  });
}

function normalizeModel(token) {
  const upper = String(token).toUpperCase();
  if (/^RTX/i.test(token)) return upper.replace(/^RTX/, "RTX ");
  return upper; // H100, H200, L40S, A40, MI300X — passed to buildGpuLabel/normalizeGpuLabel
}
