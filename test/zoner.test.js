import assert from "node:assert/strict";
import test from "node:test";
import { zonerHtmlToItems, extractZonerOffers } from "../src/connectors/live/providers/zoner.js";

// Mirrors the live Zoner GPU-server configurator (captured 2026-06-14): an embedded JS
// `price_per_hour` map keyed by gpu type, plus labelled radio inputs giving model + VRAM.
const HTML = `
<input type="radio" id="gpu_type_rtx4090" name="gpu_type" value="rtx4090"><label for="gpu_type_rtx4090" class="custom-control-label">NVIDIA RTX 4090 (24 GB VRAM)</label>
<input type="radio" id="gpu_type_h200" name="gpu_type" value="h200"><label for="gpu_type_h200" class="custom-control-label">NVIDIA H200 NVL (141 GB VRAM)</label>
<script>const processGPUPriceResult = function(result) { let price_per_hour = {'rtx4090': 0.3, 'h200': 3.77}; let ram_step = {'rtx4090': 30, 'h200': 256};</script>
`;

test("Zoner reads the embedded price map and binds each key to its model + VRAM", () => {
  const offers = extractZonerOffers(HTML);
  assert.equal(offers.length, 2);
  const rtx = offers.find((o) => o.key === "rtx4090");
  assert.equal(rtx.model, "RTX 4090");
  assert.equal(rtx.vramGbEach, 24);
  assert.equal(rtx.pricePerGpuHour, 0.3);
  const h200 = offers.find((o) => o.key === "h200");
  assert.equal(h200.vramGbEach, 141);
  assert.equal(h200.pricePerGpuHour, 3.77);
});

test("Zoner rows are non-orderable USD price catalog", () => {
  const items = zonerHtmlToItems(HTML);
  assert.equal(items.length, 2);
  for (const item of items) {
    assert.equal(item.providerId, "zoner");
    assert.equal(item.currency, "USD");
    assert.equal(item.gpuCount, 1);
    assert.equal(item.checkoutSemantics, "provider_console");
    assert.equal(item.orderable, false);
  }
});
