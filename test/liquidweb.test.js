import assert from "node:assert/strict";
import test from "node:test";
import { liquidwebHtmlToItems, extractLiquidwebCards } from "../src/connectors/live/providers/liquidweb.js";

// Mirrors the live LiquidWeb GPU hosting page cards (captured 2026-06-13): a heading with
// an optional "(xN)" GPU count + model + in-name VRAM, followed by a list price and a
// "<pct>% off" discounted price. The discounted (current) price is the whole-instance rate.
const HTML = `
<div class="card"><div class="kadence-advancedheading">L40S Ada 48GB</div>
  <div> $1.92/hr </div><mark>25% off</mark><div>$1.44/hr</div></div>
<div class="card"><div class="kadence-advancedheading">H100 NVL 94GB</div>
  <div> $3.97/hr </div><mark>25% off</mark><div>$2.98/hr</div></div>
<div class="card"><div class="kadence-advancedheading">(x2) H100 NVL 94GB</div>
  <div> $6.85/hr </div><mark>25% off</mark><div>$5.14/hr</div></div>
`;

test("LiquidWeb binds model + VRAM to the discounted instance price", () => {
  const items = liquidwebHtmlToItems(HTML);
  const l40s = items.find((i) => i.metadata.gpuModel === "L40S Ada 48GB");
  assert.ok(l40s, "L40S row present");
  assert.equal(l40s.gpuCount, 1);
  assert.equal(l40s.vramGbEach, 48);
  assert.equal(l40s.totalHourlyPrice, 1.44); // discounted, not the $1.92 list
  assert.equal(l40s.pricePerGpuHour, 1.44);
  assert.equal(l40s.metadata.listPriceUsdPerHour, 1.92);
});

test("LiquidWeb reads the (xN) prefix as GPU count and derives per-GPU price", () => {
  const items = liquidwebHtmlToItems(HTML);
  const dual = items.find((i) => i.gpuCount === 2);
  assert.ok(dual, "2x H100 row present");
  assert.equal(dual.metadata.gpuModel, "H100 NVL 94GB");
  assert.equal(dual.totalHourlyPrice, 5.14);
  assert.equal(dual.pricePerGpuHour, 2.57); // 5.14 / 2
});

test("LiquidWeb keeps the 1x and 2x H100 as distinct rows", () => {
  const cards = extractLiquidwebCards(HTML);
  const h100 = cards.filter((c) => c.gpuModel === "H100 NVL 94GB");
  assert.equal(h100.length, 2);
  assert.deepEqual(h100.map((c) => c.gpuCount).sort(), [1, 2]);
});

test("LiquidWeb rows are non-orderable USD price catalog", () => {
  const items = liquidwebHtmlToItems(HTML);
  assert.equal(items.length, 3);
  for (const item of items) {
    assert.equal(item.providerId, "liquidweb");
    assert.equal(item.currency, "USD");
    assert.equal(item.checkoutSemantics, "provider_console");
  }
});
