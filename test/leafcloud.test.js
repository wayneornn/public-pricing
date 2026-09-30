import assert from "node:assert/strict";
import test from "node:test";
import { leafcloudHtmlToItems } from "../src/connectors/live/providers/leafcloud.js";

// Fixture is the real embedded pricing row from leaf.cloud/pricing (verified live),
// HTML-escaped exactly as it appears in the page source (&quot;).
const REAL_BLOCK = '&quot;provider&quot;:[0,&quot;Leafcloud&quot;],&quot;rtx6000&quot;:[0,&quot;€2.76&quot;],&quot;h100&quot;:[0,&quot;€4.12&quot;],&quot;a100&quot;:[0,&quot;€1.61&quot;],&quot;a30&quot;:[0,&quot;€0.60&quot;],&quot;location&quot;:[0,&quot;ams-1 (Amsterdam)&quot;]';

test("leafcloud parser extracts per-GPU EUR prices from the embedded pricing row", () => {
  const rows = leafcloudHtmlToItems(`<html><body>${REAL_BLOCK}</body></html>`);
  assert.equal(rows.length, 4);

  const byModel = Object.fromEntries(rows.map((r) => [r.gpuModel, r]));
  assert.equal(byModel.H100.providerId, "leafcloud");
  assert.equal(byModel.H100.vramGbEach, 80);
  assert.equal(byModel.H100.nativeCurrency, "EUR");
  assert.equal(byModel.H100.currency, "USD");
  assert.equal(byModel.H100.totalHourlyPrice, round(4.12 * 1.08)); // EUR->USD FX
  assert.equal(byModel.H100.rawRegion, "ams-1 (Amsterdam)");
  assert.equal(byModel.H100.orderable, false);

  assert.equal(byModel.A100.nativePricePerGpuHour, 1.61);
  assert.equal(byModel.A30.vramGbEach, 24);
  assert.equal(byModel["RTX PRO 6000"].vramGbEach, 96);
});

test("leafcloud parser returns [] when the pricing row is absent", () => {
  assert.deepEqual(leafcloudHtmlToItems("<html>no pricing here</html>"), []);
});

test("leafcloud parser skips N/A columns", () => {
  const block = '&quot;provider&quot;:[0,&quot;Leafcloud&quot;],&quot;rtx6000&quot;:[0,&quot;N/A&quot;],&quot;h100&quot;:[0,&quot;€4.12&quot;],&quot;a100&quot;:[0,&quot;€1.61&quot;],&quot;a30&quot;:[0,&quot;€0.60&quot;],&quot;location&quot;:[0,&quot;ams-1 (Amsterdam)&quot;]';
  const rows = leafcloudHtmlToItems(block);
  assert.equal(rows.length, 3); // rtx6000 N/A skipped
  assert.ok(!rows.find((r) => r.gpuModel === "RTX PRO 6000"));
});

function round(value) {
  return Math.round(value * 10000) / 10000;
}
