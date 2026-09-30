import fs from "node:fs";
import path from "node:path";
import { fetchInventory, providerConfigs } from "../src/connectors/index.js";
import { primeDefaultResourceHourlyPrice } from "../src/connectors/live.js";
import { fxRateToUsd } from "../src/core/inventory.js";

const KEYED_PROVIDERS = [
  "runpod",
  "vast-ai",
  "shadeform",
  "prime-intellect",
  "lambda",
  "crusoe",
  "cudo",
  "sesterce",
  "clore-ai"
];

const OPTIONAL_PROVIDER_ENVS = {
  "google-cloud": ["GOOGLE_CLOUD_API_KEY", "GCP_BILLING_API_KEY", "GCP_ACCESS_TOKEN", "GCP_USE_GCLOUD_AUTH"],
  aws: ["AWS_GPU_INVENTORY_ENABLED", "AWS_ACCESS_KEY_ID", "AWS_PROFILE", "AWS_WEB_IDENTITY_TOKEN_FILE", "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI", "AWS_CONTAINER_CREDENTIALS_FULL_URI"],
  azure: ["AZURE_GPU_INVENTORY_ENABLED", "AZURE_SUBSCRIPTION_ID", "AZURE_ACCESS_TOKEN", "AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET", "AZURE_TENANT_ID", "AZURE_FEDERATED_TOKEN_FILE"],
  oci: ["OCI_GPU_INVENTORY_ENABLED", "OCI_CONFIG_FILE", "OCI_PROFILE", "OCI_TENANCY_OCID", "OCI_USER_OCID", "OCI_FINGERPRINT", "OCI_PRIVATE_KEY", "OCI_PRIVATE_KEY_FILE", "OCI_RESOURCE_PRINCIPAL_VERSION"],
  "together-ai": ["TOGETHER_API_KEY"],
  "voltage-park": ["VOLTAGE_PARK_API_KEY", "VOLTAGEGPU_API_KEY"],
  hyperstack: ["HYPERSTACK_API_KEY"],
  gmi: ["GMI_API_KEY"],
  gcore: ["GCORE_API_KEY"],
  "verda-datacrunch": ["DATACRUNCH_CLIENT_ID", "DATACRUNCH_CLIENT_SECRET", "DATACRUNCH_ACCESS_TOKEN", "DATACRUNCH_API_KEY"],
  vultr: ["VULTR_API_KEY"],
  scaleway: ["SCW_SECRET_KEY", "SCW_ACCESS_KEY", "SCW_PROJECT_ID", "SCW_ZONES"],
  tensordock: ["TENSORDOCK_API_TOKEN"],
  latitude: ["LATITUDE_API_KEY", "LATITUDESH_BEARER"],
  "massed-compute": ["MASSED_COMPUTE_API_KEY"],
  "e2e-cloud": ["E2E_API_KEY", "E2E_AUTH_TOKEN"]
};

const rootDir = path.resolve(import.meta.dirname, "..");
const env = loadEnv(path.join(rootDir, ".env"));
const auditedProviders = [...new Set([
  ...KEYED_PROVIDERS,
  ...Object.entries(OPTIONAL_PROVIDER_ENVS)
    .filter(([, keys]) => keys.some((key) => hasEnvValue(env[key])))
    .map(([providerId]) => providerId),
  // Safety net: never silently skip a live-capable provider whose keys are configured,
  // even if it is missing from OPTIONAL_PROVIDER_ENVS above.
  ...providerConfigs
    .filter((provider) => provider.supportsLive && (provider.envVars || []).some((key) => hasEnvValue(env[key])))
    .map((provider) => provider.id)
])];
const snapshot = await fetchInventory({ env, mode: "live", now: new Date() });
const failures = [];
const warnings = [];

for (const providerId of auditedProviders) {
  const health = snapshot.providerHealth.find((provider) => provider.id === providerId);
  if (!health) {
    failures.push(`${providerId}: provider missing from health registry`);
    continue;
  }
  if (health.status !== "live") failures.push(`${providerId}: status is ${health.status}${health.error ? ` (${health.error})` : ""}`);
  if (!health.itemCount) warnings.push(`${providerId}: live but returned 0 rows`);
}

