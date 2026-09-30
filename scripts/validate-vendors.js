import fs from "node:fs";
import path from "node:path";
import { providerConfigs } from "../src/connectors/fixtures.js";
import { liveConnectors, primeDefaultResourceHourlyPrice } from "../src/connectors/live.js";

const rootDir = path.resolve(import.meta.dirname, "..");
const env = loadEnv(path.join(rootDir, ".env"));
const connectorById = new Map(liveConnectors.map((connector) => [connector.id, connector]));
const startedAt = new Date();
const results = [];
const DEFAULT_VALIDATE_VENDOR_TIMEOUT_MS = 90_000;

for (const provider of providerConfigs) {
  const connector = connectorById.get(provider.id);
  const configured = provider.envVars.some((envVar) => hasEnvValue(env[envVar]));
  const result = {
    providerId: provider.id,
    name: provider.name,
    status: "pending",
    configured,
    supportsLive: provider.supportsLive,
    rows: 0,
    orderable: 0,
    priced: 0,
    available: 0,
    unknownGpu: 0,
    missingRegion: 0,
    sourceModes: {},
    priceScopes: {},
    listingTypes: {},
    availabilitySemantics: {},
    priceSemantics: {},
    checkoutSemantics: {},
    confidence: {},
    exactOrderable: 0,
    prefilledOrderable: 0,
    manualOrderable: 0,
    highEndMissingFabric: 0,
    highEndMissingGpuLink: 0,
    unsupportedFabricClaims: 0,
    priceMathMismatches: 0,
    warnings: [],
    failures: [],
    durationMs: 0
  };

  if (!provider.supportsLive) {
    result.status = "fixture_only";
    result.warnings.push("No live adapter exists; fixture rows cannot be validated against a provider API.");
    progress(provider, "skipped fixture-only provider");
    results.push(result);
    continue;
  }

  if (!connector) {
    result.status = "missing_connector";
    result.failures.push("Provider is marked live-capable but has no live connector.");
    progress(provider, "failed: missing live connector");
    results.push(result);
    continue;
  }

  if (!configured) {
    result.status = "missing_key";
    result.warnings.push(`Missing one of: ${provider.envVars.join(", ")}`);
    progress(provider, "skipped: missing credentials");
    results.push(result);
    continue;
  }

  const providerStartedAt = Date.now();
  const timeoutMs = providerTimeoutMs(provider, env);
  progress(provider, `fetching live rows (timeout ${Math.round(timeoutMs / 1000)}s)...`);
  try {
    const rows = await withProviderTimeout(connector.fetch(env), provider, timeoutMs);
    result.durationMs = Date.now() - providerStartedAt;
    validateProviderRows(provider, rows, result);
    result.status = result.failures.length
      ? "failed"
      : result.warnings.length
        ? "passed_with_warnings"
        : "passed";
    progress(provider, `${result.status} (${result.orderable}/${result.rows} orderable, ${result.durationMs}ms)`);
  } catch (error) {
    result.durationMs = Date.now() - providerStartedAt;
    result.status = error.code === "VALIDATE_VENDOR_TIMEOUT" ? "timeout" : "error";
    result.failures.push(error.message);
    progress(provider, `${result.status}: ${error.message} (${result.durationMs}ms)`);
  }
  results.push(result);
}

const failedStatuses = ["failed", "error", "timeout", "missing_connector"];
const summary = {
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  totals: {
    providers: results.length,
    passed: results.filter((result) => result.status === "passed").length,
    passedWithWarnings: results.filter((result) => result.status === "passed_with_warnings").length,
    failed: results.filter((result) => failedStatuses.includes(result.status)).length,
    timedOut: results.filter((result) => result.status === "timeout").length,
    missingKey: results.filter((result) => result.status === "missing_key").length,
    fixtureOnly: results.filter((result) => result.status === "fixture_only").length,
    rows: results.reduce((sum, result) => sum + result.rows, 0),
    orderable: results.reduce((sum, result) => sum + result.orderable, 0),
    priced: results.reduce((sum, result) => sum + result.priced, 0),
    available: results.reduce((sum, result) => sum + result.available, 0)
  },
  providers: results.map(printableResult)
};

const exitCode = results.some((result) => failedStatuses.includes(result.status)) ? 1 : 0;

await writeSummaryAndExit(summary, exitCode);

function printableResult(result) {
  return {
    ...result,
    warningCount: result.warnings.length,
    failureCount: result.failures.length,
    warnings: result.warnings.slice(0, 25),
    failures: result.failures.slice(0, 25)
  };
}

