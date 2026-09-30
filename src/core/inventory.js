import {
  extractGpuCount,
  inferCountry,
  normalizeGpuLabel,
  normalizeProviderId,
  normalizeRegion
} from "./taxonomy.js";

export function createInventoryItem(input) {
  const provider = String(input.provider || "Unknown").trim();
  const providerId = input.providerId || normalizeProviderId(provider);
  const gpuLabel = input.gpuLabel || input.gpu_model || input.gpu || "Unknown GPU";
  const gpu = normalizeGpuLabel(gpuLabel);
  const gpuCount = toPositiveNumber(input.gpuCount) || extractGpuCount(gpuLabel, 1);
  const vramGbEach = toPositiveNumber(input.vramGbEach) || gpu.vramGbEach || null;
  const nativeCurrency = String(input.currency || "USD").toUpperCase();
  const nativeTotalHourlyPrice = toPositiveNumber(input.totalHourlyPrice);
  const nativePricePerGpuHour = toPositiveNumber(input.pricePerGpuHour);
  const hasNativePrice = nativeTotalHourlyPrice != null || nativePricePerGpuHour != null;
  const fxKnown = nativeCurrency === "USD" || hasKnownFxRate(nativeCurrency);
  // Never silently treat an unknown currency as 1:1 with USD; leave such prices
  // in their native currency and exclude them from buy-now (see orderability).
  const unconvertibleCurrency = !fxKnown && hasNativePrice;
  const fxRate = fxKnown ? fxRateToUsd(nativeCurrency) : 1;
  const totalHourlyPrice = nativeTotalHourlyPrice == null ? null : nativeTotalHourlyPrice * fxRate;
  const pricePerGpuHour = (nativePricePerGpuHour == null ? null : nativePricePerGpuHour * fxRate) || (totalHourlyPrice && gpuCount ? totalHourlyPrice / gpuCount : null);
  const derivedTotalHourlyPrice = totalHourlyPrice || (pricePerGpuHour && gpuCount ? pricePerGpuHour * gpuCount : null);
  const currencyConverted = fxKnown && fxRate !== 1 && hasNativePrice;
  const currencyNotes = currencyConverted
    ? [`Converted to USD from ${nativeCurrency} @ ${fxRate} (native ${currencySymbol(nativeCurrency)}${roundMoney(nativePricePerGpuHour || (nativeTotalHourlyPrice && gpuCount ? nativeTotalHourlyPrice / gpuCount : 0))}/GPU/hr)`]
    : unconvertibleCurrency
      ? [`Price shown in ${nativeCurrency}; no USD FX rate configured (set FX_${nativeCurrency}_USD) — excluded from buy-now/cheapest`]
      : [];
  const region = normalizeRegion(input.region || input.regionName || input.datacenter || "");
  const rawOfferId = String(input.rawOfferId || input.offerId || input.id || syntheticOfferId({ provider, gpu, gpuCount, vramGbEach, region, input })).trim();
  const lastSeenAt = input.lastSeenAt || new Date().toISOString();
  const checkoutUrl = input.checkoutUrl || makeProviderUrl(providerId);
  const sourceMode = input.sourceMode || "fixture";
  const listingType = input.listingType || "";
  const priceScope = input.priceScope || "";
  const availabilitySemantics = normalizeAvailabilitySemantics(input.availabilitySemantics, { providerId, sourceMode, listingType, priceScope });
  const priceSemantics = normalizePriceSemantics(input.priceSemantics, { providerId, sourceMode, listingType, priceScope });
  const marketType = normalizeMarketType(input.marketType, { sourceMode, listingType, priceScope, rawOfferId, priceSemantics });
  const checkoutSemantics = normalizeCheckoutSemantics(input.checkoutSemantics, { providerId, sourceMode, listingType, checkoutUrl });
  const availability = normalizeAvailability(input.availability);
  const spotPriced = input.rawPayload?.isSpot === true || input.volatilePricing === true;
  const orderability = normalizeOrderability(input.orderable, {
    availability,
    availabilitySemantics,
    checkoutSemantics,
    pricePerGpuHour,
    priceSemantics,
    rawPayload: input.rawPayload,
    sourceMode,
    spotPriced,
    unconvertibleCurrency,
    totalHourlyPrice: derivedTotalHourlyPrice
  });
  const confidence = normalizeConfidence(input.confidence, {
    sourceMode,
    availabilitySemantics,
    priceSemantics,
    checkoutSemantics,
    gpuModel: gpu.model,
    totalHourlyPrice: derivedTotalHourlyPrice,
    pricePerGpuHour,
    rawPayload: input.rawPayload
  });
  const specs = buildNormalizedSpecs(input, {
    gpu,
    gpuCount,
    vramGbEach,
    formFactor: normalizeFormFactor(input.formFactor || input.deploymentType || input.type || ""),
    interconnect: normalizeInterconnect(input.interconnect || (input.nvlink ? "NVLink" : "")),
    networkFabric: normalizeNetworkFabric(input.networkFabric || input.clusterFabric || input.networkType || input.fabric || "")
  });

  return {
    id: `${providerId}:${rawOfferId}:${region.canonical}`,
    provider,
    providerId,
    rawOfferId,
    gpuLabel: gpu.rawLabel,
    gpuModel: gpu.model,
    gpuVariant: input.gpuVariant || gpu.variant,
    gpuCanonicalName: gpu.canonicalName,
    gpuRank: gpu.rank,
    gpuTier: gpu.tier || "datacenter",
    gpuCount,
    vramGbEach,
    vramTotalGb: vramGbEach ? vramGbEach * gpuCount : null,
    cpu: input.cpu || input.vcpu || input.vcpus || "",
    ramGb: toPositiveNumber(input.ramGb) || null,
    storage: input.storage || "",
    region: region.label,
    regionCanonical: region.canonical,
    rawRegion: region.raw,
    country: input.country || inferCountry(region.raw),
    formFactor: normalizeFormFactor(input.formFactor || input.deploymentType || input.type || ""),
    interconnect: normalizeInterconnect(input.interconnect || (input.nvlink ? "NVLink" : "")),
    networkFabric: specs.machine?.networkFabric || "Not exposed",
    networkBandwidth: input.networkBandwidth || "",
    pricePerGpuHour: pricePerGpuHour ? roundMoney(pricePerGpuHour) : null,
    totalHourlyPrice: derivedTotalHourlyPrice ? roundMoney(derivedTotalHourlyPrice) : null,
    currency: currencyConverted ? "USD" : nativeCurrency,
    nativeCurrency,
    nativePricePerGpuHour: nativePricePerGpuHour ? roundMoney(nativePricePerGpuHour) : null,
    availability,
    availabilityCount: toNonNegativeNumber(input.availabilityCount),
    minTerm: input.minTerm || "",
    checkoutUrl,
    deploySupported: Boolean(input.deploySupported),
    sourceMode,
    listingType,
    priceScope,
    availabilitySemantics,
    priceSemantics,
    marketType,
    checkoutSemantics,
    confidence,
    orderable: orderability.orderable,
    orderabilityReason: orderability.reason,
    dataNotes: dedupeNotes([
      ...(Array.isArray(input.dataNotes) ? input.dataNotes.filter(Boolean) : []),
      ...currencyNotes,
      ...(input.rawPayload?.isSpot === true ? ["Spot / interruptible"] : []),
      ...(input.volatilePricing === true ? ["Volatile auction pricing"] : [])
    ]),
    specs,
    metadata: sanitizeMetadata(input.metadata),
    lastSeenAt,
    stalenessSeconds: secondsSince(lastSeenAt),
    rawPayload: input.rawPayload || null
  };
}

