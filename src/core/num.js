// Numeric coercion shared by the provider crawlers. Consolidates what used to be
// 9 divergent copies of `numberOrNull` (some stripped currency symbols, some
// rejected non-positive values, some turned "" into 0) into one contract.

// Parse to a positive finite number or null. Strips currency symbols/commas/
// whitespace so values like "$1,234.50" parse; empty/blank/non-numeric/<=0 yield
// null (these fields — prices, VRAM, counts, bandwidth — are never non-positive).
export function numberOrNull(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/[$,\s]/g, "");
  if (text === "") return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

// Normalize a memory value to GB. Accepts a bare number (already GB), a unit
// string ("512 MB", "1 TB", "80GiB"), or an object carrying the amount under
// amount/value/size.
export function parseMemoryGb(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "object") return parseMemoryGb(value.amount ?? value.value ?? value.size);
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  // Only a unit-qualified amount is read from a string, so mixed text like
  // "t2-90" (a flavor name) stays null and lets callers fall back to a model
  // lookup, while "2x V100 32GB" correctly reads 32GB rather than the count.
  const unitMatch = String(value).match(/(\d+(?:\.\d+)?)\s*(tb|tib|gb|gib|mb|mib)\b/i);
  if (!unitMatch) return null;
  const amount = Number(unitMatch[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = unitMatch[2].toLowerCase();
  if (/tb|tib/.test(unit)) return amount * 1024;
  if (/mb|mib/.test(unit)) return Math.round((amount / 1024) * 100) / 100;
  return amount;
}
