import { createInventoryItem } from "../../../core/inventory.js";
import { buildGpuLabel, compactMetadata, numberOrNull, round, truthyEnv } from "../format.js";
import { jsonFetch } from "../http.js";

const POLARIS_PRICING_URL = "https://api.polaris.computer/api/pricing";
const POLARIS_CONSOLE_URL = "https://polaris.computer/compute";

export const polarisConnector = {
  id: "polaris",
  name: "Polaris",
  envVars: ["POLARIS_ENABLED"],
  async fetch(env) {
    if (!truthyEnv(env.POLARIS_ENABLED)) return [];
    const url = env.POLARIS_PRICING_URL || POLARIS_PRICING_URL;
    const payload = await jsonFetch(url, {
      headers: { Accept: "application/json", "User-Agent": "gpu-deal-terminal" },
      timeoutMs: Number(env.POLARIS_TIMEOUT_MS || 30_000)
    });
    return polarisPricingToItems(payload, { url, consoleUrl: env.POLARIS_CONSOLE_URL || POLARIS_CONSOLE_URL });
  }
};

export function polarisPricingToItems(payload = {}, { url = POLARIS_PRICING_URL, consoleUrl = POLARIS_CONSOLE_URL } = {}) {
  const currency = payload.currency || "USD";
  return (Array.isArray(payload.gpus) ? payload.gpus : [])
    .map((row) => polarisGpuToItem(row, { url, consoleUrl, currency }))
    .filter(Boolean);
}

function polarisGpuToItem(row, { url, consoleUrl, currency }) {
  const pricePerGpuHour = numberOrNull(row.on_demand_per_hour);
  if (!row?.display_name || pricePerGpuHour == null || pricePerGpuHour <= 0) return null;
  const parsedGpu = parseGpu(row.display_name);

  return createInventoryItem({
    provider: "Polaris",
    providerId: "polaris",
    rawOfferId: `polaris:${slug(row.billing_key || row.display_name)}:on-demand`,
    gpuLabel: buildGpuLabel({ count: 1, model: parsedGpu.model, vramGb: parsedGpu.vramGbEach }),
    gpuCount: 1,
    vramGbEach: parsedGpu.vramGbEach,
    pricePerGpuHour: round(pricePerGpuHour, 4),
    totalHourlyPrice: round(pricePerGpuHour, 4),
    region: "Polaris marketplace",
    formFactor: "vm",
    networkFabric: "Not exposed",
    currency,
    availability: "unknown",
    availabilityCount: null,
    checkoutUrl: consoleUrl,
    sourceMode: "live",
    listingType: "gpu_sku_pricing",
    priceScope: "gpu_only",
    availabilitySemantics: "price_only",
    priceSemantics: "on_demand",
    dataNotes: [
      "Polaris public pricing API exposes per-GPU on-demand hourly USD rates; spot_per_hour is preserved in metadata only and not used for pricing",
      "No public stock endpoint or exact deploy listing URL is exposed, so rows are a price catalog"
    ],
    metadata: compactMetadata({
      billingKey: row.billing_key,
      spotPerHour: row.spot_per_hour,
      sourceUrl: url
    }),
    rawPayload: { ...row, sourceUrl: url }
  });
}

function parseGpu(value = "") {
  const text = String(value).replace(/\s+/g, " ").trim();
  const vramGbEach = numberOrNull(text.match(/([0-9]+)\s*GB/i)?.[1]);
  const model = text
    .replace(/^NVIDIA\s+/i, "")
    .replace(/^Tesla\s+/i, "")
    .replace(/^GeForce\s+/i, "")
    .replace(/\s+[0-9]+\s*GB\b/ig, "")
    .replace(/\s+/g, " ")
    .trim();
  return { model, vramGbEach };
}

function slug(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
