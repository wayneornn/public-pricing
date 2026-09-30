import fs from "node:fs";
import oci from "oci-sdk";
import { createInventoryItem } from "../core/inventory.js";
import { hasEnvValue, truthyEnv } from "../core/env.js";
import { numberOrNull, round } from "../core/num.js";
import { normalizedList, parseEnvList } from "../core/format.js";
import { cacheKeyForList, cachedApiStage } from "../core/apiCache.js";

export const OCI_PROVIDER_ID = "oci";
export const OCI_CRAWLER_SCHEDULE = Object.freeze({
  regions: "daily",
  availabilityDomains: "daily",
  shapes: "daily",
  pricing: "every_12_hours"
});

export const OCI_STAGE_TTLS_MS = Object.freeze({
  regions: 24 * 60 * 60 * 1000,
  availabilityDomains: 24 * 60 * 60 * 1000,
  shapes: 24 * 60 * 60 * 1000,
  pricing: 12 * 60 * 60 * 1000
});

export function hasOciConfiguration(env = process.env) {
  const hasApiKeyEnv = hasEnvValue(env.OCI_TENANCY_OCID)
    && hasEnvValue(env.OCI_USER_OCID)
    && hasEnvValue(env.OCI_FINGERPRINT)
    && (hasEnvValue(env.OCI_PRIVATE_KEY) || hasEnvValue(env.OCI_PRIVATE_KEY_FILE));
  return truthyEnv(env.OCI_GPU_INVENTORY_ENABLED)
    || hasEnvValue(env.OCI_CONFIG_FILE)
    || hasApiKeyEnv
    || hasEnvValue(env.OCI_RESOURCE_PRINCIPAL_VERSION);
}

export async function get_regions(env = process.env, options = {}) {
  const selected = normalizedList(options.regions).length ? normalizedList(options.regions) : parseEnvList(env.OCI_GPU_REGIONS);
  if (selected.length) return selected;
  const rows = await cachedOciStage(env, "regions", OCI_STAGE_TTLS_MS.regions, options, async () => {
    const tenancyId = tenancyOcid(env, options);
    const client = options.identityClient || createIdentityClient(env.OCI_REGION || env.OCI_HOME_REGION || "us-ashburn-1", env);
    const response = await client.listRegionSubscriptions({ tenancyId });
    return responseItems(response)
      .filter((region) => !region.status || region.status === "READY")
      .map((region) => region.regionName)
      .filter(Boolean)
      .sort();
  });
  return Array.isArray(rows) ? rows : [];
}

export async function get_availability_domains(region, env = process.env, options = {}) {
  const rows = await cachedOciStage(env, `availability-domains/${region}`, OCI_STAGE_TTLS_MS.availabilityDomains, options, async () => {
    const compartmentId = rootCompartmentOcid(env, options);
    const client = options.identityClient || createIdentityClient(region, env);
    const response = await client.listAvailabilityDomains({ compartmentId });
    return responseItems(response)
      .map((ad) => ad.name)
      .filter(Boolean)
      .sort();
  });
  return Array.isArray(rows) ? rows : [];
}

export async function get_shapes(region, availabilityDomain, env = process.env, options = {}) {
  const selectedShapes = normalizedList(options.shapes).length ? normalizedList(options.shapes) : parseEnvList(env.OCI_GPU_SHAPES);
  const rows = await cachedOciStage(env, `shapes/${region}/${availabilityDomain}/${cacheKeyForList(selectedShapes)}`, OCI_STAGE_TTLS_MS.shapes, options, async () => {
    const compartmentId = rootCompartmentOcid(env, options);
    const client = options.computeClient || createComputeClient(region, env);
    const response = client.listAllShapes
      ? await client.listAllShapes({ compartmentId, availabilityDomain })
      : await client.listShapes({ compartmentId, availabilityDomain, limit: 1000 });
    return responseItems(response)
      .filter(isOciGpuShape)
      .filter((shape) => !selectedShapes.length || selectedShapes.includes(shape.shape))
      .sort((left, right) => String(left.shape).localeCompare(String(right.shape)));
  });
  return Array.isArray(rows) ? rows : [];
}

export function get_offerings(region, availabilityDomain, shapes) {
  return (shapes || [])
    .map((shape) => ociShapeToOffering(region, availabilityDomain, shape))
    .filter(Boolean)
    .sort(compareOciRows);
}

