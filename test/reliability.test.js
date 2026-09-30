import { test } from "node:test";
import assert from "node:assert/strict";
import { jsonFetch } from "../src/connectors/live.js";
import { fetchInventory, __resetLastKnownGoodCache } from "../src/connectors/index.js";
import { createInventoryItem } from "../src/core/inventory.js";

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status || 200,
    statusText: init.statusText || "OK",
    headers: init.headers || { "content-type": "application/json" }
  });
}

test("jsonFetch retries transient 5xx then succeeds", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls < 3) return jsonResponse({}, { status: 503, statusText: "Service Unavailable" });
    return jsonResponse({ ok: true });
  };
  try {
    const result = await jsonFetch("https://example.test/api", { maxRetries: 2, timeoutMs: 1000 });
    assert.deepEqual(result, { ok: true });
    assert.equal(calls, 3, "should retry twice before the successful third attempt");
  } finally {
    globalThis.fetch = original;
  }
});

test("jsonFetch retries on 429 honoring Retry-After, then succeeds", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return jsonResponse({}, { status: 429, statusText: "Too Many Requests", headers: { "retry-after": "0" } });
    return jsonResponse({ ok: true });
  };
  try {
    const result = await jsonFetch("https://example.test/api", { maxRetries: 2, timeoutMs: 1000 });
    assert.deepEqual(result, { ok: true });
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = original;
  }
});

test("jsonFetch does not retry non-retryable 4xx", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return jsonResponse({}, { status: 400, statusText: "Bad Request" });
  };
  try {
    await assert.rejects(() => jsonFetch("https://example.test/api", { maxRetries: 3, timeoutMs: 1000 }), /400/);
    assert.equal(calls, 1, "client errors must fail fast without retrying");
  } finally {
    globalThis.fetch = original;
  }
});

test("jsonFetch gives up after exhausting retries", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return jsonResponse({}, { status: 500, statusText: "Server Error" });
  };
  try {
    await assert.rejects(() => jsonFetch("https://example.test/api", { maxRetries: 2, timeoutMs: 1000 }), /500/);
    assert.equal(calls, 3, "1 initial attempt + 2 retries");
  } finally {
    globalThis.fetch = original;
  }
});

const ITEM = {
  id: "tensordock:loc:gpu",
  provider: "TensorDock",
  providerId: "tensordock",
  orderable: true,
  lastSeenAt: new Date("2026-01-01T00:00:00Z").toISOString()
};

function makeConnector(behaviors) {
  let i = 0;
  return [
    {
      id: "tensordock",
      name: "TensorDock",
      envVars: ["TENSORDOCK_API_TOKEN"],
      async fetch() {
        const behavior = behaviors[Math.min(i, behaviors.length - 1)];
        i += 1;
        if (behavior === "throw") throw new Error("503 Service Unavailable");
        return [{ ...ITEM }];
      }
    }
  ];
}

test("fetchInventory re-serves last-known-good rows when a provider fetch fails", async () => {
  __resetLastKnownGoodCache();
  const env = { TENSORDOCK_API_TOKEN: "x", INVENTORY_MODE: "hybrid" };
  const connectors = makeConnector(["ok", "throw"]);

  const first = await fetchInventory({ env, mode: "hybrid", connectors, now: new Date("2026-01-01T00:01:00Z") });
  assert.equal(first.items.length, 1, "first successful fetch returns the row");

  const second = await fetchInventory({ env, mode: "hybrid", connectors, now: new Date("2026-01-01T00:02:00Z") });
  assert.equal(second.items.length, 1, "transient failure should re-serve the cached row, not blink it out");
  const health = second.providerHealth.find((p) => p.id === "tensordock");
  assert.equal(health.status, "stale");
  assert.equal(health.usingLastKnownGood, true);
});

