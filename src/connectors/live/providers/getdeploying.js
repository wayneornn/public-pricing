import { createInventoryItem } from "../../../core/inventory.js";
import { buildGpuLabel, compactMetadata, numberOrNull, round, truthyEnv } from "../format.js";

// getDeploying (getdeploying.com) — a GPU price-comparison aggregator / meta-source (like the
// integrated gpulist.ai). No public API, but the reference pages are server-rendered:
//   - Index `/reference/cloud-gpu` lists one row per GPU model:
//       <tr data-gpu data-name="Nvidia H100" data-vram="80.0" data-minprice="..." data-providers="45" ...>
//   - Each model detail `/reference/cloud-gpu/<slug>` (slug = name lowercased, non-alnum→'-')
//     lists per-provider offerings:
//       <tr data-offering-id="120528" data-provider="lyceum" data-billing="ON_DEMAND"
//           data-gpu-count="1" data-vram="80" data-price="2.7900" data-price-per-gpu="2.79"
//           data-availability="UNKNOWN" data-source-url-organic="https://…/pricing">
// We emit ON_DEMAND offerings only (SPOT/RESERVED dropped — the repo never surfaces spot, and
// reserved isn't on-demand supply). Because providers overlap with direct integrations and the
// rows have no live capacity, this is a non-orderable cross-check catalog (provider_console).
// To stay light we expand only the top-N mainstream models by provider count. Opt-in via
// GETDEPLOYING_ENABLED=1; override the model set with GETDEPLOYING_MODELS (comma-separated
// slugs) and GETDEPLOYING_MAX_MODELS.
const GETDEPLOYING_BASE_URL = "https://www.getdeploying.com";
const DEFAULT_MAX_MODELS = 12;
const DEFAULT_DETAIL_CONCURRENCY = 4;

export const getdeployingConnector = {
  id: "getdeploying",
  name: "getDeploying",
  envVars: ["GETDEPLOYING_ENABLED"],
  async fetch(env) {
    if (!truthyEnv(env.GETDEPLOYING_ENABLED)) return [];
    const base = (env.GETDEPLOYING_BASE_URL || GETDEPLOYING_BASE_URL).replace(/\/$/, "");
    const timeoutMs = Number(env.GETDEPLOYING_TIMEOUT_MS || 30_000);

    const indexHtml = await fetchText(`${base}/reference/cloud-gpu`, timeoutMs);
    const models = selectGetdeployingModels(parseGetdeployingIndex(indexHtml), env);

    const items = [];
    const detailPages = await fetchGetdeployingDetails(models, base, env, timeoutMs);
    for (const { model, detailHtml } of detailPages) {
      for (const offering of parseGetdeployingDetail(detailHtml)) {
        const item = getdeployingOfferingToItem(offering, model, base);
        if (item) items.push(item);
      }
    }
    return items;
  }
};

async function fetchGetdeployingDetails(models, base, env, timeoutMs) {
  const concurrency = Math.max(1, Number(env.GETDEPLOYING_DETAIL_CONCURRENCY || DEFAULT_DETAIL_CONCURRENCY));
  const results = [];
  let index = 0;

  async function worker() {
    while (index < models.length) {
      const model = models[index++];
      try {
        const detailHtml = await fetchText(`${base}/reference/cloud-gpu/${model.slug}`, timeoutMs);
        results.push({ model, detailHtml });
      } catch {
        // A missing/renamed model page must not fail the whole connector.
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, models.length) }, worker));
  return results;
}

export function parseGetdeployingIndex(html = "") {
  const models = [];
  for (const m of String(html).matchAll(/<tr\b[^>]*\bdata-gpu\b[^>]*>/gi)) {
    const tag = m[0];
    const name = attr(tag, "data-name");
    if (!name) continue;
    models.push({
      name,
      slug: slug(name),
      vramGb: numberOrNull(attr(tag, "data-vram")),
      providers: numberOrNull(attr(tag, "data-providers")) || 0,
      segment: attr(tag, "data-segment") || ""
    });
  }
  return models;
}

