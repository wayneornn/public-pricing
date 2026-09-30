import { isBrokerVisibleInventoryItem, isSpotInventoryItem, redactSpotPricing, updateStaleness } from "../core/inventory.js";
import { truthyEnv } from "../core/env.js";
import { fixtureInventory, providerConfigs } from "./fixtures.js";
import { liveConnectors } from "./live.js";

// Last-known-good cache: when a provider fetch fails after retries, a single
// transient blip would otherwise blink that provider's entire inventory out for
// the cycle. Instead we briefly re-serve the last successful rows (which keep
// aging via stalenessSeconds and are still gated at checkout) so supply doesn't
// flicker. Retention is capped so we never present long-dead data as live.
const DEFAULT_LAST_GOOD_MAX_AGE_MS = 5 * 60 * 1000;
const DEFAULT_CONNECTOR_TIMEOUT_MS = 45 * 1000;
const DEFAULT_CONNECTOR_REFRESH_INTERVAL_MS = 60 * 1000;
const HOT_MARKET_REFRESH_INTERVAL_MS = 15 * 1000;
const NORMAL_MARKET_REFRESH_INTERVAL_MS = 60 * 1000;
const CATALOG_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const CLOUD_CATALOG_REFRESH_INTERVAL_MS = 15 * 60 * 1000;
const CONNECTOR_REFRESH_INTERVALS_MS = {
  "vast-ai": HOT_MARKET_REFRESH_INTERVAL_MS,
  runpod: HOT_MARKET_REFRESH_INTERVAL_MS,
  shadeform: HOT_MARKET_REFRESH_INTERVAL_MS,
  "prime-intellect": HOT_MARKET_REFRESH_INTERVAL_MS,
  tensordock: HOT_MARKET_REFRESH_INTERVAL_MS,
  "voltage-park": HOT_MARKET_REFRESH_INTERVAL_MS,
  "verda-datacrunch": HOT_MARKET_REFRESH_INTERVAL_MS,
  "clore-ai": HOT_MARKET_REFRESH_INTERVAL_MS,
  sesterce: HOT_MARKET_REFRESH_INTERVAL_MS,
  lambda: 30 * 1000,
  crusoe: 30 * 1000,
  cudo: 30 * 1000,
  hyperstack: 30 * 1000,
  gmi: 30 * 1000,
  gcore: NORMAL_MARKET_REFRESH_INTERVAL_MS,
  "e2e-cloud": NORMAL_MARKET_REFRESH_INTERVAL_MS,
  "massed-compute": NORMAL_MARKET_REFRESH_INTERVAL_MS,
  mithril: NORMAL_MARKET_REFRESH_INTERVAL_MS,
  "together-ai": CATALOG_REFRESH_INTERVAL_MS,
  vultr: CATALOG_REFRESH_INTERVAL_MS,
  scaleway: CATALOG_REFRESH_INTERVAL_MS,
  digitalocean: CATALOG_REFRESH_INTERVAL_MS,
  latitude: CATALOG_REFRESH_INTERVAL_MS,
  nscale: CATALOG_REFRESH_INTERVAL_MS,
  ovhcloud: CATALOG_REFRESH_INTERVAL_MS,
  "google-cloud": CLOUD_CATALOG_REFRESH_INTERVAL_MS,
  "google-tpu": CLOUD_CATALOG_REFRESH_INTERVAL_MS,
  aws: CLOUD_CATALOG_REFRESH_INTERVAL_MS,
  azure: CLOUD_CATALOG_REFRESH_INTERVAL_MS,
  oci: CLOUD_CATALOG_REFRESH_INTERVAL_MS,
  nebius: CLOUD_CATALOG_REFRESH_INTERVAL_MS,
  denvr: CATALOG_REFRESH_INTERVAL_MS,
  contabo: CATALOG_REFRESH_INTERVAL_MS,
  hetzner: CATALOG_REFRESH_INTERVAL_MS,
  utho: CATALOG_REFRESH_INTERVAL_MS,
  greennode: CATALOG_REFRESH_INTERVAL_MS,
  acecloud: CATALOG_REFRESH_INTERVAL_MS,
  "arkane-cloud": CATALOG_REFRESH_INTERVAL_MS,
  "hot-aisle": CATALOG_REFRESH_INTERVAL_MS,
  "hpc-ai": CATALOG_REFRESH_INTERVAL_MS,
  northflank: CATALOG_REFRESH_INTERVAL_MS,
  hivenet: CATALOG_REFRESH_INTERVAL_MS,
  ionstream: CATALOG_REFRESH_INTERVAL_MS,
  ionet: CATALOG_REFRESH_INTERVAL_MS,
  coreweave: CATALOG_REFRESH_INTERVAL_MS,
  liquidweb: CATALOG_REFRESH_INTERVAL_MS,
  qubrid: CATALOG_REFRESH_INTERVAL_MS,
  core42: CATALOG_REFRESH_INTERVAL_MS,
  flexai: CATALOG_REFRESH_INTERVAL_MS,
  valdi: CATALOG_REFRESH_INTERVAL_MS,
  farmgpu: CATALOG_REFRESH_INTERVAL_MS,
  cirrascale: CATALOG_REFRESH_INTERVAL_MS,
  whitefiber: CATALOG_REFRESH_INTERVAL_MS,
  yottalabs: CATALOG_REFRESH_INTERVAL_MS,
  neysa: CATALOG_REFRESH_INTERVAL_MS,
  taiga: CATALOG_REFRESH_INTERVAL_MS,
  olakrutrim: CATALOG_REFRESH_INTERVAL_MS,
  zoner: CATALOG_REFRESH_INTERVAL_MS,
  neevcloud: CATALOG_REFRESH_INTERVAL_MS,
  getdeploying: CLOUD_CATALOG_REFRESH_INTERVAL_MS,
  nebulablock: CATALOG_REFRESH_INTERVAL_MS,
  trainy: CATALOG_REFRESH_INTERVAL_MS,
  turboscale: CATALOG_REFRESH_INTERVAL_MS,
  visionbay: CATALOG_REFRESH_INTERVAL_MS,
  cloudclusters: CATALOG_REFRESH_INTERVAL_MS,
  airon: CATALOG_REFRESH_INTERVAL_MS,
  ax3: CATALOG_REFRESH_INTERVAL_MS,
  "cato-digital": CATALOG_REFRESH_INTERVAL_MS,
  cloudexe: CATALOG_REFRESH_INTERVAL_MS,
  highreso: CATALOG_REFRESH_INTERVAL_MS,
  nodeai: CATALOG_REFRESH_INTERVAL_MS,
  charg: CATALOG_REFRESH_INTERVAL_MS,
  polaris: CATALOG_REFRESH_INTERVAL_MS,
  slyd: CATALOG_REFRESH_INTERVAL_MS
};
const lastGoodByConnector = new Map();

