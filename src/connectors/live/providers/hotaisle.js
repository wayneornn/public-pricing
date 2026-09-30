import { createInventoryItem } from "../../../core/inventory.js";
import { jsonFetch } from "../http.js";
import { bytesToGb, buildGpuLabel, centsToDollars, compactMetadata, fabricDataNote, nonNegativeNumber, numberOrNull, round } from "../format.js";

// Hot Aisle — AMD Instinct MI300X developer cloud (single US facility). A real
// public REST API now exists (added for the dstack `hotaisle` backend), gated by a
// per-team API key. The authoritative contract is the provider's OpenAPI/Swagger spec
// at https://admin.hotaisle.app/api/docs/swagger.json:
//   GET https://admin.hotaisle.app/api/teams/{team}/virtual_machines/available/
//   GET https://admin.hotaisle.app/api/teams/{team}/bare_metal/available/
//   Auth: header `Authorization: Token <api_key>` (securityDefinitions.token)
//   -> [ { MinimumReservationMinutes, OnDemandPrice (US cents/hr, whole-instance),
//          Quantity (creatable/reservable count), Specs: { cpu_cores, disk_capacity
//          (bytes), ram_capacity (bytes), gpus: [ { count, manufacturer, model } ] } } ]
//
// `Quantity` is a real deployable/reservable count, but the only provisioning route is
// the mutating POST .../virtual_machines/ (create), so rows stay provider_console /
// non-checkout until a safe exact deploy route is verified with live credentials.
// Set HOTAISLE_API_KEY + HOTAISLE_TEAM_HANDLE to enable.
const HOTAISLE_API_BASE_URL = "https://admin.hotaisle.app/api";
const HOTAISLE_CONSOLE_URL = "https://admin.hotaisle.app/";
const DEFAULT_REGION = "United States";

export const hotaisleConnector = {
  id: "hot-aisle",
  name: "Hot Aisle",
  envVars: ["HOTAISLE_API_KEY", "HOTAISLE_TOKEN", "HOTAISLE_TEAM_HANDLE"],
  async fetch(env) {
    const apiKey = env.HOTAISLE_API_KEY || env.HOTAISLE_TOKEN;
    const team = env.HOTAISLE_TEAM_HANDLE || env.HOTAISLE_TEAM;
    if (!apiKey || !team) return [];

    const base = (env.HOTAISLE_API_BASE_URL || HOTAISLE_API_BASE_URL).replace(/\/$/, "");
    const timeoutMs = Number(env.HOTAISLE_TIMEOUT_MS || 30_000);
    const headers = { Accept: "application/json", Authorization: `Token ${apiKey}` };
    const teamPath = `${base}/teams/${encodeURIComponent(team)}`;

    const [virtualMachines, bareMetal] = await Promise.all([
      jsonFetch(`${teamPath}/virtual_machines/available/`, { headers, timeoutMs }),
      jsonFetch(`${teamPath}/bare_metal/available/`, { headers, timeoutMs })
    ]);

    return hotaisleToItems({
      virtualMachines,
      bareMetal,
      region: env.HOTAISLE_REGION || DEFAULT_REGION,
      consoleUrl: env.HOTAISLE_CONSOLE_URL || HOTAISLE_CONSOLE_URL
    });
  }
};

export function hotaisleToItems({ virtualMachines = [], bareMetal = [], region = DEFAULT_REGION, consoleUrl = HOTAISLE_CONSOLE_URL } = {}) {
  const items = [];
  for (const type of asArray(virtualMachines)) {
    const row = hotaisleTypeToItem(type, { kind: "vm", region, consoleUrl });
    if (row) items.push(row);
  }
  for (const type of asArray(bareMetal)) {
    const row = hotaisleTypeToItem(type, { kind: "bare_metal", region, consoleUrl });
    if (row) items.push(row);
  }
  return uniquifyHotaisleItems(items);
}