export async function get_prices(region, shapes, env = process.env, options = {}) {
  const shapeRows = (shapes || []).map(parseOciShapeMetadata).filter(Boolean);
  const rows = await cachedOciStage(env, `prices/${region}/${cacheKeyForList(shapeRows.map((shape) => shape.shape))}`, OCI_STAGE_TTLS_MS.pricing, options, async () => {
    const rateCards = options.rateCards || await fetchRateCards(region, env, options);
    return normalizeOciPrices(rateCards, shapeRows, { region });
  });
  return new Map((Array.isArray(rows) ? rows : []).map((row) => [row.shape, row]));
}

export async function crawl(env = process.env, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const regions = await get_regions(env, options);
  const rows = [];

  for (const region of regions) {
    const ads = await get_availability_domains(region, env, options);
    const allRegionShapes = new Map();
    const offerings = [];
    for (const availabilityDomain of ads) {
      const shapes = await get_shapes(region, availabilityDomain, env, options);
      for (const shape of shapes) allRegionShapes.set(shape.shape, shape);
      offerings.push(...get_offerings(region, availabilityDomain, shapes));
    }
    const prices = await get_prices(region, [...allRegionShapes.values()], env, options);
    for (const offering of offerings) {
      const price = prices.get(offering.shape);
      rows.push({
        ...offering,
        on_demand_price_usd_per_hour: price?.on_demand_price_usd_per_hour ?? null,
        preemptible_price_usd_per_hour: price?.preemptible_price_usd_per_hour ?? null,
        last_seen: now.toISOString(),
        metadata: {
          rawShape: offering.rawShape,
          onDemandPrice: price?.onDemandPrice || null,
          preemptiblePrice: price?.preemptiblePrice || null
        }
      });
    }
  }

  return rows.sort(compareOciRows);
}

export function ociInventoryRowToInventoryItem(row, env = process.env) {
  return createInventoryItem({
    provider: "Oracle OCI",
    providerId: OCI_PROVIDER_ID,
    rawOfferId: `${row.region}:${row.availability_domain}:${row.shape}`,
    gpuLabel: ociGpuLabel(row),
    gpuCount: row.gpu_count,
    vramGbEach: row.gpu_memory_gb,
    pricePerGpuHour: row.on_demand_price_usd_per_hour && row.gpu_count ? row.on_demand_price_usd_per_hour / row.gpu_count : null,
    totalHourlyPrice: row.on_demand_price_usd_per_hour,
    region: row.region,
    formFactor: row.bare_metal ? "bare_metal" : "vm",
    interconnect: ociGpuInterconnect(row),
    cpu: row.ocpus ? `${row.ocpus} OCPU` : "",
    ramGb: row.ram_gb,
    storage: row.local_storage,
    networkBandwidth: row.network_gbps ? `${row.network_gbps} Gbps` : "",
    networkFabric: ociNetworkFabric(row),
    availability: row.offered ? "available" : "unavailable",
    availabilityCount: null,
    currency: "USD",
    checkoutUrl: buildOciConsoleUrl(row.region, row.shape, env),
    sourceMode: "live",
    listingType: "oci_shape_offering",
    priceScope: "node_total",
    dataNotes: [
      "OCI official Identity, Compute, and OneSubscription APIs",
      "Shape offering, not capacity checked",
      `${ociNetworkFabric(row)} fabric`,
      row.preemptible_price_usd_per_hour != null ? `Preemptible: $${row.preemptible_price_usd_per_hour}/hr` : ""
    ].filter(Boolean),
    metadata: {
      table: "oci_inventory",
      region: row.region,
      availabilityDomain: row.availability_domain,
      shape: row.shape,
      vcpuEquivalent: row.vcpu_equivalent,
      networkFabric: ociNetworkFabric(row),
      preemptiblePriceUsdPerHour: row.preemptible_price_usd_per_hour,
      lastSeen: row.last_seen
    },
    lastSeenAt: row.last_seen,
    rawPayload: row
  });
}

function ociGpuInterconnect(row) {
  const text = `${row.shape || ""} ${row.gpu_model || ""}`;
  if (/h100|a100|gpu4|gpu3/i.test(text)) return "NVLink";
  return "PCIe";
}