test("fetchInventory drops a provider once last-known-good exceeds the retention cap", async () => {
  __resetLastKnownGoodCache();
  const env = { TENSORDOCK_API_TOKEN: "x", INVENTORY_MODE: "hybrid", LAST_GOOD_MAX_AGE_MS: "60000" };
  const connectors = makeConnector(["ok", "throw"]);

  await fetchInventory({ env, mode: "hybrid", connectors, now: new Date("2026-01-01T00:00:00Z") });
  // 5 minutes later, well past the 60s cap.
  const stale = await fetchInventory({ env, mode: "hybrid", connectors, now: new Date("2026-01-01T00:05:00Z") });
  assert.equal(stale.items.length, 0, "expired cache must not be presented as live");
  const health = stale.providerHealth.find((p) => p.id === "tensordock");
  assert.equal(health.status, "error");
});

test("fetchInventory serves scheduled cache before provider-specific refresh interval", async () => {
  __resetLastKnownGoodCache();
  let calls = 0;
  const env = {
    TENSORDOCK_API_TOKEN: "x",
    INVENTORY_MODE: "hybrid",
    PROVIDER_REFRESH_SECONDS_TENSORDOCK: "60"
  };
  const connectors = [
    {
      id: "tensordock",
      name: "TensorDock",
      envVars: ["TENSORDOCK_API_TOKEN"],
      async fetch() {
        calls += 1;
        return [{ ...ITEM, rawOfferId: `call-${calls}` }];
      }
    }
  ];

  await fetchInventory({ env, mode: "hybrid", connectors, now: new Date("2026-01-01T00:00:00Z") });
  const cached = await fetchInventory({ env, mode: "hybrid", connectors, now: new Date("2026-01-01T00:00:30Z") });

  assert.equal(calls, 1, "second crawl should not hit the provider before its refresh interval");
  const health = cached.providerHealth.find((p) => p.id === "tensordock");
  assert.equal(health.status, "scheduled_cache");
  assert.equal(health.usingScheduledCache, true);
  assert.equal(health.refreshIntervalSeconds, 60);
});

test("fetchInventory forceRefresh bypasses provider-specific refresh interval", async () => {
  __resetLastKnownGoodCache();
  let calls = 0;
  const env = {
    TENSORDOCK_API_TOKEN: "x",
    INVENTORY_MODE: "hybrid",
    PROVIDER_REFRESH_SECONDS_TENSORDOCK: "60"
  };
  const connectors = [
    {
      id: "tensordock",
      name: "TensorDock",
      envVars: ["TENSORDOCK_API_TOKEN"],
      async fetch() {
        calls += 1;
        return [{ ...ITEM, rawOfferId: `call-${calls}` }];
      }
    }
  ];

  await fetchInventory({ env, mode: "hybrid", connectors, now: new Date("2026-01-01T00:00:00Z") });
  const forced = await fetchInventory({
    env,
    mode: "hybrid",
    connectors,
    now: new Date("2026-01-01T00:00:30Z"),
    forceRefresh: true
  });

  assert.equal(calls, 2, "manual refresh must force a provider call even before its scheduled interval");
  assert.equal(forced.providerHealth.find((p) => p.id === "tensordock").status, "live");
});

function dupConnector(items) {
  return [
    {
      id: "tensordock",
      name: "TensorDock",
      envVars: ["TENSORDOCK_API_TOKEN"],
      async fetch() {
        return items.map((it) => ({ ...it }));
      }
    }
  ];
}

test("fetchInventory dedupes rows sharing a canonical id, keeping the orderable one (M2)", async () => {
  __resetLastKnownGoodCache();
  const env = { TENSORDOCK_API_TOKEN: "x", INVENTORY_MODE: "hybrid" };
  const base = { ...ITEM };
  const connectors = dupConnector([
    { ...base, orderable: false, availability: "unavailable", availabilityCount: 0 },
    { ...base, orderable: true, availability: "available", availabilityCount: 5 }
  ]);

  const result = await fetchInventory({ env, mode: "hybrid", connectors, now: new Date("2026-01-01T00:01:00Z") });
  assert.equal(result.rawCount, 2, "both raw rows were fetched");
  assert.equal(result.items.length, 1, "duplicate id collapses to a single row");
  assert.equal(result.items[0].availabilityCount, 5, "kept the stronger orderable/available row");
});

