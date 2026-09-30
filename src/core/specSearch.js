import { gpuDefinitions, normalizeGpuLabel, normalizeGpuVariant, normalizeRegion } from "./taxonomy.js";
import { isDatacenterVendorInventoryItem } from "./inventory.js";

export function parseSpec(input = "") {
  const text = String(input || "").trim();
  const lower = text.toLowerCase();
  const definitions = gpuDefinitions();
  const modelRequirements = parseModelRequirements(text);
  const requestedModels = definitions
    .filter((definition) => definition.patterns.some((pattern) => pattern.test(text)))
    .map((definition) => definition.model);
  const firstModel = requestedModels[0] || "";
  const gpuCount = modelRequirements[0]?.count || parseGpuCount(text, firstModel);
  const variant = normalizeGpuVariant(text);
  const region = parseRegion(text);
  const budget = parseBudget(lower);
  const formFactor = parseFormFactor(lower);
  const networkFabric = parseNetworkFabric(lower);
  const minVramGbEach = parseMinVram(lower);

  return {
    raw: text,
    requestedModels: [...new Set(requestedModels)],
    modelRequirements,
    gpuCount,
    variant: variant === "Unknown" ? "" : variant,
    region,
    budgetPerGpuHour: budget.perGpuHour,
    budgetTotalHourly: budget.totalHourly,
    formFactor,
    networkFabric,
    minVramGbEach
  };
}

export function searchInventory(items, options = {}) {
  const spec = typeof options.spec === "string" ? parseSpec(options.spec) : options.spec || parseSpec("");
  const filters = options.filters || {};
  const filtered = filterInventory(items, filters);
  const market = computeMarketStats(filtered);
  const ranked = filtered
    .map((item) => scoreOffer(item, spec, market))
    .sort((left, right) => right.matchScore - left.matchScore || compareNullable(left.pricePerGpuHour, right.pricePerGpuHour));

  return {
    spec,
    market,
    results: ranked,
    bestOverall: ranked[0] || null,
    bestPerProvider: bestPerProvider(ranked),
    alerts: evaluateAlerts(items, options.alerts || [])
  };
}

