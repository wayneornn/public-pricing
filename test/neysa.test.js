import assert from "node:assert/strict";
import test from "node:test";
import { neysaHtmlToItems, extractNeysaCards } from "../src/connectors/live/providers/neysa.js";

// Mirrors the live Neysa /pricing cards (captured 2026-06-14): a "<model> (<vram>GB)" heading
// followed by a "Starts at <strong>$X</strong> / hour" floor (split across elements).
const HTML = `
<div class="card"><p class="title">L40S (48GB)</p>

<p class="price">Starts at <strong>$1.95</strong> / hour</p></div>
<div class="card"><p class="title">H100 SXM (80GB)</p>

<p class="price">Starts at <strong>$4.39</strong> / hour</p></div>
`;

test("Neysa pairs each model+VRAM heading with its Starts-at floor", () => {
  const cards = extractNeysaCards(HTML);
  assert.equal(cards.length, 2);
  assert.equal(cards[0].vramGbEach, 48);
  assert.equal(cards[0].startingPricePerGpuHourUsd, 1.95);
  assert.equal(cards[1].heading, "H100 SXM (80GB)");
  assert.equal(cards[1].startingPricePerGpuHourUsd, 4.39);
});

test("Neysa rows are non-orderable USD starting-floor price catalog", () => {
  const items = neysaHtmlToItems(HTML);
  assert.equal(items.length, 2);
  const h100 = items.find((i) => i.metadata.gpuModel.startsWith("H100"));
  assert.equal(h100.pricePerGpuHour, 4.39);
  assert.equal(h100.vramGbEach, 80);
  assert.ok(!h100.gpuLabel.includes("("), "VRAM paren dropped from label");
  for (const item of items) {
    assert.equal(item.providerId, "neysa");
    assert.equal(item.currency, "USD");
    assert.equal(item.checkoutSemantics, "provider_console");
    assert.equal(item.orderable, false);
  }
});
