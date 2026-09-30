import assert from "node:assert/strict";
import test from "node:test";
import { visionbayHtmlToItems, extractVisionbayCards } from "../src/connectors/live/providers/visionbay.js";

// Mirrors the live Visionbay pricing cards (captured 2026-06-14): some cards put the platform
// name in the heading and the concrete model in the (Chinese) description.
const HTML = `
<div class="card"><h3>NVIDIA H100</h3><p>$4 / 每小時</p><p>透過長期承租方案，解鎖 NVIDIA H100 GPU 更加優惠價格。</p></div>
<div class="card"><h3>NVIDIA Blackwell Platform</h3><p>$10 / 每小時</p><p>搶先體驗 NVIDIA GB200 NVL72，為高速訓練而生。</p></div>`;

test("Visionbay reads the model from the card (incl. description) and the per-hour USD rate", () => {
  const cards = extractVisionbayCards(HTML);
  assert.equal(cards.length, 2);
  assert.equal(cards[0].model, "H100");
  assert.equal(cards[0].pricePerGpuHourUsd, 4);
  assert.equal(cards[1].model, "GB200 NVL72"); // model pulled from description, not "Platform"
  assert.equal(cards[1].pricePerGpuHourUsd, 10);
});

test("Visionbay rows are a non-orderable USD price catalog", () => {
  const items = visionbayHtmlToItems(HTML);
  assert.equal(items.length, 2);
  for (const item of items) {
    assert.equal(item.providerId, "visionbay");
    assert.equal(item.currency, "USD");
    assert.equal(item.checkoutSemantics, "provider_console");
    assert.equal(item.orderable, false);
  }
});
