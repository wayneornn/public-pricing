import assert from "node:assert/strict";
import test from "node:test";
import { cloudexeHtmlToItems, extractCloudexeTiers } from "../src/connectors/live/providers/cloudexe.js";

const HTML = `
<div class="price-card"><div class="price-tier">Silver</div><div class="price-amount">$1.39<span class="price-unit">/H100/GPU·hr</span></div></div>
<div class="price-card"><div class="price-tier">Gold</div><div class="price-amount">$2.49<span class="price-unit">/H100/GPU·hr</span></div></div>
<div class="price-card"><div class="price-tier">Platinum</div><div class="price-amount">$2.49<span class="price-unit">/H100/GPU·hr</span></div></div>`;

test("Cloudexe extracts non-spot H100 price tiers", () => {
  const tiers = extractCloudexeTiers(HTML);
  assert.deepEqual(tiers.map((tier) => tier.tier), ["Gold", "Platinum"]);
});

test("Cloudexe rows are non-orderable USD price catalog", () => {
  const items = cloudexeHtmlToItems(HTML);
  assert.equal(items.length, 2);
  assert.equal(items[0].pricePerGpuHour, 2.49);
  assert.equal(items[0].checkoutSemantics, "provider_console");
  assert.equal(items[0].orderable, false);
});
