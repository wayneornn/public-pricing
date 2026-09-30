import assert from "node:assert/strict";
import test from "node:test";
import { mithrilInstanceToItem, mithrilDedupeItems } from "../src/connectors/live.js";

function instanceType(overrides = {}) {
  return {
    fid: "it_RrgkIZz6c9BZu5gi",
    name: "a100-80gb.sxm.1x",
    gpu_type: "A100",
    num_gpus: 1,
    gpu_memory_gb: 80,
    ...overrides
  };
}

function pricing(overrides = {}) {
  return {
    spot_price_cents: 100,
    reserved_price_cents: 110,
    minimum_price_cents: 1,
    lowest_allocated_bid_cents: null,
    dynamic_win_price_cents: null,
    available_capacity: 3,
    total_capacity: 26,
    ...overrides
  };
}

test("mithrilInstanceToItem maps instance + pricing but is not orderable (volatile auction price)", () => {
  const item = mithrilInstanceToItem(instanceType(), "us-central3-a", pricing());
  assert.equal(item.providerId, "mithril");
  assert.equal(item.gpuModel, "A100");
  assert.equal(item.gpuCount, 1);
  assert.equal(item.vramGbEach, 80);
  assert.equal(item.totalHourlyPrice, 1.1);
  assert.equal(item.availability, "available");
  assert.equal(item.availabilityCount, 3);
  assert.equal(item.orderable, false);
  assert.match(item.orderabilityReason, /spot|auction/i);
  assert.ok(item.dataNotes.some((n) => /varies hour to hour|auction/i.test(n)));
  assert.equal(item.sourceMode, "live");
  assert.equal(item.checkoutSemantics, "manual_provider");
  assert.equal(item.checkoutUrl, "https://app.mithril.ai");
  assert.ok(item.rawPayload);
});

test("mithrilInstanceToItem handles 8-GPU instance types", () => {
  const item = mithrilInstanceToItem(
    instanceType({ fid: "it_XqgKWbhZ5gznAYsG", name: "h100-80gb.sxm.8x", gpu_type: "H100", num_gpus: 8, gpu_memory_gb: 80 }),
    "us-central2-a",
    pricing({ reserved_price_cents: 2272, spot_price_cents: 800, available_capacity: 0, total_capacity: 9 })
  );
  assert.equal(item.gpuModel, "H100");
  assert.equal(item.gpuCount, 8);
  assert.equal(item.totalHourlyPrice, 22.72);
  assert.ok(Math.abs(item.pricePerGpuHour - 2.84) < 0.01);
  assert.equal(item.availability, "unavailable");
  assert.equal(item.orderable, false);
});

test("mithrilInstanceToItem returns null when reserved_price_cents is zero or missing", () => {
  assert.equal(mithrilInstanceToItem(instanceType(), "us-central3-a", pricing({ reserved_price_cents: 0 })), null);
  assert.equal(mithrilInstanceToItem(instanceType(), "us-central3-a", pricing({ reserved_price_cents: null })), null);
  assert.equal(mithrilInstanceToItem(instanceType(), "us-central3-a", {}), null);
});

test("mithrilInstanceToItem never surfaces a spot price (notes or metadata)", () => {
  const item = mithrilInstanceToItem(instanceType(), "us-central3-a", pricing({ spot_price_cents: 50 }));
  assert.ok(!item.dataNotes.some((n) => /spot/i.test(n)));
  assert.equal(item.metadata.spotPriceCents, undefined);
});

test("mithrilInstanceToItem maps B200 correctly", () => {
  const item = mithrilInstanceToItem(
    instanceType({ fid: "it_HiqFjGT37y3fREPT", name: "neb-b200.sxm.1x", gpu_type: "B200", num_gpus: 1, gpu_memory_gb: 180 }),
    "us-central5-a",
    pricing({ reserved_price_cents: 345, spot_price_cents: 3, available_capacity: 0, total_capacity: 32 })
  );
  assert.equal(item.gpuModel, "B200");
  assert.equal(item.vramGbEach, 180);
  assert.equal(item.totalHourlyPrice, 3.45);
});

test("mithrilDedupeItems keeps orderable/available variant when keys collide", () => {
  const available = mithrilInstanceToItem(instanceType(), "us-central3-a", pricing());
  const unavailable = mithrilInstanceToItem(instanceType(), "us-central3-a", pricing({ available_capacity: 0 }));
  const items = mithrilDedupeItems([unavailable, available]);
  assert.equal(items.length, 1);
  assert.equal(items[0].availability, "available");
});

test("mithrilDedupeItems preserves items with different regions", () => {
  const a = mithrilInstanceToItem(instanceType(), "us-central3-a", pricing());
  const b = mithrilInstanceToItem(instanceType(), "us-central5-a", pricing());
  const items = mithrilDedupeItems([a, b]);
  assert.equal(items.length, 2);
});
