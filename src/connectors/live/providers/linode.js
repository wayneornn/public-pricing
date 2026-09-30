import { createInventoryItem } from "../../../core/inventory.js";
import { extractGpuCount } from "../../../core/taxonomy.js";
import { jsonFetch, pickArray } from "../http.js";
import { buildGpuLabel, compactMetadata, fabricDataNote, fabricFromText, numberOrNull, round, truthyEnv } from "../format.js";

// Akamai Cloud Computing (formerly Linode). The instance-type catalog is a public,
// unauthenticated endpoint that lists every plan including the `gpu` class with
// per-region price overrides. A token is not required to read it, so we enable the
// connector when LINODE_TOKEN is present OR LINODE_ENABLED is truthy.
const LINODE_API_BASE_URL = "https://api.linode.com/v4";

export const linodeConnector = {
  id: "akamai-linode",
  name: "Akamai (Linode)",
  envVars: ["LINODE_TOKEN", "LINODE_API_TOKEN", "AKAMAI_LINODE_TOKEN", "LINODE_ENABLED"],
  async fetch(env) {
    if (!linodeIsEnabled(env)) return [];
    const base = (env.LINODE_API_BASE_URL || LINODE_API_BASE_URL).replace(/\/$/, "");
    const token = env.LINODE_TOKEN || env.LINODE_API_TOKEN || env.AKAMAI_LINODE_TOKEN;
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const data = await jsonFetch(`${base}/linode/types`, {
      headers,
      timeoutMs: Number(env.LINODE_TIMEOUT_MS || 30_000)
    });
    return linodeTypesToItems(pickArray(data, ["data"]));
  }
};

function linodeIsEnabled(env = {}) {
  return Boolean(env.LINODE_TOKEN || env.LINODE_API_TOKEN || env.AKAMAI_LINODE_TOKEN) || truthyEnv(env.LINODE_ENABLED);
}

export function linodeTypesToItems(types = []) {
  const items = [];
  for (const type of types) {
    if (!linodeIsGpuType(type)) continue;
    // The base `price` applies to default regions; `region_prices` override it for
    // specific regions. Emit one row per priced region plus a base catalog row so a
    // new GPU region surfaces automatically.
    const basePrice = numberOrNull(type.price?.hourly);
    if (basePrice != null) items.push(linodeTypeToItem(type, { region: "", hourly: basePrice }));
    for (const regionPrice of pickArray(type, ["region_prices"])) {
      const hourly = numberOrNull(regionPrice.hourly);
      if (hourly == null) continue;
      items.push(linodeTypeToItem(type, { region: regionPrice.id, hourly }));
    }
  }
  return items.filter(Boolean);
}

function linodeTypeToItem(type, priced) {
  const gpuCount = Number(type.gpus) || extractGpuCount(type.label, 1);
  if (!gpuCount) return null;
  const model = linodeGpuModel(type.label);
  const vramGbEach = linodeVramGb(type.label, model);
  const ramGb = numberOrNull(type.memory) ? round(Number(type.memory) / 1024, 1) : null;
  const diskGb = numberOrNull(type.disk) ? round(Number(type.disk) / 1024, 0) : null;
  const totalHourlyPrice = numberOrNull(priced.hourly);
  const networkFabric = fabricFromText(type.label, type.class, type.network_out ? "ethernet" : "");
  const gpuLabel = buildGpuLabel({ count: gpuCount, model, vramGb: vramGbEach });
  const region = priced.region || "";

  return createInventoryItem({
    provider: "Akamai (Linode)",
    providerId: "akamai-linode",
    rawOfferId: `${type.id}${region ? `:${region}` : ""}`,
    gpuLabel,
    gpuCount,
    vramGbEach,
    pricePerGpuHour: totalHourlyPrice && gpuCount ? totalHourlyPrice / gpuCount : null,
    totalHourlyPrice,
    region: region || "Akamai global",
    formFactor: "vm",
    interconnect: linodeInterconnect(type.label),
    cpu: type.vcpus ? `${type.vcpus} vCPU` : "",
    ramGb,
    storage: diskGb ? `${diskGb} GB` : "",
    networkBandwidth: type.network_out ? `${round(Number(type.network_out) / 1000, 1)} Gbps out` : "",
    networkFabric,
    currency: "USD",
    availability: "available",
    availabilityCount: null,
    checkoutUrl: linodeCheckoutUrl(type, region),
    sourceMode: "live",
    listingType: "instance_type",
    priceScope: "node_total",
    availabilitySemantics: "region_offering",
    dataNotes: [
      "Akamai/Linode public instance-type catalog (region offering, not capacity checked)",
      region ? `Region-specific price for ${region}` : "Default region price",
      fabricDataNote(networkFabric, gpuLabel, gpuCount)
    ].filter(Boolean),
    metadata: compactMetadata({
      typeId: type.id,
      label: type.label,
      class: type.class,
      gpus: type.gpus,
      vcpus: type.vcpus,
      memoryMb: type.memory,
      diskMb: type.disk,
      transferGb: type.transfer,
      networkOutMbps: type.network_out,
      priceRegion: region,
      basePrice: type.price,
      monthly: type.price?.monthly
    }),
    rawPayload: { ...type, _priceRegion: region, _hourly: totalHourlyPrice }
  });
}

function linodeIsGpuType(type = {}) {
  return String(type.class || "").toLowerCase() === "gpu"
    || Number(type.gpus) > 0
    || /\bgpu\b|rtx|tesla|quadro|a100|h100|l40/i.test(type.label || "");
}

function linodeGpuModel(label = "") {
  const text = String(label);
  if (/rtx\s*6000\s*ada|rtx6000ada/i.test(text)) return "RTX 6000 Ada";
  if (/rtx\s*4000\s*ada|rtx4000ada/i.test(text)) return "RTX 4000 Ada";
  if (/rtx\s*6000/i.test(text)) return "RTX 6000";
  if (/h100/i.test(text)) return "H100";
  if (/a100/i.test(text)) return "A100";
  if (/l40s/i.test(text)) return "L40S";
  if (/l40/i.test(text)) return "L40";
  if (/v100/i.test(text)) return "V100";
  const match = text.match(/\b(RTX\s?\d{3,4}\s?\w*|Tesla\s?\w+|Quadro\s?\w+)\b/i);
  return match ? match[1].replace(/\s+/g, " ").trim() : "GPU";
}

function linodeVramGb(label, model) {
  const text = `${label} ${model}`;
  if (/rtx\s*6000\s*ada/i.test(text)) return 48;
  if (/rtx\s*6000/i.test(text)) return 24;
  if (/rtx\s*4000/i.test(text)) return 20;
  if (/h100/i.test(text)) return 80;
  if (/a100/i.test(text)) return 80;
  if (/l40s?/i.test(text)) return 48;
  if (/v100/i.test(text)) return 16;
  return null;
}

function linodeInterconnect(label = "") {
  return /nvlink|sxm/i.test(label) ? "NVLink" : "PCIe";
}

function linodeCheckoutUrl(type, region) {
  const params = new URLSearchParams();
  if (type.id) params.set("type", type.id);
  if (region) params.set("regionID", region);
  const query = params.toString();
  return `https://cloud.linode.com/linodes/create${query ? `?${query}` : ""}`;
}
