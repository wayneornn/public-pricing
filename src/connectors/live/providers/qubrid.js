import { createInventoryItem } from "../../../core/inventory.js";
import { buildGpuLabel, compactMetadata, numberOrNull, round, truthyEnv } from "../format.js";

// Qubrid AI — on-demand GPU cloud. No public pricing API, but the public pricing page
// ships its on-demand catalog as embedded (minified) JS objects with full structured
// per-config pricing:
//   id:"nvidia-h100-80gb-1-0",family:"NVIDIA H100 (80GB)",name:"NVIDIA H100 (80GB) - 1 GPU",
//   gpuCount:"1",gpuMemory:"80 GB",ram:"200 GB",vcpu:"16",storage:"2500 GB",
//   prices:{hourly:{amount:3.83,availability:!0}, weekly:{...}, monthly:{...}}
// `prices.hourly.amount` is the whole-config hourly USD rate (an 8-GPU config is 8x the
// 1-GPU rate), so per-GPU = amount / gpuCount. `availability:!0`/`!1` is true/false in the
// minified payload. The page also lists quote-only 8-GPU *servers* in a separate HTML table
// (total prices + "Get quote") which we ignore. No live stock or exact deploy listing route,
// so rows are a price catalog (provider_console), not orderable. Enable with QUBRID_ENABLED=1.
const QUBRID_PRICING_URL = "https://qubrid.com/pricing";

export const qubridConnector = {
  id: "qubrid",
  name: "Qubrid AI",
  envVars: ["QUBRID_ENABLED"],
  async fetch(env) {
    if (!truthyEnv(env.QUBRID_ENABLED)) return [];
    const url = env.QUBRID_PRICING_URL || QUBRID_PRICING_URL;
    const response = await fetch(url, {
      headers: { Accept: "text/html", "User-Agent": "gpu-deal-terminal" },
      signal: AbortSignal.timeout(Number(env.QUBRID_TIMEOUT_MS || 30_000))
    });
    if (!response.ok) throw new Error(`qubrid pricing page ${response.status}`);
    return qubridHtmlToItems(await response.text(), { url });
  }
};

export function qubridHtmlToItems(htmlText = "", { url = QUBRID_PRICING_URL } = {}) {
  return extractQubridConfigs(htmlText)
    .map((config) => qubridConfigToItem(config, { url }))
    .filter(Boolean);
}

export function extractQubridConfigs(htmlText = "") {
  const configs = [];
  const seen = new Set();
  const configRe = /id:"([^"]+)",family:"([^"]+)",name:"([^"]+)",gpuCount:"(\d+)",gpuMemory:"([^"]*)",ram:"([^"]*)",vcpu:"([^"]*)",storage:"([^"]*)"[\s\S]{0,400}?prices:\{hourly:\{amount:([0-9]*\.?[0-9]+),availability:(![01])/g;
  let match;
  while ((match = configRe.exec(htmlText)) !== null) {
    const id = match[1];
    if (seen.has(id)) continue;
    seen.add(id);
    configs.push({
      id,
      family: match[2],
      name: match[3],
      gpuCount: numberOrNull(match[4]),
      gpuMemory: match[5],
      ram: match[6],
      vcpu: match[7],
      storage: match[8],
      hourlyAmountUsd: numberOrNull(match[9]),
      hourlyAvailable: match[10] === "!0"
    });
  }
  return configs;
}

function qubridConfigToItem(config, { url }) {
  const instancePrice = numberOrNull(config.hourlyAmountUsd);
  if (instancePrice == null || instancePrice <= 0) return null;

  const gpuCount = numberOrNull(config.gpuCount) || 1;
  const model = normalizeQubridModel(config.family);
  const vramGbEach = parseGb(config.gpuMemory);
  const pricePerGpuHour = round(instancePrice / gpuCount, 4);
  const ramGb = parseGb(config.ram);
  const gpuLabel = buildGpuLabel({ count: gpuCount, model, vramGb: vramGbEach });

  return createInventoryItem({
    provider: "Qubrid AI",
    providerId: "qubrid",
    rawOfferId: config.id,
    gpuLabel,
    gpuCount,
    vramGbEach,
    pricePerGpuHour,
    totalHourlyPrice: instancePrice,
    region: "Qubrid Cloud",
    formFactor: "vm",
    networkFabric: "Not exposed",
    currency: "USD",
    availability: config.hourlyAvailable ? "available" : "unavailable",
    availabilityCount: null,
    cpu: config.vcpu ? `${String(config.vcpu).replace(/[^0-9]/g, "")} vCPU` : "",
    ramGb,
    storage: config.storage || "",
    checkoutUrl: url,
    sourceMode: "live",
    listingType: "gpu_sku_pricing",
    priceScope: "node_total",
    availabilitySemantics: "price_only",
    dataNotes: [
      "Qubrid on-demand hourly USD price parsed from the public pricing page's embedded config catalog; per-GPU = amount / gpuCount",
      "prices.hourly.availability is a catalog availability flag, not a live stock count or exact orderable listing",
      "Quote-only 8-GPU server listings on the same page are not emitted; no public pricing API and no exact deploy listing route"
    ],
    metadata: compactMetadata({
      configId: config.id,
      family: config.family,
      name: config.name,
      gpuCount,
      vramGbEach,
      ramGb,
      vcpu: config.vcpu,
      storage: config.storage,
      hourlyAmountUsd: instancePrice,
      pricePerGpuHourUsd: pricePerGpuHour,
      hourlyAvailable: config.hourlyAvailable,
      sourceUrl: url
    }),
    rawPayload: { ...config, sourceUrl: url }
  });
}

// "NVIDIA H100 (80GB)" -> "H100" (strip brand and the trailing (VRAM) note the label
// already encodes via vramGbEach).
function normalizeQubridModel(value) {
  return String(value || "")
    .replace(/\bNVIDIA\b/gi, " ")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseGb(value) {
  return numberOrNull(String(value || "").replace(/[^0-9.]/g, ""));
}
