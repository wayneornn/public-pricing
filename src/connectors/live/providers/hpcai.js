import { createInventoryItem } from "../../../core/inventory.js";
import { buildGpuLabel, compactMetadata, fabricFromText, numberOrNull, round, truthyEnv } from "../format.js";

// HPC-AI.com (HPC-AI Tech / Colossal-AI cloud) — full-machine 8-card SXM GPU rental.
//
// No usable public pricing API: the documented REST API (www.hpc-ai.com/api/) is
// JWT-login-gated and exposes only instance create/list/stop (no pricing, instance-type,
// or catalog endpoint), and every /api/* pricing path returns 401. The /pricing page
// renders no data server-side (an auth-gated XHR populates it).
//
// The public per-model SEO pages, however, embed a single on-demand per-GPU price in
// their Next.js RSC payload: GET https://www.hpc-ai.com/gpus/<slug> contains exactly one
// `"pricePerGpu":<usd>` for that page's model (h200 -> 2.5, b200 -> 4). The co-located
// `spotPricePerGpu` is spot/interruptible and is never emitted. Unpriced models (b300 ->
// "Contact") yield no row. Opt-in via HPCAI_ENABLED.
const HPCAI_BASE_URL = "https://www.hpc-ai.com";
const DEFAULT_SLUGS = ["h200", "b200"];

export const hpcaiConnector = {
  id: "hpc-ai",
  name: "HPC-AI.com",
  envVars: ["HPCAI_ENABLED"],
  async fetch(env) {
    if (!truthyEnv(env.HPCAI_ENABLED)) return [];
    const base = (env.HPCAI_BASE_URL || HPCAI_BASE_URL).replace(/\/$/, "");
    const slugs = parseSlugs(env.HPCAI_GPU_SLUGS) || DEFAULT_SLUGS;
    const timeoutMs = Number(env.HPCAI_TIMEOUT_MS || 30_000);

    const pages = await Promise.all(
      slugs.map(async (slug) => {
        const url = `${base}/gpus/${slug}`;
        const response = await fetch(url, {
          headers: { Accept: "text/html", "User-Agent": "gpu-deal-terminal" },
          signal: AbortSignal.timeout(timeoutMs)
        });
        if (!response.ok) throw new Error(`hpc-ai ${slug} page ${response.status}`);
        return { slug, url, html: await response.text() };
      })
    );

    return hpcaiPagesToItems(pages);
  }
};

export function hpcaiPagesToItems(pages = []) {
  return pages.map((page) => hpcaiPageToItem(page.html, page)).filter(Boolean);
}

export function hpcaiPageToItem(html = "", { slug = "", url = "" } = {}) {
  const model = modelFromSlug(slug);
  if (!model) return null;

  // On-demand per-GPU/hr USD. Spot (spotPricePerGpu/tidePricePerGpu) is never emitted.
  const pricePerGpuHour = numberOrNull(matchNumber(html, /"pricePerGpu\\?"\s*:\s*([0-9.]+)/));
  if (pricePerGpuHour == null || pricePerGpuHour <= 0) return null; // unpriced "Contact" models (e.g. B300)

  const gpuCount = numberOrNull(matchNumber(html, new RegExp(`(\\d+)\\s*x\\s*(?:NVIDIA\\s*)?${model}`, "i"))) || 8;
  const vramGbEach = numberOrNull(matchNumber(html, new RegExp(`${model}[\\sA-Za-z0-9-]{0,14}?(\\d{2,3})\\s*GB`, "i")));
  const variant = matchText(html, new RegExp(`${model}[\\s-]*?(SXM\\d?)`, "i"));
  const networkFabric = fabricFromText(/infiniband/i.test(html) ? "InfiniBand" : "");
  const totalHourlyPrice = round(pricePerGpuHour * gpuCount, 4);
  const gpuLabel = buildGpuLabel({ count: gpuCount, model, vramGb: vramGbEach, variant });

  return createInventoryItem({
    provider: "HPC-AI.com",
    providerId: "hpc-ai",
    rawOfferId: `gpus:${slug}`,
    gpuLabel,
    gpuCount,
    vramGbEach,
    pricePerGpuHour,
    totalHourlyPrice,
    region: "Global",
    formFactor: "bare_metal",
    interconnect: variant || "",
    networkFabric,
    currency: "USD",
    availability: "unknown",
    availabilityCount: null,
    checkoutUrl: url || `${HPCAI_BASE_URL}/gpus/${slug}`,
    sourceMode: "live",
    listingType: "gpu_sku_pricing",
    priceScope: "gpu_sku_only",
    availabilitySemantics: "price_only",
    dataNotes: [
      "HPC-AI.com on-demand per-GPU/hr USD parsed from the public /gpus/<model> page (full-machine 8-card SXM rental)",
      "Spot/tide (interruptible) prices on the page are never emitted",
      "No public pricing API: the documented REST API is JWT-login-gated and exposes only instance create/list/stop, and the /pricing page is populated by an auth-gated XHR",
      "Page lists a price but no live stock/capacity or exact deploy listing route"
    ],
    metadata: compactMetadata({
      slug,
      gpuModel: model,
      variant,
      vramGbEach,
      gpuCount,
      pricePerGpuHourUsd: pricePerGpuHour,
      billingGranularity: "per-second",
      sourceUrl: url
    }),
    rawPayload: { slug, model, pricePerGpuHour, gpuCount, vramGbEach, variant, sourceUrl: url }
  });
}

function modelFromSlug(slug) {
  const text = String(slug || "").trim().toUpperCase();
  if (/^(H100|H200|B200|B300|A100|GH200)$/.test(text)) return text;
  if (/^(4090|5090)$/.test(text)) return `RTX ${text}`;
  if (/^RTX(4090|5090)$/.test(text)) return `RTX ${text.slice(3)}`;
  return "";
}

function matchNumber(html, regex) {
  const m = String(html).match(regex);
  return m ? m[1] : null;
}

function matchText(html, regex) {
  const m = String(html).match(regex);
  return m ? m[1] : "";
}

function parseSlugs(value) {
  if (!value) return null;
  const list = String(value)
    .split(/[\s,]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.length ? list : null;
}
