import assert from "node:assert/strict";
import test from "node:test";
import { whitefiberHtmlToItems, extractWhitefiberCards } from "../src/connectors/live/providers/whitefiber.js";

// Mirrors the live WhiteFiber /pricing cards (captured 2026-06-14): an h3 model heading and a
// `pricing-value` "Starting at $X/HR" floor, one per card in document order.
const HTML = `
<div class="card"><h3 class="text-size-large">B200</h3><div>Starting at</div><p class="pricing-value">$2.50/HR</p></div>
<div class="card"><h3 class="text-size-large">GB200</h3><div>Starting at</div><p class="pricing-value">$2.55/HR</p></div>
<div class="card"><h3 class="text-size-large">B300</h3><div>Starting at</div><p class="pricing-value">$3.50/HR</p></div>
`;

test("WhiteFiber pairs each model heading with its Starting-at floor in order", () => {
  const cards = extractWhitefiberCards(HTML);
  assert.equal(cards.length, 3);
  assert.deepEqual(cards.map((c) => c.model), ["B200", "GB200", "B300"]);
  assert.equal(cards[0].startingPricePerGpuHourUsd, 2.5);
  assert.equal(cards[2].startingPricePerGpuHourUsd, 3.5);
});

test("WhiteFiber rows are non-orderable USD starting-floor price catalog", () => {
  const items = whitefiberHtmlToItems(HTML);
  assert.equal(items.length, 3);
  for (const item of items) {
    assert.equal(item.providerId, "whitefiber");
    assert.equal(item.currency, "USD");
    assert.equal(item.metadata.priceQualifier, "starts_at");
    assert.equal(item.checkoutSemantics, "provider_console");
    assert.equal(item.orderable, false);
  }
});
