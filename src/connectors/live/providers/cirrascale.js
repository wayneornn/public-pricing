import { createInventoryItem } from "../../../core/inventory.js";
import { buildGpuLabel, compactMetadata, numberOrNull, round, truthyEnv } from "../format.js";

// Cirrascale (cirrascale.com) — AI Innovation Cloud, reserved GPU instances. No public
// pricing API, but the public /pricing page server-renders accordion plans per SKU. Each SKU
// row's title sits in `plan-trigger__text--secondary` ("8X NVIDIA H100 (Standalone)") and its
// plan-info carries either an `option__duration__hr` term ladder or a single "As low as $X
// per GPU hour" line; the lowest/headline rate is per-GPU/hr:
//   <div class="plan-trigger__text plan-trigger__text--secondary"><div>8X AMD MI300X</div></div>
//   ... <div class="option__duration__hr">$3.08/GPUhr Equivalent</div>
// We emit the headline per-GPU rate as a non-orderable price catalog. Only NVIDIA/AMD GPU
// plans are kept (Qualcomm AI 100 accelerators and storage plans are dropped). Enable with
// CIRRASCALE_ENABLED=1 (opt-in).
const CIRRASCALE_PRICING_URL = "https://cirrascale.com/pricing";

export const cirrascaleConnector = {
  id: "cirrascale",
  name: "Cirrascale",
  envVars: ["CIRRASCALE_ENABLED"],
  async fetch(env) {
    if (!truthyEnv(env.CIRRASCALE_ENABLED)) return [];
    const url = env.CIRRASCALE_PRICING_URL || CIRRASCALE_PRICING_URL;
    const response = await fetch(url, {
      headers: { Accept: "text/html", "User-Agent": "gpu-deal-terminal" },
      signal: AbortSignal.timeout(Number(env.CIRRASCALE_TIMEOUT_MS || 30_000))
    });
    if (!response.ok) throw new Error(`cirrascale pricing page ${response.status}`);
    return cirrascaleHtmlToItems(await response.text(), { url });
  }
};

export function cirrascaleHtmlToItems(htmlText = "", { url = CIRRASCALE_PRICING_URL } = {}) {
  return extractCirrascalePlans(htmlText)
    .map((plan) => cirrascalePlanToItem(plan, { url }))
    .filter(Boolean);
}

export function extractCirrascalePlans(htmlText = "") {
  const plans = [];
  // Each SKU row's title sits in `plan-trigger__text--secondary` (e.g. "8X AMD MI300X");
  // category headers use `text--lg` and are ignored. We only accept titles starting with
  // "<N>X <NVIDIA|AMD>". We collect every SKU title position and bound each price search to
  // the span up to the next title — a card without its own price never borrows the next card's.
  const titleRe = /plan-trigger__text--secondary"[^>]*>\s*<div[^>]*>([\s\S]*?)<\/div>/gi;
  const titles = [];
  let m;
  while ((m = titleRe.exec(htmlText)) !== null) {
    const text = decodeEntities(m[1].replace(/<[^>]*>/g, " ")).replace(/[ ]/g, " ").replace(/\s+/g, " ").trim();
    titles.push({ index: m.index, text });
  }

  for (let i = 0; i < titles.length; i++) {
    const title = titles[i].text;
    const titleMatch = title.match(/^(\d+)\s*[xX]\s+(AMD|NVIDIA)\s+(.+)$/i);
    if (!titleMatch) continue;

    const end = i + 1 < titles.length ? titles[i + 1].index : titles[i].index + 4000;
    const block = htmlText.slice(titles[i].index, end);

    // Most cards use the term ladder ("$X/GPUhr Equivalent"); a few clustered cards use a
    // single "As low as $X per GPU hour" line instead.
    const priceMatch = block.match(/option__duration__hr">\$([0-9]+(?:\.[0-9]+)?)\/GPUhr/i)
      || block.match(/As low as\s*\$([0-9]+(?:\.[0-9]+)?)[\s\S]{0,120}?per GPU hour/i);
    if (!priceMatch) continue;

    const gpuCount = numberOrNull(titleMatch[1]);
    const vendor = titleMatch[2].toUpperCase() === "AMD" ? "AMD" : "NVIDIA";
    let model = titleMatch[3].replace(/\b(PRO|Blackwell|Server Edition|Standalone)\b/gi, " ");
    const vramMatch = model.match(/\((\d+)\s*GB\)/i);
    const vramGbEach = vramMatch ? numberOrNull(vramMatch[1]) : null;
    model = model.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();

    plans.push({
      title,
      vendor,
      model,
      gpuCount,
      vramGbEach,
      pricePerGpuHour: numberOrNull(priceMatch[1])
    });
  }
  return plans;
}

function cirrascalePlanToItem(plan, { url }) {
  const pricePerGpuHour = numberOrNull(plan.pricePerGpuHour);
  if (!plan.model || pricePerGpuHour == null || pricePerGpuHour <= 0) return null;

  const gpuCount = plan.gpuCount && plan.gpuCount > 0 ? plan.gpuCount : 1;
  const modelLabel = plan.vendor === "AMD" ? `AMD ${plan.model}` : plan.model;
  const gpuLabel = buildGpuLabel({ count: gpuCount, model: modelLabel, vramGb: plan.vramGbEach });

  return createInventoryItem({
    provider: "Cirrascale",
    providerId: "cirrascale",
    rawOfferId: `plan:${slug(plan.title)}`,
    gpuLabel,
    gpuCount,
    vramGbEach: plan.vramGbEach,
    pricePerGpuHour,
    totalHourlyPrice: round(pricePerGpuHour * gpuCount, 4),
    region: "Cirrascale",
    formFactor: "bare_metal",
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
      `Cirrascale "${plan.title}" per-GPU/hr equivalent parsed from the public pricing page`,
      "Headline/annual-term per-GPU rate; shorter terms (monthly/3-/6-month) cost more",
      "Reserved-term commitment SKU; no public provisioning/pricing API, so rows are a price catalog"
    ],
    metadata: compactMetadata({
      plan: plan.title,
      gpuModel: modelLabel,
      gpuCount,
      vramGbEach: plan.vramGbEach,
      pricePerGpuHourUsd: pricePerGpuHour,
      priceQualifier: "term_equivalent",
      billingGranularity: "hourly",
      sourceUrl: url
    }),
    rawPayload: { ...plan, sourceUrl: url }
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
