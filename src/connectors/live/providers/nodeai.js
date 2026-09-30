import { createInventoryItem } from "../../../core/inventory.js";
import { jsonFetch } from "../http.js";
import { buildGpuLabel, compactMetadata, numberOrNull, round, truthyEnv } from "../format.js";

const NODEAI_PRICING_URL = "https://www.nodes.ai/pricing";
const NODEAI_CONSOLE_URL = "https://manage.nodes.ai/";

export const nodeaiConnector = {
  id: "nodeai",
  name: "NodeAI",
  envVars: ["NODEAI_ENABLED"],
  async fetch(env) {
    if (!truthyEnv(env.NODEAI_ENABLED)) return [];
    const url = env.NODEAI_PRICING_JSON_URL || await discoverNodeaiPricingJsonUrl(env);
    const payload = await jsonFetch(url, {
      headers: { Accept: "application/json" },
      timeoutMs: Number(env.NODEAI_TIMEOUT_MS || 30_000)
    });
    return nodeaiToItems(payload, { sourceUrl: url, consoleUrl: env.NODEAI_CONSOLE_URL || NODEAI_CONSOLE_URL });
  }
};

async function discoverNodeaiPricingJsonUrl(env) {
  const pricingUrl = env.NODEAI_PRICING_URL || NODEAI_PRICING_URL;
  const response = await fetch(pricingUrl, {
    headers: { Accept: "text/html", "User-Agent": "gpu-deal-terminal" },
    signal: AbortSignal.timeout(Number(env.NODEAI_TIMEOUT_MS || 30_000))
  });
  if (!response.ok) throw new Error(`nodeai pricing page ${response.status}`);
  const htmlText = await response.text();
  const buildId = htmlText.match(/"buildId"\s*:\s*"([^"]+)"/)?.[1];
  if (!buildId) throw new Error("nodeai pricing page missing Next buildId");
  return new URL(`/_next/data/${buildId}/pricing.json`, pricingUrl).toString();
}

export function nodeaiToItems(payload = {}, { sourceUrl = NODEAI_PRICING_URL, consoleUrl = NODEAI_CONSOLE_URL } = {}) {
  const options = payload?.pageProps?.content?.options || payload?.props?.pageProps?.content?.options;
  if (!Array.isArray(options)) return [];
  return options.map((row) => nodeaiRowToItem(row, { sourceUrl, consoleUrl })).filter(Boolean);
}

function nodeaiRowToItem(row, { sourceUrl, consoleUrl }) {
  const pricePerGpuHour = numberOrNull(row.pricePerHour);
  if (!row.model || pricePerGpuHour == null || pricePerGpuHour <= 0) return null;
  const gpuLabel = buildGpuLabel({ count: 1, model: row.model });
  const supply = numberOrNull(row.supply);

  return createInventoryItem({
    provider: "NodeAI",
    providerId: "nodeai",
    rawOfferId: String(row._key || `nodeai:${slug(row.model)}`),
    gpuLabel,
    gpuCount: 1,
    vramGbEach: vramFromModel(row.model),
    pricePerGpuHour: round(pricePerGpuHour, 4),
    totalHourlyPrice: round(pricePerGpuHour, 4),
    region: "NodeAI marketplace",
    formFactor: "container",
    networkFabric: "Not exposed",
    currency: "USD",
    availability: supply && supply > 0 ? "available" : "unknown",
    availabilityCount: supply,
    checkoutUrl: consoleUrl,
    sourceMode: "live",
    listingType: "gpu_sku_pricing",
    priceScope: "gpu_sku_lowest",
    availabilitySemantics: "sku_capacity",
    dataNotes: [
      "NodeAI public Next.js pricing JSON publishes per-GPU hourly USD prices and supply counts",
      "Deploy requires the NodeAI app and no exact listing URL is exposed, so rows are a priced capacity catalog"
    ],
    metadata: compactMetadata({
      key: row._key,
      model: row.model,
      productType: row.productType,
      supply,
      pricePerHourUsd: pricePerGpuHour,
      sourceUrl
    }),
    rawPayload: { ...row, sourceUrl }
  });
}

function vramFromModel(model = "") {
  const match = String(model).match(/(\d+)\s*GB/i);
  return match ? numberOrNull(match[1]) : null;
}

function slug(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