export function filterInventory(items, filters = {}) {
  const provider = String(filters.provider || "").toLowerCase();
  const providerIds = normalizeProviderIdFilter(filters.providerIds ?? filters.providers);
  const providerIdsFilterApplied = providerIds.length > 0
    && (Object.hasOwn(filters, "providerIds") || Object.hasOwn(filters, "providers"));
  const gpuModel = String(filters.gpuModel || "").toUpperCase();
  const gpuModels = normalizeGpuModelFilter(filters.gpuModels);
  const region = String(filters.region || "").toLowerCase();
  const variant = String(filters.variant || "").toLowerCase();
  const formFactor = String(filters.formFactor || "").toLowerCase();
  const fabric = String(filters.fabric || filters.networkFabric || "").toLowerCase();
  const sourceMode = String(filters.sourceMode || "").toLowerCase();
  const availabilityOnly = filters.availabilityOnly === true || filters.availabilityOnly === "true";
  const orderableOnly = filters.orderableOnly === true || filters.orderableOnly === "true";
  const directCheckoutOnly = filters.directCheckoutOnly === true || filters.directCheckoutOnly === "true";
  const excludeRiskyFabric = filters.excludeRiskyFabric === true || filters.excludeRiskyFabric === "true";
  const datacenterVendorOnly = filters.datacenterVendorOnly === true || filters.datacenterVendorOnly === "true";
  const datacenterOnly = filters.datacenterOnly === true || filters.datacenterOnly === "true"
    || filters.excludeConsumerGpus === true || filters.excludeConsumerGpus === "true";
  const minGpuCount = Number(filters.minGpuCount || 0);
  const maxPricePerGpu = Number(filters.maxPricePerGpu || 0);
  const minSpecCompleteness = Number(filters.minSpecCompleteness || 0);
  const freeText = String(filters.freeText || "").toLowerCase();

  return items.filter((item) => {
    if (providerIdsFilterApplied && !providerIds.includes(item.providerId)) return false;
    if (!providerIdsFilterApplied && provider && item.providerId !== provider && !item.provider.toLowerCase().includes(provider)) return false;
    if (gpuModels.length) {
      if (!gpuModels.includes(String(item.gpuModel || "").toUpperCase())) return false;
    } else if (gpuModel && item.gpuModel !== gpuModel) return false;
    if (region && !item.regionCanonical.includes(region) && !item.region.toLowerCase().includes(region) && !String(item.rawRegion || "").toLowerCase().includes(region) && !item.country.toLowerCase().includes(region)) return false;
    if (variant && item.gpuVariant.toLowerCase() !== variant) return false;
    if (formFactor && item.formFactor !== formFactor) return false;
    if (fabric && !fabricMatches(item, fabric)) return false;
    if (sourceMode && item.sourceMode !== sourceMode) return false;
    if (availabilityOnly && item.availability !== "available") return false;
    if (orderableOnly && item.orderable === false) return false;
    if (directCheckoutOnly && !["exact_listing", "prefilled_deploy"].includes(item.checkoutSemantics)) return false;
    if (excludeRiskyFabric && fabricRisk(item).isRisky) return false;
    if (datacenterVendorOnly && !isDatacenterVendorInventoryItem(item)) return false;
    if (datacenterOnly && item.gpuTier === "consumer") return false;
    if (minSpecCompleteness && specCompleteness(item).score < minSpecCompleteness) return false;
    if (minGpuCount && item.gpuCount < minGpuCount) return false;
    if (maxPricePerGpu) {
      if (!item.pricePerGpuHour) return false;
      if (item.pricePerGpuHour > maxPricePerGpu) return false;
    }
    if (freeText) {
      const haystack = [
        item.provider,
        item.gpuLabel,
        item.gpuModel,
        item.gpuVariant,
        item.region,
        item.country,
        item.formFactor,
        item.interconnect,
        item.networkFabric,
        item.networkBandwidth,
        item.specs?.machine?.networkFabric,
        item.specs?.machine?.gpuInterconnect,
        item.listingType,
        item.priceScope,
        item.availabilitySemantics,
        item.priceSemantics,
        item.checkoutSemantics,
        item.confidence,
        item.marketType,
        item.dataNotes?.join(" "),
        metadataText(item.metadata)
      ].join(" ").toLowerCase();
      if (!haystack.includes(freeText)) return false;
    }
    return true;
  });
}

function fabricMatches(item, fabric) {
  const haystack = [
    item.networkFabric,
    item.networkBandwidth,
    item.interconnect,
    item.specs?.machine?.networkFabric,
    item.specs?.machine?.gpuInterconnect,
    metadataText(item.metadata)
  ].join(" ").toLowerCase();
  if (fabric === "ib" || fabric === "infiniband") return /infiniband|\bib\b|ndr|hdr|edr|rdma|roce/.test(haystack);
  if (fabric === "ethernet") return /ethernet|gbe|gbit|gbps|100g|200g|400g/.test(haystack) && !/infiniband|\bib\b|rdma|roce/.test(haystack);
  if (fabric === "not_exposed") return /not exposed|not listed|unknown|none/.test(haystack);
  return haystack.includes(fabric);
}

