import { createInventoryItem } from "../../../core/inventory.js";
import { jsonFetch } from "../http.js";
import { buildGpuLabel, compactMetadata, nonNegativeNumber, numberOrNull, round, truthyEnv } from "../format.js";

// io.net — decentralized GPU network (IO Cloud). The public IO Cloud API the
// console itself calls exposes a no-auth hardware catalog with real USD per-hour
// prices and a deployable replica count:
//   GET https://api.io.solutions/v1/io-cloud/vmaas/hardware  (VM-as-a-service: specs)
//   GET https://api.io.solutions/v1/io-cloud/caas/hardware   (container: available_replicas + brand)
//   -> data.hardware[] = { id, deploy_id, name (GPU model), num_cards, vram_per_card,
//      interconnect, nvlink, vcpu, memory (GB), storage (GB), location, sold_out,
//      price (whole-config USD/hr) } ; caas adds { brand_name, available_replicas }.
//
// `price` is the whole-config hourly rate in USD (native unit; settlement may net out
// in $IO but quotes are USD), so per-GPU = price / num_cards. Provisioning requires the
// IO console + a funded wallet, so rows are a priced capacity catalog (provider_console),
// not orderable. No key needed; enable with IONET_ENABLED=1 (opt-in so default/offline
// runs make no network call).
const IONET_API_BASE_URL = "https://api.io.solutions/v1";
const IONET_CONSOLE_URL = "https://cloud.io.net/";

export const ionetConnector = {
  id: "ionet",
  name: "io.net",
  envVars: ["IONET_ENABLED"],
  async fetch(env) {
    if (!truthyEnv(env.IONET_ENABLED)) return [];
    const base = (env.IONET_API_BASE_URL || IONET_API_BASE_URL).replace(/\/$/, "");
    const timeoutMs = Number(env.IONET_TIMEOUT_MS || 30_000);
    const headers = { Accept: "application/json" };

    const [vmaas, caas] = await Promise.all([
      jsonFetch(`${base}/io-cloud/vmaas/hardware`, { headers, timeoutMs }),
      jsonFetch(`${base}/io-cloud/caas/hardware`, { headers, timeoutMs }).catch(() => null)
    ]);

    return ionetToItems({ vmaas, caas, consoleUrl: env.IONET_CONSOLE_URL || IONET_CONSOLE_URL });
  }
};

export function ionetToItems({ vmaas, caas, consoleUrl = IONET_CONSOLE_URL } = {}) {
  const supply = indexById(hardwareList(caas));
  return hardwareList(vmaas)
    .map((hw) => ionetHardwareToItem(hw, { extra: supply.get(hw?.id), consoleUrl }))
    .filter(Boolean);
}

function ionetHardwareToItem(hw = {}, { extra = {}, consoleUrl }) {
  const model = normalizeIonetModel(hw.name);
  if (!model) return null;

  const gpuCount = numberOrNull(hw.num_cards) || 1;
  const totalHourlyPrice = numberOrNull(hw.price);
  if (totalHourlyPrice == null || totalHourlyPrice <= 0) return null;

  const vramGbEach = numberOrNull(hw.vram_per_card);
  const pricePerGpuHour = round(totalHourlyPrice / gpuCount, 4);
  const replicas = nonNegativeNumber(extra.available_replicas);
  const soldOut = hw.sold_out === true;
  const availability = soldOut ? "unavailable" : replicas == null ? "unknown" : replicas > 0 ? "available" : "unavailable";
  const gpuLabel = buildGpuLabel({ count: gpuCount, model, vramGb: vramGbEach });
  const ramGb = numberOrNull(hw.memory);
  const storageGb = numberOrNull(hw.storage);
  const interconnect = String(hw.interconnect || "").toUpperCase();

  return createInventoryItem({
    provider: "io.net",
    providerId: "ionet",
    rawOfferId: String(hw.id || hw.deploy_id || `${gpuCount}x-${model}`),
    gpuLabel,
    gpuCount,
    vramGbEach,
    pricePerGpuHour,
    totalHourlyPrice,
    region: String(hw.location || "").trim() || "io.net Network",
    formFactor: "vm",
    interconnect,
    ramGb,
    storage: storageGb ? `${storageGb} GB` : "",
    networkFabric: hw.nvlink ? "NVLink" : interconnect || "Not exposed",
    currency: "USD",
    availability,
    availabilityCount: replicas,
    checkoutUrl: consoleUrl,
    sourceMode: "live",
    listingType: "vm_configuration_availability",
    priceScope: "node_total",
    availabilitySemantics: replicas == null ? "price_only" : "sku_capacity",
    checkoutSemantics: "provider_console",
    dataNotes: [
      "io.net IO Cloud public hardware API: price is the whole-config hourly USD rate; per-GPU = price / num_cards",
      replicas == null
        ? "Container available_replicas not returned for this config; availability derived from sold_out only"
        : "available_replicas is a deployable count, not an exact orderable checkout listing",
      "Decentralized network; provisioning needs the IO console + a funded wallet, so rows are a priced capacity catalog, not orderable"
    ],
    metadata: compactMetadata({
      deployId: hw.deploy_id,
      gpuModel: hw.name,
      brand: extra.brand_name,
      gpuCount,
      vramGbEach,
      priceUsdPerHour: totalHourlyPrice,
      pricePerGpuHourUsd: pricePerGpuHour,
      interconnect: hw.interconnect,
      nvlink: hw.nvlink === true ? true : undefined,
      vcpu: numberOrNull(hw.vcpu),
      ramGb,
      storageGb,
      location: hw.location,
      availableReplicas: replicas,
      soldOut: soldOut ? true : undefined
    }),
    rawPayload: { ...hw, available_replicas: extra.available_replicas, brand_name: extra.brand_name }
  });
}

function hardwareList(payload) {
  const list = payload?.data?.hardware ?? payload?.hardware ?? payload?.data;
  return Array.isArray(list) ? list.filter((row) => row != null) : [];
}

function indexById(list) {
  const map = new Map();
  for (const row of list) {
    if (row?.id != null) map.set(row.id, row);
  }
  return map;
}

// Strip the brand and collapse io.net's terse SKU names (e.g. "RTXPRO6000",
// "A100-SXM4-80GB", "GeForce RTX 4090") to a clean model the taxonomy can read.
function normalizeIonetModel(value) {
  const text = String(value || "")
    .replace(/\b(NVIDIA|GeForce)\b/gi, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text;
}
