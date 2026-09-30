import assert from "node:assert/strict";
import test from "node:test";
import { olakrutrimHtmlToItems, extractOlakrutrimRows } from "../src/connectors/live/providers/olakrutrim.js";

// Mirrors the live Ola Krutrim /pricing GPU tables (captured 2026-06-14): columns Instance |
// RAM | GPU memory(GB) total | vCPUs | <price columns> with ₹/hr values. A fractional MIG row
// (no "× N") and a CPU-only row are included to prove they are skipped.
const HTML = `
<table><tr><th>Instance</th><th>RAM (GB)</th><th>GPU memory (GB)</th><th>vCPUs</th><th>On-demand</th><th>Monthly</th></tr>
<tr><td>A100 80 GB × 1</td><td>96</td><td>80</td><td>24</td><td>₹189 /hr</td><td>₹148 /hr</td></tr>
<tr><td>H100 × 2</td><td>400</td><td>160</td><td>48</td><td>₹426 /hr</td><td>₹396 /hr</td></tr>
<tr><td>A100 Tiny</td><td>30</td><td>5</td><td>16</td><td>₹24.00 /hr</td><td></td></tr></table>
<table><tr><th>Instance</th><th>On-demand</th></tr>
<tr><td>1 vCPU / 4 GB RAM</td><td>₹3.00 /hr</td></tr></table>
`;

test("Ola Krutrim parses whole-GPU instance rows, skipping fractional and CPU-only rows", () => {
  const rows = extractOlakrutrimRows(HTML);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].model, "A100");
  assert.equal(rows[0].gpuCount, 1);
  assert.equal(rows[0].totalHourlyInr, 189);
  assert.equal(rows[1].model, "H100");
  assert.equal(rows[1].gpuCount, 2);
  assert.equal(rows[1].vramGbEach, 80);
  assert.equal(rows[1].totalHourlyInr, 426);
});

test("Ola Krutrim rows are non-orderable INR->USD converted price catalog", () => {
  const items = olakrutrimHtmlToItems(HTML);
  assert.equal(items.length, 2);
  for (const item of items) {
    assert.equal(item.providerId, "olakrutrim");
    // INR converted to USD downstream by createInventoryItem (FX).
    assert.equal(item.currency, "USD");
    assert.equal(item.metadata.totalHourlyInr > 0, true);
    assert.equal(item.checkoutSemantics, "provider_console");
    assert.equal(item.orderable, false);
  }
});
