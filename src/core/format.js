// Shared data-shaping helpers for the provider crawlers (previously duplicated
// across most provider files).
import { hasEnvValue } from "./env.js";
import { numberOrNull } from "./num.js";

// Return the first array found at `value` itself or one of the dotted paths.
export function pickArray(value, paths) {
  if (Array.isArray(value)) return value;
  for (const path of paths) {
    const nested = path.split(".").reduce((cursor, part) => cursor?.[part], value);
    if (Array.isArray(nested)) return nested;
  }
  return [];
}

// Recursively drop null / undefined / "" values (and empties left behind) so
// metadata payloads stay compact at every nesting level.
export function compactMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .map(([key, entry]) => [key, compactMetadataValue(entry)])
    .filter(([, entry]) => entry !== undefined));
}

export function compactMetadataValue(value) {
  if (value === null || value === undefined || value === "") return undefined;
  if (Array.isArray(value)) {
    const items = value.map(compactMetadataValue).filter((item) => item !== undefined);
    return items.length ? items : undefined;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value)
      .map(([key, entry]) => [key, compactMetadataValue(entry)])
      .filter(([, entry]) => entry !== undefined);
    return entries.length ? Object.fromEntries(entries) : undefined;
  }
  return value;
}

// Trim a comma list or array into a clean string[]; blank input yields [].
export function normalizedList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  if (!hasEnvValue(value)) return [];
  return String(value).split(",").map((item) => item.trim()).filter(Boolean);
}

export function parseEnvList(value) {
  return normalizedList(value);
}

export function truncate(value, max = 500) {
  return String(value || "").slice(0, max);
}

// Pull a GPU count out of free text like "8x H100" or "H100 x4".
export function inferGpuCount(value) {
  const match = String(value || "").match(/\b(\d+)\s*x\b|\bx\s*(\d+)\b/i);
  return numberOrNull(match?.[1] || match?.[2]);
}
