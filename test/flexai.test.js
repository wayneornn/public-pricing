import assert from "node:assert/strict";
import test from "node:test";
import { flexaiHtmlToItems, extractFlexaiOffers } from "../src/connectors/live/providers/flexai.js";

// Mirrors the live FlexAI pricing page schema.org Offer block (captured 2026-06-13).
// `price` is the per-GPU on-demand hourly USD rate.
const HTML = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","offers":[
{"@type":"Offer","name":"NVIDIA H100 SXM","priceCurrency":"USD","price":"2.10","priceSpecification":{"@type":"UnitPriceSpecification","price":"2.10"}},
{"@type":"Offer","name":"NVIDIA A100 80GB","priceCurrency":"USD","price":"1.80","priceSpecification":{"@type":"UnitPriceSpecification","price":"1.80"}},
{"@type":"Offer","name":"NVIDIA B200","priceCurrency":"USD","price":"6.25","priceSpecification":{"@type":"UnitPriceSpecification","price":"6.25"}}
]}</script>`;

test("FlexAI parses schema.org Offers into per-GPU rows", () => {
  const items = flexaiHtmlToItems(HTML);
  const h100 = items.find((i) => i.metadata.offerName === "NVIDIA H100 SXM");
  assert.ok(h100);
  assert.equal(h100.gpuCount, 1);
  assert.equal(h100.pricePerGpuHour, 2.1);
  assert.equal(h100.currency, "USD");
});

test("FlexAI captures all priced offers", () => {
  const offers = extractFlexaiOffers(HTML);
  assert.equal(offers.length, 3);
  assert.deepEqual(offers.map((o) => o.pricePerGpuHour).sort((a, b) => a - b), [1.8, 2.1, 6.25]);
});

test("FlexAI rows are non-orderable USD price catalog", () => {
  const items = flexaiHtmlToItems(HTML);
  assert.equal(items.length, 3);
  for (const item of items) {
    assert.equal(item.providerId, "flexai");
    assert.equal(item.checkoutSemantics, "provider_console");
  }
});
