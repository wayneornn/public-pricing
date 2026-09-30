import { execFileSync } from "node:child_process";
import { createInventoryItem } from "../../../core/inventory.js";
import { jsonFetch, pickArray } from "../http.js";
import { buildGpuLabel, compactMetadata, truthyEnv } from "../format.js";

// Cloud TPUs are billed as SKUs under the Compute Engine billing service. The legacy
// "Cloud TPU" service (E000-3F24-B8AA) only carries deprecated v2/v3/v4 entries priced
// per-device with continent-scoped regions — a different unit semantics — so this connector
// deliberately reads only the modern Compute Engine service, whose TPU SKUs are clean,
// region-resolved, per-chip-hour on-demand rates (v5e/v5p/v6e/7x).
const GOOGLE_COMPUTE_ENGINE_SERVICE_ID = "6F81-5844-456A";

// HBM per chip (GB), documented hardware specs — used only as a spec lookup for display,
// never sourced from the billing SKU (the SKU exposes price, not memory).
const TPU_HBM_GB = {
  v2: 8,
  v3: 16,
  v4: 32,
  v5e: 16,
  v5p: 95,
  v6e: 32,
  "7x": 192
};

export const googleTpuConnector = {
  id: "google-tpu",
  name: "Google Cloud TPU",
  envVars: ["GOOGLE_CLOUD_API_KEY", "GCP_BILLING_API_KEY", "GCP_ACCESS_TOKEN", "GCP_USE_GCLOUD_AUTH"],
  async fetch(env) {
    if (!hasGoogleCatalogAuth(env)) return [];
    const skus = await fetchGoogleTpuSkus(env);
    return googleTpuSkusToItems(skus, env);
  }
};

export function googleTpuSkusToItems(skus, env = {}) {
  return skus
    .filter((sku) => isGoogleTpuSku(sku, env))
    .flatMap((sku) => googleTpuSkuToItems(sku, env));
}

async function fetchGoogleTpuSkus(env) {
  const skus = [];
  let pageToken = "";
  for (let page = 0; page < 20; page += 1) {
    const url = new URL(`https://cloudbilling.googleapis.com/v1/services/${GOOGLE_COMPUTE_ENGINE_SERVICE_ID}/skus`);
    url.searchParams.set("currencyCode", env.GCP_CURRENCY_CODE || "USD");
    url.searchParams.set("pageSize", "5000");
    const apiKey = env.GOOGLE_CLOUD_API_KEY || env.GCP_BILLING_API_KEY;
    if (apiKey) url.searchParams.set("key", apiKey);
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const data = await jsonFetch(url.toString(), { headers: googleTpuAuthHeaders(env) });
    skus.push(...pickArray(data, ["skus"]));
    pageToken = data.nextPageToken || "";
    if (!pageToken) break;
  }
  return skus;
}

function googleTpuSkuToItems(sku, env) {
  const price = googleTpuSkuPrice(sku);
  if (!price) return [];
  const type = parseTpuType(sku.description);
  if (!type) return [];
  const regions = googleTpuSkuRegions(sku);
  return regions.map((region) => createInventoryItem({
    provider: "Google Cloud TPU",
    providerId: "google-tpu",
    rawOfferId: `${sku.skuId || sku.name}:${region}`,
    gpuLabel: buildGpuLabel({ count: 1, model: `TPU ${type}`, vramGb: TPU_HBM_GB[type] || null }),
    gpuCount: 1,
    vramGbEach: TPU_HBM_GB[type] || null,
    pricePerGpuHour: price,
    totalHourlyPrice: price,
    currency: "USD",
    region,
    formFactor: "tpu_vm",
    interconnect: "ICI",
    networkFabric: "Not exposed",
    availability: "available",
    checkoutUrl: buildGoogleTpuUrl(env),
    sourceMode: "catalog",
    listingType: "pricing_catalog",
    priceScope: "gpu_sku_only",
    dataNotes: [
      "TPU on-demand price per chip-hour",
      "Host VM/CPU/RAM/disk excluded",
      "Capacity not checked",
      "ICI/network fabric not exposed by Billing SKU"
    ],
    metadata: compactMetadata({
      tpuType: type,
      skuId: sku.skuId,
      skuName: sku.name,
      description: sku.description,
      category: sku.category,
      serviceRegions: sku.serviceRegions,
      geoTaxonomy: sku.geoTaxonomy,
      pricingExpression: sku.pricingInfo?.at(-1)?.pricingExpression,
      pricingEffectiveTime: sku.pricingInfo?.at(-1)?.effectiveTime
    }),
    rawPayload: sku
  }));
}