export async function fetchInventory({ env = process.env, mode = env.INVENTORY_MODE || "fixture", now = new Date(), connectors = liveConnectors, forceRefresh = false } = {}) {
  const normalizedMode = String(mode || "fixture").toLowerCase();
  const providerHealth = providerConfigs.map((provider) => ({
    ...provider,
    status: "not_configured",
    itemCount: 0,
    error: "",
    lastSyncAt: null
  }));

  if (normalizedMode === "fixture") {
    const items = fixtureInventory(now)
      .filter((item) => !isSpotInventoryItem(item))
      .map((item) => redactSpotPricing(updateStaleness(item, now)));
    return {
      mode: "fixture",
      items,
      providerHealth: providerHealth.map((provider) => ({
        ...provider,
        status: "fixture",
        itemCount: items.filter((item) => item.providerId === provider.id).length,
        lastSyncAt: now.toISOString()
      }))
    };
  }

  const connectorIds = new Set(connectors.map((connector) => connector.id));
  for (const health of providerHealth) {
    const hasConfiguredKey = health.envVars.some((envVar) => truthyEnv(env[envVar]));
    if (!connectorIds.has(health.id) && hasConfiguredKey) {
      health.status = "connector_pending";
    }
  }

  const connectorResults = await Promise.all(connectors.map(async (connector) => {
    const health = providerHealth.find((provider) => provider.id === connector.id);
    const configured = connector.envVars.some((envVar) => truthyEnv(env[envVar]));
    if (!configured) {
      if (health) health.status = "missing_key";
      return [];
    }

    const refreshIntervalMs = connectorRefreshIntervalMs(connector, env);
    const scheduledCache = forceRefresh ? null : getScheduledCache(connector.id, env, now, refreshIntervalMs);
    if (scheduledCache) {
      const staleItems = scheduledCache.items.map((item) => redactSpotPricing(updateStaleness(item, now)));
      if (health) {
        const orderableItems = staleItems.filter(isBrokerVisibleInventoryItem);
        health.status = "scheduled_cache";
        health.itemCount = orderableItems.length;
        health.rawItemCount = staleItems.length;
        health.lastSyncAt = scheduledCache.fetchedAt.toISOString();
        health.nextSyncAt = new Date(scheduledCache.fetchedAt.getTime() + refreshIntervalMs).toISOString();
        health.refreshIntervalSeconds = Math.round(refreshIntervalMs / 1000);
        health.usingScheduledCache = true;
      }
      return staleItems;
    }

    try {
      const items = (await withConnectorTimeout(connector.fetch(env), env, connector))
        .filter((item) => !isSpotInventoryItem(item));
      const staleItems = items.map((item) => redactSpotPricing(updateStaleness(item, now)));
      lastGoodByConnector.set(connector.id, { items, fetchedAt: now, refreshIntervalMs });
      if (health) {
        const orderableItems = staleItems.filter(isBrokerVisibleInventoryItem);
        health.status = "live";
        health.itemCount = orderableItems.length;
        health.rawItemCount = staleItems.length;
        health.lastSyncAt = now.toISOString();
        health.nextSyncAt = new Date(now.getTime() + refreshIntervalMs).toISOString();
        health.refreshIntervalSeconds = Math.round(refreshIntervalMs / 1000);
      }
      return staleItems;
    } catch (error) {
      const cached = getLastKnownGood(connector.id, env, now);
      if (cached) {
        const staleItems = cached.items.map((item) => redactSpotPricing(updateStaleness(item, now)));
        if (health) {
          const orderableItems = staleItems.filter(isBrokerVisibleInventoryItem);
          health.status = "stale";
          health.error = error.message;
          health.itemCount = orderableItems.length;
          health.rawItemCount = staleItems.length;
          health.usingLastKnownGood = true;
          // lastSyncAt reflects the last *successful* fetch, not this failed one.
          health.lastSyncAt = cached.fetchedAt.toISOString();
        }
        return staleItems;
      } else if (health) {
        health.status = "error";
        health.error = error.message;
        health.lastSyncAt = now.toISOString();
      }
      return [];
    }
  }));

  const liveItems = connectorResults.flat();
  const dedupedItems = dedupeById(liveItems);

  if (normalizedMode === "live") {
    const orderableItems = dedupedItems.filter(isBrokerVisibleInventoryItem);
    return {
      mode: "live",
      items: orderableItems,
      rawCount: liveItems.length,
      providerHealth
    };
  }

  // Hybrid shows only real live provider data. Demo/fixture rows are never
  // injected into the broker-facing inventory; providers without keys stay
  // honestly marked (missing_key / not_configured) rather than backfilled with
  // sample data that does not reflect real, orderable supply.
  const orderableLiveItems = dedupedItems.filter(isBrokerVisibleInventoryItem);

  return {
    mode: "hybrid",
    items: orderableLiveItems,
    rawCount: liveItems.length,
    providerHealth
  };
}