function progress(provider, message) {
  process.stderr.write(`[validate-vendors] ${provider.name}: ${message}\n`);
}

function providerTimeoutMs(provider, loadedEnv) {
  const envKey = `VALIDATE_VENDOR_TIMEOUT_MS_${String(provider.id || "").toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
  const explicit = Number(loadedEnv[envKey]);
  if (Number.isFinite(explicit) && explicit >= 0) return explicit;
  const global = Number(loadedEnv.VALIDATE_VENDOR_TIMEOUT_MS);
  if (Number.isFinite(global) && global >= 0) return global;
  return DEFAULT_VALIDATE_VENDOR_TIMEOUT_MS;
}

function withProviderTimeout(promise, provider, timeoutMs) {
  if (!timeoutMs) return promise;
  let timeout;
  const timedOut = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      const error = new Error(`${provider.name} validation timed out after ${timeoutMs}ms`);
      error.code = "VALIDATE_VENDOR_TIMEOUT";
      reject(error);
    }, timeoutMs);
  });
  return Promise.race([promise, timedOut]).finally(() => {
    clearTimeout(timeout);
  });
}

async function writeSummaryAndExit(summary, exitCode) {
  await new Promise((resolve) => {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`, resolve);
  });
  // A timed-out provider request may leave an SDK socket open. This validator is
  // a one-shot audit, so exit after the JSON report is flushed.
  process.exit(exitCode);
}

function validateProviderRows(provider, rows, result) {
  result.rows = rows.length;
  if (!rows.length) result.warnings.push("Connector returned zero rows.");

  const seenIds = new Set();
  for (const item of rows) {
    result.priced += item.pricePerGpuHour != null || item.totalHourlyPrice != null ? 1 : 0;
    result.orderable += item.orderable ? 1 : 0;
    result.available += item.availability === "available" ? 1 : 0;
    result.unknownGpu += item.gpuModel === "Unknown" ? 1 : 0;
    result.missingRegion += item.region === "Unknown" ? 1 : 0;
    increment(result.sourceModes, item.sourceMode || "unknown");
    increment(result.priceScopes, item.priceScope || "unknown");
    increment(result.listingTypes, item.listingType || "unknown");
    increment(result.availabilitySemantics, item.availabilitySemantics || "missing");
    increment(result.priceSemantics, item.priceSemantics || "missing");
    increment(result.checkoutSemantics, item.checkoutSemantics || "missing");
    increment(result.confidence, item.confidence || "missing");
    if (item.orderable && item.checkoutSemantics === "exact_listing") result.exactOrderable += 1;
    if (item.orderable && item.checkoutSemantics === "prefilled_deploy") result.prefilledOrderable += 1;
    if (item.orderable && item.checkoutSemantics === "manual_provider") result.manualOrderable += 1;

    if (item.providerId !== provider.id) result.failures.push(`${item.rawOfferId}: providerId ${item.providerId} does not match ${provider.id}`);
    if (!item.rawPayload) result.failures.push(`${item.rawOfferId}: missing rawPayload`);
    if (item.rawPayload?.fixture) result.failures.push(`${item.rawOfferId}: fixture payload leaked into live validation`);
    if (/fixture/i.test(item.sourceMode || "")) result.failures.push(`${item.rawOfferId}: fixture sourceMode leaked into live validation`);
    if (!item.rawOfferId) result.failures.push("row has empty rawOfferId");
    if (seenIds.has(item.id)) result.failures.push(`${item.id}: duplicate normalized id`);
    seenIds.add(item.id);
    if (!Number.isFinite(Number(item.gpuCount)) || Number(item.gpuCount) <= 0) result.failures.push(`${item.rawOfferId}: invalid gpuCount ${item.gpuCount}`);
    validateEnum(result.failures, item, "availabilitySemantics", item.availabilitySemantics, ["host_capacity", "sku_capacity", "region_offering", "catalog_only", "price_only", "unknown"]);
    validateEnum(result.failures, item, "priceSemantics", item.priceSemantics, ["node_total", "node_total_variable", "gpu_only", "lowest_sku", "spot", "on_demand", "unpriced", "unknown"]);
    validateEnum(result.failures, item, "marketType", item.marketType, ["on_demand", "spot", "catalog", "capacity", "variable", "unknown"]);
    validateEnum(result.failures, item, "checkoutSemantics", item.checkoutSemantics, ["exact_listing", "prefilled_deploy", "manual_provider", "provider_console", "unavailable", "unknown"]);
    validateEnum(result.failures, item, "confidence", item.confidence, ["high", "medium", "low"]);
    if (/cpu/i.test(item.gpuLabel || "") || /cpu/i.test(item.gpuModel || "")) result.failures.push(`${item.rawOfferId}: CPU-only label leaked into GPU inventory`);
    if (!item.checkoutUrl) result.warnings.push(`${item.rawOfferId}: missing checkoutUrl`);
    if (item.gpuModel === "Unknown") result.warnings.push(`${item.rawOfferId}: unknown GPU label "${item.gpuLabel}"`);
    if (item.region === "Unknown") result.warnings.push(`${item.rawOfferId}: missing normalized region`);
    if (item.pricePerGpuHour == null && item.totalHourlyPrice == null && !allowsUnpriced(item)) {
      result.failures.push(`${item.rawOfferId}: missing price in priced inventory row`);
    }
    if (item.orderable && item.availability !== "available") {
      result.failures.push(`${item.rawOfferId}: orderable row is not available`);
    }
    if (item.orderable && !["host_capacity", "sku_capacity"].includes(item.availabilitySemantics)) {
      result.failures.push(`${item.rawOfferId}: orderable row has weak availabilitySemantics ${item.availabilitySemantics}`);
    }
    if (item.orderable && ["unpriced", "unknown"].includes(item.priceSemantics)) {
      result.failures.push(`${item.rawOfferId}: orderable row has weak priceSemantics ${item.priceSemantics}`);
    }
    auditInternalPriceMath(item, result);
    auditFieldProvenance(item, result);
    auditBrokerCriticalFields(item, result);
    auditProviderMath(item, result.failures);
  }
}