function ociNetworkFabric(row) {
  const text = `${row.shape || ""} ${row.gpu_description || ""} ${row.network_gbps || ""}`;
  if (/rdma|cluster|h100|a100|gpu4|gpu3/i.test(text)) return "RDMA";
  return row.network_gbps ? "Ethernet" : "Not exposed";
}

export function parseOciShapeMetadata(raw) {
  const shape = raw.shape || raw.name || "";
  const mapping = mapOciGpuShape(shape, raw);
  if (!mapping) return null;
  const ocpus = numberOrNull(raw.ocpus ?? raw.ocpu ?? raw.shapeOcpus);
  return {
    shape,
    gpu_model: mapping.gpu_model,
    gpu_count: numberOrNull(raw.gpus) ?? mapping.gpu_count,
    gpu_description: raw.gpuDescription || raw.gpu_description || "",
    gpu_memory_gb: mapping.gpu_memory_gb,
    ocpus,
    vcpu_equivalent: ocpus != null ? ocpus * 2 : null,
    ram_gb: numberOrNull(raw.memoryInGBs ?? raw.memoryInGBsDefault ?? raw.memory_gb),
    network_gbps: numberOrNull(raw.networkingBandwidthInGbps ?? raw.network_gbps),
    local_storage: localStorageFromShape(raw),
    bare_metal: /^BM\./i.test(shape),
    rawShape: raw
  };
}

export function mapOciGpuShape(shape, raw = {}) {
  const text = `${shape} ${raw.gpuDescription || ""}`.toUpperCase();
  const count = numberOrNull(raw.gpus) ?? numberOrNull(shape.match(/\.(\d+)(?:$|\D)/)?.[1]) ?? 1;
  if (/BM\.GPU\.H100\.8|H100/.test(text)) return { gpu_model: "H100", gpu_count: count, gpu_memory_gb: 80 };
  if (/BM\.GPU\.A100-V2\.8|BM\.GPU4\.8|VM\.GPU\.A100|A100/.test(text)) return { gpu_model: "A100", gpu_count: count, gpu_memory_gb: 80 };
  if (/BM\.GPU3\.8|V100/.test(text)) return { gpu_model: "V100", gpu_count: count, gpu_memory_gb: 16 };
  if (/BM\.GPU2\.2|P100/.test(text)) return { gpu_model: "P100", gpu_count: count, gpu_memory_gb: 16 };
  if (/VM\.GPU\.A10|A10/.test(text)) return { gpu_model: "A10", gpu_count: count, gpu_memory_gb: 24 };
  if (/^BM\.GPU|^VM\.GPU|GPU/.test(text)) return { gpu_model: "OCI GPU", gpu_count: count, gpu_memory_gb: null };
  return null;
}

export function ociShapeToOffering(region, availabilityDomain, raw) {
  const metadata = parseOciShapeMetadata(raw);
  if (!metadata) return null;
  return {
    provider: OCI_PROVIDER_ID,
    region,
    availability_domain: availabilityDomain,
    shape: metadata.shape,
    gpu_model: metadata.gpu_model,
    gpu_count: metadata.gpu_count,
    gpu_memory_gb: metadata.gpu_memory_gb,
    ocpus: metadata.ocpus,
    vcpu_equivalent: metadata.vcpu_equivalent,
    ram_gb: metadata.ram_gb,
    network_gbps: metadata.network_gbps,
    local_storage: metadata.local_storage,
    bare_metal: metadata.bare_metal,
    offered: true,
    on_demand_price_usd_per_hour: null,
    preemptible_price_usd_per_hour: null,
    rawShape: raw
  };
}

export function normalizeOciPrices(rateCards, shapes, options = {}) {
  const byShape = new Map();
  for (const shape of shapes || []) {
    const normalizedShape = parseOciShapeMetadata(shape.rawShape || shape) || shape;
    const matches = (rateCards || []).filter((rate) => rateMatchesShape(rate, normalizedShape, options.region));
    const onDemand = pickCheapest(matches.filter((rate) => !isPreemptibleRate(rate)), normalizedShape);
    const preemptible = pickCheapest(matches.filter(isPreemptibleRate), normalizedShape);
    byShape.set(normalizedShape.shape, {
      shape: normalizedShape.shape,
      region: options.region || "",
      currency: currencyFromRate(onDemand?.rate || preemptible?.rate),
      on_demand_price_usd_per_hour: onDemand?.price ?? null,
      preemptible_price_usd_per_hour: preemptible?.price ?? null,
      onDemandPrice: onDemand?.rate || null,
      preemptiblePrice: preemptible?.rate || null
    });
  }
  return [...byShape.values()].sort((left, right) => left.shape.localeCompare(right.shape));
}