export function specCompleteness(item) {
  const checks = [
    ["GPU model", item.gpuModel && item.gpuModel !== "Unknown", 12],
    ["GPU count", Number(item.gpuCount) > 0, 8],
    ["VRAM", Number(item.vramGbEach) > 0, 8],
    ["CPU", Boolean(item.cpu), 7],
    ["RAM", Number(item.ramGb) > 0, 7],
    ["storage", Boolean(item.storage), 5],
    ["region", Boolean((item.rawRegion || item.region) && (item.rawRegion || item.region) !== "Unknown"), 7],
    ["price", Boolean(item.totalHourlyPrice || item.pricePerGpuHour), 10],
    ["availability truth", ["host_capacity", "sku_capacity"].includes(item.availabilitySemantics), 10],
    ["checkout route", ["exact_listing", "prefilled_deploy", "manual_provider"].includes(item.checkoutSemantics) && Boolean(item.checkoutUrl), 9],
    ["fabric/topology", !fabricRisk(item).isRisky, 12],
    ["raw proof", Boolean(item.rawPayload), 5]
  ];
  const total = checks.reduce((sum, entry) => sum + entry[2], 0);
  const earned = checks.reduce((sum, entry) => sum + (entry[1] ? entry[2] : 0), 0);
  return {
    score: Math.round((earned / total) * 100),
    missing: checks.filter((entry) => !entry[1]).map((entry) => entry[0])
  };
}

function fabricRisk(item) {
  const fabric = [
    item.networkFabric,
    item.networkBandwidth,
    item.interconnect,
    item.specs?.machine?.networkFabric,
    item.specs?.machine?.gpuInterconnect
  ].join(" ").toLowerCase();
  const notes = String(item.dataNotes?.join(" ") || "").toLowerCase();
  const highEnd = isHighEndMultiGpu(item);
  if (/no\s+(?:ib|infiniband|rdma)|without\s+(?:ib|infiniband|rdma)|not\s+(?:exposed|listed)/.test(`${fabric} ${notes}`)) {
    return highEnd
      ? { tone: "bad", detail: "No IB/RDMA fabric listed", isRisky: true }
      : { tone: "warn", detail: "No fabric detail", isRisky: false };
  }
  if (/infiniband|rdma|roce|efa|nvl|nvlink|nvswitch/.test(fabric)) return { tone: "good", detail: "Fabric listed", isRisky: false };
  if (/ethernet/.test(fabric)) {
    return highEnd
      ? { tone: "warn", detail: "High-end multi-GPU on Ethernet only", isRisky: true }
      : { tone: "good", detail: "Ethernet listed", isRisky: false };
  }
  if (/not exposed|unknown|none|not listed|^$/.test(fabric)) {
    return highEnd
      ? { tone: "bad", detail: "No IB/RDMA fabric listed", isRisky: true }
      : { tone: "warn", detail: "No fabric detail", isRisky: false };
  }
  return { tone: "warn", detail: "Fabric needs review", isRisky: false };
}

function isHighEndMultiGpu(item) {
  return Number(item.gpuCount || 0) >= 2 && /^(H100|H200|B200|B300|GB200|GB300|A100|MI300X|MI325X|MI355X)$/i.test(item.gpuModel || "");
}

// Accepts an array of models or a comma-separated string and normalizes to
// upper-cased model names so a multi-model filter (e.g. ["H100", "H200"]) can be
// compared case-insensitively against item.gpuModel.
function normalizeGpuModelFilter(value) {
  if (Array.isArray(value)) {
    return value.map((model) => String(model || "").trim().toUpperCase()).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    return value.split(",").map((model) => model.trim().toUpperCase()).filter(Boolean);
  }
  return [];
}

function normalizeProviderIdFilter(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").toLowerCase()).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    return value.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  }
  return [];
}