test("fetchInventory drops spot/interruptible rows and keeps the firm on-demand row", async () => {
  __resetLastKnownGoodCache();
  const common = {
    provider: "Prime Intellect", providerId: "prime-intellect", gpuLabel: "1x B300", gpuCount: 1,
    availability: "available", availabilitySemantics: "sku_capacity", listingType: "secure_cloud",
    priceScope: "node_total", sourceMode: "live", checkoutSemantics: "manual_provider",
    checkoutUrl: "https://app.primeintellect.ai"
  };
  const spot = createInventoryItem({ ...common, rawOfferId: "spot:B300:FIN-03", totalHourlyPrice: 2.68, rawPayload: { isSpot: true } });
  const onDemand = createInventoryItem({ ...common, rawOfferId: "od:B300:FIN-03", totalHourlyPrice: 7.55, rawPayload: { isSpot: false } });
  const connectors = [{
    id: "prime-intellect", name: "Prime Intellect", envVars: ["PRIME_INTELLECT_API_KEY"],
    async fetch() { return [spot, onDemand]; }
  }];

  const result = await fetchInventory({ env: { PRIME_INTELLECT_API_KEY: "x", INVENTORY_MODE: "live" }, mode: "live", connectors, now: new Date("2026-01-01T00:01:00Z") });
  assert.equal(result.rawCount, 1, "only the firm on-demand row enters the inventory");
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].totalHourlyPrice, 7.55, "the surviving row is the firm $7.55 on-demand, never the $2.68 spot");
});

test("fetchInventory strips spot prices a surviving on-demand row carries in metadata/rawPayload/notes", async () => {
  __resetLastKnownGoodCache();
  const onDemand = createInventoryItem({
    provider: "Verda/DataCrunch", providerId: "verda-datacrunch", rawOfferId: "od:B300:FIN-03",
    gpuLabel: "8x B300 SXM", gpuCount: 8, totalHourlyPrice: 60, availability: "available",
    availabilitySemantics: "sku_capacity", listingType: "instance_type", priceScope: "node_total",
    sourceMode: "live", checkoutSemantics: "manual_provider", checkoutUrl: "https://console.verda.com/deploy",
    dataNotes: ["8x B300 SXM", "Spot also available (~$3.50/GPU/hr)"],
    metadata: { prices: { onDemand: 60, spot: 28, serverlessSpot: 30 }, instanceType: "8B300" },
    rawPayload: { price_per_hour: 60, spot_price: 28, gpu: { number_of_gpus: 8 } }
  });
  const connectors = [{
    id: "verda-datacrunch", name: "Verda/DataCrunch", envVars: ["VERDA_API_KEY"],
    async fetch() { return [onDemand]; }
  }];

  const result = await fetchInventory({ env: { VERDA_API_KEY: "x", INVENTORY_MODE: "live" }, mode: "live", connectors, now: new Date("2026-01-01T00:01:00Z") });
  assert.equal(result.items.length, 1);
  const item = result.items[0];
  assert.equal(item.totalHourlyPrice, 60, "firm on-demand price is untouched");
  assert.equal(JSON.stringify(item).match(/spot/i), null, "no spot field or note survives anywhere on the served row");
  assert.equal(item.metadata.prices.onDemand, 60, "non-spot metadata is preserved");
});

