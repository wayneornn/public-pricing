import assert from "node:assert/strict";
import test from "node:test";
import { farmgpuHtmlToItems, extractFarmgpuCards } from "../src/connectors/live/providers/farmgpu.js";

// Mirrors the live FarmGPU /pricing cards (captured 2026-06-14): a `pricing_label` heading, a
// `pricing_card_price` dollar value + "per hour", and a "Nx <model> <vram>GB" spec bullet.
const HTML = `
<div class="pricing_card u-column-span-4 u-column-start-3"><div class="pricing_card_top"><div class="pricing_label u-text-style-h6">H100 Cluster</div><div class="pricing_card_price_wrap"><div class="pricing_card_price u-text-style-h2">$2.99</div><div class="pricing_card_price_variable u-text-style-small">per hour</div></div></div><div class="pricing_card_info_list"><div class="platform_card_info_bullet"><svg viewBox="0 0 12 12"><path d="M0"/></svg><div>8x H100 80GB SXM</div></div></div></div>
<div class="pricing_card u-column-span-4 u-column-start-7"><div class="pricing_card_top"><div class="pricing_label u-text-style-h6">B200 Cluster</div><div class="pricing_card_price_wrap"><div class="pricing_card_price u-text-style-h2">$5.49</div><div class="pricing_card_price_variable u-text-style-small">per hour</div></div></div><div class="pricing_card_info_list"><div class="platform_card_info_bullet"><svg viewBox="0 0 12 12"><path d="M0"/></svg><div>8x B200 192GB</div></div></div></div>
`;

test("FarmGPU parses each cluster card into a per-GPU priced row", () => {
  const cards = extractFarmgpuCards(HTML);
  assert.equal(cards.length, 2);
  assert.equal(cards[0].pricePerGpuHour, 2.99);
  assert.equal(cards[0].gpuCount, 8);
  assert.equal(cards[0].vramGbEach, 80);
  assert.equal(cards[1].model, "B200");
  assert.equal(cards[1].vramGbEach, 192);
});

test("FarmGPU rows are non-orderable USD price catalog with whole-cluster totals", () => {
  const items = farmgpuHtmlToItems(HTML);
  assert.equal(items.length, 2);
  const h100 = items.find((i) => i.metadata.gpuModel === "H100");
  assert.equal(h100.pricePerGpuHour, 2.99);
  assert.equal(h100.totalHourlyPrice, 23.92);
  assert.equal(h100.gpuCount, 8);
  for (const item of items) {
    assert.equal(item.providerId, "farmgpu");
    assert.equal(item.currency, "USD");
    assert.equal(item.checkoutSemantics, "provider_console");
    assert.equal(item.orderable, false);
  }
});