for (const item of snapshot.items) {
  if (!auditedProviders.includes(item.providerId)) continue;
  if (!item.rawPayload) failures.push(`${item.providerId}:${item.rawOfferId}: missing raw payload`);
  if (item.gpuModel === "Unknown") warnings.push(`${item.providerId}:${item.rawOfferId}: unknown GPU label "${item.gpuLabel}"`);
  if (item.region === "Unknown") warnings.push(`${item.providerId}:${item.rawOfferId}: missing normalized region`);
  if (item.pricePerGpuHour == null && item.totalHourlyPrice == null) {
    if (allowsUnpriced(item)) {
      warnings.push(`${item.providerId}:${item.rawOfferId}: price not returned by provider API`);
    } else {
      failures.push(`${item.providerId}:${item.rawOfferId}: missing price`);
    }
  }
  if (/cpu/i.test(item.gpuLabel) || /cpu/i.test(item.gpuModel)) {
    failures.push(`${item.providerId}:${item.rawOfferId}: CPU-only row leaked into GPU inventory`);
  }
  auditProviderMath(item, failures);
}

const byProvider = Object.fromEntries(auditedProviders.map((providerId) => {
  const rows = snapshot.items.filter((item) => item.providerId === providerId);
  return [providerId, {
    rows: rows.length,
    priced: rows.filter((item) => item.pricePerGpuHour != null || item.totalHourlyPrice != null).length,
    unknownGpu: rows.filter((item) => item.gpuModel === "Unknown").length,
    available: rows.filter((item) => item.availability === "available").length
  }];
}));

console.log(JSON.stringify({
  totalRows: snapshot.items.length,
  mode: snapshot.mode,
  byProvider,
  warnings: warnings.slice(0, 50),
  warningCount: warnings.length,
  failures
}, null, 2));

if (failures.length) process.exitCode = 1;

