import { execFileSync } from "node:child_process";
import { createInventoryItem } from "../../../core/inventory.js";
import { jsonFetch, pickArray } from "../http.js";
import { buildGpuLabel, compactMetadata, truthyEnv } from "../format.js";

const GOOGLE_COMPUTE_ENGINE_SERVICE_ID = "6F81-5844-456A";

export const googleCloudConnector = {
  id: "google-cloud",
  name: "Google Cloud",
  envVars: ["GOOGLE_CLOUD_API_KEY", "GCP_BILLING_API_KEY", "GCP_ACCESS_TOKEN", "GCP_USE_GCLOUD_AUTH"],
  async fetch(env) {
    if (!hasGoogleCatalogAuth(env)) return [];
    const skus = await fetchGoogleCloudSkus(env);
    return skus
      .filter((sku) => isGoogleCloudGpuSku(sku, env))
      .flatMap((sku) => googleCloudSkuToItems(sku, env));
  }
};

async function fetchGoogleCloudSkus(env) {
  const skus = [];
  let pageToken = "";
  for (let page = 0; page < 20; page += 1) {
    const url = new URL(`https://cloudbilling.googleapis.com/v1/services/${GOOGLE_COMPUTE_ENGINE_SERVICE_ID}/skus`);
    url.searchParams.set("currencyCode", env.GCP_CURRENCY_CODE || "USD");
    url.searchParams.set("pageSize", "5000");
    const apiKey = env.GOOGLE_CLOUD_API_KEY || env.GCP_BILLING_API_KEY;
    if (apiKey) url.searchParams.set("key", apiKey);
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const data = await jsonFetch(url.toString(), { headers: googleCloudAuthHeaders(env) });
    skus.push(...pickArray(data, ["skus"]));
    pageToken = data.nextPageToken || "";
    if (!pageToken) break;
  }
  return skus;
}

