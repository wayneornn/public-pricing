import assert from "node:assert/strict";
import test from "node:test";
import { valdiHtmlToItems, extractValdiCards } from "../src/connectors/live/providers/valdi.js";

// Mirrors the live Valdi home page GPU cards (captured 2026-06-13): an h1.h3 model heading
// then a "Starting at $X/hr" floor, one per card in document order.
const HTML = `
<div class="w-col"><div><h1 class="h3 small white"><strong>NVIDIA H100 (PCIe or SXM5 IB)</strong></h1></div>
  <p>The NVIDIA H100 is the heavyweight champ.</p><div class="button-gradient-text solid">Starting at $2.35/hr</div></div>
<div class="w-col"><div><h1 class="h3 small white"><strong>NVIDIA A100 80GB (PCIe or SXM4 IB)</strong></h1></div>
  <p>Like a hot knife through butter.</p><div class="button-gradient-text solid">Starting at $1.95/hr</div></div>
<div class="w-col"><div><h1 class="h3 small white"><strong>AMD Instinct MI250</strong></h1></div>
  <p>Crunching numbers at incredible speeds.</p><div class="button-gradient-text solid">Starting at $1.35/hr</div></div>
`;

test("Valdi pairs each model heading with its Starting-at floor in order", () => {
  const cards = extractValdiCards(HTML);
  assert.equal(cards.length, 3);
  assert.equal(cards[0].gpuModel, "NVIDIA H100 (PCIe or SXM5 IB)");
  assert.equal(cards[0].startingPricePerGpuHourUsd, 2.35);
  assert.equal(cards[1].startingPricePerGpuHourUsd, 1.95);
  assert.equal(cards[2].gpuModel, "AMD Instinct MI250");
});

test("Valdi strips the bus/form-factor note from the model label", () => {
  const items = valdiHtmlToItems(HTML);
  const h100 = items.find((i) => i.metadata.gpuModel.startsWith("NVIDIA H100"));
  assert.ok(h100);
  assert.equal(h100.pricePerGpuHour, 2.35);
  assert.equal(h100.metadata.priceQualifier, "starts_at");
  assert.ok(!h100.gpuLabel.includes("PCIe"), "bus note dropped from label");
});

test("Valdi rows are non-orderable USD price catalog", () => {
  const items = valdiHtmlToItems(HTML);
  assert.equal(items.length, 3);
  for (const item of items) {
    assert.equal(item.providerId, "valdi");
    assert.equal(item.currency, "USD");
    assert.equal(item.checkoutSemantics, "provider_console");
  }
});