export { providerConfigs };

// Collapses rows that resolve to the same canonical inventory id. Overlapping
// queries (e.g. multi-region enumeration) or a provider echoing the same SKU
// twice would otherwise double-count real capacity. When two rows share an id we
// keep the "stronger" one (orderable + available + larger availabilityCount) so
// dedup never downgrades a buyable row to a non-orderable duplicate.
function dedupeById(items) {
  const byId = new Map();
  for (const item of items) {
    const existing = byId.get(item.id);
    if (!existing || preferItem(item, existing)) byId.set(item.id, item);
  }
  return [...byId.values()];
}

function preferItem(candidate, current) {
  const candidateOrderable = isBrokerVisibleInventoryItem(candidate) ? 1 : 0;
  const currentOrderable = isBrokerVisibleInventoryItem(current) ? 1 : 0;
  if (candidateOrderable !== currentOrderable) return candidateOrderable > currentOrderable;
  const candidateAvailable = candidate.availability === "available" ? 1 : 0;
  const currentAvailable = current.availability === "available" ? 1 : 0;
  if (candidateAvailable !== currentAvailable) return candidateAvailable > currentAvailable;
  return Number(candidate.availabilityCount || 0) > Number(current.availabilityCount || 0);
}

// Returns the last successful fetch for a connector if it is still within the
// retention window, otherwise null (and evicts the expired entry).
function getLastKnownGood(connectorId, env, now) {
  const cached = lastGoodByConnector.get(connectorId);
  if (!cached) return null;
  const maxAgeMs = Number(env.LAST_GOOD_MAX_AGE_MS) || DEFAULT_LAST_GOOD_MAX_AGE_MS;
  if (now.getTime() - cached.fetchedAt.getTime() > maxAgeMs) {
    lastGoodByConnector.delete(connectorId);
    return null;
  }
  return cached;
}

