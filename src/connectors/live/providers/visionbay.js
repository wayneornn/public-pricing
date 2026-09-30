import { createInventoryItem } from "../../../core/inventory.js";
import { buildGpuLabel, compactMetadata, numberOrNull, round, truthyEnv } from "../format.js";

// Visionbay (visionbay.ai) — Foxconn's AI-supercomputing / GPU-cloud unit (operates Taiwan's
// largest GPU cluster). No public pricing API, but the public pricing page server-renders one
// card per GPU binding a model to an "$X / 每小時" (per hour) rate:
//   <div ...>NVIDIA H100</div> ... $4 / 每小時 ... 透過長期承租方案，解鎖 NVIDIA H100 …
// Some Blackwell cards put the platform name in the heading and the concrete model (e.g.
// "GB200 NVL72") in the description, so we read the model from the whole card. Per-GPU hourly
// USD → emitted as a non-orderable price catalog. Enable with VISIONBAY_ENABLED=1 (opt-in).
const VISIONBAY_PRICING_URL = "https://visionbay.ai/zh-tw/pricing";
// Ordered most-specific-first so "GB200 NVL72" wins over a bare "GB200".
const MODEL_RE = /(GB300 NVL72|GB200 NVL72|GB300 NVL|GB200 NVL|B300 HGX|B200 HGX|H200|H100|B300|B200|GB300|GB200|A100|L40S)/i;

export const visionbayConnector = {
  id: "visionbay",
  name: "Visionbay",
  envVars: ["VISIONBAY_ENABLED"],
  async fetch(env) {
    if (!truthyEnv(env.VISIONBAY_ENABLED)) return [];
    const url = env.VISIONBAY_PRICING_URL || VISIONBAY_PRICING_URL;
    const response = await fetch(url, {
      headers: { Accept: "text/html", "User-Agent": "gpu-deal-terminal" },
      signal: AbortSignal.timeout(Number(env.VISIONBAY_TIMEOUT_MS || 30_000))
    });
    if (!response.ok) throw new Error(`visionbay pricing page ${response.status}`);
    return visionbayHtmlToItems(await response.text(), { url });
  }
};

export function visionbayHtmlToItems(htmlText = "", { url = VISIONBAY_PRICING_URL } = {}) {
  return extractVisionbayCards(htmlText)
    .map((card) => visionbayCardToItem(card, { url }))
    .filter(Boolean);
}

// Each priced card has an "$X / 每小時" rate; the GPU model is read from the card text around
// the price (heading before + description after).
export function extractVisionbayCards(htmlText = "") {
  const cards = [];
  const re = /\$([0-9]+(?:\.[0-9]+)?)\s*\/\s*每小時/g;
  let m;
  while ((m = re.exec(htmlText)) !== null) {
    const after = m.index + m[0].length;
    // The description after the price names the concrete model on every card (even when the
    // heading before it is just a platform name), so read post-window first, heading second.
    const post = htmlText.slice(after, after + 320).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const pre = htmlText.slice(Math.max(0, m.index - 220), m.index).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const modelMatch = post.match(MODEL_RE) || pre.match(MODEL_RE);
    if (!modelMatch) continue;
    cards.push({
      model: modelMatch[1].toUpperCase().replace(/\s+/g, " ").trim(),
      pricePerGpuHourUsd: numberOrNull(m[1])
    });
  }
  return cards;
}

function visionbayCardToItem(card, { url }) {
  const pricePerGpuHour = numberOrNull(card.pricePerGpuHourUsd);
  if (!card.model || pricePerGpuHour == null || pricePerGpuHour <= 0) return null;

  const gpuLabel = buildGpuLabel({ count: 1, model: card.model });
  return createInventoryItem({
    provider: "Visionbay",
    providerId: "visionbay",
    rawOfferId: `card:${slug(card.model)}`,
    gpuLabel,
    gpuCount: 1,
    vramGbEach: null,
    pricePerGpuHour,
    totalHourlyPrice: round(pricePerGpuHour, 4),
    region: "Taiwan",
    formFactor: "bare_metal",
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
      `Visionbay ${card.model} per-GPU hourly USD parsed from the public pricing page`,
      "Public hourly rate (long-term rental is discounted/contact-sales); no public provisioning/pricing API or live stock, so rows are a price catalog"
    ],
    metadata: compactMetadata({
      gpuModel: card.model,
      pricePerGpuHourUsd: pricePerGpuHour,
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
