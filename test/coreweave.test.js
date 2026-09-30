import assert from "node:assert/strict";
import test from "node:test";
import { coreweaveHtmlToItems, extractCoreweaveCards } from "../src/connectors/live/providers/coreweave.js";

// Mirrors the live CoreWeave pricing page card grid (captured 2026-06-13): a model-name
// heading, then a labeled price block (On-Demand / Spot / Inference) and meta values
// ("8 GPU Count", "80 VRAM"). On-Demand Price is the whole-instance hourly USD rate.
const HTML = `
<div class="table-grid">
  <h3 class="table-model-name">NVIDIA HGX H100</h3>
  <div class="table-meta-value">8<span>GPU Count</span></div>
  <div class="table-meta-value">80<span>VRAM</span></div>
  <h3 class="table-model-name">NVIDIA HGX H100</h3>
  <div class="table-meta-text">On-Demand Price:</div><div>$49.24</div><div>/ Hour</div>
  <div class="table-meta-text">Spot Price:</div><div>$19.71</div><div>/ Hour</div>
  <div class="table-meta-text">Inference Single CPU Price:</div><div>$6.16</div><div>/ Hour</div>
  <div class="table-meta-value">8<span>GPU Count</span></div>
  <div class="table-meta-value">80<span>VRAM</span></div>
</div>
<div class="table-grid">
  <h3 class="table-model-name">NVIDIA L40S</h3>
  <h3 class="table-model-name">NVIDIA L40S</h3>
  <div class="table-meta-text">On-Demand Price:</div><div>$18.00</div><div>/ Hour</div>
  <div class="table-meta-value">8<span>GPU Count</span></div>
  <div class="table-meta-value">48<span>VRAM</span></div>
</div>
<div class="table-grid">
  <h3 class="table-model-name">NVIDIA GB300 NVL72</h3>
  <h3 class="table-model-name">NVIDIA GB300 NVL72</h3>
  <div class="table-meta-text">On-Demand Price:</div><div>Contact us</div>
</div>
`;

test("CoreWeave parses labeled On-Demand cards into per-GPU rows", () => {
  const items = coreweaveHtmlToItems(HTML);
  const h100 = items.find((i) => i.metadata.gpuModel === "HGX H100");
  assert.ok(h100, "HGX H100 row present");
  assert.equal(h100.gpuCount, 8);
  assert.equal(h100.vramGbEach, 80);
  assert.equal(h100.totalHourlyPrice, 49.24); // whole 8-GPU node
  assert.equal(h100.pricePerGpuHour, 6.155); // 49.24 / 8
});

test("CoreWeave ignores Spot and Inference prices, keeps only On-Demand", () => {
  const cards = extractCoreweaveCards(HTML);
  const h100 = cards.find((c) => c.gpuModel === "HGX H100");
  assert.equal(h100.onDemandPriceUsdPerHour, 49.24);
  assert.ok(!cards.some((c) => c.onDemandPriceUsdPerHour === 19.71));
});

test("CoreWeave skips unpriced (Contact us) cards", () => {
  const items = coreweaveHtmlToItems(HTML);
  assert.ok(!items.some((i) => i.metadata.gpuModel.includes("GB300")), "GB300 dropped (no price)");
});

test("CoreWeave dedupes a model to a single row and is non-orderable", () => {
  const items = coreweaveHtmlToItems(HTML);
  const h100s = items.filter((i) => i.metadata.gpuModel === "HGX H100");
  assert.equal(h100s.length, 1);
  for (const item of items) {
    assert.equal(item.providerId, "coreweave");
    assert.equal(item.checkoutSemantics, "provider_console");
  }
});
