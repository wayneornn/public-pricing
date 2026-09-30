import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAppServer } from "../src/server.js";
import { createInventoryStore } from "../src/store.js";
import { createInventoryItem } from "../src/core/inventory.js";

test("refreshes inventory and searches through the app store", async () => {
  const store = createInventoryStore({
    env: {
      INVENTORY_MODE: "fixture",
      REFRESH_INTERVAL_SECONDS: "0"
    }
  });

  const inventory = await store.refresh();
  assert.equal(inventory.count, 72);

  const search = store.search({
    spec: "1x H200 under $5/gpu/hr",
    filters: { availabilityOnly: true }
  });
  assert.ok(search.results.length > 0);
  assert.equal(search.bestOverall.gpuModel, "H200");
});

test("checkout revalidation endpoint returns 200 only for freshly buyable rows", async () => {
  const snapshotItem = runpodItem({ price: 3.25 });
  const connector = {
    id: "runpod",
    name: "Runpod",
    envVars: ["RUNPOD_API_KEY"],
    async fetch() {
      return [runpodItem({ price: 3.25 })];
    }
  };
  const { server } = createAppServer({
    env: {
      INVENTORY_MODE: "live",
      RUNPOD_API_KEY: "test"
    },
    connectors: [connector],
    initialItems: [snapshotItem],
    initialProviderHealth: [{ id: "runpod", name: "Runpod", status: "live", itemCount: 1 }]
  });

  server.listen(0);
  await once(server, "listening");
  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/checkout/revalidate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: snapshotItem.id })
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.status, "buyable");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("checkout revalidation endpoint returns 409 when the provider no longer has the row", async () => {
  const snapshotItem = runpodItem({ price: 3.25 });
  const connector = {
    id: "runpod",
    name: "Runpod",
    envVars: ["RUNPOD_API_KEY"],
    async fetch() {
      return [];
    }
  };
  const { server } = createAppServer({
    env: {
      INVENTORY_MODE: "live",
      RUNPOD_API_KEY: "test"
    },
    connectors: [connector],
    initialItems: [snapshotItem]
  });

  server.listen(0);
  await once(server, "listening");
  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/checkout/revalidate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: snapshotItem.id })
    });
    const payload = await response.json();

    assert.equal(response.status, 409);
    assert.equal(payload.ok, false);
    assert.equal(payload.status, "not_found_live");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("cron refresh on Vercel requires the cron secret", async () => {
  const previous = process.env.VERCEL;
  process.env.VERCEL = "1";
  const { server } = createAppServer({
    env: {
      INVENTORY_MODE: "fixture",
      REFRESH_INTERVAL_SECONDS: "0",
      CRON_SECRET: "test-secret"
    },
    connectors: [],
    initialItems: [runpodItem({ price: 3.25 })],
    initialProviderHealth: []
  });

  server.listen(0);
  await once(server, "listening");
  try {
    const port = server.address().port;
    const denied = await fetch(`http://127.0.0.1:${port}/api/cron/refresh`);
    assert.equal(denied.status, 401);
    const allowed = await fetch(`http://127.0.0.1:${port}/api/cron/refresh`, {
      headers: { authorization: "Bearer test-secret" }
    });
    assert.equal(allowed.status, 200);
  } finally {
    if (previous === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previous;
    await new Promise((resolve) => server.close(resolve));
  }
});

test("vercel caches a filled inventory response at the edge", async () => {
  const previous = process.env.VERCEL;
  process.env.VERCEL = "1";
  const item = runpodItem({ price: 3.25 });
  const { server } = createAppServer({
    env: {
      INVENTORY_MODE: "live",
      RUNPOD_API_KEY: "x",
      REFRESH_INTERVAL_SECONDS: "30"
    },
    connectors: [{
      id: "runpod",
      name: "Runpod",
      envVars: ["RUNPOD_API_KEY"],
      async fetch() {
        return [item];
      }
    }],
    initialItems: [item]
  });

  server.listen(0);
  await once(server, "listening");
  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/inventory`);
    const fresh = await fetch(`http://127.0.0.1:${port}/api/inventory?refresh=1`);
    assert.match(response.headers.get("cache-control"), /s-maxage=300/);
    assert.match(response.headers.get("cache-control"), /stale-while-revalidate=3600/);
    assert.equal(fresh.headers.get("cache-control"), "no-store");
  } finally {
    if (previous === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previous;
    await new Promise((resolve) => server.close(resolve));
  }
});

test("inventory gpu query returns only that model", async () => {
  const h100 = runpodItem({ price: 3.25 });
  const a100 = createInventoryItem({
    provider: "Runpod",
    providerId: "runpod",
    rawOfferId: "NVIDIA A100",
    gpuLabel: "1x A100 80GB",
    gpuCount: 1,
    totalHourlyPrice: 2.1,
    availability: "available",
    availabilitySemantics: "sku_capacity",
    region: "US",
    listingType: "gpu_type_lowest_price",
    priceScope: "node_total",
    checkoutSemantics: "manual_provider",
    checkoutUrl: "https://www.runpod.io/console/gpu-cloud",
    sourceMode: "live",
    rawPayload: { id: "NVIDIA A100" }
  });
  const { server } = createAppServer({
    env: { INVENTORY_MODE: "live", REFRESH_INTERVAL_SECONDS: "3600" },
    connectors: [],
    initialItems: [h100, a100]
  });

  server.listen(0);
  await once(server, "listening");
  try {
    const port = server.address().port;
    const payload = await fetch(`http://127.0.0.1:${port}/api/inventory?gpu=H100`).then((response) => response.json());
    assert.equal(payload.items.length, 1);
    assert.equal(payload.items[0].gpuModel, "H100");
    assert.equal(payload.count, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("home page is a price table", async () => {
  const { server } = createAppServer({
    env: { INVENTORY_MODE: "fixture", REFRESH_INTERVAL_SECONDS: "0" },
    connectors: [],
    initialItems: []
  });

  server.listen(0);
  await once(server, "listening");
  try {
    const port = server.address().port;
    const html = await fetch(`http://127.0.0.1:${port}/`).then((response) => response.text());
    const css = await fetch(`http://127.0.0.1:${port}/styles.css`).then((response) => response.text());
    assert.equal(/ornn/i.test(html), false);
    assert.match(html, /<title>GPU Pricing<\/title>/);
    assert.match(html, /<option value="H100" selected>H100<\/option>/);
    assert.match(html, /id="orderableOnly"/);
    assert.match(html, /id="loading"/);
    assert.match(html, /class="is-loading"/);
    assert.equal(html.includes("Refresh"), false);
    assert.match(html, /<select id="regionFilter"/);
    assert.match(css, /PP Neue Montreal/);
    assert.match(html, /data-sort="pricePerGpuHour"/);
    assert.equal(html.includes("<footer"), false);
    assert.equal(html.includes("<p"), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("inventory endpoint hydrates persisted snapshot instead of returning an empty cold start", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ornn-server-inventory-snapshot-"));
  const snapshotFile = path.join(tempDir, "inventory.json");
  await fs.writeFile(snapshotFile, JSON.stringify({
    version: 1,
    savedAt: "2026-06-09T10:00:00.000Z",
    snapshot: {
      items: [runpodItem({ price: 3.25 })],
      providerHealth: [{ id: "runpod", name: "Runpod", status: "live", itemCount: 1 }],
      mode: "live",
      lastRefreshAt: "2026-06-09T09:59:00.000Z",
      count: 1
    }
  }));
  const { server } = createAppServer({
    env: {
      INVENTORY_MODE: "live",
      REFRESH_INTERVAL_SECONDS: "0",
      INVENTORY_SNAPSHOT_STORE: "file",
      INVENTORY_SNAPSHOT_FILE: snapshotFile
    },
    connectors: []
  });

  server.listen(0);
  await once(server, "listening");
  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/inventory`);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.count, 1);
    assert.equal(payload.items[0].providerId, "runpod");
    assert.equal(payload.items[0].rawPayload, undefined);
    assert.equal(payload.items[0].checkoutUrl, null);
    assert.equal(payload.loadedFromSnapshotAt, "2026-06-09T10:00:00.000Z");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

function runpodItem({ price }) {
  return createInventoryItem({
    provider: "Runpod",
    providerId: "runpod",
    rawOfferId: "NVIDIA H100 SXM",
    gpuLabel: "1x H100 SXM 80GB",
    gpuCount: 1,
    totalHourlyPrice: price,
    availability: "available",
    availabilitySemantics: "sku_capacity",
    region: "US",
    listingType: "gpu_type_lowest_price",
    priceScope: "node_total",
    checkoutSemantics: "manual_provider",
    checkoutUrl: "https://www.runpod.io/console/gpu-cloud?gpuTypeId=NVIDIA+H100+SXM",
    sourceMode: "live",
    rawPayload: {
      id: "NVIDIA H100 SXM",
      lowestPrice: {
        uninterruptablePrice: price,
        stockStatus: "Available"
      }
    }
  });
}