// Default: the most-covered mainstream models (by provider count), capped. Overridable with an
// explicit GETDEPLOYING_MODELS slug allowlist.
export function selectGetdeployingModels(models, env = {}) {
  const allow = String(env.GETDEPLOYING_MODELS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (allow.length) return models.filter((m) => allow.includes(m.slug));
  const max = Number(env.GETDEPLOYING_MAX_MODELS) || DEFAULT_MAX_MODELS;
  return [...models].sort((a, b) => b.providers - a.providers).slice(0, max);
}

export function parseGetdeployingDetail(html = "") {
  const offerings = [];
  for (const m of String(html).matchAll(/<tr\b[^>]*\bdata-offering-id="[^"]+"[^>]*>/gi)) {
    const tag = m[0];
    if (attr(tag, "data-billing") !== "ON_DEMAND") continue; // drop spot/reserved/committed
    const pricePerGpu = numberOrNull(attr(tag, "data-price-per-gpu"));
    const provider = attr(tag, "data-provider");
    if (!provider || pricePerGpu == null || pricePerGpu <= 0) continue;
    offerings.push({
      offeringId: attr(tag, "data-offering-id"),
      provider,
      gpuCount: numberOrNull(attr(tag, "data-gpu-count")) || 1,
      vramGb: numberOrNull(attr(tag, "data-vram")),
      pricePerGpuHour: pricePerGpu,
      totalHourlyPrice: numberOrNull(attr(tag, "data-price")),
      availability: attr(tag, "data-availability") || "UNKNOWN",
      sourceUrl: decodeEntities(attr(tag, "data-source-url-organic") || "")
    });
  }
  return offerings;
}

function getdeployingOfferingToItem(offering, model, base) {
  const pricePerGpuHour = numberOrNull(offering.pricePerGpuHour);
  if (pricePerGpuHour == null || pricePerGpuHour <= 0) return null;

  const gpuCount = offering.gpuCount && offering.gpuCount > 0 ? offering.gpuCount : 1;
  const vramGbEach = offering.vramGb || model.vramGb || null;
  const modelName = cleanModel(model.name);
  const gpuLabel = buildGpuLabel({ count: gpuCount, model: modelName, vramGb: vramGbEach });
  const sourceProvider = titleCase(offering.provider);

  return createInventoryItem({
    provider: "getDeploying",
    providerId: "getdeploying",
    rawOfferId: `gd:${offering.offeringId || `${offering.provider}:${model.slug}`}`,
    gpuLabel,
    gpuCount,
    vramGbEach,
    pricePerGpuHour,
    totalHourlyPrice: round(offering.totalHourlyPrice || pricePerGpuHour * gpuCount, 4),
    region: sourceProvider,
    formFactor: "vm",
    networkFabric: "Not exposed",
    currency: "USD",
    availability: "unknown",
    availabilityCount: null,
    checkoutUrl: offering.sourceUrl || `${base}/reference/cloud-gpu/${model.slug}`,
    sourceMode: "live",
    listingType: "aggregator_listing",
    priceScope: "gpu_sku",
    availabilitySemantics: "price_only",
    dataNotes: [
      `getDeploying aggregator: ${sourceProvider} on-demand per-GPU/hr for ${modelName}, from the public price-comparison reference page`,
      "Meta-source cross-check — providers overlap with direct integrations; on-demand only (spot/reserved dropped); no live capacity, so non-orderable"
    ],
    metadata: compactMetadata({
      sourceProvider: offering.provider,
      offeringId: offering.offeringId,
      gpuModel: model.name,
      gpuCount,
      vramGbEach,
      pricePerGpuHourUsd: pricePerGpuHour,
      providerPricingUrl: offering.sourceUrl,
      billing: "on_demand",
      aggregator: "getdeploying"
    }),
    rawPayload: { ...offering, model: model.name }
  });
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`${name}="([^"]*)"`, "i"));
  return m ? m[1] : null;
}

function slug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function cleanModel(value = "") {
  return String(value || "")
    .replace(/\b(NVIDIA|AMD|Instinct|GeForce|Tesla)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCase(value = "") {
  return String(value || "")
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function decodeEntities(value = "") {
  return String(value).replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'");
}

async function fetchText(url, timeoutMs) {
  const response = await fetch(url, {
    headers: { Accept: "text/html", "User-Agent": "gpu-deal-terminal" },
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) throw new Error(`getdeploying ${url} ${response.status}`);
  return response.text();
}
