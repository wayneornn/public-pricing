import assert from "node:assert/strict";
import test from "node:test";
import { jarvisServerMetaToItems } from "../src/connectors/live/providers/jarvislabs.js";

// Fixtures mirror real GET /misc/server_meta rows (verified live): price_per_hour is INR,
// num_free_devices is the live availability count, and duplicate pools can share a
// (gpu_type, region, vram).
function server(overrides = {}) {
  return {
    gpu_type: "H100", vram: "80", arc: "Hopper", price_per_hour: 255.15,
    num_free_devices: 4, effective_num_free_devices: 4, spot_only_server: false,
    region: "india-noida-01", cpus_per_gpu: 16, ram_per_gpu: 200, ...overrides
  };
}

test("Jarvis aggregates duplicate pools and converts INR price to USD", () => {
  const rows = jarvisServerMetaToItems([
    server({ gpu_type: "H100", region: "india-noida-01", num_free_devices: 0 }),
    server({ gpu_type: "H100", region: "india-noida-01", num_free_devices: 4 }),
    server({ gpu_type: "A100-80GB", vram: "80", arc: "Ampere", price_per_hour: 140.94, region: "india-noida-01", num_free_devices: 3 })
  ]);

  assert.equal(rows.length, 2); // two H100 pools aggregate into one row

  const h100 = rows.find((r) => r.gpuModel === "H100");
  assert.equal(h100.providerId, "jarvis-labs");
  assert.equal(h100.vramGbEach, 80);
  assert.equal(h100.availabilityCount, 4); // 0 + 4 aggregated
  assert.equal(h100.availability, "available");
  assert.equal(h100.nativeCurrency, "INR");
  assert.equal(h100.currency, "USD");
  assert.equal(h100.totalHourlyPrice, round(255.15 * 0.012)); // INR->USD FX
  assert.equal(h100.orderable, false);

  const a100 = rows.find((r) => r.gpuModel === "A100");
  assert.equal(a100.vramGbEach, 80);
});

test("Jarvis parses RTX-PRO6000 and A100 40GB vs 80GB from vram", () => {
  const rows = jarvisServerMetaToItems([
    server({ gpu_type: "RTX-PRO6000", vram: "96", arc: "Blackwell", price_per_hour: 179.01, region: "india-chennai-01", num_free_devices: 8 }),
    server({ gpu_type: "A100", vram: "40", arc: "Ampere", price_per_hour: 84.24, region: "india-noida-01", num_free_devices: 4 })
  ]);
  const pro = rows.find((r) => r.gpuModel === "RTX PRO 6000");
  assert.equal(pro.vramGbEach, 96);
  const a100 = rows.find((r) => r.gpuModel === "A100");
  assert.equal(a100.vramGbEach, 40);
});

test("Jarvis marks zero-free pools unavailable and skips priceless rows", () => {
  const rows = jarvisServerMetaToItems([
    server({ gpu_type: "L4", vram: "24", price_per_hour: 41.31, region: "india-noida-01", num_free_devices: 0, effective_num_free_devices: 0 }),
    server({ gpu_type: "A30", vram: "24", price_per_hour: 0, region: "india-noida-01" })
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].gpuModel, "L4");
  assert.equal(rows[0].availability, "unavailable");
});

function round(value) {
  return Math.round(value * 10000) / 10000;
}
