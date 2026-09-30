import assert from "node:assert/strict";
import test from "node:test";
import { acecloudHtmlToItems, extractAceCloudPage } from "../src/connectors/live/providers/acecloud.js";

const H100_HTML = `
<div class="section-header"><h3>NVIDIA H100 – HGX</h3></div>
<table id="compute_data">
  <tbody>
    <tr>
      <td>N.HGXH100.250</td>
      <td>1x</td>
      <td>26</td>
      <td>250</td>
      <td>---</td>
      <td>₹180,000</td>
      <td>₹1,026,000</td>
      <td>₹1,944,000</td>
      <td><button>Launch Now</button></td>
    </tr>
  </tbody>
</table>`;

const H200_HTML = `
<div class="section-header"><h3>NVIDIA H200 – NVL</h3></div>
<table id="compute_data">
  <tbody>
    <tr>
      <td>N.H200.48.384</td>
      <td>2x</td>
      <td>48</td>
      <td>384</td>
      <td>₹823.20</td>
      <td>₹480,746</td>
      <td>₹2,740,253</td>
      <td>₹5,192,057</td>
      <td><button>Launch Now</button></td>
    </tr>
  </tbody>
</table>`;

test("ACE Cloud extracts rows from official pricing table markup", () => {
  const page = extractAceCloudPage(H100_HTML);
  assert.equal(page.title, "NVIDIA H100 – HGX");
  assert.equal(page.rows.length, 1);
  assert.equal(page.rows[0].flavor, "N.HGXH100.250");
  assert.equal(page.rows[0].gpuCount, 1);
  assert.equal(page.rows[0].monthlyInr, 180000);
});

test("ACE Cloud maps monthly-only GPU pricing into non-orderable catalog rows", () => {
  const rows = acecloudHtmlToItems(H100_HTML, {
    url: "https://acecloud.ai/pricing/linux/inr/noida/nvidia-h100-hgx/",
    region: "noida",
    slug: "nvidia-h100-hgx"
  });
  assert.equal(rows.length, 1);

  const row = rows[0];
  assert.equal(row.providerId, "acecloud");
  assert.equal(row.rawOfferId, "N.HGXH100.250");
  assert.equal(row.gpuLabel, "1x H100 HGX 80GB");
  assert.equal(row.gpuCount, 1);
  assert.equal(row.vramGbEach, 80);
  assert.equal(row.cpu, "26 vCPU");
  assert.equal(row.ramGb, 250);
  assert.equal(row.nativeCurrency, "INR");
  assert.equal(row.nativePricePerGpuHour, 246.5753);
  assert.equal(row.nativeTotalHourlyPrice, undefined);
  assert.equal(row.metadata.priceSource, "monthly_converted");
  assert.equal(row.availability, "unknown");
  assert.equal(row.orderable, false);
  assert.equal(row.checkoutSemantics, "provider_console");
});

test("ACE Cloud prefers explicit hourly pricing when the page exposes it", () => {
  const rows = acecloudHtmlToItems(H200_HTML, {
    url: "https://acecloud.ai/pricing/linux/inr/noida/nvidia-h200-nvl/",
    region: "noida",
    slug: "nvidia-h200-nvl"
  });
  assert.equal(rows.length, 1);

  const row = rows[0];
  assert.equal(row.rawOfferId, "N.H200.48.384");
  assert.equal(row.gpuLabel, "2x H200 141GB NVL");
  assert.equal(row.gpuCount, 2);
  assert.equal(row.nativePricePerGpuHour, 411.6);
  assert.equal(row.metadata.priceSource, "hourly");
  assert.equal(row.metadata.hourlyInr, 823.2);
});