export function normalizeAvailabilitySemantics(value, context = {}) {
  const explicit = semanticValue(value);
  if (["host_capacity", "sku_capacity", "region_offering", "catalog_only", "price_only", "unknown"].includes(explicit)) return explicit;
  const providerId = context.providerId || "";
  const sourceMode = context.sourceMode || "";
  const listingType = context.listingType || "";
  const priceScope = context.priceScope || "";
  if (/fixture/.test(sourceMode)) return "unknown";
  if (providerId === "google-cloud" || providerId === "google-tpu") return "price_only";
  if (providerId === "together-ai" || sourceMode === "catalog") return "catalog_only";
  if (["aws", "azure", "oci"].includes(providerId)) return "region_offering";
  if (["vast-ai", "clore-ai", "voltage-park"].includes(providerId) || /hostnode|marketplace_server|spot_server|marketplace_offer/i.test(listingType)) return "host_capacity";
  if (["runpod", "lambda", "crusoe", "shadeform", "prime-intellect", "cudo", "sesterce", "gmi", "massed-compute"].includes(providerId)) return "sku_capacity";
  if (/capacity/i.test(listingType) || /unpriced_capacity/i.test(priceScope)) return "sku_capacity";
  if (/plan_location|flavor|commercial_type|gpu_plan|instance_type|location_gpu_offering|resource_sku|shape_offering/i.test(listingType)) return "region_offering";
  return "unknown";
}