export function scoreOffer(item, spec, market) {
  const reasons = [];
  const warnings = [];
  let score = 0;

  const modelScore = scoreGpuModel(item, spec, reasons, warnings);
  score += modelScore;

  const requestedGpuCount = requestedCountForItem(item, spec);
  if (requestedGpuCount) {
    if (item.gpuCount === requestedGpuCount) {
      score += 140;
      reasons.push(`exact ${requestedGpuCount}x GPU count`);
    } else if (item.gpuCount > requestedGpuCount) {
      score += 105;
      reasons.push(`${item.gpuCount}x GPUs can satisfy ${requestedGpuCount}x request`);
    } else {
      const partial = Math.round((item.gpuCount / requestedGpuCount) * 80);
      score += partial;
      warnings.push(`only ${item.gpuCount}x GPUs vs requested ${requestedGpuCount}x`);
    }
  } else {
    score += 60;
  }

  if (spec.variant) {
    if (item.gpuVariant === spec.variant) {
      score += 80;
      reasons.push(`${spec.variant} variant match`);
    } else if (item.gpuVariant === "Unknown") {
      score += 25;
      warnings.push("GPU variant unknown");
    } else {
      score -= 25;
      warnings.push(`${item.gpuVariant} variant differs from requested ${spec.variant}`);
    }
  }

  if (spec.minVramGbEach) {
    if (item.vramGbEach && item.vramGbEach >= spec.minVramGbEach) {
      score += 55;
      reasons.push(`${item.vramGbEach}GB VRAM meets minimum`);
    } else {
      score -= 60;
      warnings.push("VRAM is below or unknown vs requested minimum");
    }
  }

  if (spec.region?.canonical) {
    if (regionMatches(item, spec.region)) {
      score += 80;
      reasons.push(`region matches ${spec.region.label}`);
    } else {
      score -= 20;
      warnings.push(`region is ${item.region}`);
    }
  }

  if (spec.formFactor) {
    if (item.formFactor === spec.formFactor) {
      score += 40;
      reasons.push(`${spec.formFactor} form factor`);
    } else {
      score -= 10;
    }
  }

  if (spec.networkFabric) {
    if (fabricMatches(item, spec.networkFabric)) {
      score += 95;
      reasons.push(`${formatFabricLabel(spec.networkFabric)} fabric match`);
    } else {
      score -= 120;
      warnings.push(`${formatFabricLabel(spec.networkFabric)} fabric not listed`);
    }
  }

  const priceScore = scorePrice(item, spec, market, reasons, warnings);
  score += priceScore;

  if (item.availability === "available") {
    score += 65;
  } else if (item.availability === "upcoming") {
    score += 20;
    warnings.push("upcoming inventory");
  } else {
    score -= 40;
    warnings.push("not currently available");
  }

  const freshness = scoreFreshness(item, warnings);
  score += freshness;

  const brokerRisk = fabricRisk(item);
  if (brokerRisk.isRisky) {
    score -= brokerRisk.tone === "bad" ? 95 : 55;
    warnings.push(brokerRisk.detail);
  }

  if (item.checkoutSemantics === "exact_listing") score += 35;
  if (item.checkoutSemantics === "prefilled_deploy") score += 25;
  if (item.checkoutSemantics === "manual_provider") score -= 5;

  const completeness = specCompleteness(item);
  score += Math.round((completeness.score - 70) / 3);

  const dealLabels = buildDealLabels(item, spec, market);

  return {
    ...item,
    matchScore: Math.max(0, Math.round(score)),
    reasons,
    warnings,
    dealLabels,
    specCompleteness: completeness.score,
    specCompletenessMissing: completeness.missing,
    brokerRisk: brokerRisk.detail
  };
}

// GPU-only prices (e.g. TensorDock) cover just the GPU; CPU/RAM/storage are
// billed separately, so they are not comparable to all-in node prices. Market
// medians/min must be computed within a single price scope or a cheap GPU-only
// row will deflate the median and earn a false "below market" badge.
export function priceScopeClass(item) {
  const semantics = String(item?.priceSemantics || "").toLowerCase();
  if (semantics === "gpu_only" || semantics === "lowest_sku") return "gpu_only";
  if (semantics === "node_total" || semantics === "node_total_variable" || semantics === "spot") return "all_in";
  const scope = String(item?.priceScope || "").toLowerCase();
  if (scope === "gpu_sku_only" || scope === "gpu_sku_lowest") return "gpu_only";
  if (scope === "node_total" || scope === "node_total_variable") return "all_in";
  return "other";
}

function marketKey(item) {
  return `${item.gpuModel}:${item.gpuVariant}:${priceScopeClass(item)}`;
}

