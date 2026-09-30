import assert from "node:assert/strict";
import test from "node:test";
import { trainyHtmlToItems, extractTrainyOffers } from "../src/connectors/live/providers/trainy.js";

// Mirrors the live Trainy /pricing page (captured 2026-06-14).
const HTML = `
<div class="pricing11_plan"><div class="text-size-small">8xH100 (80 GB SXM5) + 3.2Tb/s Infiniband</div>
<div class="text-size-tiny">8xH100 GPUs • 80GB memory each (SXM5) • 3.2 TB/s Infiniband connectivity</div>
<span>On-Demand $3.60 per GPU per hour</span></div>`;

test("Trainy parses the on-demand 8xH100 SKU at a per-GPU rate", () => {
  const offers = extractTrainyOffers(HTML);
  assert.equal(offers.length >= 1, true);
  assert.equal(offers[0].gpuCount, 8);
  assert.equal(offers[0].model, "H100");
  assert.equal(offers[0].vramGbEach, 80);
  assert.equal(offers[0].pricePerGpuHour, 3.6);
});

test("Trainy row is a non-orderable USD price catalog", () => {
  const items = trainyHtmlToItems(HTML);
  assert.equal(items.length >= 1, true);
  const h100 = items[0];
  assert.equal(h100.gpuCount, 8);
  assert.equal(h100.totalHourlyPrice, 28.8);
  assert.equal(h100.providerId, "trainy");
  assert.equal(h100.checkoutSemantics, "provider_console");
  assert.equal(h100.orderable, false);
});