function getScheduledCache(connectorId, env, now, refreshIntervalMs) {
  const cached = lastGoodByConnector.get(connectorId);
  if (!cached) return null;
  if (refreshIntervalMs <= 0) return null;
  const ageMs = now.getTime() - cached.fetchedAt.getTime();
  const maxScheduledAgeMs = Math.max(
    Number(env.LAST_GOOD_MAX_AGE_MS) || DEFAULT_LAST_GOOD_MAX_AGE_MS,
    refreshIntervalMs + 60_000
  );
  if (ageMs > maxScheduledAgeMs) {
    lastGoodByConnector.delete(connectorId);
    return null;
  }
  return ageMs < refreshIntervalMs ? cached : null;
}

function connectorRefreshIntervalMs(connector, env) {
  const envKey = `PROVIDER_REFRESH_SECONDS_${String(connector.id || "").toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
  const explicitSeconds = Number(env[envKey]);
  if (Number.isFinite(explicitSeconds) && explicitSeconds >= 0) return explicitSeconds * 1000;
  const defaultSeconds = Number(env.PROVIDER_REFRESH_SECONDS_DEFAULT);
  if (Number.isFinite(defaultSeconds) && defaultSeconds >= 0) return defaultSeconds * 1000;
  return CONNECTOR_REFRESH_INTERVALS_MS[connector.id] || DEFAULT_CONNECTOR_REFRESH_INTERVAL_MS;
}

// Exposed for tests so the in-memory cache can be reset between cases.
export function __resetLastKnownGoodCache() {
  lastGoodByConnector.clear();
}

function withConnectorTimeout(promise, env, connector) {
  const timeoutMs = Number(env.CONNECTOR_TIMEOUT_MS || DEFAULT_CONNECTOR_TIMEOUT_MS);
  if (!timeoutMs || timeoutMs < 0) return promise;

  let timeout;
  const timedOut = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`${connector.name || connector.id} fetch timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([promise, timedOut]).finally(() => {
    clearTimeout(timeout);
  });
}