export function normalizeOciPrice(rate, shape) {
  const unitPrice = rateUnitPrice(rate);
  if (unitPrice == null) return null;
  const shapeToken = escapeRegExp(String(shape.shape || ""));
  const productName = shapeToken
    ? String(rate.product?.name || "").replace(new RegExp(shapeToken, "ig"), "")
    : String(rate.product?.name || "");
  const unitText = [
    rate.product?.unitOfMeasure,
    productName,
    rate.product?.billingCategory,
    rate.product?.productCategory,
    rate.product?.ucmRateCardPartType
  ].filter(Boolean).join(" ").toLowerCase();
  if (/ocpu/.test(unitText)) return round(unitPrice * Number(shape.ocpus || 1), 4);
  if (/\bgpu\b|gpu hour|gpu-hour/.test(unitText)) return round(unitPrice * Number(shape.gpu_count || 1), 4);
  return round(unitPrice, 4);
}

function createIdentityClient(region, env) {
  return new oci.identity.IdentityClient({ authenticationDetailsProvider: createOciAuthProvider(region, env) });
}

function createComputeClient(region, env) {
  return new oci.core.ComputeClient({ authenticationDetailsProvider: createOciAuthProvider(region, env) });
}

function createRatecardClient(region, env) {
  return new oci.onesubscription.RatecardClient({ authenticationDetailsProvider: createOciAuthProvider(region, env) });
}

function createOciAuthProvider(region, env) {
  const ociRegion = oci.common.Region.fromRegionId(region || env.OCI_REGION || env.OCI_HOME_REGION || "us-ashburn-1");
  if (hasEnvValue(env.OCI_TENANCY_OCID) && hasEnvValue(env.OCI_USER_OCID) && hasEnvValue(env.OCI_FINGERPRINT) && (hasEnvValue(env.OCI_PRIVATE_KEY) || hasEnvValue(env.OCI_PRIVATE_KEY_FILE))) {
    const privateKey = hasEnvValue(env.OCI_PRIVATE_KEY)
      ? env.OCI_PRIVATE_KEY.replace(/\\n/g, "\n")
      : fs.readFileSync(env.OCI_PRIVATE_KEY_FILE, "utf8");
    return new oci.common.SimpleAuthenticationDetailsProvider(
      env.OCI_TENANCY_OCID,
      env.OCI_USER_OCID,
      env.OCI_FINGERPRINT,
      privateKey,
      env.OCI_PRIVATE_KEY_PASSPHRASE || null,
      ociRegion
    );
  }
  if (hasEnvValue(env.OCI_RESOURCE_PRINCIPAL_VERSION)) {
    return new oci.common.ResourcePrincipalAuthenticationDetailsProvider();
  }
  const provider = new oci.common.ConfigFileAuthenticationDetailsProvider(
    env.OCI_CONFIG_FILE || undefined,
    env.OCI_PROFILE || "DEFAULT"
  );
  if (provider.setRegion) provider.setRegion(ociRegion);
  return provider;
}

async function fetchRateCards(region, env, options) {
  const subscriptionId = env.OCI_SUBSCRIPTION_ID;
  const compartmentId = rootCompartmentOcid(env, options);
  if (!subscriptionId) return [];
  const client = options.ratecardClient || createRatecardClient(env.OCI_RATECARD_REGION || region, env);
  const request = {
    subscriptionId,
    compartmentId,
    limit: 1000
  };
  if (options.timeFrom) request.timeFrom = new Date(options.timeFrom);
  if (options.timeTo) request.timeTo = new Date(options.timeTo);
  const response = client.listAllRateCards
    ? await client.listAllRateCards(request)
    : await client.listRateCards(request);
  return responseItems(response);
}

function rootCompartmentOcid(env, options) {
  return options.compartmentId || env.OCI_ROOT_COMPARTMENT_OCID || tenancyOcid(env, options);
}

