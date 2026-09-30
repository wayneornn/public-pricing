import { createInventoryItem } from "../../../core/inventory.js";
import { jsonFetch } from "../http.js";
import { buildGpuLabel, compactMetadata, fabricDataNote, numberOrNull, round, truthyEnv } from "../format.js";

// SAKURA internet — 高火力 VRT (Koukaryoku VRT, VM-type GPU cloud). The IaaS price-list
// API is PUBLIC (no API key) but rejects requests without an XHR header. Verified live:
//   GET https://secure.sakura.ad.jp/cloud/zone/<zone>/api/cloud/1.1/public/price.json
//       -H "X-Requested-With: XMLHttpRequest"
//   -> { Count, ResponsedAt, ServiceClasses: { "<i>": {DisplayName, Price:{Hourly,Daily,
//        Monthly,Zone}, ServiceCharge, ServiceClassName, ServiceClassPath} } }
// GPU plans only exist in the Ishikari zones (is1a: V100 32GB + H100 80GB; is1b: H100
// 80GB). They are uptime plans whose ServiceClassName encodes cores/RAM/GPU-count and
// (for H100) VRAM, e.g. "plan/24core-240gb-1gpu-nvidia_h100_80gbvram-g2"; the GPU model
// and count come verbatim from the DisplayName tail "…-H100x1". Prices are whole-instance
// JPY/hour (CPU+RAM+1 GPU bundled), converted to USD via the repo FX (FX_JPY_USD). The
// API exposes price but no live capacity, so rows are a region-offering price catalog
// (provider_console), not orderable. No key needed; opt-in with SAKURA_ENABLED=1 so the
// default/offline run makes no network call.
const SAKURA_PRICE_URL = (zone) =>
  `https://secure.sakura.ad.jp/cloud/zone/${zone}/api/cloud/1.1/public/price.json`;
const DEFAULT_ZONES = ["is1a", "is1b"]; // only Ishikari zones carry GPU plans today
// plan/<cores>core-<ram>gb-<count>gpu[-nvidia_<model>_<vram>gbvram][-g2]
const PLAN_NAME_RE = /^plan\/(\d+)core-(\d+)gb-(\d+)gpu/i;
// DisplayName tail "…-<MODEL>x<COUNT>" (e.g. "高火力 VRT/24Core-240GB-H100x1")
const DISPLAY_GPU_RE = /-\s*([A-Za-z][A-Za-z0-9]*)x(\d+)\s*$/;
const VRAM_RE = /(\d+)gbvram/i;
const KNOWN_VRAM = { V100: 32, H100: 80 }; // Sakura 高火力 VRT lineup (V100 32GB, H100 80GB)

export const sakuraConnector = {
  id: "sakura",
  name: "SAKURA internet",
  envVars: ["SAKURA_ENABLED", "SAKURACLOUD_ENABLED"],
  async fetch(env) {
    if (!truthyEnv(env.SAKURA_ENABLED) && !truthyEnv(env.SAKURACLOUD_ENABLED)) return [];
    const zones = (env.SAKURA_ZONES ? String(env.SAKURA_ZONES).split(",") : DEFAULT_ZONES)
      .map((zone) => zone.trim())
      .filter(Boolean);
    const timeoutMs = Number(env.SAKURA_TIMEOUT_MS || 30_000);
    const responses = await Promise.all(
      zones.map((zone) =>
        jsonFetch(SAKURA_PRICE_URL(zone), {
          headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" },
          timeoutMs
        })
      )
    );
    return responses.flatMap((payload) => sakuraToItems(payload));
  }
};

export function sakuraToItems(payload = {}) {
  const classes = payload?.ServiceClasses;
  if (!classes || typeof classes !== "object") return [];
  const items = [];
  for (const entry of Object.values(classes)) {
    const row = sakuraRow(entry);
    if (row) items.push(row);
  }
  return items;
}

function sakuraRow(entry = {}) {
  const name = String(entry.ServiceClassName || "");
  const planMatch = PLAN_NAME_RE.exec(name);
  if (!planMatch) return null; // non-GPU plans (plan/1, plan/2, disks, …) are skipped

  const hourly = numberOrNull(entry.Price?.Hourly);
  if (hourly == null || hourly <= 0) return null;

  const [, coreStr, ramStr, gpuStr] = planMatch;
  const displayMatch = DISPLAY_GPU_RE.exec(String(entry.DisplayName || ""));
  // count comes from the plan name (authoritative); model from the DisplayName tail
  const gpuCount = Number(gpuStr) || Number(displayMatch?.[2]) || 1;
  const model = displayMatch?.[1] || gpuTokenFromName(name);
  if (!model) return null; // never emit a GPU row whose model we cannot identify
  const vramGbEach = numberOrNull(VRAM_RE.exec(name)?.[1]) || KNOWN_VRAM[model.toUpperCase()] || null;

  const gpuLabel = buildGpuLabel({ count: gpuCount, model, vramGb: vramGbEach });
  const zone = entry.Price?.Zone || "";
  const cores = Number(coreStr) || null;
  const ramGb = Number(ramStr) || null;

  return createInventoryItem({
    provider: "SAKURA internet",
    providerId: "sakura",
    rawOfferId: `${zone}:${name}`,
    gpuLabel,
    gpuCount,
    vramGbEach,
    pricePerGpuHour: round(hourly / gpuCount, 4),
    totalHourlyPrice: hourly,
    region: zone || "Ishikari",
    formFactor: "vm",
    interconnect: gpuCount > 1 ? "NVLink" : "PCIe",
    cpu: cores ? `${cores} vCPU` : "",
    ramGb,
    storage: "",
    networkFabric: "Not exposed",
    currency: "JPY",
    availability: "unknown",
    availabilityCount: null,
    checkoutUrl: "https://cloud.sakura.ad.jp/products/server/gpu/",
    sourceMode: "live",
    listingType: "gpu_sku_pricing",
    priceScope: "node_total",
    availabilitySemantics: "region_offering",
    dataNotes: [
      "高火力 VRT plan price (whole VM incl. 1 GPU) from Sakura public IaaS price-list API; no live capacity signal",
      "Boot disk billed separately (not included in this plan price)",
      fabricDataNote("Not exposed", gpuLabel, gpuCount)
    ].filter(Boolean),
    metadata: compactMetadata({
      serviceClassName: name,
      serviceClassId: entry.ServiceClassID,
      displayName: entry.DisplayName,
      zone,
      cores,
      ramGb,
      vramGb: vramGbEach,
      hourlyJpy: hourly,
      dailyJpy: numberOrNull(entry.Price?.Daily),
      monthlyJpy: numberOrNull(entry.Price?.Monthly)
    }),
    rawPayload: { ...entry }
  });
}

// Fallback model lookup from the plan name (DisplayName is the primary source).
function gpuTokenFromName(name) {
  const token = /1gpu-nvidia_([a-z0-9]+?)_\d+gbvram/i.exec(name)?.[1];
  return token ? token.toUpperCase() : "";
}
