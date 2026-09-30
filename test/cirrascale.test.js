import assert from "node:assert/strict";
import test from "node:test";
import { cirrascaleHtmlToItems, extractCirrascalePlans } from "../src/connectors/live/providers/cirrascale.js";

// Mirrors the live Cirrascale /pricing accordions (captured 2026-06-14): SKU titles in
// `plan-trigger__text--secondary`, a category header in `text--lg`, a term ladder via
// `option__duration__hr`, and a clustered card that uses "As low as $X ... per GPU hour".
const HTML = `
<div class="text--lg">NVIDIA H200 / H100 Instance Pricing</div>
<div class="plan-trigger__text plan-trigger__text--secondary"><div>8X NVIDIA H100 (Standalone)</div></div>
<div class="plan-info"><div class="plan-options"><div class="option option--highlighted"><div class="option__price">$24,999</div><div class="option__duration">Annual Term</div><div class="option__duration__hr">$3.43/GPUhr Equivalent</div></div><div class="option"><div class="option__duration__hr">$4.28/GPUhr Equivalent</div></div></div></div>
<div class="plan-trigger__text plan-trigger__text--secondary"><div>8X NVIDIA H100 (16-Node+ Clustered)</div></div>
<div class="plan-info"><div class="plan-options"><div class="option"><div class="option__price">As low as $2.49</div><div class="option__duration">per GPU hour*</div></div></div></div>
<div class="text--lg">Cloud Storage Solutions Pricing</div>
`;

test("Cirrascale reads SKU titles and the headline per-GPU rate, bounding each card", () => {
  const plans = extractCirrascalePlans(HTML);
  assert.equal(plans.length, 2);
  assert.equal(plans[0].model, "H100");
  assert.equal(plans[0].gpuCount, 8);
  assert.equal(plans[0].pricePerGpuHour, 3.43);
  // Clustered card uses its own "As low as" price, never borrows the next card's.
  assert.equal(plans[1].pricePerGpuHour, 2.49);
});

test("Cirrascale rows are non-orderable USD price catalog", () => {
  const items = cirrascaleHtmlToItems(HTML);
  assert.equal(items.length, 2);
  for (const item of items) {
    assert.equal(item.providerId, "cirrascale");
    assert.equal(item.currency, "USD");
    assert.equal(item.checkoutSemantics, "provider_console");
    assert.equal(item.orderable, false);
  }
});