function tenancyOcid(env, options) {
  if (options.tenancyId) return options.tenancyId;
  if (env.OCI_TENANCY_OCID) return env.OCI_TENANCY_OCID;
  try {
    const provider = createOciAuthProvider(env.OCI_REGION || env.OCI_HOME_REGION || "us-ashburn-1", env);
    return provider.getTenantId?.();
  } catch {
    return "";
  }
}

function responseItems(response) {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.items)) return response.items;
  if (Array.isArray(response?.data)) return response.data;
  if (Array.isArray(response?.value)) return response.value;
  return [];
}

function isOciGpuShape(raw) {
  const shape = raw.shape || "";
  return /^BM\.GPU/i.test(shape)
    || /^VM\.GPU/i.test(shape)
    || Number(raw.gpus || 0) > 0
    || /gpu/i.test(raw.gpuDescription || "");
}

function localStorageFromShape(raw) {
  const disks = numberOrNull(raw.localDisks);
  const size = numberOrNull(raw.localDisksTotalSizeInGBs);
  const description = raw.localDiskDescription || "";
  if (!disks && !size && !description) return "";
  return [disks ? `${disks} disks` : "", size ? `${size} GB` : "", description].filter(Boolean).join(" ");
}

function rateMatchesShape(rate, shape, region) {
  const product = rate.product || {};
  const text = [
    product.name,
    product.partNumber,
    product.billingCategory,
    product.productCategory,
    rate.partNumber,
    rate.displayName,
    rate.description,
    rate.skuName,
    rate.region,
    rate.regionName
  ].filter(Boolean).join(" ").toLowerCase();
  const shapeText = String(shape.shape || "").toLowerCase();
  const regionMatches = !region || !/(^|\s)([a-z]+-[a-z]+-\d)(\s|$)/i.test(text) || text.includes(String(region).toLowerCase());
  return text.includes(shapeText) && regionMatches;
}

function pickCheapest(rates, shape) {
  let best = null;
  for (const rate of rates || []) {
    const price = normalizeOciPrice(rate, shape);
    if (price == null) continue;
    if (!best || price < best.price) best = { rate, price };
  }
  return best;
}

function rateUnitPrice(rate) {
  const tiers = Array.isArray(rate.rateCardTiers) ? rate.rateCardTiers : [];
  const tierPrice = tiers.map((tier) => numberOrNull(tier.overagePrice ?? tier.netUnitPrice)).find((price) => price != null);
  return tierPrice
    ?? numberOrNull(rate.overagePrice)
    ?? numberOrNull(rate.netUnitPrice)
    ?? numberOrNull(rate.hourlyPrice)
    ?? numberOrNull(rate.price);
}

function isPreemptibleRate(rate) {
  return /preempt|pre-empt|interrupt/i.test([
    rate.product?.name,
    rate.product?.billingCategory,
    rate.product?.productCategory,
    rate.description,
    rate.displayName
  ].filter(Boolean).join(" "));
}

function currencyFromRate(rate) {
  const currency = rate?.currency;
  return currency?.isoCode || currency?.code || currency?.currencyCode || rate?.currencyCode || "USD";
}

function ociGpuLabel(row) {
  return [
    row.gpu_count ? `${row.gpu_count}x` : "",
    row.gpu_model || "OCI GPU",
    row.gpu_memory_gb ? `${Math.round(Number(row.gpu_memory_gb))}GB` : "",
    row.shape
  ].filter(Boolean).join(" ");
}

function buildOciConsoleUrl(region, shape, env) {
  const params = new URLSearchParams();
  if (region) params.set("region", region);
  if (shape) params.set("shape", shape);
  const base = env.OCI_CONSOLE_INSTANCE_CREATE_URL || "https://cloud.oracle.com/compute/instances/create";
  return `${base}${params.toString() ? `?${params.toString()}` : ""}`;
}

function cachedOciStage(env, key, ttlMs, options, loader) {
  return cachedApiStage({
    env, key, ttlMs, options, loader,
    disableKey: "OCI_GPU_DISABLE_CACHE",
    cacheDirKey: "OCI_GPU_CACHE_DIR",
    cacheDirDefault: ".cache/oci-api",
    allowStaleKey: "OCI_GPU_ALLOW_STALE_ON_ERROR"
  });
}

function compareOciRows(left, right) {
  return left.region.localeCompare(right.region)
    || left.availability_domain.localeCompare(right.availability_domain)
    || left.shape.localeCompare(right.shape);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