export function normalizePriceSemantics(value, context = {}) {
  const explicit = semanticValue(value);
  if (["node_total", "node_total_variable", "gpu_only", "lowest_sku", "spot", "on_demand", "unpriced", "unknown"].includes(explicit)) return explicit;
  const providerId = context.providerId || "";
  const sourceMode = context.sourceMode || "";
  const listingType = context.listingType || "";
  const priceScope = context.priceScope || "";
  if (/unpriced/i.test(priceScope)) return "unpriced";
  if (providerId === "together-ai") return "unpriced";
  if (providerId === "google-cloud" || providerId === "google-tpu") return "gpu_only";
  if (priceScope === "gpu_sku_lowest") return "lowest_sku";
  if (priceScope === "gpu_sku_only") return "gpu_only";
  if (priceScope === "spot") return "spot";
  if (priceScope === "node_total_variable") return "node_total_variable";
  if (priceScope === "node_total") return /spot/i.test(listingType) ? "spot" : "node_total";
  if (sourceMode === "catalog") return "unknown";
  return "unknown";
}

export function normalizeMarketType(value, context = {}) {
  const explicit = semanticValue(value);
  if (["on_demand", "spot", "catalog", "capacity", "variable", "unknown"].includes(explicit)) return explicit;
  const text = `${context.listingType || ""} ${context.rawOfferId || ""} ${context.priceScope || ""}`;
  if (/spot/i.test(text)) return "spot";
  if (context.sourceMode === "catalog") return "catalog";
  if (context.priceSemantics === "unpriced") return "capacity";
  if (/variable/i.test(context.priceScope || "")) return "variable";
  return "on_demand";
}