function allowsUnpriced(item) {
  return item.providerId === "crusoe"
    || item.providerId === "together-ai"
    || item.sourceMode === "catalog"
    || item.priceScope === "unknown"
    || /unpriced/i.test(item.priceScope || "");
}

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
      // CUDO VM machine types are configurable. `maxGpuFree` is available
      // pool capacity, not the per-rental GPU count, so the broker row is a
      // one-GPU priced offering.
      expectedCount = 1;
      expectedPerGpu = numberOrNull(raw.gpuPriceHr?.value);
      expectedTotal = expectedPerGpu;
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
    expectedTotal = numberOrNull(raw.on_demand_price_usd_per_hour);
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
  } else if (item.providerId === "mithril") {
    expectedCount = Number(raw.instanceType?.num_gpus || item.gpuCount || 1);
    expectedTotal = numberOrNull(raw.auction?.last_instance_price || raw.auction?.lowest_allocated_price);
    expectedPerGpu = expectedTotal ? expectedTotal / expectedCount : null;
  } else if (item.providerId === "digitalocean") {
    expectedCount = Number(raw.size?.gpu_info?.count || item.gpuCount || 1);
    expectedTotal = numberOrNull(raw.size?.price_hourly);
    expectedPerGpu = expectedTotal ? expectedTotal / expectedCount : null;
  } else if (item.providerId === "nscale") {
    expectedCount = Number(raw.flavor?.spec?.gpu?.physicalCount || raw.flavor?.spec?.gpu?.physical_count || raw.flavor?.spec?.gpu?.count || item.gpuCount || 1);
  } else if (item.providerId === "ovhcloud") {
    const gpu = raw.flavor?.gpu;
    expectedCount = Number((gpu && typeof gpu === "object" ? gpu.count || gpu.number || gpu.quantity : gpu) || item.gpuCount || 1);
    expectedTotal = ovhPriceToNumber(raw.flavor?.hourly || raw.flavor?.price || raw.flavor?.hourlyPrice);
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
    // Per-GPU marketplace: the priced unit is one GPU; `max_count` is the
    // available pool size (an availability count), not a node configuration.
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
  }

  expectedPerGpu = normalizeExpectedPriceForItemCurrency(item, expectedPerGpu);
  expectedTotal = normalizeExpectedPriceForItemCurrency(item, expectedTotal);

  assertEqualNumber(failures, item, "gpuCount", item.gpuCount, expectedCount);
  assertEqualNumber(failures, item, "pricePerGpuHour", item.pricePerGpuHour, expectedPerGpu);
  assertEqualNumber(failures, item, "totalHourlyPrice", item.totalHourlyPrice, expectedTotal);
}

