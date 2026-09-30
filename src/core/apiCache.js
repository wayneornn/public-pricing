// Shared on-disk API response cache used by the SDK-backed crawlers (AWS, Azure,
// OCI). Previously each provider carried byte-identical copies of these helpers.
import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { truthyEnv } from "./env.js";
import { normalizedList } from "./format.js";

export function safeCacheKey(value) {
  return String(value || "empty").replace(/[^a-z0-9._/-]+/gi, "_");
}

export async function isFreshFile(filePath, ttlMs) {
  try {
    const stats = await fsp.stat(filePath);
    return Date.now() - stats.mtimeMs < ttlMs;
  } catch {
    return false;
  }
}

// Stable cache key for a list of region/SKU filters: short lists are joined
// verbatim, long ones are hashed so file names stay bounded.
export function cacheKeyForList(values) {
  const list = normalizedList(values);
  if (!list.length) return "all";
  const joined = list.slice().sort().join(",");
  if (joined.length <= 80) return joined;
  return `${list.length}-${createHash("sha256").update(joined).digest("hex").slice(0, 16)}`;
}

// Read-through file cache for a single crawl stage. Falls back to a stale file on
// loader error when `<PREFIX>_GPU_ALLOW_STALE_ON_ERROR` is set (default true).
export async function cachedApiStage({ env, key, ttlMs, options = {}, loader, disableKey, cacheDirKey, cacheDirDefault, allowStaleKey }) {
  if (options.cache === false || truthyEnv(env[disableKey])) return loader();
  const cacheDir = path.resolve(env[cacheDirKey] || cacheDirDefault);
  const cachePath = path.join(cacheDir, `${safeCacheKey(key)}.json`);
  if (await isFreshFile(cachePath, ttlMs)) return JSON.parse(await fsp.readFile(cachePath, "utf8"));
  try {
    const value = await loader();
    await fsp.mkdir(path.dirname(cachePath), { recursive: true });
    await fsp.writeFile(cachePath, JSON.stringify(value, null, 2));
    return value;
  } catch (error) {
    if (truthyEnv(env[allowStaleKey] ?? "true") && fs.existsSync(cachePath)) {
      return JSON.parse(await fsp.readFile(cachePath, "utf8"));
    }
    throw error;
  }
}
