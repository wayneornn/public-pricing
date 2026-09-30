import assert from "node:assert/strict";
import test from "node:test";
import { hivenetToItems } from "../src/connectors/live/providers/hivenet.js";

// Captured verbatim from the live public API (api.hivecompute.ai/presets/pricing) on
// 2026-06-13: gpu[] length is the GPU count, hourly_price is the whole-preset (node total)
// EUR rate, and €0 presets are demo/test nodes that must be dropped.
const PRESETS = [
  {
    id: "c7e6cd7d-3f36-4d72-8020-86915ecf35e0",
    name: "2x-RTX-4090",
    cpu: 16,
    memory: 96,
    gpu: [{ model: "RTX 4090" }, { model: "RTX 4090" }],
    disk: 250,
    hourly_price: 0,
    bandwidth: 1000,
    hourly_price_discounted: 0,
    location: "uae-magure"
  },
  {
    id: "11111111-1111-1111-1111-111111111111",
    name: "1x-RTX-5090",
    cpu: 8,
    memory: 48,
    gpu: [{ model: "RTX 5090" }],
    disk: 250,
    hourly_price: 0.75,
    bandwidth: 1000,
    hourly_price_discounted: 0,
    location: "france-2"
  },
  {
    id: "22222222-2222-2222-2222-222222222222",
    name: "4x-RTX-4090",
    cpu: 32,
    memory: 192,
    gpu: [{ model: "RTX 4090" }, { model: "RTX 4090" }, { model: "RTX 4090" }, { model: "RTX 4090" }],
    disk: 500,
    hourly_price: 1.6,
    bandwidth: 1000,
    hourly_price_discounted: 0,
    location: "cntxt"
  },
  {
    id: "33333333-3333-3333-3333-333333333333",
    name: "2x-vCPU",
    cpu: 2,
    memory: 4,
    gpu: [],
    disk: 50,
    hourly_price: 0,
    bandwidth: 250,
    hourly_price_discounted: 0,
    location: "antimatter-uae-2"
  }
];

test("Hivenet maps priced GPU presets and drops CPU-only + €0 demo presets", () => {
  const items = hivenetToItems(PRESETS);
  assert.equal(items.length, 2); // 2x-RTX-4090 (€0) and 2x-vCPU (no gpu) dropped
  assert.deepEqual(items.map((i) => i.rawOfferId), [
    "11111111-1111-1111-1111-111111111111",
    "22222222-2222-2222-2222-222222222222"
  ]);
});

test("Hivenet derives per-GPU price from the node-total EUR rate (RTX 5090)", () => {
  const [r5090] = hivenetToItems([PRESETS[1]]);
  assert.equal(r5090.providerId, "hivenet");
  assert.equal(r5090.provider, "Hivenet");
  assert.equal(r5090.gpuModel, "RTX 5090");
  assert.equal(r5090.gpuLabel, "1x RTX 5090");
  assert.equal(r5090.gpuCount, 1);
  assert.equal(r5090.region, "Europe"); // normalizeRegion maps "france-2" -> Europe
  assert.equal(r5090.rawRegion, "france-2");
  assert.equal(r5090.cpu, "8 vCPU");
  assert.equal(r5090.ramGb, 48);
  assert.equal(r5090.storage, "250 GB");
  assert.equal(r5090.nativeCurrency, "EUR");
  assert.equal(r5090.nativePricePerGpuHour, 0.75); // €0.75/GPU/hr native
  assert.equal(r5090.currency, "USD"); // converted via configured EUR FX
  assert.ok(r5090.pricePerGpuHour > 0); // USD-converted
  assert.equal(r5090.priceScope, "node_total");
  assert.equal(r5090.priceSemantics, "node_total");
  assert.equal(r5090.availabilitySemantics, "region_offering");
  assert.equal(r5090.checkoutSemantics, "provider_console");
  assert.equal(r5090.orderable, false);
});

test("Hivenet treats hourly_price as node total for multi-GPU (4x RTX 4090)", () => {
  const [r4090] = hivenetToItems([PRESETS[2]]);
  assert.equal(r4090.gpuCount, 4);
  assert.equal(r4090.gpuModel, "RTX 4090");
  assert.equal(r4090.nativeCurrency, "EUR");
  // node total €1.6 over 4 GPUs => €0.40/GPU/hr native
  assert.equal(r4090.nativePricePerGpuHour, 0.4);
  assert.equal(r4090.orderable, false);
});