export function computeMarketStats(items) {
  const groups = new Map();
  for (const item of items) {
    if (!item.pricePerGpuHour || item.gpuModel === "Unknown") continue;
    const key = marketKey(item);
    const bucket = groups.get(key) || [];
    bucket.push(item.pricePerGpuHour);
    groups.set(key, bucket);
  }

  const bySku = {};
  for (const [key, prices] of groups.entries()) {
    prices.sort((a, b) => a - b);
    bySku[key] = {
      min: prices[0],
      median: median(prices),
      max: prices[prices.length - 1],
      count: prices.length
    };
  }

  return { bySku };
}

function scoreGpuModel(item, spec, reasons, warnings) {
  if (!spec.requestedModels.length) return 120;
  if (spec.requestedModels.includes(item.gpuModel)) {
    reasons.push(`${item.gpuModel} exact model match`);
    return 300;
  }

  const requested = normalizeGpuLabel(spec.requestedModels[0]);
  if (item.gpuRank > requested.rank) {
    reasons.push(`${item.gpuModel} is an upgrade candidate for ${requested.model}`);
    return 210;
  }
  if (item.gpuRank >= requested.rank * 0.85) {
    warnings.push(`${item.gpuModel} is a near substitute for ${requested.model}`);
    return 135;
  }
  warnings.push(`${item.gpuModel} is weaker than requested ${requested.model}`);
  return 45;
}

function scorePrice(item, spec, market, reasons, warnings) {
  let score = 0;
  if (item.pricePerGpuHour) {
    const sku = market.bySku[marketKey(item)];
    if (sku?.median) {
      const discount = (sku.median - item.pricePerGpuHour) / sku.median;
      if (discount > 0.18) {
        score += 95;
        reasons.push(`${Math.round(discount * 100)}% below SKU median`);
      } else if (discount > 0.05) {
        score += 65;
        reasons.push("below SKU median");
      } else if (discount >= -0.05) {
        score += 40;
      } else {
        score += 15;
      }
    } else {
      score += 35;
    }
  }

  if (spec.budgetPerGpuHour) {
    if (item.pricePerGpuHour && item.pricePerGpuHour <= spec.budgetPerGpuHour) {
      score += 80;
      reasons.push("within per-GPU budget");
    } else {
      score -= 80;
      warnings.push("above per-GPU budget");
    }
  }

  if (spec.budgetTotalHourly) {
    if (item.totalHourlyPrice && item.totalHourlyPrice <= spec.budgetTotalHourly) {
      score += 80;
      reasons.push("within total hourly budget");
    } else {
      score -= 80;
      warnings.push("above total hourly budget");
    }
  }

  return score;
}

function scoreFreshness(item, warnings) {
  const seconds = Number(item.stalenessSeconds);
  if (!Number.isFinite(seconds)) {
    warnings.push("freshness unknown");
    return 0;
  }
  if (seconds < 5 * 60) return 50;
  if (seconds < 30 * 60) return 35;
  if (seconds < 2 * 60 * 60) return 15;
  warnings.push("inventory is stale");
  return -10;
}

function buildDealLabels(item, spec, market) {
  const labels = [];
  const sku = market.bySku[marketKey(item)];
  if (sku?.min === item.pricePerGpuHour) labels.push("Best price in SKU");
  if (sku?.median && item.pricePerGpuHour && item.pricePerGpuHour < sku.median * 0.85) labels.push("Below market");
  if (spec.requestedModels.includes(item.gpuModel)) labels.push("Exact GPU");
  if (item.availability === "available") labels.push("Available");
  if (item.stalenessSeconds <= 5 * 60) labels.push("Fresh");
  return labels.slice(0, 4);
}

function bestPerProvider(items) {
  const winners = new Map();
  for (const item of items) {
    const current = winners.get(item.providerId);
    if (!current || item.matchScore > current.matchScore) winners.set(item.providerId, item);
  }
  return [...winners.values()].sort((left, right) => right.matchScore - left.matchScore);
}

