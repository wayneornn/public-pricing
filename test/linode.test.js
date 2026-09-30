import assert from "node:assert/strict";
import test from "node:test";
import { linodeTypesToItems } from "../src/connectors/live/providers/linode.js";

// Fixtures below mirror real GET https://api.linode.com/v4/linode/types responses
// (verified live): GPU-class plans are RTX6000 (g1-gpu-rtx6000-*) and RTX4000 Ada
// (g2-gpu-rtx4000a*); the `accelerated` class holds NETINT Quadra VPUs (gpus:0) which
// must not be treated as GPUs. region_prices is currently empty for all GPU plans.

test("Linode parser maps real RTX6000 GPU plan fields (model, VRAM, count, price)", () => {
  const rows = linodeTypesToItems([
    linodeRtx6000({ id: "g1-gpu-rtx6000-1", label: "Dedicated 32GB + RTX6000 GPU x1", gpus: 1, vcpus: 8, memory: 32768, disk: 655360, price: { hourly: 1.5, monthly: 1000 } }),
    linodeRtx6000({ id: "g1-gpu-rtx6000-2", label: "Dedicated 64GB + RTX6000 GPU x2", gpus: 2, vcpus: 16, memory: 65536, disk: 1310720, price: { hourly: 3.0, monthly: 2000 } }),
    // Non-GPU plan must be ignored.
    { id: "g6-standard-2", label: "Linode 4GB", class: "standard", gpus: 0, price: { hourly: 0.03, monthly: 20 }, region_prices: [] }
  ]);

  assert.equal(rows.length, 2);
  const single = rows.find((row) => row.gpuCount === 1);
  assert.equal(single.providerId, "akamai-linode");
  assert.equal(single.gpuModel, "RTX 6000");
  assert.equal(single.vramGbEach, 24);
  assert.equal(single.totalHourlyPrice, 1.5);
  assert.equal(single.region, "Akamai global");
  assert.match(single.checkoutUrl, /type=g1-gpu-rtx6000-1/);

  const dual = rows.find((row) => row.gpuCount === 2);
  assert.equal(dual.pricePerGpuHour, 1.5);
});

test("Linode parser recognizes RTX4000 Ada plans", () => {
  const rows = linodeTypesToItems([
    { id: "g2-gpu-rtx4000a1-s", label: "RTX4000 Ada x1 Small", class: "gpu", gpus: 1, vcpus: 4, memory: 16384, disk: 512000, network_out: 5000, price: { hourly: 0.52, monthly: 348 }, region_prices: [] },
    { id: "g2-gpu-rtx4000a4-m", label: "RTX4000 Ada x4 Medium", class: "gpu", gpus: 4, vcpus: 24, memory: 65536, disk: 2048000, network_out: 10000, price: { hourly: 2.08, monthly: 1392 }, region_prices: [] }
  ]);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].gpuModel, "RTX 4000 Ada");
  assert.equal(rows[0].vramGbEach, 20);
  assert.equal(rows[1].gpuCount, 4);
});

test("Linode parser excludes NETINT accelerated VPUs (not GPUs)", () => {
  const rows = linodeTypesToItems([
    { id: "g1-accelerated-netint-vpu-t1u8-s", label: "NETINT Quadra T1U x8 Small", class: "accelerated", gpus: 0, accelerated_devices: 8, vcpus: 8, memory: 16384, disk: 512000, price: { hourly: 0.5, monthly: 335 }, region_prices: [] }
  ]);
  assert.equal(rows.length, 0);
});

test("Linode parser emits a per-region row when region_prices is populated", () => {
  const rows = linodeTypesToItems([
    linodeRtx6000({ id: "g1-gpu-rtx6000-1", gpus: 1, price: { hourly: 1.5, monthly: 1000 }, region_prices: [{ id: "id-cgk", hourly: 1.8, monthly: 1200 }] })
  ]);
  assert.equal(rows.length, 2);
  const regional = rows.find((row) => row.totalHourlyPrice === 1.8);
  assert.match(regional.checkoutUrl, /regionID=id-cgk/);
});

test("Linode parser skips GPU plans with no usable price", () => {
  const rows = linodeTypesToItems([
    linodeRtx6000({ id: "g1-gpu-rtx6000-1", gpus: 1, price: { hourly: 0, monthly: 0 }, region_prices: [] })
  ]);
  assert.equal(rows.length, 0);
});

function linodeRtx6000(overrides = {}) {
  return {
    id: "g1-gpu-rtx6000-1",
    label: "Dedicated 32GB + RTX6000 GPU x1",
    class: "gpu",
    gpus: 1,
    vcpus: 8,
    memory: 32768,
    disk: 655360,
    transfer: 16000,
    network_out: 10000,
    accelerated_devices: 0,
    price: { hourly: 1.5, monthly: 1000 },
    region_prices: [],
    ...overrides
  };
}