test("fetchInventory excludes spot rows from broker-facing live inventory", async () => {
  __resetLastKnownGoodCache();
  const env = { TENSORDOCK_API_TOKEN: "x", INVENTORY_MODE: "hybrid" };
  const base = { ...ITEM, id: "verda:spot:b200", provider: "Verda/DataCrunch", providerId: "verda-datacrunch" };
  const connectors = dupConnector([
    {
      ...base,
      rawOfferId: "spot:1B200.180V:FIN-02",
      marketType: "spot",
      priceSemantics: "spot",
      priceScope: "node_total",
      listingType: "spot_instance_type",
      availability: "available"
    },
    {
      ...base,
      id: "verda:on-demand:b200",
      rawOfferId: "on_demand:1B200.180V:FIN-02",
      marketType: "on_demand",
      priceSemantics: "node_total",
      priceScope: "node_total",
      listingType: "instance_type",
      availability: "available"
    }
  ]);

  const result = await fetchInventory({ env, mode: "hybrid", connectors, now: new Date("2026-01-01T00:01:00Z") });

  assert.equal(result.rawCount, 1, "spot row is dropped at ingestion so rawCount is 1");
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].rawOfferId, "on_demand:1B200.180V:FIN-02");
  assert.equal(result.providerHealth.find((p) => p.id === "tensordock").itemCount, 1);
});

test("fetchInventory returns fast provider rows when another provider times out", async () => {
  __resetLastKnownGoodCache();
  const env = {
    TENSORDOCK_API_TOKEN: "x",
    AWS_GPU_INVENTORY_ENABLED: "1",
    INVENTORY_MODE: "hybrid",
    CONNECTOR_TIMEOUT_MS: "20"
  };
  const connectors = [
    {
      id: "aws",
      name: "AWS",
      envVars: ["AWS_GPU_INVENTORY_ENABLED"],
      async fetch() {
        return new Promise(() => {});
      }
    },
    {
      id: "tensordock",
      name: "TensorDock",
      envVars: ["TENSORDOCK_API_TOKEN"],
      async fetch() {
        return [{ ...ITEM }];
      }
    }
  ];

  const startedAt = Date.now();
  const result = await fetchInventory({ env, mode: "hybrid", connectors, now: new Date("2026-01-01T00:01:00Z") });

  assert.equal(result.items.length, 1, "slow providers must not blank the whole inventory");
  assert.ok(Date.now() - startedAt < 250, "crawl should return after the connector timeout, not wait indefinitely");
  assert.equal(result.providerHealth.find((p) => p.id === "aws").status, "error");
  assert.match(result.providerHealth.find((p) => p.id === "aws").error, /timed out/);
  assert.equal(result.providerHealth.find((p) => p.id === "tensordock").status, "live");
});

test("fetchInventory keeps a priced catalog row that is not orderable", async () => {
  __resetLastKnownGoodCache();
  const catalog = createInventoryItem({
    provider: "Azure",
    providerId: "azure",
    rawOfferId: "eastus:Standard_ND96isr_H100_v5",
    gpuLabel: "8x H100 SXM 80GB",
    gpuCount: 8,
    totalHourlyPrice: 98.32,
    region: "eastus",
    sourceMode: "catalog",
    listingType: "azure_retail_price",
    priceScope: "node_total",
    availability: "unknown",
    checkoutUrl: "https://portal.azure.com/",
    rawPayload: { sku: "Standard_ND96isr_H100_v5" }
  });
  assert.equal(catalog.orderable, false);
  const connectors = [{
    id: "azure",
    name: "Azure",
    runsWithoutCredentials: true,
    envVars: ["AZURE_SUBSCRIPTION_ID"],
    async fetch() {
      return [catalog];
    }
  }];
  const result = await fetchInventory({
    env: { INVENTORY_MODE: "live" },
    mode: "live",
    connectors,
    now: new Date("2026-09-30T00:00:00Z")
  });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].provider, "Azure");
  assert.equal(result.items[0].gpuModel, "H100");
  assert.equal(result.providerHealth.find((provider) => provider.id === "azure").status, "live");
});
