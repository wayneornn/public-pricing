import { createInventoryItem } from "../../../core/inventory.js";
import { buildGpuLabel, compactMetadata, numberOrNull, round, truthyEnv } from "../format.js";

// Trainy (trainy.ai) — GPU cluster management (Konduktor) that also rents compute. No public
// pricing API, but the public /pricing page server-renders a single on-demand GPU SKU:
//   <div ...>8xH100 (80 GB SXM5) + 3.2Tb/s Infiniband</div> ... On-Demand $3.60 per GPU per hour
// Reserved pricing is contact-sales. One per-GPU on-demand rate → emitted as a non-orderable
// price catalog. Enable with TRAINY_ENABLED=1 (opt-in).
const TRAINY_PRICING_URL = "https://www.trainy.ai/pricing";

export const trainyConnector = {
  id: "trainy",
  name: "Trainy",
  envVars: ["TRAINY_ENABLED"],
  async fetch(env) {
    if (!truthyEnv(env.TRAINY_ENABLED)) return [];
    const url = env.TRAINY_PRICING_URL || TRAINY_PRICING_URL;
    const response = await fetch(url, {
      headers: { Accept: "text/html", "User-Agent": "gpu-deal-terminal" },
      signal: AbortSignal.timeout(Number(env.TRAINY_TIMEOUT_MS || 30_000))
    });
    if (!response.ok) throw new Error(`trainy pricing page ${response.status}`);
    return trainyHtmlToItems(await response.text(), { url });
  }
};

export function trainyHtmlToItems(htmlText = "", { url = TRAINY_PRICING_URL } = {}) {
  return extractTrainyOffers(htmlText)
    .map((offer) => trainyOfferToItem(offer, { url }))
    .filter(Boolean);
}

// Each on-demand SKU is a "<N>x<model> (<vram> GB SXM…)" spec paired with an "$X per GPU per
// hour" rate. We pair each spec with the on-demand rate that follows it.
export function extractTrainyOffers(htmlText = "") {
  const text = String(htmlText).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const offers = [];
  const re = /(\d+)\s*x\s*([A-Za-z0-9]+)\s*\(\s*(\d+)\s*GB[^)]*\)[\s\S]{0,120}?\$([0-9]+(?:\.[0-9]+)?)\s*per\s*GPU\s*per\s*hour/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    pushUniqueOffer(offers, {
      gpuCount: numberOrNull(m[1]),
      model: m[2].toUpperCase(),
      vramGbEach: numberOrNull(m[3]),
      pricePerGpuHour: numberOrNull(m[4])
    });
  }

  const priceFirstRe = /\$([0-9]+(?:\.[0-9]+)?)\s*per\s*GPU\s*per\s*hour[\s\S]{0,320}?(\d+)\s*x\s*([A-Za-z0-9]+)\s*(?:GPUs?)?[\s\S]{0,80}?(\d+)\s*GB\s*(?:memory each)?/gi;
  while ((m = priceFirstRe.exec(text)) !== null) {
    pushUniqueOffer(offers, {
      gpuCount: numberOrNull(m[2]),
      model: m[3].toUpperCase(),
      vramGbEach: numberOrNull(m[4]),
      pricePerGpuHour: numberOrNull(m[1])
    });
  }
  return offers;
}

function pushUniqueOffer(offers, offer) {
  if (!offer.gpuCount || !offer.model || !offer.pricePerGpuHour) return;
  const key = `${offer.gpuCount}:${offer.model}:${offer.vramGbEach || ""}:${offer.pricePerGpuHour}`;
  if (offers.some((existing) => `${existing.gpuCount}:${existing.model}:${existing.vramGbEach || ""}:${existing.pricePerGpuHour}` === key)) return;
  offers.push(offer);
}

function trainyOfferToItem(offer, { url }) {
  const pricePerGpuHour = numberOrNull(offer.pricePerGpuHour);
  if (!offer.model || pricePerGpuHour == null || pricePerGpuHour <= 0) return null;

  const gpuCount = offer.gpuCount && offer.gpuCount > 0 ? offer.gpuCount : 1;
  const gpuLabel = buildGpuLabel({ count: gpuCount, model: offer.model, vramGb: offer.vramGbEach });

  return createInventoryItem({
    provider: "Trainy",
    providerId: "trainy",
    rawOfferId: `ondemand:${gpuCount}x-${slug(offer.model)}`,
    gpuLabel,
    gpuCount,
    vramGbEach: offer.vramGbEach,
    pricePerGpuHour,
    totalHourlyPrice: round(pricePerGpuHour * gpuCount, 4),
    region: "Trainy",
    formFactor: "bare_metal",
    networkFabric: "InfiniBand",
    currency: "USD",
    availability: "unknown",
    availabilityCount: null,
    checkoutUrl: url,
    sourceMode: "live",
    listingType: "gpu_sku_pricing",
    priceScope: "gpu_sku",
    availabilitySemantics: "price_only",
    dataNotes: [
      `Trainy on-demand ${gpuCount}x ${offer.model} per-GPU/hr parsed from the public pricing page`,
      "On-demand rate only (reserved pricing is contact-sales); no public provisioning/pricing API or live stock, so rows are a price catalog"
    ],
    metadata: compactMetadata({
      gpuModel: offer.model,
      gpuCount,
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
