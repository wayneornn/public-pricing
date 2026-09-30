import assert from "node:assert/strict";
import test from "node:test";
import { turboscaleHtmlToItems, extractTurboscaleRows } from "../src/connectors/live/providers/turboscale.js";

// Mirrors the live Turboscale /pricing table (captured 2026-06-14): same GPU+count can repeat
// with different storage tiers (and price), so rows must stay distinct.
const HTML = `
<table><tr><th>GPUs</th><th>VRAM/GPU</th><th>vCPUs</th><th>RAM GB</th><th>Storage SSD</th><th>Storage NVMe</th><th>Bandwidth</th><th>Price USD</th></tr>
<tr><td>1 × NVIDIA H100</td><td>80</td><td>30</td><td>380</td><td>50</td><td>3840</td><td>8</td><td>3.24/h</td></tr>
<tr><td>4 × NVIDIA H100</td><td>320</td><td>120</td><td>1520</td><td>50</td><td>15360</td><td>25</td><td>12.97/h</td></tr>
<tr><td>1 × NVIDIA V100S</td><td>32</td><td>15</td><td>45</td><td>300</td><td></td><td>2</td><td>0.95/h</td></tr>
<tr><td>1 × NVIDIA V100S</td><td>32</td><td>15</td><td>45</td><td>400</td><td></td><td>2</td><td>2.15/h</td></tr>
</table>`;

test("Turboscale parses whole-config rows and computes per-GPU price", () => {
  const rows = extractTurboscaleRows(HTML);
  assert.equal(rows.length, 4);
  assert.equal(rows[0].model, "H100");
  assert.equal(rows[0].gpuCount, 1);
  assert.equal(rows[1].gpuCount, 4);
  assert.equal(rows[1].totalHourlyPrice, 12.97);
});

test("Turboscale keeps same-GPU storage tiers as distinct rows (no id collision)", () => {
  const items = turboscaleHtmlToItems(HTML);
  assert.equal(items.length, 4);
  const ids = new Set(items.map((i) => i.rawOfferId));
  assert.equal(ids.size, 4);
  const h100 = items.find((i) => i.gpuCount === 4 && i.metadata.gpuModel === "H100");
  assert.equal(h100.pricePerGpuHour, 3.2425); // 12.97 / 4
  for (const item of items) {
    assert.equal(item.providerId, "turboscale");
    assert.equal(item.checkoutSemantics, "provider_console");
    assert.equal(item.orderable, false);
  }
});