export function normalizeCheckoutSemantics(value, context = {}) {
  const explicit = semanticValue(value);
  if (["exact_listing", "prefilled_deploy", "manual_provider", "provider_console", "unavailable", "unknown"].includes(explicit)) return explicit;
  const providerId = context.providerId || "";
  const sourceMode = context.sourceMode || "";
  const listingType = context.listingType || "";
  const checkoutUrl = context.checkoutUrl || "";
  if (!checkoutUrl) return "unavailable";
  if (NON_CHECKOUT_PROVIDER_IDS.has(providerId)) return "provider_console";
  if (["vast-ai", "clore-ai"].includes(providerId) || /hostnode/i.test(listingType)) return "exact_listing";
  if (sourceMode === "catalog") return "provider_console";
  if (/\?|#/.test(checkoutUrl) || /create|deploy|instancesAdd|LaunchInstances/i.test(checkoutUrl)) return "prefilled_deploy";
  return "provider_console";
}

export function normalizeConfidence(value, context = {}) {
  const explicit = semanticValue(value);
  if (["high", "medium", "low"].includes(explicit)) return explicit;
  if (!context.rawPayload || /fixture/.test(context.sourceMode || "")) return "low";
  if (context.gpuModel === "Unknown") return "low";
  if (["unknown"].includes(context.availabilitySemantics) || ["unknown"].includes(context.priceSemantics)) return "low";
  if (["catalog_only", "price_only", "region_offering"].includes(context.availabilitySemantics)) return "medium";
  if (["gpu_only", "lowest_sku", "unpriced"].includes(context.priceSemantics)) return "medium";
  if (context.checkoutSemantics === "manual_provider" || context.checkoutSemantics === "provider_console") return "medium";
  return "high";
}

export function normalizeOrderability(value, context = {}) {
  if (value === false) {
    return {
      orderable: false,
      reason: "Provider adapter marked this row non-orderable"
    };
  }

  if (context.sourceMode !== "live") {
    return {
      orderable: false,
      reason: "Not live provider inventory"
    };
  }

  if (context.availability !== "available") {
    return {
      orderable: false,
      reason: `Availability is ${context.availability || "unknown"}`
    };
  }

  if (context.spotPriced) {
    return {
      orderable: false,
      reason: "Spot/auction pricing excluded from buy-now (variable rate, interruptible)"
    };
  }

  if (context.unconvertibleCurrency) {
    return {
      orderable: false,
      reason: "Price is in a currency with no configured USD FX rate; excluded until convertible"
    };
  }

  if (!["host_capacity", "sku_capacity"].includes(context.availabilitySemantics)) {
    return {
      orderable: false,
      reason: `Availability truth is ${context.availabilitySemantics || "unknown"}`
    };
  }

  if (["unpriced", "unknown"].includes(context.priceSemantics) || (!context.pricePerGpuHour && !context.totalHourlyPrice)) {
    return {
      orderable: false,
      reason: `Price truth is ${context.priceSemantics || "unknown"}`
    };
  }

  if (!["exact_listing", "prefilled_deploy", "manual_provider"].includes(context.checkoutSemantics)) {
    return {
      orderable: false,
      reason: `Checkout truth is ${context.checkoutSemantics || "unknown"}`
    };
  }

  if (!context.rawPayload) {
    return {
      orderable: false,
      reason: "Missing raw provider payload"
    };
  }

  return {
    orderable: true,
    reason: "Live priced inventory with provider availability signal"
  };
}

const NON_CHECKOUT_PROVIDER_IDS = new Set([
  "aws",
  "azure",
  "oci",
  "nebius",
  "digitalocean",
  "nscale",
  "ovhcloud",
  "google-cloud",
  "google-tpu",
  "together-ai",
  "crusoe",
  "voltage-park",
  "mithril",
  "akamai-linode",
  "civo",
  "novita",
  "oblivus",
  "leader-gpu",
  "thunder-compute",
  "outscale",
  "leafcloud",
  "seeweb",
  "saladcloud",
  "jarvis-labs",
  "hydra-host",
  "sakura",
  "ionos",
  "exabits",
  "sharon-ai",
  "atlantic-net",
  "gpulist-ai",
  "denvr",
  "contabo",
  "hetzner",
  "utho",
  "greennode",
  "acecloud",
  "arkane-cloud",
  "hot-aisle",
  "hpc-ai",
  "northflank",
  "hivenet",
  "ionstream",
  "ionet",
  "coreweave",
  "liquidweb",
  "qubrid",
  "core42",
  "flexai",
  "valdi",
  "farmgpu",
  "cirrascale",
  "whitefiber",
  "yottalabs",
  "neysa",
  "taiga",
  "olakrutrim",
  "zoner",
  "neevcloud",
  "getdeploying",
  "nebulablock",
  "trainy",
  "turboscale",
  "visionbay",
  "cloudclusters",
  "airon",
  "ax3",
  "cato-digital",
  "cloudexe",
  "highreso",
  "nodeai",
  "charg",
  "polaris",
  "slyd"
]);

export function isOrderableInventoryItem(item) {
  return Boolean(item?.orderable);
}

// Spot / interruptible supply must never be ingested or displayed: its price is
// not a firm rate you can actually buy at (the instance can be reclaimed and the
// price floats). We drop these rows at ingestion so no downstream consumer ever
// sees a spot price. Reserved/auction-volatile pricing (e.g. Mithril) is a
// separate concern handled via orderability, not here.
export function isSpotInventoryItem(item) {
  if (!item) return false;
  if (item.rawPayload && item.rawPayload.isSpot === true) return true;
  return item.marketType === "spot"
    || item.priceSemantics === "spot"
    || item.priceScope === "spot";
}

// Spot rows are dropped at ingestion, but a surviving on-demand/reserved row can
// still carry a spot price in a sibling field (e.g. Verda's metadata.prices.spot
// and rawPayload.spot_price, AWS/Azure spot fields) or a "Spot also available"
// data-note. A trader reading the detail page would still see a spot number. To
// guarantee no spot price is ever surfaced, we strip every spot-named field and
// note from each row before it is served. Firm/auction prices are untouched.
const SPOT_FIELD_RE = /spot/i;

function stripSpotKeys(value) {
  if (Array.isArray(value)) return value.map(stripSpotKeys);
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      if (SPOT_FIELD_RE.test(key)) continue;
      out[key] = stripSpotKeys(val);
    }
    return out;
  }
  return value;
}

