import { fetchInventory } from "./connectors/index.js";
import { liveConnectors } from "./connectors/live.js";
import { revalidateBuyableCheckout } from "./core/buyability.js";
import { truthyEnv } from "./core/env.js";
import { createInventorySnapshotStore } from "./core/inventorySnapshotStore.js";
import { searchInventory } from "./core/specSearch.js";

export function createInventoryStore({
  env = process.env,
  connectors = liveConnectors,
  initialItems = [],
  initialProviderHealth = []
} = {}) {
  const snapshotStore = createInventorySnapshotStore({ env });
  const state = {
    items: initialItems,
    providerHealth: initialProviderHealth,
    mode: env.INVENTORY_MODE || "fixture",
    lastRefreshAt: null,
    lastError: null,
    loadedFromSnapshotAt: null,
    hydrateInFlight: null,
    hydrated: Boolean(initialItems.length || initialProviderHealth.length),
    refreshInFlight: null,
    refreshInFlightForced: false
  };

  async function hydrate() {
    if (state.hydrated) return snapshot();
    if (state.hydrateInFlight) return state.hydrateInFlight;
    state.hydrateInFlight = snapshotStore.load()
      .then((saved) => {
        if (saved?.items?.length) {
          state.items = saved.items;
          state.providerHealth = saved.providerHealth;
          state.mode = saved.mode || state.mode;
          state.lastRefreshAt = saved.lastRefreshAt || state.lastRefreshAt;
          state.lastError = saved.lastError || null;
          state.loadedFromSnapshotAt = saved.savedAt || new Date().toISOString();
        }
        state.hydrated = true;
        return snapshot();
      })
      .catch((error) => {
        state.hydrated = true;
        state.lastError = state.lastError || error.message;
        return snapshot();
      })
      .finally(() => {
        state.hydrateInFlight = null;
      });
    return state.hydrateInFlight;
  }

  async function refresh(options = {}) {
    const force = Boolean(options.force);
    // Coalesce onto an in-flight crawl to avoid hammering providers — but never
    // let a forced refresh piggyback on a non-forced one, or the cache-busting
    // `force` flag would be silently dropped and the caller would get stale,
    // scheduled-cache data instead of the fresh crawl they asked for.
    if (state.refreshInFlight && (!force || state.refreshInFlightForced)) {
      return state.refreshInFlight;
    }
    if (!state.hydrated) await hydrate();

    // If a non-forced crawl is already running, chain the forced one after it so
    // we still never crawl providers concurrently.
    const previous = state.refreshInFlight;
    const pending = (previous ? previous.catch(() => {}) : Promise.resolve())
      .then(() => runRefresh(options));
    state.refreshInFlight = pending;
    state.refreshInFlightForced = force;
    pending.finally(() => {
      if (state.refreshInFlight === pending) {
        state.refreshInFlight = null;
        state.refreshInFlightForced = false;
      }
    });
    return pending;
  }

  function runRefresh(options) {
    return fetchInventory({
      env,
      mode: options.mode || state.mode,
      now: new Date(),
      connectors,
      forceRefresh: Boolean(options.force)
    })
      .then(async (result) => {
        if (shouldRetainLastGoodInventory({ result, currentItems: state.items })) {
          state.providerHealth = result.providerHealth;
          state.mode = result.mode;
          state.lastError = "Live refresh returned zero broker-visible rows; retained last-good inventory.";
          await snapshotStore.save(snapshot());
          return snapshot();
        }

        state.items = result.items;
        state.providerHealth = result.providerHealth;
        state.mode = result.mode;
        state.lastRefreshAt = new Date().toISOString();
        state.lastError = null;
        state.loadedFromSnapshotAt = null;
        const latestSnapshot = snapshot();
        await snapshotStore.save(latestSnapshot);
        return latestSnapshot;
      })
      .catch((error) => {
        state.lastError = error.message;
        throw error;
      });
  }

  function snapshot() {
    return {
      items: state.items,
      providerHealth: state.providerHealth,
      mode: state.mode,
      lastRefreshAt: state.lastRefreshAt,
      lastError: state.lastError,
      loadedFromSnapshotAt: state.loadedFromSnapshotAt,
      snapshotStore: snapshotStore.enabled ? snapshotStore.mode : "off",
      isRefreshing: Boolean(state.refreshInFlight),
      refreshIntervalSeconds: Number(env.REFRESH_INTERVAL_SECONDS || 5),
      count: state.items.length
    };
  }

  function search({ spec, filters, alerts }) {
    return searchInventory(state.items, { spec, filters, alerts });
  }

  async function revalidateCheckout({ id }) {
    if (!state.hydrated) await hydrate();
    const snapshotItem = state.items.find((item) => item.id === id);
    if (!snapshotItem) {
      return {
        ok: false,
        status: "snapshot_missing",
        message: "This offer is not present in the current inventory snapshot.",
        item: null,
        warnings: [],
        failures: ["This offer is not present in the current inventory snapshot."]
      };
    }

    const connector = connectors.find((candidate) => candidate.id === snapshotItem.providerId);
    if (!connector) {
      return {
        ok: false,
        status: "connector_missing",
        message: "No live connector exists for this provider, so it cannot be proven buyable.",
        item: snapshotItem,
        warnings: [],
        failures: ["No live connector exists for this provider, so it cannot be proven buyable."]
      };
    }

    if (!connector.envVars.some((envVar) => truthyEnv(env[envVar]))) {
      return {
        ok: false,
        status: "missing_credentials",
        message: "Provider credentials are missing, so this offer cannot be revalidated before checkout.",
        item: snapshotItem,
        warnings: [],
        failures: ["Provider credentials are missing, so this offer cannot be revalidated before checkout."]
      };
    }

    try {
      const freshRows = await connector.fetch(env);
      const result = revalidateBuyableCheckout({
        requestedItem: snapshotItem,
        freshRows,
        now: new Date(),
        maxSnapshotAgeSeconds: Number(env.CHECKOUT_MAX_SNAPSHOT_AGE_SECONDS || 120),
        priceTolerancePct: Number(env.CHECKOUT_PRICE_TOLERANCE_PCT ?? 0.01),
        priceToleranceUsd: Number(env.CHECKOUT_PRICE_TOLERANCE_USD ?? 0.01)
      });
      if (result.ok && result.item) {
        state.items = state.items.map((item) => (item.id === id ? result.item : item));
      }
      return result;
    } catch (error) {
      return {
        ok: false,
        status: "provider_error",
        message: `Provider revalidation failed: ${error.message}`,
        item: snapshotItem,
        warnings: [],
        failures: [error.message]
      };
    }
  }

  return {
    hydrate,
    refresh,
    snapshot,
    search,
    revalidateCheckout
  };
}

function shouldRetainLastGoodInventory({ result, currentItems }) {
  if (result?.mode !== "live") return false;
  if (!Array.isArray(result.items) || result.items.length > 0) return false;
  if (!Array.isArray(currentItems) || currentItems.length === 0) return false;
  return true;
}
