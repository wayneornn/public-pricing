import { createInventoryItem } from "../../../core/inventory.js";
import { jsonFetch, pickArray } from "../http.js";
import { buildGpuLabel, compactMetadata, fabricDataNote, numberOrNull, round, truthyEnv } from "../format.js";

// Hydra Host (Brokkr marketplace). Verified against the live API — both endpoints are
// PUBLIC (no auth):
//   GET https://brokkr.hydrahost.com/api/v1/inventory/category-prices       -> {category, startPrice}
//   GET https://brokkr.hydrahost.com/api/v1/inventory/category-availability -> {category, onDemandCount, reserveCount, preorderCount}
// We join by category into one row per GPU category: startPrice (USD, a "from" rate) +
// on-demand availability count. Bare-metal provisioning with a from-price, so rows are a
// priced catalog (provider_console), not a deep-link checkout. No key needed; enable with
// HYDRA_ENABLED=1. (id `hydra-host`; the reserved `hydra-cloud` console URL points at the
// dead hydracloud.ai domain, so we use the real hydrahost.com checkout.)
const HYDRA_API_BASE_URL = "https://brokkr.hydrahost.com/api/v1";

export const hydrahostConnector = {
  id: "hydra-host",
  name: "Hydra Host",
  envVars: ["HYDRA_ENABLED", "HYDRAHOST_ENABLED"],
  async fetch(env) {
    if (!truthyEnv(env.HYDRA_ENABLED) && !truthyEnv(env.HYDRAHOST_ENABLED)) return [];
    const base = (env.HYDRA_API_BASE_URL || HYDRA_API_BASE_URL).replace(/\/$/, "");
    const timeoutMs = Number(env.HYDRA_TIMEOUT_MS || 30_000);
    const [prices, availability] = await Promise.all([
      jsonFetch(`${base}/inventory/category-prices`, { headers: { Accept: "application/json" }, timeoutMs }),
      jsonFetch(`${base}/inventory/category-availability`, { headers: { Accept: "application/json" }, timeoutMs })
    ]);
    return hydraCategoriesToItems(pickArray(prices, ["data"]), pickArray(availability, ["data"]));
  }
};

export function hydraCategoriesToItems(prices = [], availability = []) {
  const availByCategory = new Map((availability || []).map((a) => [a.category, a]));
  return (prices || []).map((entry) => hydraRow(entry, availByCategory.get(entry.category))).filter(Boolean);
}

function hydraRow(priceEntry, avail = {}) {
  const price = numberOrNull(priceEntry.startPrice);
  if (price == null || price <= 0) return null;
  const category = String(priceEntry.category || "");
  const model = hydraModel(category);
  // VRAM only when the category states it explicitly (e.g. "...80gb"); otherwise leave
  // null so the taxonomy default applies.
  const vramGbEach = numberOrNull(category.match(/(\d{2,3})\s*gb/i)?.[1]);
  const gpuLabel = buildGpuLabel({ count: 1, model, vramGb: vramGbEach });
  const onDemand = Number(avail.onDemandCount) || 0;
  const reserve = Number(avail.reserveCount) || 0;
  const preorder = Number(avail.preorderCount) || 0;

  return createInventoryItem({
    provider: "Hydra Host",
    providerId: "hydra-host",
    rawOfferId: category.replace(/\s+/g, "-"),
    gpuLabel,
    gpuCount: 1,
    vramGbEach,
    pricePerGpuHour: round(price, 4),
    totalHourlyPrice: round(price, 4),
    region: "Hydra Host",
    formFactor: "bare_metal",
    interconnect: /sxm|nvl|hbm3/i.test(category) ? "NVLink" : "PCIe",
    networkFabric: "Not exposed",
    currency: "USD",
    availability: onDemand > 0 ? "available" : "unavailable",
    availabilityCount: onDemand,
    checkoutUrl: "https://hydrahost.com/",
    sourceMode: "live",
    listingType: "marketplace_category",
    priceScope: "gpu_sku_lowest",
    availabilitySemantics: "sku_capacity",
    dataNotes: [
      "Hydra Host Brokkr public marketplace — category starting (from) price",
      `On-demand: ${onDemand}, reserve: ${reserve}, preorder: ${preorder}`,
      fabricDataNote("Not exposed", gpuLabel, 1)
    ].filter(Boolean),
    metadata: compactMetadata({
      category,
      startPriceUsd: priceEntry.startPrice,
      onDemandCount: onDemand,
      reserveCount: reserve,
      preorderCount: preorder
    }),
    rawPayload: { ...priceEntry, ...avail }
  });
}

function hydraModel(category = "") {
  // Categories are lowercase like "nvidia geforce rtx 4090", "nvidia h100 nvl",
  // "nvidia rtx pro 6000 blackwell server edition" — strip vendor prefixes and let the
  // taxonomy resolve the model from what remains.
  return category
    .replace(/\bnvidia\b/gi, "")
    .replace(/\bgeforce\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}
