import assert from "node:assert/strict";
import test from "node:test";
import { arkaneHtmlToItems, extractArkaneGpuRows } from "../src/connectors/live/providers/arkane.js";

const PRICING_HTML = `
<table class="pxl-table__wrap pxl-table__desktop">
  <thead>
    <tr>
      <th>GPU type</th>
      <th>Price per GPU</th>
      <th>CPU</th>
      <th>RAM </th>
      <th>VRAM</th>
    </tr>
  </thead>
  <tbody>
    <tr data-column-title="NVIDIA H200">
      <th>NVIDIA H200</th>
      <td data-row-title="Price per GPU">$3.99/hr</td>
      <td data-row-title="CPU">44</td>
      <td data-row-title="RAM ">182 GB</td>
      <td data-row-title="VRAM">141 GB</td>
    </tr>
    <tr data-column-title="RTX 6000 ADA">
      <th>RTX 6000 ADA</th>
      <td data-row-title="Price per GPU">$1.29/hr</td>
      <td data-row-title="CPU">10</td>
      <td data-row-title="RAM ">60 GB</td>
      <td data-row-title="VRAM">48 GB</td>
    </tr>
  </tbody>
</table>`;

test("Arkane Cloud extracts GPU pricing rows from the official table markup", () => {
  const rows = extractArkaneGpuRows(PRICING_HTML);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    gpuType: "NVIDIA H200",
    pricePerGpuHourUsd: 3.99,
    vcpu: 44,
    ramGb: 182,
    vramGbEach: 141
  });
});

test("Arkane Cloud maps pricing rows into non-orderable catalog inventory", () => {
  const rows = arkaneHtmlToItems(PRICING_HTML, { url: "https://arkanecloud.com/pricing/" });
  assert.equal(rows.length, 2);

  const h200 = rows[0];
  assert.equal(h200.providerId, "arkane-cloud");
  assert.equal(h200.rawOfferId, "nvidia-h200");
  assert.equal(h200.gpuLabel, "1x H200 141GB");
  assert.equal(h200.gpuCount, 1);
  assert.equal(h200.vramGbEach, 141);
  assert.equal(h200.cpu, "44 vCPU");
  assert.equal(h200.ramGb, 182);
  assert.equal(h200.pricePerGpuHour, 3.99);
  assert.equal(h200.totalHourlyPrice, 3.99);
  assert.equal(h200.availability, "unknown");
  assert.equal(h200.availabilitySemantics, "price_only");
  assert.equal(h200.priceSemantics, "gpu_only");
  assert.equal(h200.checkoutSemantics, "provider_console");
  assert.equal(h200.orderable, false);
  assert.equal(h200.metadata.billingGranularity, "per-minute");

  const ada = rows[1];
  assert.equal(ada.rawOfferId, "rtx-6000-ada");
  assert.equal(ada.gpuModel, "RTX 6000 Ada");
  assert.equal(ada.gpuLabel, "1x RTX 6000 Ada 48GB");
});