function auditProviderMath(item, failures) {
  const raw = item.rawPayload || {};
  let expectedCount = null;
  let expectedTotal = null;
  let expectedPerGpu = null;

  if (item.providerId === "shadeform") {
    expectedCount = Number(raw.configuration?.num_gpus ?? raw.num_gpus ?? 1);
    expectedTotal = priceFromCentsLike(raw.hourly_price);
    expectedPerGpu = expectedTotal / expectedCount;
  } else if (item.providerId === "prime-intellect") {
    expectedCount = Number(raw.gpuCount || 1);
    const baseTotal = numberOrNull(raw.prices?.onDemand);
    expectedTotal = baseTotal ? baseTotal + primeDefaultResourceHourlyPrice(raw) : null;
    expectedPerGpu = expectedTotal ? expectedTotal / expectedCount : null;
  } else if (item.providerId === "vast-ai") {
    expectedCount = Number(raw.num_gpus || raw.gpu_count || 1);
    expectedTotal = numberOrNull(raw.dph_total || raw.dph_base || raw.price_per_hour);
    expectedPerGpu = expectedTotal ? expectedTotal / expectedCount : null;
  } else if (item.providerId === "lambda") {
    expectedCount = Number(raw.gpu_count || raw.gpus || raw.instance_type?.gpu_count || raw.instance_type?.specs?.gpus || raw.specs?.gpus || 1);
    expectedTotal = centsToDollars(raw.price_cents_per_hour || raw.instance_type?.price_cents_per_hour);
    expectedPerGpu = expectedTotal ? expectedTotal / expectedCount : null;
  } else if (item.providerId === "sesterce") {
    expectedCount = Number(raw.gpuCount || 1);
    expectedTotal = numberOrNull(raw.hourlyPrice);
    expectedPerGpu = expectedTotal ? expectedTotal / expectedCount : null;
  } else if (item.providerId === "cudo") {
    if (item.rawOfferId.startsWith("vm:")) {
      // CUDO VMs are configurable (1..maxGpuFree GPUs, priced per GPU), so the
      // priced/rentable unit is a single GPU and maxGpuFree is an availability
      // count, not a node size — mirrors the TensorDock per-GPU marketplace
      // handling below.
      expectedCount = 1;
      expectedPerGpu = numberOrNull(raw.gpuPriceHr?.value);
      expectedTotal = expectedPerGpu;
      const expectedAvailable = Number(raw.maxGpuFree ?? raw.totalGpuFree ?? 0);
      assertEqualNumber(failures, item, "availabilityCount", item.availabilityCount, expectedAvailable);
    } else {
      expectedCount = Number(raw.gpus || 1);
      expectedTotal = numberOrNull(raw.prices?.find((price) => price.commitmentTerm === "COMMITMENT_TERM_NONE")?.priceHr?.value || raw.prices?.[0]?.priceHr?.value);
      expectedPerGpu = expectedTotal ? expectedTotal / expectedCount : null;
    }
  } else if (item.providerId === "crusoe") {
    expectedCount = Number(String(raw.type || "").match(/[.-](\d+)x$/i)?.[1] || 1);
  } else if (item.providerId === "runpod") {
    expectedCount = Number(raw.gpuCount || 1);
    expectedPerGpu = numberOrNull(raw.lowestPrice?.uninterruptablePrice);
    expectedTotal = expectedPerGpu ? expectedPerGpu * expectedCount : null;
  } else if (item.providerId === "google-cloud") {
    expectedCount = 1;
    expectedPerGpu = googleCloudSkuPrice(raw);
    expectedTotal = expectedPerGpu;
  } else if (item.providerId === "aws") {
    expectedCount = numberOrNull(raw.gpu_count);
    expectedTotal = numberOrNull(raw.on_demand_price_usd_per_hour) ?? numberOrNull(raw.spot_price_usd_per_hour);
    expectedPerGpu = expectedTotal ? expectedTotal / expectedCount : null;
  } else if (item.providerId === "azure") {
    expectedCount = numberOrNull(raw.gpu_count);
    expectedTotal = numberOrNull(raw.on_demand_price_usd_per_hour);
    expectedPerGpu = expectedTotal ? expectedTotal / expectedCount : null;
  } else if (item.providerId === "oci") {
    expectedCount = numberOrNull(raw.gpu_count);
    expectedTotal = numberOrNull(raw.on_demand_price_usd_per_hour);
    expectedPerGpu = expectedTotal ? expectedTotal / expectedCount : null;
  } else if (item.providerId === "voltage-park") {
    if (raw.hostnode && raw.gpuKey) {
      expectedCount = Number(raw.hostnode.available_resources?.gpus?.[raw.gpuKey]?.count || 1);
      expectedTotal = voltageParkHostnodeTotalPrice(raw.hostnode, raw.gpuKey, expectedCount);
      expectedPerGpu = expectedTotal ? expectedTotal / expectedCount : numberOrNull(raw.hostnode.pricing?.per_gpu_hr?.[raw.gpuKey]);
    } else {
      expectedCount = Number(raw.gpu_count || raw.gpuCount || raw.k || 1);
      expectedTotal = numberOrNull(raw.price ?? raw.rental_rate ?? raw.hourly_price ?? raw.cost_per_hour);
      expectedPerGpu = expectedTotal ? expectedTotal / expectedCount : null;
    }
  } else if (item.providerId === "gcore") {
    expectedCount = Number(raw.hardware_properties?.gpu_count || raw.gpu_count || 1);
    expectedTotal = numberOrNull(raw.price_per_hour ?? raw.pricePerHour ?? raw.price?.price_per_hour ?? raw.total_price_per_hour ?? raw.per_hour?.flavor ?? raw.prices?.per_hour?.flavor ?? raw.pricing?.price_per_hour);
    expectedPerGpu = expectedTotal ? expectedTotal / expectedCount : null;
  } else if (item.providerId === "gmi") {
    expectedCount = Number(String(raw.spec?.basic?.find((entry) => /gpu/i.test(entry.name || ""))?.value || raw.name || "").match(/\bx\s*(\d+)\b/i)?.[1] || 1);
    expectedTotal = gmiPriceToDollars(raw.price);
    expectedPerGpu = expectedTotal ? expectedTotal / expectedCount : null;
  } else if (item.providerId === "hyperstack") {
    expectedCount = Number(raw.gpu_count || raw.gpuCount || 1);
    expectedTotal = numberOrNull(raw.price_per_hour ?? raw.hourly_price ?? raw.pricePerHour ?? raw.price);
    expectedPerGpu = expectedTotal ? expectedTotal / expectedCount : null;
  } else if (item.providerId === "together-ai") {
    expectedCount = Number(String(item.rawOfferId || "").match(/\b(\d+)\s*x/i)?.[1] || 1);
  } else if (item.providerId === "verda-datacrunch") {
    expectedCount = Number(raw.gpu?.number_of_gpus || 1);
    expectedTotal = numberOrNull(item.rawOfferId.startsWith("spot:") ? raw.spot_price : raw.price_per_hour);
    expectedPerGpu = expectedTotal ? expectedTotal / expectedCount : null;
  } else if (item.providerId === "vultr") {
    expectedCount = item.gpuCount;
    expectedTotal = numberOrNull(raw.hourly_cost);
    expectedPerGpu = expectedTotal ? expectedTotal / expectedCount : null;
  } else if (item.providerId === "scaleway") {
    expectedCount = Number(raw.gpu || 1);
    expectedTotal = numberOrNull(raw.hourly_price);
    expectedPerGpu = expectedTotal ? expectedTotal / expectedCount : null;
  } else if (item.providerId === "tensordock") {
    // TensorDock is a per-GPU marketplace: the priced/rentable unit is a single
    // GPU and `max_count` is the available pool size (an availability count),
    // not a node configuration.
    expectedCount = 1;
    expectedPerGpu = numberOrNull(raw.gpu?.price_per_hr);
    expectedTotal = expectedPerGpu;
    const expectedAvailable = Number(raw.gpu?.max_count || raw.gpu?.availableCount || 0);
    assertEqualNumber(failures, item, "availabilityCount", item.availabilityCount, expectedAvailable);
  } else if (item.providerId === "latitude") {
    expectedCount = Number(raw.plan?.attributes?.specs?.gpu?.count || 1);
    expectedTotal = numberOrNull(raw.region?.pricing?.USD?.hour);
    expectedPerGpu = expectedTotal ? expectedTotal / expectedCount : null;
  } else if (item.providerId === "massed-compute") {
    expectedCount = Number(String(raw.instance_type?.description || raw.productName || "").match(/\b(\d+)\s*x/i)?.[1] || 1);
    expectedTotal = centsToDollars(raw.instance_type?.price_cents_per_hour);
    expectedPerGpu = expectedTotal ? expectedTotal / expectedCount : null;
  } else if (item.providerId === "digitalocean") {
    expectedCount = Number(raw.gpu_info?.count || 1);
    expectedTotal = numberOrNull(raw.price_hourly);
    expectedPerGpu = expectedTotal ? expectedTotal / expectedCount : null;
  }

  // Expected prices are computed from the native-currency raw payload; items
  // are normalized to USD, so convert expectations with the same FX rate.
  const fx = fxRateToUsd(item.nativeCurrency || item.currency);
  assertEqualNumber(failures, item, "gpuCount", item.gpuCount, expectedCount);
  assertEqualNumber(failures, item, "pricePerGpuHour", item.pricePerGpuHour, expectedPerGpu == null ? null : expectedPerGpu * fx);
  assertEqualNumber(failures, item, "totalHourlyPrice", item.totalHourlyPrice, expectedTotal == null ? null : expectedTotal * fx);
}