function hotaisleTypeToItem(type = {}, { kind, region, consoleUrl }) {
  const specs = type.Specs || type.specs || {};
  const gpu = firstGpu(specs.gpus);
  const model = normalizeHotaisleModel(gpu.model);
  if (!model) return null; // CPU-only types are not GPU supply

  const gpuCount = totalGpuCount(specs.gpus) || 1;
  // OnDemandPrice is the whole-instance hourly rate in US cents (node total).
  const totalHourlyPrice = centsToDollars(type.OnDemandPrice ?? type.onDemandPrice);
  if (totalHourlyPrice == null || totalHourlyPrice <= 0) return null;

  const quantity = nonNegativeNumber(type.Quantity ?? type.quantity);
  const available = quantity == null ? true : quantity > 0;
  const minMinutes = numberOrNull(type.MinimumReservationMinutes ?? type.minimumReservationMinutes);
  const vcpus = numberOrNull(specs.cpu_cores);
  const ramGb = bytesToGb(specs.ram_capacity);
  const diskGb = bytesToGb(specs.disk_capacity);
  const pricePerGpuHour = round(totalHourlyPrice / gpuCount, 4);
  const isBareMetal = kind === "bare_metal";
  const gpuLabel = buildGpuLabel({ count: gpuCount, model });

  return createInventoryItem({
    provider: "Hot Aisle",
    providerId: "hot-aisle",
    rawOfferId: `${kind}:${gpuCount}x-${slug(model)}`,
    gpuLabel,
    gpuCount,
    vramGbEach: null, // GPU memory is not exposed by the available-types API; not guessed
    pricePerGpuHour,
    totalHourlyPrice,
    region,
    formFactor: isBareMetal ? "bare_metal" : "vm",
    interconnect: "",
    cpu: vcpus ? `${vcpus} ${isBareMetal ? "cores" : "vCPU"}` : "",
    ramGb,
    storage: diskGb ? `${diskGb} GB` : "",
    networkFabric: "Not exposed",
    currency: "USD",
    availability: available ? "available" : "unavailable",
    availabilityCount: quantity,
    minTerm: minTermLabel(minMinutes),
    checkoutUrl: consoleUrl,
    sourceMode: "live",
    listingType: isBareMetal ? "bare_metal_availability" : "vm_configuration_availability",
    priceScope: "node_total",
    availabilitySemantics: "sku_capacity",
    checkoutSemantics: "provider_console",
    dataNotes: [
      "Hot Aisle available-types API exposes a creatable/reservable Quantity per type, not an exact checkout listing",
      "OnDemandPrice is the whole-instance hourly rate (US cents); per-GPU = OnDemandPrice / GPU count",
      isBareMetal ? "Bare metal carries a minimum reservation term (see minTerm)" : "VMs are pay-as-you-go, billed by the minute",
      "GPU VRAM/region are not returned by the available-types API",
      fabricDataNote("Not exposed", gpuLabel, gpuCount)
    ].filter(Boolean),
    metadata: compactMetadata({
      kind,
      gpuManufacturer: gpu.manufacturer,
      gpuModel: gpu.model,
      gpuCount,
      onDemandPriceCents: numberOrNull(type.OnDemandPrice ?? type.onDemandPrice),
      pricePerGpuHourUsd: pricePerGpuHour,
      minimumReservationMinutes: minMinutes,
      cpuCores: vcpus,
      ramGb,
      diskGb,
      quantityAvailable: quantity,
      billingGranularity: isBareMetal ? "reservation" : "per-minute"
    }),
    rawPayload: { ...type, kind }
  });
}

function firstGpu(gpus) {
  return Array.isArray(gpus) && gpus.length ? gpus[0] || {} : {};
}

function totalGpuCount(gpus) {
  if (!Array.isArray(gpus)) return null;
  const sum = gpus.reduce((total, g) => total + (numberOrNull(g?.count) || 0), 0);
  return sum > 0 ? sum : null;
}

function normalizeHotaisleModel(value) {
  const text = String(value || "")
    .replace(/\b(AMD|NVIDIA|Instinct)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text;
}

function minTermLabel(minutes) {
  if (!minutes || minutes <= 0) return "";
  if (minutes % (60 * 24) === 0) return `${minutes / (60 * 24)} day minimum`;
  if (minutes % 60 === 0) return `${minutes / 60} hr minimum`;
  return `${minutes} min minimum`;
}

function slug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function asArray(value) {
  if (Array.isArray(value)) return value.filter((item) => item != null);
  if (Array.isArray(value?.items)) return value.items.filter((item) => item != null);
  return [];
}

function uniquifyHotaisleItems(items) {
  const counts = new Map();
  for (const item of items) counts.set(item.id, (counts.get(item.id) || 0) + 1);
  const seen = new Map();
  return items.map((item) => {
    if ((counts.get(item.id) || 0) <= 1) return item;
    const nextIndex = (seen.get(item.id) || 0) + 1;
    seen.set(item.id, nextIndex);
    const suffix = slug(`${item.cpu || "cpu"}-${nextIndex}`);
    const rawOfferId = `${item.rawOfferId}:${suffix}`;
    return {
      ...item,
      id: `${item.providerId}:${rawOfferId}:${item.regionCanonical}`,
      rawOfferId,
      rawPayload: { ...item.rawPayload, normalizedOfferSuffix: suffix }
    };
  });
}
