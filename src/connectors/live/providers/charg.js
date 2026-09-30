import { createInventoryItem } from "../../../core/inventory.js";
import { buildGpuLabel, compactMetadata, numberOrNull, round, truthyEnv } from "../format.js";

const CHARG_PRICING_URL = "https://charg.cloud/pricing/";

export const chargConnector = {
  id: "charg",
  name: "Charg",
  envVars: ["CHARG_ENABLED"],
  async fetch(env) {
    if (!truthyEnv(env.CHARG_ENABLED)) return [];
    const url = env.CHARG_PRICING_URL || CHARG_PRICING_URL;
    const response = await fetch(url, {
      headers: { Accept: "text/html", "User-Agent": "gpu-deal-terminal" },
      signal: AbortSignal.timeout(Number(env.CHARG_TIMEOUT_MS || 30_000))
    });
    if (!response.ok) throw new Error(`charg pricing page ${response.status}`);
    return chargHtmlToItems(await response.text(), { url });
  }
};

export function chargHtmlToItems(htmlText = "", { url = CHARG_PRICING_URL } = {}) {
  const text = cleanText(htmlText);
  const nodeMatch = text.match(/\$([0-9]+(?:\.[0-9]+)?)\s*\/\s*hr\s+for\s+a\s+full\s+(\d+)x\s+([A-Za-z0-9 -]+?)\s+node\s*\(([^)]*)\)/i);
  if (!nodeMatch) return [];

  const totalHourlyPrice = numberOrNull(nodeMatch[1]);
  const gpuCount = numberOrNull(nodeMatch[2]);
  const gpuModel = nodeMatch[3].trim();
  const specs = parseSpecs(nodeMatch[4]);
  if (!totalHourlyPrice || !gpuCount || !gpuModel) return [];

  return [createInventoryItem({
    provider: "Charg",
    providerId: "charg",
    rawOfferId: `charg:${gpuCount}x-${slug(gpuModel)}`,
    gpuLabel: buildGpuLabel({ count: gpuCount, model: gpuModel }),
    gpuCount,
    pricePerGpuHour: round(totalHourlyPrice / gpuCount, 4),
    totalHourlyPrice,
    region: "Dallas, US",
    formFactor: "bare_metal",
    cpu: specs.cpuText,
    cpuCores: specs.cpuCores,
    ramGb: specs.ramGb,
    storage: specs.storage,
    networkFabric: "200 Gbit InfiniBand",
    currency: "USD",
    availability: "unknown",
    availabilityCount: null,
    checkoutUrl: url,
    sourceMode: "live",
    listingType: "gpu_sku_pricing",
    priceScope: "node_total",
    availabilitySemantics: "price_only",
    priceSemantics: "node_total",
    dataNotes: [
      "Charg public pricing page publishes a whole-node hourly USD rate for an 8x V100 node; per-GPU price is derived from node total / GPU count",
      "No public stock API or exact deploy listing route is exposed, so rows are a price catalog"
    ],
    metadata: compactMetadata({
      billingGranularity: "hourly",
      specs: nodeMatch[4],
      sourceUrl: url
    }),
    rawPayload: {
      totalHourlyPrice,
      gpuCount,
      gpuModel,
      specs: nodeMatch[4],
      sourceUrl: url
    }
  })];
}

function parseSpecs(value = "") {
  const cpuMatch = value.match(/([0-9]+)\s*vCPU/i);
  const ramMatch = value.match(/([0-9]+)\s*GB\s*RAM/i);
  const storageMatch = value.match(/([0-9.]+)\s*TB\s*NVMe/i);
  return {
    cpuText: cpuMatch ? `${cpuMatch[1]} vCPU` : "",
    cpuCores: cpuMatch ? numberOrNull(cpuMatch[1]) : null,
    ramGb: ramMatch ? numberOrNull(ramMatch[1]) : null,
    storage: storageMatch ? `${storageMatch[1]} TB NVMe` : ""
  };
}

function cleanText(htmlText = "") {
  return String(htmlText)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&#8217;|&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function slug(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
