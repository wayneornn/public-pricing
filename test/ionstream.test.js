import assert from "node:assert/strict";
import test from "node:test";
import { extractIonstreamCards, ionstreamHtmlToItems } from "../src/connectors/live/providers/ionstream.js";

// Mirrors the real homepage solution-card markup (verified live 2026-06-13): a
// `solutions-item__title` containing "NVIDIA <model>" followed within the card by a
// "Pricing starts at $<price> p/hr" floor. The header mega-menu repeats the model names
// without a price and must not produce a row.
const HOME_HTML = `
<nav><div class="header-mega-menu-solutions__item"><h3 class="header-mega-menu-solutions__title"><p>NVIDIA H200</p></h3></div></nav>
<section>
  <div class="solutions-item"><h3 class="solutions-item__title"><p>NVIDIA L40S</p></h3>
    <p>Achieve superior performance across diverse data center workloads Pricing starts at $1.00 p/hr Equipped with cutting-edge AI</p></div>
  <div class="solutions-item"><h3 class="solutions-item__title"><p>NVIDIA H200</p></h3>
    <p>Ensure your place at the forefront of next-generation computing Pricing starts at $2.06 p/hr Built for unrivalled performance</p></div>
  <div class="solutions-item"><h3 class="solutions-item__title"><p>NVIDIA B200</p></h3>
    <p>Delivering up to 15X more real-time inference Pricing starts at $2.55 p/hr</p></div>
  <div class="solutions-item"><h3 class="solutions-item__title"><p>AMD MI300X</p></h3>
    <p>Hosted dedicated systems. Contact sales for pricing.</p></div>
</section>`;

test("ionstream extracts per-GPU 'Pricing starts at' floors from solution cards", () => {
  const cards = extractIonstreamCards(HOME_HTML);
  assert.deepEqual(cards, [
    { gpuModel: "L40S", startingPricePerGpuHourUsd: 1 },
    { gpuModel: "H200", startingPricePerGpuHourUsd: 2.06 },
    { gpuModel: "B200", startingPricePerGpuHourUsd: 2.55 }
  ]);
});

test("ionstream maps cards into non-orderable lowest-SKU price rows", () => {
  const rows = ionstreamHtmlToItems(HOME_HTML, { url: "https://ionstream.ai/" });
  assert.equal(rows.length, 3);

  const h200 = rows[1];
  assert.equal(h200.providerId, "ionstream");
  assert.equal(h200.provider, "ionstream.ai");
  assert.equal(h200.rawOfferId, "card:h200");
  assert.equal(h200.gpuModel, "H200");
  assert.equal(h200.gpuLabel, "1x H200");
  assert.equal(h200.gpuCount, 1);
  assert.equal(h200.pricePerGpuHour, 2.06);
  assert.equal(h200.totalHourlyPrice, 2.06);
  assert.equal(h200.currency, "USD");
  assert.equal(h200.formFactor, "bare_metal");
  assert.equal(h200.availability, "unknown");
  assert.equal(h200.availabilitySemantics, "price_only");
  assert.equal(h200.priceScope, "gpu_sku_lowest");
  assert.equal(h200.priceSemantics, "lowest_sku");
  assert.equal(h200.checkoutSemantics, "provider_console");
  assert.equal(h200.orderable, false);
  assert.equal(h200.metadata.priceQualifier, "starts_at");
});

test("ionstream ignores nav menu entries and unpriced 'Contact' cards", () => {
  const rows = ionstreamHtmlToItems(HOME_HTML);
  assert.deepEqual(rows.map((r) => r.gpuModel), ["L40S", "H200", "B200"]); // no MI300X (contact), no dupe H200 from nav
});