// Constraints a user wrote into an alert spec must be hard filters, not soft
// scores. Otherwise "alert me when an H100 SXM + IB node appears" fires on an
// H100 SXM row with no InfiniBand, because the model match outweighs the fabric
// penalty. Region is intentionally left to soft scoring: parseRegion yields
// hierarchical canonicals (e.g. "north-america") that would not substring-match
// "us-east" rows, so hard-filtering it would silently drop real matches.
function alertHardFiltersFromSpec(spec) {
  const filters = {};
  if (spec.requestedModels?.length === 1) filters.gpuModel = spec.requestedModels[0];
  else if (spec.requestedModels?.length > 1) filters.gpuModels = spec.requestedModels;
  if (spec.variant) filters.variant = spec.variant;
  if (spec.networkFabric) filters.fabric = spec.networkFabric;
  if (spec.gpuCount) filters.minGpuCount = spec.gpuCount;
  return filters;
}

// Drop empty-string sentinels (the UI emits "" for unset controls) so an
// unset explicit filter never clobbers a constraint derived from the spec.
function compactFilters(filters = {}) {
  const out = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value === "" || value === null || value === undefined) continue;
    out[key] = value;
  }
  return out;
}

function evaluateAlerts(items, alerts) {
  return alerts.map((alert) => evaluateAlert(items, alert));
}

export function evaluateAlert(items, alert, options = {}) {
  const spec = parseSpec(alert.spec || "");
  const alertFilters = {
    availabilityOnly: true,
    orderableOnly: true,
    excludeRiskyFabric: true,
    ...alertHardFiltersFromSpec(spec),
    ...compactFilters(alert.filters || {}),
    // Alerts are intentionally higher-trust than search: marketplace rows can
    // still be inspected in the terminal, but should not page brokers.
    datacenterVendorOnly: true
  };
  const filtered = filterInventory(items, alertFilters);
  const market = computeMarketStats(filtered);
  const matches = filtered
    .map((item) => ({ ...scoreOffer(item, spec, market), alertMatchKey: alertMatchKey(item) }))
    .filter((item) => item.matchScore >= (alert.minScore || 500))
    .sort((left, right) => right.matchScore - left.matchScore || compareNullable(left.pricePerGpuHour, right.pricePerGpuHour));
  const matchKeys = dedupeStableKeys(matches.map((item) => item.alertMatchKey));
  const result = {
    id: alert.id,
    name: alert.name || alert.spec,
    matchCount: matches.length,
    topMatch: matches[0] || null,
    matchIds: matchKeys.slice(0, 20),
    matchKeys,
    checkedAt: new Date().toISOString()
  };
  if (options.includeMatches) result.matches = matches;
  return result;
}

export function alertMatchKey(item) {
  return stableKey([
    item?.providerId,
    item?.rawOfferId,
    item?.rawRegion || item?.regionCanonical || item?.region,
    item?.gpuModel,
    item?.gpuVariant,
    item?.gpuCount,
    item?.vramGbEach,
    item?.formFactor,
    item?.networkFabric,
    item?.interconnect,
    item?.availabilitySemantics,
    item?.priceScope,
    item?.marketType,
    item?.checkoutSemantics,
    item?.listingType
  ]);
}

function stableKey(parts) {
  return parts
    .map((part) => String(part ?? "").trim().toLowerCase().replace(/\s+/g, " "))
    .join("|");
}

function dedupeStableKeys(keys) {
  return [...new Set(keys.filter(Boolean))];
}

