import { createInventoryItem } from "../../../core/inventory.js";
import { jsonFetch, pickArray } from "../http.js";
import { buildGpuLabel, compactMetadata, fabricDataNote, numberOrNull, round } from "../format.js";

// Jarvis Labs. Verified against the live API (endpoint found in the jlclient SDK):
//   GET https://backendprod.jarvislabs.net/misc/server_meta   (Authorization: Bearer <key>)
// Returns a global server_meta list: { gpu_type, vram, arc, price_per_hour (INR),
// num_free_devices, region, spot_only_server, cpus_per_gpu, ram_per_gpu }. Multiple
// physical pools can share a (gpu_type, region); we aggregate their free-device counts.
// Prices are INR (e.g. H100 ~₹255/hr ≈ $3) — converted to USD via core FX. Has a real
// availability count but no verified deploy deep-link, so rows are a priced catalog
// (provider_console).
const JARVIS_API_BASE_URL = "https://backendprod.jarvislabs.net";

export const jarvislabsConnector = {
  id: "jarvis-labs",
  name: "Jarvis Labs",
  envVars: ["JARVISLABS_API_KEY", "JARVIS_API_KEY"],
  async fetch(env) {
    const key = env.JARVISLABS_API_KEY || env.JARVIS_API_KEY;
    if (!key) return [];
    const base = (env.JARVISLABS_API_BASE_URL || JARVIS_API_BASE_URL).replace(/\/$/, "");
    const data = await jsonFetch(`${base}/misc/server_meta`, {
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      timeoutMs: Number(env.JARVISLABS_TIMEOUT_MS || 30_000)
    });
    return jarvisServerMetaToItems(pickArray(data, ["server_meta", "data"]));
  }
};

export function jarvisServerMetaToItems(serverMeta = []) {
  // Aggregate duplicate pools sharing the same (gpu_type, region, vram, price).
  const groups = new Map();
  for (const server of serverMeta) {
    const price = numberOrNull(server.price_per_hour);
    if (price == null || price <= 0) continue;
    const key = `${server.gpu_type}|${server.region}|${server.vram}|${price}`;
    if (!groups.has(key)) groups.set(key, { server, free: 0, effectiveFree: 0 });
    const group = groups.get(key);
    group.free += Number(server.num_free_devices) || 0;
    group.effectiveFree += Number(server.effective_num_free_devices ?? server.num_free_devices) || 0;
  }
  return [...groups.values()].map(({ server, free, effectiveFree }) => jarvisRow(server, free, effectiveFree)).filter(Boolean);
}

function jarvisRow(server, free, effectiveFree) {
  const price = numberOrNull(server.price_per_hour);
  const vramGbEach = numberOrNull(server.vram);
  const model = jarvisModel(server.gpu_type);
  const gpuLabel = buildGpuLabel({ count: 1, model, vramGb: vramGbEach });
  const available = free > 0;

  return createInventoryItem({
    provider: "Jarvis Labs",
    providerId: "jarvis-labs",
    rawOfferId: `${server.gpu_type}:${server.region}:${server.vram}`,
    gpuLabel,
    gpuCount: 1,
    vramGbEach,
    pricePerGpuHour: price,
    totalHourlyPrice: price,
    region: server.region || "Jarvis Labs",
    formFactor: "container",
    interconnect: /hopper|blackwell/i.test(server.arc || "") ? "NVLink" : "PCIe",
    cpu: server.cpus_per_gpu ? `${server.cpus_per_gpu} vCPU` : "",
    ramGb: numberOrNull(server.ram_per_gpu),
    networkFabric: "Not exposed",
    currency: "INR",
    availability: available ? "available" : "unavailable",
    availabilityCount: free,
    checkoutUrl: "https://cloud.jarvislabs.ai/",
    sourceMode: "live",
    listingType: "gpu_server_meta",
    priceScope: "node_total",
    availabilitySemantics: "sku_capacity",
    dataNotes: [
      `${free} free device(s) reported${effectiveFree !== free ? ` (${effectiveFree} effective)` : ""}`,
      server.arc ? `${server.arc} architecture` : "",
      server.spot_only_server ? "Spot-only server pool" : "",
      fabricDataNote("Not exposed", gpuLabel, 1)
    ].filter(Boolean),
    metadata: compactMetadata({
      gpuType: server.gpu_type,
      vram: server.vram,
      arc: server.arc,
      region: server.region,
      pricePerHourInr: server.price_per_hour,
      numFreeDevices: free,
      effectiveFreeDevices: effectiveFree,
      spotOnlyServer: server.spot_only_server,
      cpusPerGpu: server.cpus_per_gpu,
      ramPerGpu: server.ram_per_gpu
    }),
    rawPayload: { ...server, _aggregatedFree: free }
  });
}

function jarvisModel(gpuType = "") {
  // Tokens: H100, H200, A30, L4, A100, A100-80GB, RTX-PRO6000 -> taxonomy-friendly text.
  const text = String(gpuType).replace(/-/g, " ").trim();
  if (/A100\s*80/i.test(text)) return "A100";
  if (/RTX\s*PRO\s*6000|PRO6000/i.test(text)) return "RTX PRO 6000";
  return text;
}
