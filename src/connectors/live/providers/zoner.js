import { createInventoryItem } from "../../../core/inventory.js";
import { buildGpuLabel, compactMetadata, numberOrNull, round, truthyEnv } from "../format.js";

// Zoner (zonercloud.com) — AI/GPU server rental. No public pricing API, but the public
// /ai-gpu/ai-gpu-server page embeds a JS `price_per_hour` object the configurator uses, plus
// labelled radio inputs giving each GPU's model + VRAM:
//   let price_per_hour = {'rtx4090': 0.3, 'rtx5090': 0.45, '6000pro': 0.95, 'h200': 3.77};
//   <label for="gpu_type_rtx4090" ...>NVIDIA RTX 4090 (24 GB VRAM)</label>
// These are per-GPU hourly USD rates. Emitted as a non-orderable price catalog. Enable with
// ZONER_ENABLED=1 (opt-in).
const ZONER_PRICING_URL = "https://www.zonercloud.com/ai-gpu/ai-gpu-server";

export const zonerConnector = {
  id: "zoner",
  name: "Zoner",
  envVars: ["ZONER_ENABLED"],
  async fetch(env) {
    if (!truthyEnv(env.ZONER_ENABLED)) return [];
    const url = env.ZONER_PRICING_URL || ZONER_PRICING_URL;
    const response = await fetch(url, {
      headers: { Accept: "text/html", "User-Agent": "gpu-deal-terminal" },
      signal: AbortSignal.timeout(Number(env.ZONER_TIMEOUT_MS || 30_000))
    });
    if (!response.ok) throw new Error(`zoner pricing page ${response.status}`);
    return zonerHtmlToItems(await response.text(), { url });
  }
};

export function zonerHtmlToItems(htmlText = "", { url = ZONER_PRICING_URL } = {}) {
  return extractZonerOffers(htmlText)
    .map((offer) => zonerOfferToItem(offer, { url }))
    .filter(Boolean);
}

// The configurator's `price_per_hour` map keys each GPU type to a per-GPU hourly rate; the
// radio labels give the human model + VRAM for the same key.
export function extractZonerOffers(htmlText = "") {
  const priceMatch = htmlText.match(/price_per_hour\s*=\s*\{([^}]*)\}/);
  if (!priceMatch) return [];
  const prices = {};
  for (const m of priceMatch[1].matchAll(/'([^']+)'\s*:\s*([0-9]+(?:\.[0-9]+)?)/g)) {
    prices[m[1]] = numberOrNull(m[2]);
  }

  const labels = {};
  for (const m of htmlText.matchAll(/id="gpu_type_(\w+)"[\s\S]{0,160}?custom-control-label">([^<]+)</gi)) {
    labels[m[1]] = decodeEntities(m[2]).replace(/\s+/g, " ").trim();
  }

  const offers = [];
  for (const [key, pricePerGpuHour] of Object.entries(prices)) {
    if (pricePerGpuHour == null || pricePerGpuHour <= 0) continue;
    const label = labels[key] || key;
    const vramMatch = label.match(/(\d+)\s*GB/i);
    const model = label.replace(/\bNVIDIA\b/gi, "").replace(/\(\s*\d+\s*GB[^)]*\)/i, "").replace(/\s+/g, " ").trim();
    offers.push({
      key,
      model: model || key,
      vramGbEach: vramMatch ? numberOrNull(vramMatch[1]) : null,
      pricePerGpuHour
    });
  }
  return offers;
}

function zonerOfferToItem(offer, { url }) {
  const pricePerGpuHour = numberOrNull(offer.pricePerGpuHour);
  if (!offer.model || pricePerGpuHour == null || pricePerGpuHour <= 0) return null;

  const gpuLabel = buildGpuLabel({ count: 1, model: offer.model, vramGb: offer.vramGbEach });
  return createInventoryItem({
    provider: "Zoner",
    providerId: "zoner",
    rawOfferId: `gpu:${slug(offer.key)}`,
    gpuLabel,
    gpuCount: 1,
    vramGbEach: offer.vramGbEach,
    pricePerGpuHour,
    totalHourlyPrice: round(pricePerGpuHour, 4),
    region: "Zoner",
    formFactor: "vm",
    networkFabric: "Not exposed",
    currency: "USD",
    availability: "unknown",
    availabilityCount: null,
    checkoutUrl: url,
    sourceMode: "live",
    listingType: "gpu_sku_pricing",
    priceScope: "gpu_sku",
    availabilitySemantics: "price_only",
    dataNotes: [
      `Zoner ${offer.model} per-GPU/hr parsed from the public GPU-server configurator's price table`,
      "Per-GPU hourly rate the configurator uses; the page also rents by 1/3/6/12-month terms",
      "No public provisioning/pricing API and no live stock or deploy route, so rows are a price catalog"
    ],
    metadata: compactMetadata({
      gpuType: offer.key,
      gpuModel: offer.model,
      vramGbEach: offer.vramGbEach,
      pricePerGpuHourUsd: pricePerGpuHour,
      billingGranularity: "hourly",
      sourceUrl: url
    }),
    rawPayload: { ...offer, sourceUrl: url }
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
