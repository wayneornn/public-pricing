import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { __resetLastKnownGoodCache } from "../src/connectors/index.js";
import { createInventoryItem } from "../src/core/inventory.js";
import { createInventorySnapshotStore } from "../src/core/inventorySnapshotStore.js";
import { createInventoryStore } from "../src/store.js";

test("inventory store hydrates from a persisted snapshot before live refresh", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ornn-inventory-snapshot-"));
  const snapshotFile = path.join(tempDir, "snapshot.json");
  const item = h100Item("persisted-h100");
  await fs.writeFile(snapshotFile, JSON.stringify({
    version: 1,
    savedAt: "2026-06-09T10:00:00.000Z",
    snapshot: {
      items: [item],
      providerHealth: [{ id: "exact-ib-cloud", name: "Exact IB Cloud", status: "live", itemCount: 1 }],
      mode: "live",
      lastRefreshAt: "2026-06-09T09:59:00.000Z",
      count: 1
    }
  }));

  const store = createInventoryStore({
    env: {
      INVENTORY_MODE: "live",
      INVENTORY_SNAPSHOT_STORE: "file",
      INVENTORY_SNAPSHOT_FILE: snapshotFile
    },
    connectors: []
  });

  const snapshot = await store.hydrate();

  assert.equal(snapshot.count, 1);
  assert.equal(snapshot.items[0].rawOfferId, "persisted-h100");
  assert.equal(snapshot.loadedFromSnapshotAt, "2026-06-09T10:00:00.000Z");
  assert.equal(snapshot.snapshotStore, "file");
});

test("inventory refresh persists latest snapshot for warm restart hydration", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ornn-inventory-snapshot-"));
  const snapshotFile = path.join(tempDir, "snapshot.json");
  const connector = {
    id: "exact-ib-cloud",
    name: "Exact IB Cloud",
    envVars: ["EXACT_IB_KEY"],
    async fetch() {
      return [h100Item("fresh-h100")];
    }
  };
  const env = {
    INVENTORY_MODE: "live",
    INVENTORY_SNAPSHOT_STORE: "file",
    INVENTORY_SNAPSHOT_FILE: snapshotFile,
    EXACT_IB_KEY: "test"
  };

  const firstStore = createInventoryStore({ env, connectors: [connector] });
  const refreshed = await firstStore.refresh();
  assert.equal(refreshed.count, 1);

  const secondStore = createInventoryStore({ env, connectors: [] });
  const hydrated = await secondStore.hydrate();

  assert.equal(hydrated.count, 1);
  assert.equal(hydrated.items[0].rawOfferId, "fresh-h100");
});

test("inventory refresh keeps last-good rows when a live crawl returns empty", async () => {
  __resetLastKnownGoodCache();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ornn-inventory-snapshot-"));
  const snapshotFile = path.join(tempDir, "snapshot.json");
  const oldItem = h100Item("last-good-h100");
  const connector = {
    id: "exact-ib-cloud",
    name: "Exact IB Cloud",
    envVars: ["EXACT_IB_KEY"],
    async fetch() {
      return [];
    }
  };
  const env = {
    INVENTORY_MODE: "live",
    INVENTORY_SNAPSHOT_STORE: "file",
    INVENTORY_SNAPSHOT_FILE: snapshotFile,
    EXACT_IB_KEY: "test"
  };

  const store = createInventoryStore({
    env,
    connectors: [connector],
    initialItems: [oldItem],
    initialProviderHealth: [{ id: "exact-ib-cloud", name: "Exact IB Cloud", status: "live", itemCount: 1 }]
  });
  const refreshed = await store.refresh();
  const persisted = JSON.parse(await fs.readFile(snapshotFile, "utf8"));

  assert.equal(refreshed.count, 1);
  assert.equal(refreshed.items[0].rawOfferId, "last-good-h100");
  assert.match(refreshed.lastError, /retained last-good inventory/i);
  assert.equal(persisted.snapshot.count, 1);
  assert.equal(persisted.snapshot.items[0].rawOfferId, "last-good-h100");
});

test("GCS snapshot store reads and writes through official GCS JSON APIs", async () => {
  const calls = [];
  const store = createInventorySnapshotStore({
    env: {
      INVENTORY_SNAPSHOT_STORE: "gcs",
      INVENTORY_SNAPSHOT_GCS_BUCKET: "ornn-supply-snapshots",
      INVENTORY_SNAPSHOT_GCS_OBJECT: "inventory/latest.json",
      INVENTORY_SNAPSHOT_GCS_ACCESS_TOKEN: "test-token"
    },
    fetcher: async (url, options = {}) => {
      calls.push({ url, options });
      if (url.includes("alt=media")) {
        return jsonResponse({
          version: 1,
          savedAt: "2026-06-09T10:00:00.000Z",
          snapshot: {
            items: [h100Item("gcs-h100")],
            providerHealth: [],
            mode: "live",
            lastRefreshAt: "2026-06-09T09:59:00.000Z"
          }
        });
      }
      return jsonResponse({ name: "inventory/latest.json" });
    },
    logger: { warn() {} }
  });

  const loaded = await store.load();
  assert.equal(loaded.items[0].rawOfferId, "gcs-h100");

  const saved = await store.save({ items: [h100Item("saved-h100")], providerHealth: [], mode: "live", lastRefreshAt: "2026-06-09T10:01:00.000Z" });
  assert.equal(saved, true);
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /storage\.googleapis\.com\/storage\/v1\/b\/ornn-supply-snapshots\/o\/inventory%2Flatest\.json\?alt=media/);
  assert.match(calls[1].url, /storage\.googleapis\.com\/upload\/storage\/v1\/b\/ornn-supply-snapshots\/o/);
  assert.equal(calls[1].options.method, "POST");
  assert.equal(calls[1].options.headers.Authorization, "Bearer test-token");
});

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status || 200,
    headers: { "content-type": "application/json" }
  });
}

function h100Item(rawOfferId) {
  return createInventoryItem({
    provider: "Exact IB Cloud",
    providerId: "exact-ib-cloud",
    rawOfferId,
    gpuLabel: "8x H100 SXM 80GB",
    gpuCount: 8,
    totalHourlyPrice: 22,
    availability: "available",
    availabilitySemantics: "host_capacity",
    region: "US East",
    formFactor: "bare_metal",
    networkFabric: "InfiniBand",
    listingType: "marketplace_offer",
    priceScope: "node_total",
    checkoutSemantics: "exact_listing",
    checkoutUrl: `https://cloud.example.com/create?id=${rawOfferId}`,
    sourceMode: "live",
    rawPayload: { id: rawOfferId }
  });
}
