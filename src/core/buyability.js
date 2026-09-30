import { updateStaleness } from "./inventory.js";
import { validateCheckoutTruthItem } from "./checkoutTruth.js";

const DEFAULT_MAX_SNAPSHOT_AGE_SECONDS = 120;
const DEFAULT_PRICE_TOLERANCE_PCT = 0.01;
const DEFAULT_PRICE_TOLERANCE_USD = 0.01;

export function revalidateBuyableCheckout({
  requestedItem,
  freshRows = [],
  now = new Date(),
  maxSnapshotAgeSeconds = DEFAULT_MAX_SNAPSHOT_AGE_SECONDS,
  priceTolerancePct = DEFAULT_PRICE_TOLERANCE_PCT,
  priceToleranceUsd = DEFAULT_PRICE_TOLERANCE_USD
} = {}) {
  if (!requestedItem) {
    return fail("snapshot_missing", "This offer is not present in the current inventory snapshot.");
  }

  const snapshotItem = updateStaleness(requestedItem, now);
  const warnings = [];
  if (Number(snapshotItem.stalenessSeconds || 0) > Number(maxSnapshotAgeSeconds || DEFAULT_MAX_SNAPSHOT_AGE_SECONDS)) {
    warnings.push(`Snapshot row is ${snapshotItem.stalenessSeconds}s old; live provider data was rechecked before checkout.`);
  }

  if (!snapshotItem.orderable) {
    return fail("snapshot_not_orderable", snapshotItem.orderabilityReason || "Snapshot row is not orderable.", { item: snapshotItem, warnings });
  }

  const snapshotTruth = validateCheckoutTruthItem(snapshotItem);
  if (snapshotTruth.failures.length) {
    return fail("snapshot_truth_failed", "Snapshot row does not satisfy checkout truth rules.", {
      item: snapshotItem,
      failures: snapshotTruth.failures,
      warnings: [...warnings, ...snapshotTruth.warnings]
    });
  }

  const current = findMatchingFreshItem(snapshotItem, freshRows, now);
  if (!current) {
    return fail("not_found_live", "This offer no longer exists in the provider's live inventory.", { item: snapshotItem, warnings });
  }

  if (!current.orderable) {
    return fail("not_orderable_live", current.orderabilityReason || "The provider no longer reports this offer as orderable.", {
      item: current,
      warnings
    });
  }

  const currentTruth = validateCheckoutTruthItem(current);
  if (currentTruth.failures.length) {
    return fail("live_truth_failed", "Live provider row does not satisfy checkout truth rules.", {
      item: current,
      failures: currentTruth.failures,
      warnings: [...warnings, ...currentTruth.warnings]
    });
  }

  const priceComparison = comparePrices(snapshotItem, current, { priceTolerancePct, priceToleranceUsd });
  if (priceComparison.changed) {
    return fail("price_changed", `Live price changed from ${money(priceComparison.previous)} to ${money(priceComparison.current)}.`, {
      item: current,
      warnings,
      priceComparison
    });
  }

  return {
    ok: true,
    status: "buyable",
    message: "Live provider API revalidated this offer as orderable before checkout.",
    item: current,
    warnings,
    failures: [],
    priceComparison
  };
}

export function findMatchingFreshItem(snapshotItem, freshRows = [], now = new Date()) {
  const rows = freshRows.map((row) => updateStaleness(row, now));
  return rows.find((row) => row.id === snapshotItem.id)
    || rows.find((row) => (
      row.providerId === snapshotItem.providerId
      && row.rawOfferId === snapshotItem.rawOfferId
      && row.regionCanonical === snapshotItem.regionCanonical
    ))
    || rows.find((row) => (
      row.providerId === snapshotItem.providerId
      && row.rawOfferId === snapshotItem.rawOfferId
      && row.rawRegion === snapshotItem.rawRegion
    ))
    || null;
}

export function comparePrices(previousItem, currentItem, {
  priceTolerancePct = DEFAULT_PRICE_TOLERANCE_PCT,
  priceToleranceUsd = DEFAULT_PRICE_TOLERANCE_USD
} = {}) {
  const previous = comparablePrice(previousItem);
  const current = comparablePrice(currentItem);
  if (!positive(previous) || !positive(current)) {
    return { previous, current, delta: null, tolerance: null, changed: false };
  }
  const delta = Math.abs(current - previous);
  const tolerance = Math.max(Number(priceToleranceUsd || 0), previous * Number(priceTolerancePct || 0));
  return {
    previous,
    current,
    delta,
    tolerance,
    changed: delta > tolerance
  };
}

function fail(status, message, details = {}) {
  return {
    ok: false,
    status,
    message,
    item: details.item || null,
    warnings: details.warnings || [],
    failures: details.failures || [message],
    priceComparison: details.priceComparison || null
  };
}

function comparablePrice(item) {
  if (!item) return null;
  if (positive(item.totalHourlyPrice)) return Number(item.totalHourlyPrice);
  if (positive(item.pricePerGpuHour) && positive(item.gpuCount)) return Number(item.pricePerGpuHour) * Number(item.gpuCount);
  if (positive(item.pricePerGpuHour)) return Number(item.pricePerGpuHour);
  return null;
}

function positive(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

function money(value) {
  return positive(value) ? `$${Number(value).toFixed(4)}/hr` : "unknown";
}
