import assert from "node:assert/strict";
import test from "node:test";
import { extractNorthflankGpuCards, northflankHtmlToItems } from "../src/connectors/live/providers/northflank.js";

// Mirrors the real rendered GPU pricing cards on https://northflank.com/pricing
// (verified live 2026-06-13): an <h4>NVIDIA <model> <vram>GB</h4> heading followed by a
// "$<price> / hour" amount. The last card is an unpriced "Contact" card that must be skipped.
const PRICING_HTML = `
<div class="Ys"><div class="Js"><h4 class="ta H">NVIDIA L4 24GB</h4></div>
  <div class="Ms"><span>$<span>0.80</span> <span> / hour</span></span></div></div>
<div class="Ys"><div class="Js"><h4 class="ta H">NVIDIA A100 40GB</h4></div>
  <div class="Ms"><span>$<span>1.42</span> <span> / hour</span></span></div></div>
<div class="Ys"><div class="Js"><h4 class="ta H">NVIDIA H100 80GB</h4></div>
  <div class="Ms"><span>$<span>2.74</span> <span> / hour</span></span></div></div>
<div class="Ys"><div class="Js"><h4 class="ta H">NVIDIA RTX PRO 6000 96GB</h4></div>
  <div class="Ms"><span>$<span>3.00</span> <span> / hour</span></span></div></div>
<div class="Ys"><div class="Js"><h4 class="ta H">NVIDIA B200 180GB</h4></div>
  <div class="Ms"><span>Contact sales</span></div></div>`;

test("Northflank extracts priced GPU cards and skips unpriced ones", () => {
  const cards = extractNorthflankGpuCards(PRICING_HTML);
  assert.equal(cards.length, 4); // B200 "Contact sales" card dropped
  assert.deepEqual(cards[2], {
    heading: "H100 80GB",
    gpuModel: "H100",
    vramGbEach: 80,
    pricePerGpuHourUsd: 2.74
  });
  assert.deepEqual(cards[3], {
    heading: "RTX PRO 6000 96GB",
    gpuModel: "RTX PRO 6000",
    vramGbEach: 96,
    pricePerGpuHourUsd: 3
  });
});

test("Northflank maps cards into non-orderable per-GPU price catalog rows", () => {
  const rows = northflankHtmlToItems(PRICING_HTML, { url: "https://northflank.com/pricing" });
  assert.equal(rows.length, 4);

  const h100 = rows[2];
  assert.equal(h100.providerId, "northflank");
  assert.equal(h100.provider, "Northflank");
  assert.equal(h100.rawOfferId, "gpu:h100-80gb");
  assert.equal(h100.gpuModel, "H100");
  assert.equal(h100.gpuLabel, "1x H100 80GB");
  assert.equal(h100.gpuCount, 1);
  assert.equal(h100.vramGbEach, 80);
  assert.equal(h100.pricePerGpuHour, 2.74);
  assert.equal(h100.totalHourlyPrice, 2.74);
  assert.equal(h100.currency, "USD");
  assert.equal(h100.formFactor, "container");
  assert.equal(h100.availability, "unknown");
  assert.equal(h100.availabilitySemantics, "price_only");
  assert.equal(h100.priceScope, "gpu_sku_only");
  assert.equal(h100.priceSemantics, "gpu_only");
  assert.equal(h100.checkoutSemantics, "provider_console");
  assert.equal(h100.orderable, false);
  assert.equal(h100.metadata.billingGranularity, "per-second");

  const rtx = rows[3];
  assert.equal(rtx.gpuModel, "RTX PRO 6000");
  assert.equal(rtx.gpuLabel, "1x RTX PRO 6000 96GB");
  assert.equal(rtx.pricePerGpuHour, 3);
});

test("Northflank binds each heading to its own price (no cross-card bleed)", () => {
  const rows = northflankHtmlToItems(PRICING_HTML);
  assert.deepEqual(
    rows.map((r) => [r.gpuModel, r.pricePerGpuHour]),
    [["L4", 0.8], ["A100", 1.42], ["H100", 2.74], ["RTX PRO 6000", 3]]
  );
});
