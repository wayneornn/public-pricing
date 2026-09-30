import { createInventoryItem } from "../../../core/inventory.js";
import { buildGpuLabel, compactMetadata, numberOrNull, round, truthyEnv } from "../format.js";

// FarmGPU (farmgpu.com) — bare-metal H100/B200 GPU clusters. There is no public pricing
// API, but the public /pricing page server-renders one card per cluster binding a GPU model
// + spec to a per-GPU hourly price:
//   <div class="pricing_label u-text-style-h6">H100 Cluster</div>
//   <div class="pricing_card_price u-text-style-h2">$2.99</div><div ...>per hour</div>
//   ... <div class="platform_card_info_bullet">…8x H100 80GB SXM…</div>
// The price is per-GPU/hr (the page's own benchmark table labels it "H100 SXM Per GPU/hr
// ~$2.99"). Rows are emitted as a non-orderable price catalog. Enable with FARMGPU_ENABLED=1.
const FARMGPU_PRICING_URL = "https://farmgpu.com/pricing";

export const farmgpuConnector = {
  id: "farmgpu",
  name: "FarmGPU",
  envVars: ["FARMGPU_ENABLED"],
  async fetch(env) {
    if (!truthyEnv(env.FARMGPU_ENABLED)) return [];
    const url = env.FARMGPU_PRICING_URL || FARMGPU_PRICING_URL;
    const response = await fetch(url, {
      headers: { Accept: "text/html", "User-Agent": "gpu-deal-terminal" },
      signal: AbortSignal.timeout(Number(env.FARMGPU_TIMEOUT_MS || 30_000))
    });
    if (!response.ok) throw new Error(`farmgpu pricing page ${response.status}`);
    return farmgpuHtmlToItems(await response.text(), { url });
  }
};

export function farmgpuHtmlToItems(htmlText = "", { url = FARMGPU_PRICING_URL } = {}) {
  return extractFarmgpuCards(htmlText)
    .map((card) => farmgpuCardToItem(card, { url }))
    .filter(Boolean);
}

// Each priced cluster is a `pricing_card` block carrying a `pricing_label` heading, a
// `pricing_card_price` dollar value, and a "Nx <model> <vram>GB" spec bullet. We strip SVG
// icons first (the spec bullets are preceded by inline SVGs) then read one card per label.
export function extractFarmgpuCards(htmlText = "") {
  const clean = String(htmlText).replace(/<svg[\s\S]*?<\/svg>/gi, " ");
  const cards = [];
  const labelRe = /pricing_label[^>]*>([^<]+)<\/div>/gi;
  const labels = [];
  let m;
  while ((m = labelRe.exec(clean)) !== null) labels.push({ title: decodeEntities(m[1]).trim(), index: m.index });

  for (let i = 0; i < labels.length; i++) {
    const start = labels[i].index;
    const end = i + 1 < labels.length ? labels[i + 1].index : start + 3000;
    const block = clean.slice(start, end);

    const priceMatch = block.match(/pricing_card_price[^>]*>\s*\$([0-9]+(?:\.[0-9]+)?)/i);
    if (!priceMatch) continue;
    const pricePerGpuHour = numberOrNull(priceMatch[1]);

    // Spec bullet like "8x H100 80GB SXM" / "8x B200 192GB".
    const specMatch = block.match(/(\d+)\s*[x×]\s*((?:NVIDIA\s+)?[A-Za-z0-9][\w .\-]*?)\s+(\d+)\s*GB/i);
    const gpuCount = specMatch ? numberOrNull(specMatch[1]) : null;
    const model = specMatch ? specMatch[2].replace(/\bNVIDIA\b/gi, "").trim() : labels[i].title.replace(/\s*cluster\s*/i, "").trim();
    const vramGbEach = specMatch ? numberOrNull(specMatch[3]) : null;

    cards.push({ title: labels[i].title, pricePerGpuHour, gpuCount, model, vramGbEach });
  }
  return cards;
}

function farmgpuCardToItem(card, { url }) {
  const pricePerGpuHour = numberOrNull(card.pricePerGpuHour);
  if (!card.model || pricePerGpuHour == null || pricePerGpuHour <= 0) return null;

  const gpuCount = card.gpuCount && card.gpuCount > 0 ? card.gpuCount : 1;
  const gpuLabel = buildGpuLabel({ count: gpuCount, model: card.model, vramGb: card.vramGbEach });

  return createInventoryItem({
    provider: "FarmGPU",
    providerId: "farmgpu",
    rawOfferId: `card:${slug(card.title)}`,
    gpuLabel,
    gpuCount,
    vramGbEach: card.vramGbEach,
    pricePerGpuHour,
    totalHourlyPrice: round(pricePerGpuHour * gpuCount, 4),
    region: "FarmGPU",
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
      `FarmGPU "${card.title}" per-GPU hourly price parsed from the public pricing page`,
      "Whole-cluster bare-metal SKU; price is per-GPU/hr",
      "No public provisioning/pricing API and no live stock or deploy route, so rows are a price catalog"
    ],
    metadata: compactMetadata({
      cluster: card.title,
      gpuModel: card.model,
      gpuCount,
      vramGbEach: card.vramGbEach,
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

function decodeEntities(value = "") {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x27;|&#39;/g, "'");
}
