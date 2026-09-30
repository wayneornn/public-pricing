import assert from "node:assert/strict";
import test from "node:test";
import { yottalabsHtmlToItems, extractYottalabsRows } from "../src/connectors/live/providers/yottalabs.js";

// Mirrors the live Yotta Labs /pricing GPU table (captured 2026-06-14): columns GPU Model |
// VRAM | RAM | vCPU | On-demand | Spot. A storage table row is included to prove it is ignored.
const HTML = `
<table><tr><th>GPU Model</th><th>VRAM</th><th>RAM</th><th>vCPU</th><th>On-demand</th><th>Spot</th><th></th></tr>
<tr><td>RTX 4090</td><td>24 GB</td><td>115 GB</td><td>30</td><td>$0.48/hr</td><td>—</td><td>Deploy</td></tr>
<tr><td>H100</td><td>80 GB</td><td>119 GB</td><td>11</td><td>$2.56/hr</td><td>0.95/hr</td><td>Deploy</td></tr>
</table>
<table><tr><th>Storage Type</th><th>Use Case</th><th>Price</th></tr>
<tr><td>Container Disk</td><td>Temporary storage</td><td>0.036/GB/mo</td></tr></table>
`;

test("Yotta Labs parses on-demand GPU rows and ignores the storage table", () => {
  const rows = extractYottalabsRows(HTML);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].model, "RTX 4090");
  assert.equal(rows[0].vramGbEach, 24);
  assert.equal(rows[0].onDemandPricePerGpuHour, 0.48);
  assert.equal(rows[1].onDemandPricePerGpuHour, 2.56);
});

test("Yotta Labs rows are non-orderable USD on-demand price catalog (spot dropped)", () => {
  const items = yottalabsHtmlToItems(HTML);
  assert.equal(items.length, 2);
  const h100 = items.find((i) => i.metadata.gpuModel === "H100");
  assert.equal(h100.pricePerGpuHour, 2.56);
  assert.equal(h100.gpuCount, 1);
  for (const item of items) {
    assert.equal(item.providerId, "yottalabs");
    assert.equal(item.currency, "USD");
    assert.equal(item.checkoutSemantics, "provider_console");
    assert.equal(item.orderable, false);
  }
});