export function isGoogleTpuSku(sku, env = {}) {
  const description = String(sku.description || "");
  const resourceGroup = String(sku.category?.resourceGroup || "");
  const usageType = String(sku.category?.usageType || "");
  if (resourceGroup !== "TPU") return false;
  if (!parseTpuType(description)) return false;
  // Spot / preemptible rows are dropped (the spot usageType is "Preemptible"; the modern
  // SKUs also carry "attached to Spot Preemptible VMs" in the description).
  if (/\b(preemptible|spot)\b/i.test(`${description} ${usageType}`)) return truthyEnv(env.GCP_INCLUDE_SPOT);
  // Keep only the plain pay-as-you-go on-demand rate. Reservation/calendar, Dynamic Workload
  // Scheduler (DWS) flex, capacity-optimized, subscription and committed-use SKUs are all
  // distinct pricing modes — excluded so a single clean on-demand price remains per type/region.
  if (usageType !== "OnDemand") return truthyEnv(env.GCP_INCLUDE_NON_ON_DEMAND);
  if (/\b(reserved|calendar mode|dws|defined duration|subscription|fixed price|commitment|capacity optimized)\b/i.test(description)) return false;
  return true;
}

// TPU generation as Google names it: "TpuV5e"->v5e, "TpuV5p"->v5p, "TpuV6e"->v6e,
// "TPU7x"/"Tpu7x"->7x, legacy "Tpu-v4"->v4, and "Reserved V5e TPU"->v5e.
export function parseTpuType(description = "") {
  const text = String(description || "");
  if (/TPU\s?7x/i.test(text)) return "7x";
  let m = text.match(/Tpu[-\s]?v(\d+[a-z]*)/i);
  if (m) return `v${m[1].toLowerCase()}`;
  m = text.match(/\bV(\d+[a-z]+)\s+TPU\b/i);
  if (m) return `v${m[1].toLowerCase()}`;
  return null;
}

function hasGoogleCatalogAuth(env) {
  return Boolean(env.GOOGLE_CLOUD_API_KEY || env.GCP_BILLING_API_KEY || env.GCP_ACCESS_TOKEN || truthyEnv(env.GCP_USE_GCLOUD_AUTH));
}

function googleTpuAuthHeaders(env) {
  const token = env.GCP_ACCESS_TOKEN || googleTpuGcloudAccessToken(env);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function googleTpuGcloudAccessToken(env) {
  if (!truthyEnv(env.GCP_USE_GCLOUD_AUTH)) return "";
  const command = env.GCP_GCLOUD_PATH || "gcloud";
  try {
    return execFileSync(command, ["auth", "print-access-token"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 8_000
    }).trim();
  } catch {
    return "";
  }
}

function googleTpuSkuPrice(sku) {
  const expression = sku.pricingInfo?.at(-1)?.pricingExpression;
  const unitPrice = expression?.tieredRates?.[0]?.unitPrice;
  if (!unitPrice) return null;
  const units = Number(unitPrice.units || 0);
  const nanos = Number(unitPrice.nanos || 0) / 1_000_000_000;
  const price = units + nanos;
  return Number.isFinite(price) && price > 0 ? price : null;
}

function googleTpuSkuRegions(sku) {
  const regions = Array.isArray(sku.serviceRegions) ? sku.serviceRegions.filter(Boolean) : [];
  if (regions.length) return regions;
  const geoRegions = Array.isArray(sku.geoTaxonomy?.regions) ? sku.geoTaxonomy.regions.filter(Boolean) : [];
  if (geoRegions.length) return geoRegions;
  const descriptionRegion = String(sku.description || "").match(/\brunning in\s+(.+)$/i)?.[1]?.trim();
  return [descriptionRegion || "Google Cloud"];
}

function buildGoogleTpuUrl(env) {
  const params = new URLSearchParams();
  const project = env.GCP_PROJECT_ID || env.GOOGLE_CLOUD_PROJECT || env.GCLOUD_PROJECT;
  if (project) params.set("project", project);
  const query = params.toString();
  return `https://console.cloud.google.com/compute/tpus${query ? `?${query}` : ""}`;
}