function googleCloudSkuToItems(sku, env) {
  const price = googleCloudSkuPrice(sku);
  if (!price) return [];
  const regions = googleCloudSkuRegions(sku);
  const accelerator = googleCloudAcceleratorType(sku.description);
  return regions.map((region) => createInventoryItem({
    provider: "Google Cloud",
    providerId: "google-cloud",
    rawOfferId: `${sku.skuId || sku.name}:${region}`,
    gpuLabel: googleCloudGpuLabel(sku.description),
    gpuCount: googleCloudGpuCount(sku.description),
    vramGbEach: googleCloudVram(sku.description),
    pricePerGpuHour: price,
    totalHourlyPrice: price,
    region,
    formFactor: "vm",
    interconnect: googleCloudInterconnect(sku.description),
    networkFabric: "Not exposed",
    availability: "available",
    checkoutUrl: buildGoogleCloudUrl(env, accelerator),
    sourceMode: "catalog",
    listingType: "pricing_catalog",
    priceScope: "gpu_sku_only",
    dataNotes: [
      "GPU SKU price",
      "CPU/RAM/disk excluded",
      "Capacity not checked",
      "NIC/fabric not exposed by Billing SKU"
    ],
    metadata: compactMetadata({
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

function isGoogleCloudGpuSku(sku, env) {
  const description = String(sku.description || "");
  const resourceGroup = String(sku.category?.resourceGroup || "");
  const usageType = String(sku.category?.usageType || "");
  if (!/\b(gpu|nvidia|tesla|b300|gb300|gb200|b200|h200|h100|a100|l40s|l40|l4|v100|p100|p4|t4|k80)\b/i.test(description)) return false;
  if (!/gpu/i.test(resourceGroup) && !/\b(gpu|nvidia|tesla)\b/i.test(description)) return false;
  if (/canonical/i.test(resourceGroup)) return false;
  if (/\b(commit|committed|reservation|licen[sc](?:e|ing)|ubuntu|rhel|red hat|sles|windows|fips|workstation|sole tenancy|network|storage|disk|snapshot|egress|ingress)\b/i.test(description)) return false;
  if (/\b(preemptible|spot)\b/i.test(`${description} ${usageType}`)) return truthyEnv(env.GCP_INCLUDE_SPOT);
  if (usageType && !/ondemand/i.test(usageType) && !truthyEnv(env.GCP_INCLUDE_NON_ON_DEMAND)) return false;
  return true;
}

function hasGoogleCatalogAuth(env) {
  return Boolean(env.GOOGLE_CLOUD_API_KEY || env.GCP_BILLING_API_KEY || env.GCP_ACCESS_TOKEN || truthyEnv(env.GCP_USE_GCLOUD_AUTH));
}

function googleCloudAuthHeaders(env) {
  const token = env.GCP_ACCESS_TOKEN || googleCloudGcloudAccessToken(env);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function googleCloudGcloudAccessToken(env) {
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

function googleCloudSkuPrice(sku) {
  const expression = sku.pricingInfo?.at(-1)?.pricingExpression;
  const unitPrice = expression?.tieredRates?.[0]?.unitPrice;
  if (!unitPrice) return null;
  const units = Number(unitPrice.units || 0);
  const nanos = Number(unitPrice.nanos || 0) / 1_000_000_000;
  const price = units + nanos;
  return Number.isFinite(price) && price > 0 ? price : null;
}

function googleCloudSkuRegions(sku) {
  const regions = Array.isArray(sku.serviceRegions) ? sku.serviceRegions.filter(Boolean) : [];
  if (regions.length) return regions;
  const geoRegions = Array.isArray(sku.geoTaxonomy?.regions) ? sku.geoTaxonomy.regions.filter(Boolean) : [];
  if (geoRegions.length) return geoRegions;
  const descriptionRegion = String(sku.description || "").match(/\brunning in\s+(.+)$/i)?.[1]?.trim();
  return [descriptionRegion || "Google Cloud"];
}

function googleCloudGpuLabel(description = "") {
  const text = String(description || "");
  const accelerator = googleCloudAcceleratorType(text);
  const variant = /sxm|a3|a4|gb200|gb300|b200|h200|h100-mega/i.test(text) ? "SXM" : "";
  return buildGpuLabel({
    count: googleCloudGpuCount(text),
    model: accelerator || text,
    vramGb: googleCloudVram(text),
    variant
  });
}

function googleCloudAcceleratorType(description = "") {
  const text = String(description || "");
  const match = text.match(/\b(GB300|GB200|B300|B200|H200|H100|A100|L40S|L40|L4|V100|P100|P4|T4|K80)\b/i);
  return match ? match[1].toUpperCase() : "";
}

function googleCloudGpuCount(description = "") {
  const text = String(description || "");
  const explicit = text.match(/\b(\d+)\s*x\s*(?:NVIDIA\s*)?(?:GB300|GB200|B300|B200|H200|H100|A100|L40S|L40|L4|V100|P100|P4|T4|K80)\b/i);
  return explicit ? Number(explicit[1]) : 1;
}

function googleCloudVram(description = "") {
  const text = String(description || "");
  const explicit = text.match(/\b(\d{2,4})\s*GB\b/i);
  if (explicit) return Number(explicit[1]);
  const accelerator = googleCloudAcceleratorType(text);
  const defaults = {
    GB300: 288,
    GB200: 186,
    B300: 288,
    B200: 180,
    H200: 141,
    H100: 80,
    A100: 80,
    L40S: 48,
    L40: 48,
    L4: 24,
    V100: 32,
    P100: 16,
    P4: 8,
    T4: 16,
    K80: 12
  };
  return defaults[accelerator] || null;
}

function googleCloudInterconnect(description = "") {
  const text = String(description || "");
  if (/\b(a3|a4|gb300|gb200|b200|h200|h100)\b/i.test(text)) return "NVLink";
  return "PCIe";
}

function buildGoogleCloudUrl(env, accelerator) {
  const params = new URLSearchParams();
  const project = env.GCP_PROJECT_ID || env.GOOGLE_CLOUD_PROJECT || env.GCLOUD_PROJECT;
  if (project) params.set("project", project);
  if (accelerator) params.set("accelerator", accelerator.toLowerCase());
  const query = params.toString();
  return `https://console.cloud.google.com/compute/instancesAdd${query ? `?${query}` : ""}`;
}
