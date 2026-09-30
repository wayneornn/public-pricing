import assert from "node:assert/strict";
import test from "node:test";
import {
  extractGreenNodePricingHtml,
  greennodeHtmlToItems
} from "../src/connectors/live/providers/greennode.js";

const PRICING_TABLE = `
<table>
  <tbody>
    <tr>
      <td><span>g5-standard-16x250-1h100-0ib</span></td>
      <td>16</td><td>250</td><td>80</td><td>1</td><td>3.75</td>
      <td><span><s><strong>$2.99 </strong></s><strong>$2.69</strong></span></td>
      <td><strong>$2</strong></td>
    </tr>
    <tr>
      <td><span>g5-standard-32x500-2h100-0ib</span></td>
      <td>32</td><td>500</td><td>160</td><td>2</td><td>7,5</td>
      <td><span><s><strong>$5.98</strong></s><strong> $5.38</strong></span></td>
      <td><strong>$4</strong></td>
    </tr>
    <tr>
      <td>g5-standard-2x30-h100-mini-1.10gb</td>
      <td>2</td><td>250</td><td>10</td><td>1/8</td><td>0.3</td>
      <td><strong>$0.39</strong></td>
      <td><a>Contact us</a></td>
    </tr>
  </tbody>
</table>`;

const STATE_HTML = `
<html>
  <body>
    <script id="greennode-state" type="application/json">${JSON.stringify({
      "http_requests:/api/pages-green-node?locale=en": {
        body: {
          data: [
            {
              attributes: {
                page_configs: [
                  {
                    __component: "product.product-features",
                    type: "pricing",
                    title: "<H100 Server Configurations>",
                    content: PRICING_TABLE
                  }
                ]
              }
            }
          ]
        }
      }
    })}</script>
  </body>
</html>`;

test("GreenNode extracts H100 pricing table from embedded CMS state", () => {
  const pricingHtml = extractGreenNodePricingHtml(STATE_HTML);
  assert.match(pricingHtml, /g5-standard-16x250-1h100-0ib/);
});

test("GreenNode parses full H100 pricing rows from page state and skips fractional mini rows", () => {
  const rows = greennodeHtmlToItems(STATE_HTML);
  assert.equal(rows.length, 2);

  const oneGpu = rows[0];
  assert.equal(oneGpu.providerId, "greennode");
  assert.equal(oneGpu.rawOfferId, "g5-standard-16x250-1h100-0ib");
  assert.equal(oneGpu.gpuLabel, "1x H100 SXM5 80GB");
  assert.equal(oneGpu.gpuCount, 1);
  assert.equal(oneGpu.vramGbEach, 80);
  assert.equal(oneGpu.cpu, "16 vCPU");
  assert.equal(oneGpu.ramGb, 250);
  assert.equal(oneGpu.storage, "3.75 TB local");
  assert.equal(oneGpu.pricePerGpuHour, 2.69);
  assert.equal(oneGpu.totalHourlyPrice, 2.69);
  assert.equal(oneGpu.metadata.oneYearPricePerGpuHourUsd, 2);
  assert.equal(oneGpu.metadata.sourceFormat, "embedded_cms_state");
  assert.equal(oneGpu.availability, "unknown");
  assert.equal(oneGpu.orderable, false);
  assert.equal(oneGpu.checkoutSemantics, "provider_console");

  const twoGpu = rows[1];
  assert.equal(twoGpu.rawOfferId, "g5-standard-32x500-2h100-0ib");
  assert.equal(twoGpu.gpuCount, 2);
  assert.equal(twoGpu.vramGbEach, 80);
  assert.equal(twoGpu.pricePerGpuHour, 2.69);
  assert.equal(twoGpu.totalHourlyPrice, 5.38);
  assert.equal(twoGpu.storage, "7.5 TB local");
});

test("GreenNode falls back to rendered table parsing", () => {
  const rows = greennodeHtmlToItems(PRICING_TABLE);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].metadata.sourceFormat, "rendered_html");
});