export function redactSpotPricing(item) {
  if (!item) return item;
  const next = { ...item };
  if (Array.isArray(item.dataNotes)) {
    next.dataNotes = item.dataNotes.filter((note) => !SPOT_FIELD_RE.test(String(note)));
  }
  if (item.metadata && typeof item.metadata === "object") {
    next.metadata = stripSpotKeys(item.metadata);
  }
  if (item.rawPayload && typeof item.rawPayload === "object") {
    next.rawPayload = stripSpotKeys(item.rawPayload);
  }
  return next;
}

export function isInterruptibleInventoryItem(item) {
  const text = [
    item?.marketType,
    item?.priceSemantics,
    item?.priceScope,
    item?.listingType,
    item?.rawOfferId,
    ...(Array.isArray(item?.dataNotes) ? item.dataNotes : [])
  ].join(" ").toLowerCase();

  return /\b(spot|preemptible|pre-emptible|interruptible|interruptable)\b/.test(text);
}

export function isBrokerVisibleInventoryItem(item) {
  return isOrderableInventoryItem(item) && !isInterruptibleInventoryItem(item);
}

const MARKETPLACE_PROVIDER_IDS = new Set([
  "vast-ai",
  "clore-ai",
  "tensordock"
]);

export function isMarketplaceInventoryItem(item) {
  if (!item) return false;
  const providerId = String(item.providerId || "").toLowerCase();
  if (MARKETPLACE_PROVIDER_IDS.has(providerId)) return true;
  const text = [
    item.listingType,
    item.priceScope,
    item.availabilitySemantics,
    item.checkoutSemantics,
    item.metadata?.market,
    item.metadata?.marketplace,
    item.metadata?.location?.organization,
    item.metadata?.location?.organizationName,
    ...(Array.isArray(item.dataNotes) ? item.dataNotes : [])
  ].join(" ").toLowerCase();
  return /\bmarketplace\b|marketplace_|_marketplace|per-gpu marketplace/.test(text);
}

export function isDatacenterVendorInventoryItem(item) {
  return isBrokerVisibleInventoryItem(item) && !isMarketplaceInventoryItem(item);
}

export function updateStaleness(item, now = new Date()) {
  return {
    ...item,
    stalenessSeconds: secondsSince(item.lastSeenAt, now)
  };
}

export function normalizeFormFactor(value = "") {
  const text = String(value || "").toLowerCase();
  if (/bare/.test(text)) return "bare_metal";
  if (/container|pod|serverless/.test(text)) return "container";
  if (/vm|virtual|instance/.test(text)) return "vm";
  return "unknown";
}

export function normalizeInterconnect(value = "") {
  const text = String(value || "");
  if (/nvlink/i.test(text)) return "NVLink";
  if (/infiniband|ib\b/i.test(text)) return "InfiniBand";
  if (/ethernet/i.test(text)) return "Ethernet";
  if (/pcie|pci-e/i.test(text)) return "PCIe";
  if (/sxm|hgx/i.test(text)) return "NVLink";
  return text || "Unknown";
}

