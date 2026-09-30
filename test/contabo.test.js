import assert from "node:assert/strict";
import test from "node:test";
import { contaboHtmlToItems } from "../src/connectors/live/providers/contabo.js";

const HTML = `
<section id="product-smoke-test-tables">
  <section id="cloud-nvidia-8x-h200" class="smoketestproduct svelte-1vvg9be">
    <div class="desktop-pricing-container">
      <div class="wrapper">
        <h2>Cloud NVIDIA 8x H200</h2>
        <div class="pricing-table">
          <div data-heading="spec-gpu"><span>GPU</span></div>
          <div data-heading="spec-gpu-ram"><span>GPU RAM</span></div>
          <div data-heading="spec-vcpus"><span>CPUs</span></div>
          <div data-heading="spec-ram"><span>RAM</span></div>
          <div data-heading="spec-storage"><span>Storage</span></div>
          <div data-heading="spec-bandwidth"><span>Bandwidth</span></div>
          <div data-heading="pricing-header-price"><span>Price</span></div>
          <div data-heading="action"></div>
          <div><span class="spec-title"><!-- HTML_TAG_START -->1<!-- HTML_TAG_END --></span></div>
          <div><span class="spec-title"><!-- HTML_TAG_START -->1128 GB<!-- HTML_TAG_END --></span></div>
          <div><span class="spec-title"><!-- HTML_TAG_START -->192<!-- HTML_TAG_END --></span></div>
          <div><span class="spec-title"><!-- HTML_TAG_START -->7,68 TB<!-- HTML_TAG_END --></span></div>
          <div><span class="spec-title"><!-- HTML_TAG_START -->1,9 TB<!-- HTML_TAG_END --></span></div>
          <div><span class="spec-title"><!-- HTML_TAG_START -->15 TB<!-- HTML_TAG_END --></span></div>
          <div><span class="spec-title price">€16,000.00</span></div>
        </div>
      </div>
    </div>
  </section>
  <div class="mobile-pricing-container">
    <h2>Cloud NVIDIA 8x H200</h2>
    <span>€16,000.00/ month</span>
  </div>
</section>`;

test("Contabo parses desktop GPU Cloud pricing rows without duplicating mobile cards", () => {
  const rows = contaboHtmlToItems(HTML);
  assert.equal(rows.length, 1);

  const row = rows[0];
  assert.equal(row.providerId, "contabo");
  assert.equal(row.rawOfferId, "cloud-nvidia-8x-h200");
  assert.equal(row.gpuModel, "H200");
  assert.equal(row.gpuCount, 8);
  assert.equal(row.vramGbEach, 141);
  assert.equal(row.totalHourlyPrice, 23.6712);
  assert.equal(row.pricePerGpuHour, 2.9589);
  assert.equal(row.cpu, "192 vCPU");
  assert.equal(row.ramGb, 7864.32);
  assert.equal(row.storage, "1,9 TB");
  assert.equal(row.orderable, false);
  assert.equal(row.checkoutSemantics, "provider_console");
});