function auditInternalPriceMath(item, result) {
  const gpuCount = Number(item.gpuCount);
  const total = Number(item.totalHourlyPrice);
  const perGpu = Number(item.pricePerGpuHour);
  if (!Number.isFinite(gpuCount) || gpuCount <= 0 || !Number.isFinite(total) || !Number.isFinite(perGpu)) return;
  const expectedTotal = round(perGpu * gpuCount);
  if (Math.abs(round(total) - expectedTotal) > 0.02) {
    result.priceMathMismatches += 1;
    result.failures.push(`${item.rawOfferId}: totalHourlyPrice ${total} does not equal pricePerGpuHour ${perGpu} * gpuCount ${gpuCount}`);
  }
}

function auditFieldProvenance(item, result) {
  const fabric = String(item.networkFabric || "");
  if (!fabric || /not exposed|unknown|none|not listed/i.test(fabric)) return;

  const proof = rawProofText(item);
  const supported = (() => {
    if (/infiniband/i.test(fabric)) return /infiniband|\bib\b|ib_count|nic_ib|ib_|_ib|ndr|hdr|edr|rdma|roce/i.test(proof);
    if (/\brdma\b/i.test(fabric)) return /rdma|roce|infiniband|\bib\b|ib_count|nic_ib|ib_|_ib/i.test(proof);
    if (/roce/i.test(fabric)) return /roce|rdma/i.test(proof);
    if (/\befa\b/i.test(fabric)) return /\befa\b|efa_supported|efasupported|elastic fabric adapter/i.test(proof);
    if (/ethernet/i.test(fabric)) return /ethernet|\bgbe\b|gigabit ethernet|internet|public ip|port forward|nic_eth|eth_|_eth/i.test(proof);
    return true;
  })();

  if (!supported) {
    result.unsupportedFabricClaims += 1;
    result.failures.push(`${item.rawOfferId}: networkFabric "${fabric}" is not supported by raw payload/metadata text`);
  }
}

function auditBrokerCriticalFields(item, result) {
  if (!isHighEndMultiGpu(item)) return;
  const fabric = `${item.networkFabric || ""} ${item.specs?.machine?.networkFabric || ""}`;
  const gpuLink = `${item.interconnect || ""} ${item.specs?.machine?.gpuInterconnect || ""}`;
  if (/not exposed|unknown|none|not listed|^\s*$/i.test(fabric)) {
    result.highEndMissingFabric += 1;
  }
  if (/not exposed|unknown|none|not listed|^\s*$/i.test(gpuLink)) {
    result.highEndMissingGpuLink += 1;
  }
}

function isHighEndMultiGpu(item) {
  return Number(item.gpuCount || 0) >= 2 && /^(H100|H200|B200|B300|GB200|GB300|A100|MI300X|MI325X|MI355X)$/i.test(item.gpuModel || "");
}

function rawProofText(item) {
  return JSON.stringify(item.rawPayload || {}).toLowerCase();
}

function assertEqualNumber(failures, item, field, actual, expected) {
  if (expected == null || Number.isNaN(Number(expected))) return;
  if (round(actual) !== round(expected)) {
    failures.push(`${item.rawOfferId}: ${field} got ${actual}, expected ${round(expected)}`);
  }
}

function validateEnum(failures, item, field, actual, allowed) {
  if (!allowed.includes(actual)) {
    failures.push(`${item.rawOfferId}: ${field} got ${actual || "missing"}, expected one of ${allowed.join(", ")}`);
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

function normalizeExpectedPriceForItemCurrency(item, value) {
  const parsed = numberOrNull(value);
  if (parsed == null) return value;
  const currency = String(item.currency || "USD").toUpperCase();
  const nativeCurrency = String(item.nativeCurrency || currency).toUpperCase();
  if (currency !== "USD" || nativeCurrency === "USD") return parsed;
  const rate = fxRateToUsd(nativeCurrency);
  return rate ? parsed * rate : parsed;
}

function fxRateToUsd(currency) {
  const normalized = String(currency || "").toUpperCase();
  const override = numberOrNull(env[`FX_${normalized}_USD`]);
  if (override) return override;
  return {
    EUR: 1.08,
    GBP: 1.27,
    INR: 0.012
  }[normalized] || null;
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

function ovhPriceToNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return numberOrNull(value);
  if (typeof value === "string") {
    const match = value.match(/(\d+(?:[.,]\d+)?)/);
    return match ? numberOrNull(match[1].replace(",", ".")) : null;
  }
  if (typeof value === "object") return ovhPriceToNumber(value.value ?? value.price ?? value.amount ?? value.text ?? value.display);
  return null;
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

function increment(target, key) {
  target[key] = (target[key] || 0) + 1;
}