export function normalizeNetworkFabric(value = "") {
  const text = String(value || "");
  if (/infiniband|\bib\b|ndr|hdr|edr/i.test(text)) return "InfiniBand";
  if (/\brdma\b/i.test(text)) return "RDMA";
  if (/\broce\b/i.test(text)) return "RoCE";
  if (/\befa\b/i.test(text)) return "EFA";
  if (/ethernet|\bgbe\b|gigabit ethernet|internet|public ip|port forward|nic_eth|eth_|_eth/i.test(text)) return "Ethernet";
  if (/not exposed|not listed|unknown|none/i.test(text)) return "Not exposed";
  return text ? text : "Not exposed";
}

function normalizeAvailability(value) {
  if (typeof value === "boolean") return value ? "available" : "unavailable";
  if (value === null || value === undefined || String(value).trim() === "") return "unknown";
  const text = String(value).toLowerCase();
  if (/sold|unavailable|none|false|out/.test(text)) return "unavailable";
  if (/soon|upcoming|wait/.test(text)) return "upcoming";
  if (/stale|unknown/.test(text)) return "unknown";
  return "available";
}

function makeProviderUrl(providerId) {
  const urls = {
    runpod: "https://www.runpod.io/console/gpu-cloud",
    "vast-ai": "https://cloud.vast.ai/create/",
    shadeform: "https://www.shadeform.ai/",
    lambda: "https://cloud.lambda.ai/instances",
    crusoe: "https://cloud.crusoe.ai/",
    cudo: "https://www.cudocompute.com/console",
    "cudo-compute": "https://www.cudocompute.com/console",
    sesterce: "https://cloud.sesterce.com/clusters",
    "clore-ai": "https://clore.ai/marketplace",
    hyperstack: "https://console.hyperstack.cloud/",
    "prime-intellect": "https://app.primeintellect.ai/",
    "voltage-park": "https://console.voltagepark.com/",
    gmi: "https://console.gmicloud.ai/",
    "gmi-cloud": "https://console.gmicloud.ai/",
    "verda-datacrunch": "https://cloud.datacrunch.io/",
    "together-ai": "https://api.together.ai/",
    aws: "https://console.aws.amazon.com/ec2/home",
    scaleway: "https://console.scaleway.com/",
    vultr: "https://my.vultr.com/deploy/",
    tensordock: "https://dashboard.tensordock.com/deploy",
    latitude: "https://metal.new",
    gcore: "https://cloud.gcore.com/",
    ovhcloud: "https://us.ovhcloud.com/manager/#/public-cloud/pci/projects",
    digitalocean: "https://cloud.digitalocean.com/droplets/new",
    nscale: "https://console.nscale.com",
    "akamai-linode": "https://cloud.linode.com/linodes/create",
    exabits: "https://cloud.exabits.ai/",
    "e2e-cloud": "https://myaccount.e2enetworks.com/",
    saladcloud: "https://portal.salad.com/",
    "sharon-ai": "https://cloud.sharonai.com/",
    "massed-compute": "https://cloud.massedcompute.com/",
    "hydra-cloud": "https://console.hydracloud.ai/",
    mithril: "https://app.mlfoundry.com",
    nebius: "https://console.nebius.com/",
    "google-cloud": "https://console.cloud.google.com/compute/instancesAdd",
    "google-tpu": "https://console.cloud.google.com/compute/tpus",
    azure: "https://portal.azure.com/#create/Microsoft.VirtualMachine",
    oci: "https://cloud.oracle.com/compute/instances/create"
  };
  return urls[providerId] || "";
}

function toPositiveNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function toNonNegativeNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

function sanitizeMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .map(([key, entry]) => [key, pruneMetadataValue(entry)])
    .filter(([, entry]) => entry !== undefined));
}

function buildNormalizedSpecs(input, normalized) {
  const base = {
    gpu: {
      label: normalized.gpu.rawLabel,
      model: normalized.gpu.model,
      variant: normalized.gpu.variant,
      canonicalName: normalized.gpu.canonicalName,
      count: normalized.gpuCount,
      vramGbEach: normalized.vramGbEach,
      vramTotalGb: normalized.vramGbEach ? normalized.vramGbEach * normalized.gpuCount : null
    },
    machine: {
      cpu: input.cpu || input.vcpu || input.vcpus || "",
      ramGb: toPositiveNumber(input.ramGb) || null,
      storage: input.storage || "",
      localStorage: input.localStorage || input.storage || "",
      networkBandwidth: input.networkBandwidth || "",
      networkFabric: normalized.networkFabric,
      gpuInterconnect: normalized.interconnect,
      interconnect: normalized.interconnect,
      formFactor: normalized.formFactor
    },
    provider: {
      capacityScope: input.availabilitySemantics || "",
      priceScope: input.priceScope || "",
      listingType: input.listingType || ""
    }
  };
  return sanitizeMetadata(input.specs ? mergeMetadata(base, input.specs) : base);
}