function parseGpuCount(text, firstModel) {
  if (!text) return null;
  const escaped = firstModel ? firstModel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : "(?:GB300|GB200|B300|B200|H200|GH200|H100|A100|L40S|L40|L4|RTX\\s*4090)";
  const patterns = [
    new RegExp(`(\\d+)\\s*x\\s*(?:NVIDIA\\s*)?${escaped}`, "i"),
    new RegExp(`${escaped}.*?\\bx\\s*(\\d+)`, "i"),
    /\b(\d+)\s*(?:GPUS?|GPU)\b/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
}

function parseModelRequirements(text) {
  const definitions = gpuDefinitions();
  const modelAlternation = definitions.map((definition) => definition.model.replace(/\s+/g, "\\s*")).join("|");
  const patterns = [
    new RegExp(`(\\d+)\\s*x?\\s*(?:NVIDIA\\s*)?(${modelAlternation})`, "gi"),
    new RegExp(`(?:NVIDIA\\s*)?(${modelAlternation})\\s*x\\s*(\\d+)`, "gi")
  ];
  const requirements = [];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const count = Number(match[1]) || Number(match[2]);
      const rawModel = Number(match[1]) ? match[2] : match[1];
      const model = normalizeGpuLabel(rawModel).model;
      if (model !== "Unknown" && Number.isFinite(count)) {
        requirements.push({ model, count });
      }
    }
  }

  const byModel = new Map();
  for (const requirement of requirements) {
    if (!byModel.has(requirement.model)) byModel.set(requirement.model, requirement);
  }
  return [...byModel.values()];
}

function requestedCountForItem(item, spec) {
  const requirement = spec.modelRequirements?.find((entry) => entry.model === item.gpuModel);
  return requirement?.count || spec.gpuCount;
}

function parseBudget(text) {
  const result = { perGpuHour: null, totalHourly: null };
  const perGpu = text.match(/(?:under|below|<=|less than)?\s*\$?\s*(\d+(?:\.\d+)?)\s*(?:\/|per)?\s*gpu\s*(?:\/|per)?\s*(?:hr|hour)/i);
  if (perGpu) result.perGpuHour = Number(perGpu[1]);

  const total = text.match(/(?:under|below|<=|less than)?\s*\$?\s*(\d+(?:\.\d+)?)\s*(?:\/|per)?\s*(?:hr|hour|total)/i);
  if (total && !perGpu) result.totalHourly = Number(total[1]);
  if (/total/.test(text) && total) result.totalHourly = Number(total[1]);

  return result;
}

function parseRegion(text) {
  const explicit = text.match(/\b(us-east|us-west|north america|europe|eu|usa|canada|asia|singapore|japan|france|germany)\b/i);
  if (!explicit) return null;
  return normalizeRegion(explicit[1]);
}

function parseFormFactor(text) {
  if (/bare/.test(text)) return "bare_metal";
  if (/container|pod|serverless/.test(text)) return "container";
  if (/\bvm\b|virtual/.test(text)) return "vm";
  return "";
}

function parseNetworkFabric(text) {
  if (/\b(infiniband|ib|ndr|hdr|edr|rdma|roce)\b/.test(text)) return "ib";
  if (/\befa\b/.test(text)) return "efa";
  if (/\bethernet\b|\b(?:100|200|400|800)\s*g(?:b|bps)?\b/.test(text)) return "ethernet";
  return "";
}

function formatFabricLabel(value) {
  if (value === "ib") return "IB/RDMA";
  if (value === "efa") return "EFA";
  if (value === "ethernet") return "Ethernet";
  return String(value || "").toUpperCase();
}

function parseMinVram(text) {
  const match = text.match(/(?:at least|min(?:imum)?)\s*(\d{2,3})\s*gb/i);
  return match ? Number(match[1]) : null;
}

function regionMatches(item, region) {
  if (!region) return true;
  return item.regionCanonical === region.canonical || item.regionCanonical.includes(region.canonical) || region.canonical.includes(item.regionCanonical);
}

function median(values) {
  if (!values.length) return null;
  const middle = Math.floor(values.length / 2);
  if (values.length % 2) return values[middle];
  return (values[middle - 1] + values[middle]) / 2;
}

function compareNullable(left, right) {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return left - right;
}

function metadataText(value) {
  if (!value || typeof value !== "object") return "";
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}
