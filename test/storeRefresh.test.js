import assert from "node:assert/strict";
import test from "node:test";
import { createInventoryStore } from "../src/store.js";
import { __resetLastKnownGoodCache } from "../src/connectors/index.js";

// A connector whose fetch blocks until the test releases it, so we can hold a
// crawl "in flight" and observe how concurrent refresh() calls are scheduled.
function deferredConnector(id) {
  const releasers = [];
  const counter = { calls: 0 };
  return {
    get calls() {
      return counter.calls;
    },
    release() {
      const next = releasers.shift();
      if (!next) throw new Error("no pending fetch to release");
      next();
    },
    connector: {
      id,
      name: id,
      envVars: ["TEST_KEY"],
      fetch() {
        counter.calls += 1;
        return new Promise((resolve) => releasers.push(() => resolve([])));
      }
    }
  };
}

async function waitFor(predicate, { timeoutMs = 1000 } = {}) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

const liveEnv = (extra = {}) => ({
  INVENTORY_MODE: "live",
  TEST_KEY: "set",
  CONNECTOR_TIMEOUT_MS: "0",
  REFRESH_INTERVAL_SECONDS: "0",
  ...extra
});

test("a forced refresh during an in-flight non-forced crawl runs its own crawl", async () => {
  __resetLastKnownGoodCache();
  const harness = deferredConnector("force-provider");
  const store = createInventoryStore({ env: liveEnv(), connectors: [harness.connector] });

  const nonForced = store.refresh();
  await waitFor(() => harness.calls === 1);

  const forced = store.refresh({ force: true });
  // The forced crawl chains after the in-flight one rather than running
  // concurrently, so no second provider hit happens yet.
  await settle();
  assert.equal(harness.calls, 1);

  harness.release(); // finish the non-forced crawl
  await nonForced;

  // Once the non-forced crawl is done, the forced request gets its own crawl and
  // hits the provider again, bypassing the scheduled cache it just populated —
  // the `force` flag is honoured instead of being coalesced away.
  await waitFor(() => harness.calls === 2);
  harness.release();
  await forced;

  assert.equal(harness.calls, 2);
});

test("a non-forced refresh during an in-flight crawl is coalesced", async () => {
  __resetLastKnownGoodCache();
  const harness = deferredConnector("coalesce-provider");
  const store = createInventoryStore({ env: liveEnv(), connectors: [harness.connector] });

  const first = store.refresh();
  await waitFor(() => harness.calls === 1);

  const second = store.refresh();
  // Coalesced onto the in-flight crawl: no extra provider hit.
  await settle();
  assert.equal(harness.calls, 1);

  harness.release();
  await Promise.all([first, second]);

  assert.equal(harness.calls, 1);
});