function mergeMetadata(base, override) {
  if (!override || typeof override !== "object" || Array.isArray(override)) return base;
  const output = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (
      value
      && typeof value === "object"
      && !Array.isArray(value)
      && output[key]
      && typeof output[key] === "object"
      && !Array.isArray(output[key])
    ) {
      output[key] = mergeMetadata(output[key], value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

function semanticValue(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function pruneMetadataValue(value) {
  if (value === null || value === undefined || value === "") return undefined;
  if (Array.isArray(value)) {
    const items = value.map(pruneMetadataValue).filter((item) => item !== undefined);
    return items.length ? items : undefined;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value)
      .map(([key, entry]) => [key, pruneMetadataValue(entry)])
      .filter(([, entry]) => entry !== undefined);
    return entries.length ? Object.fromEntries(entries) : undefined;
  }
  return value;
}

function roundMoney(value) {
  return Math.round(Number(value) * 10000) / 10000;
}

const DEFAULT_FX_TO_USD = {
  USD: 1,
  EUR: 1.08,
  GBP: 1.27,
  CAD: 0.73,
  INR: 0.012,
  AUD: 0.66,
  SGD: 0.74,
  JPY: 0.0064,
  CHF: 1.12,
  SEK: 0.095,
  NOK: 0.094,
  DKK: 0.145,
  PLN: 0.25
};

function fxRateFromEnv(code) {
  const envKey = `FX_${code}_USD`;
  const fromEnv = typeof process !== "undefined" && process.env ? Number(process.env[envKey]) : NaN;
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : null;
}

export function hasKnownFxRate(currency) {
  const code = String(currency || "USD").toUpperCase();
  if (code === "USD") return true;
  if (fxRateFromEnv(code) != null) return true;
  return Object.prototype.hasOwnProperty.call(DEFAULT_FX_TO_USD, code);
}

export function fxRateToUsd(currency) {
  const code = String(currency || "USD").toUpperCase();
  if (code === "USD") return 1;
  return fxRateFromEnv(code) ?? DEFAULT_FX_TO_USD[code] ?? 1;
}

function currencySymbol(currency) {
  return { USD: "$", EUR: "€", GBP: "£", CAD: "C$", INR: "₹", AUD: "A$", SGD: "S$", JPY: "¥", CHF: "CHF ", SEK: "kr", NOK: "kr", DKK: "kr", PLN: "zł" }[String(currency || "USD").toUpperCase()] || "";
}

function dedupeNotes(notes) {
  return [...new Set((notes || []).filter(Boolean))];
}

function secondsSince(value, now = new Date()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000));
}

// Deterministic fallback id for connectors that expose no native offer/SKU id.
// Hash only durable identity fields — never volatile price/availability/timestamps
// that live in rawPayload — so the same logical node keeps one stable id across
// scrapes. A churning id makes every scrape look like fresh supply and re-fires
// Slack alerts for a node that was already notified.
function syntheticOfferId({ provider, gpu, gpuCount, vramGbEach, region, input }) {
  const parts = [
    provider,
    gpu.canonicalName || gpu.model,
    gpu.variant,
    gpuCount,
    vramGbEach,
    region.canonical,
    input.formFactor || input.deploymentType || input.type || "",
    input.networkFabric || input.clusterFabric || input.networkType || input.fabric || "",
    input.interconnect || "",
    input.listingType || "",
    input.priceScope || "",
    input.minTerm || ""
  ];
  return stableHash(parts.map((part) => String(part ?? "").trim().toLowerCase()).join("|"));
}

function stableHash(value) {
  let hash = 0;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}
