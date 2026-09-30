import assert from "node:assert/strict";
import test from "node:test";
import { highresoHtmlToItems, extractHighresoOffers } from "../src/connectors/live/providers/highreso.js";

const HTML = `
<article class="card reveal"><h3>B200 Compute Cluster</h3><dl class="specs">
<div><dt>GPU</dt><dd>NVIDIA B200 SXM × 8 / node</dd></div>
<div><dt>GPU memory</dt><dd>1,440 GB / node (180 GB × 8)</dd></div>
<div><dt>Interconnect</dt><dd>InfiniBand 3,200 Gbps</dd></div>
<div class="price"><dt>Pricing</dt><dd>from ¥22 / GPU / min</dd></div>
</dl></article>
<article class="card reveal"><h3>AI Supercomputer Cloud</h3><dl class="specs">
<div><dt>GPU</dt><dd>NVIDIA H200 SXM × 8 / node</dd></div>
<div><dt>GPU memory</dt><dd>1,128 GB / node</dd></div>
<div><dt>Interconnect</dt><dd>NVLink · NVSwitch 900 Gbps</dd></div>
<div class="price"><dt>Pricing</dt><dd>¥2,783,000 / month / node</dd></div>
</dl></article>`;

test("HIGHRESO extracts yen-denominated public service cards", () => {
  const offers = extractHighresoOffers(HTML);
  assert.equal(offers.length, 2);
  assert.equal(offers[0].model, "B200 SXM");
  assert.equal(offers[0].pricePerGpuHour, 1320); // ¥22/min normalized to hourly
});

test("HIGHRESO rows preserve native JPY prices and are non-orderable", () => {
  const items = highresoHtmlToItems(HTML);
  const b200 = items.find((item) => item.rawOfferId === "highreso:b200-sxm:JPY/GPU/min");
  assert.equal(b200.gpuCount, 8);
  assert.equal(b200.nativeCurrency, "JPY");
  assert.equal(b200.nativePricePerGpuHour, 1320);
  assert.equal(b200.checkoutSemantics, "provider_console");
  assert.equal(b200.orderable, false);
});