function allowsUnpriced(item) {
  return item.providerId === "crusoe"
    || item.providerId === "together-ai"
    || item.sourceMode === "catalog"
    || item.priceScope === "unknown"
    || /unpriced/i.test(item.priceScope || "");
}

function assertEqualNumber(failures, item, field, actual, expected) {
  if (expected == null || Number.isNaN(Number(expected))) return;
  if (round(actual) !== round(expected)) {
    failures.push(`${item.providerId}:${item.rawOfferId}: ${field} got ${actual}, expected ${round(expected)}`);
  }
}

function loadEnv(filePath) {
  const loaded = { ...process.env };
  if (!fs.existsSync(filePath)) return loaded;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    loaded[trimmed.slice(0, index)] = trimmed.slice(index + 1).replace(/^"|"$/g, "");
  }
  return loaded;
}

function priceFromCentsLike(value) {
  const parsed = numberOrNull(value);
  if (!parsed) return null;
  return parsed > 20 ? parsed / 100 : parsed;
}

function centsToDollars(value) {
  const parsed = numberOrNull(value);
  return parsed ? parsed / 100 : null;
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function round(value) {
  if (value == null || Number.isNaN(Number(value))) return null;
  return Math.round(Number(value) * 10000) / 10000;
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

function gmiPriceToDollars(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  if (parsed > 100_000) return parsed / 1_000_000;
  if (parsed > 1_000) return parsed / 100;
  return parsed;
}

function voltageParkHostnodeTotalPrice(hostnode, gpuKey, gpuCount) {
  const resources = hostnode.available_resources || {};
  const pricing = hostnode.pricing || {};
  const gpuTotal = (numberOrNull(pricing.per_gpu_hr?.[gpuKey]) || 0) * gpuCount;
  const cpuTotal = (numberOrNull(pricing.per_vcpu_hr) || 0) * Number(resources.vcpu_count || 0);
  const ramTotal = (numberOrNull(pricing.per_gb_ram_hr) || 0) * Number(resources.ram_gb || 0);
  const storageTotal = (numberOrNull(pricing.per_gb_storage_hr) || 0) * Number(resources.storage_gb || 0);
  const total = gpuTotal + cpuTotal + ramTotal + storageTotal;
  return total > 0 ? total : null;
}

function hasEnvValue(value) {
  if (value === null || value === undefined) return false;
  const normalized = String(value).trim().toLowerCase();
  return Boolean(normalized) && !["0", "false", "no", "off"].includes(normalized);
}
