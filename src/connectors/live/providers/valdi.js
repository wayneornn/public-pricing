import { createInventoryItem } from "../../../core/inventory.js";
import { buildGpuLabel, compactMetadata, numberOrNull, round, truthyEnv } from "../format.js";

// Valdi (valdi.ai) — pay-as-you-go GPU cloud. There is no public provisioning/pricing API
// (api.valdi.ai and probed catalog paths all 404), but the home page renders one card per
// GPU binding a model heading to a "Starting at $X/hr" floor:
//   <h1 class="h3 small white"><strong>NVIDIA H100 (PCIe or SXM5 IB)</strong></h1>
//   ... Starting at $2.35/hr
// These are per-GPU on-demand *starting/from* floors. Rows are emitted as a lowest-SKU price
// catalog (provider_console), not orderable. Enable with VALDI_ENABLED=1 (opt-in).
const VALDI_HOME_URL = "https://www.valdi.ai/";

export const valdiConnector = {
  id: "valdi",
  name: "Valdi",
  envVars: ["VALDI_ENABLED"],
  async fetch(env) {
    if (!truthyEnv(env.VALDI_ENABLED)) return [];
    const url = env.VALDI_HOME_URL || VALDI_HOME_URL;
    const response = await fetch(url, {
      headers: { Accept: "text/html", "User-Agent": "gpu-deal-terminal" },
      signal: AbortSignal.timeout(Number(env.VALDI_TIMEOUT_MS || 30_000))
    });
    if (!response.ok) throw new Error(`valdi home page ${response.status}`);
    return valdiHtmlToItems(await response.text(), { url });
  }
};

export function valdiHtmlToItems(htmlText = "", { url = VALDI_HOME_URL } = {}) {
  return extractValdiCards(htmlText)
    .map((card) => valdiCardToItem(card, { url }))
    .filter(Boolean);
}

// Headings (h1.h3.small.white) and "Starting at $X/hr" prices appear once per card in the
// same document order, so we pair them positionally.
export function extractValdiCards(htmlText = "") {
  const headings = [];
  const headingRe = /<h1[^>]*class="[^"]*\bh3\b[^"]*"[^>]*>([\s\S]*?)<\/h1>/gi;
  let hMatch;
  while ((hMatch = headingRe.exec(htmlText)) !== null) {
    const text = decodeEntities(hMatch[1].replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
    if (text) headings.push(text);
  }

  const prices = [];
  const priceRe = /Starting at\s*\$([0-9]+(?:\.[0-9]+)?)\/hr/gi;
  let pMatch;
  while ((pMatch = priceRe.exec(htmlText)) !== null) prices.push(numberOrNull(pMatch[1]));

  const cards = [];
  const count = Math.min(headings.length, prices.length);
  for (let i = 0; i < count; i++) {
    cards.push({ gpuModel: headings[i], startingPricePerGpuHourUsd: prices[i] });
  }
  return cards;
}

function valdiCardToItem(card, { url }) {
  const pricePerGpuHour = numberOrNull(card.startingPricePerGpuHourUsd);
  if (!card.gpuModel || pricePerGpuHour == null || pricePerGpuHour <= 0) return null;

  // Heading reads e.g. "NVIDIA H100 (PCIe or SXM5 IB)" — keep the bus/form-factor note out
  // of the model and let taxonomy read the model token.
  const model = card.gpuModel
    .replace(/\b(NVIDIA|AMD Instinct|AMD)\b/gi, "")
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const gpuLabel = buildGpuLabel({ count: 1, model });

  return createInventoryItem({
    provider: "Valdi",
    providerId: "valdi",
    rawOfferId: `card:${slug(card.gpuModel)}`,
    gpuLabel,
    gpuCount: 1,
    vramGbEach: null,
    pricePerGpuHour,
    totalHourlyPrice: round(pricePerGpuHour, 4),
    region: "Valdi",
    formFactor: "vm",
    networkFabric: "Not exposed",
    currency: "USD",
    availability: "unknown",
    availabilityCount: null,
    checkoutUrl: url,
    sourceMode: "live",
    listingType: "gpu_sku_pricing",
    priceScope: "gpu_sku_lowest",
    availabilitySemantics: "price_only",
    dataNotes: [
      `Valdi "Starting at $X/hr" per-GPU floor parsed from the public home page card`,
      "Starting/from price (on-demand floor); exhaustive per-flavor rates are not published",
      "No public provisioning/pricing API and no live stock or exact deploy listing route, so rows are a price catalog"
    ],
    metadata: compactMetadata({
      gpuModel: card.gpuModel,
      startingPricePerGpuHourUsd: pricePerGpuHour,
      priceQualifier: "starts_at",
      billingGranularity: "hourly",
      sourceUrl: url
    }),
    rawPayload: { ...card, sourceUrl: url }
  });
}

function slug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function decodeEntities(value = "") {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x27;|&#39;/g, "'");
}
