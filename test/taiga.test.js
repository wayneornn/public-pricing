import assert from "node:assert/strict";
import test from "node:test";
import { taigaHtmlToItems, extractTaigaRows } from "../src/connectors/live/providers/taiga.js";

// Mirrors the live Northern Data / Taiga Cloud pricing tables (captured 2026-06-14): columns
// Model | GPUs | vRAM(GB) total | CPUs | RAM | Local Storage | $/GPU/h. Bare-metal rows have a
// CPUs value; on-demand rows leave it blank. A CPU-only row is included to prove it is ignored.
const HTML = `
<table><tr><th></th><th>GPUs</th><th>vRAM (GB)</th><th>CPUs</th><th>RAM (GB)</th><th>Local Storage (TB)</th><th>$/GPU/h</th></tr>
<tr><td>NVIDIA H100 SXM</td><td>8</td><td>640</td><td>112</td><td>2048</td><td>23</td><td>from $2.40</td></tr></table>
<table><tr><th></th><th>GPUs</th><th>vRAM (GB)</th><th></th><th>RAM (GB)</th><th>Local Storage (TB)</th><th>$/GPU/h</th></tr>
<tr><td>NVIDIA H100 SXM</td><td>8</td><td>640</td><td></td><td>2000</td><td>23</td><td>from $2.60</td></tr></table>
<table><tr><th></th><th>vCPU</th><th>RAM (GB)</th><th>Price/Hour ($)</th></tr>
<tr><td>big.mini</td><td>6</td><td>90</td><td>$0.65</td></tr></table>
`;

test("Taiga parses bare-metal and on-demand GPU rows, ignoring CPU-only rows", () => {
  const rows = extractTaigaRows(HTML);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].formFactor, "bare_metal");
  assert.equal(rows[0].pricePerGpuHour, 2.4);
  assert.equal(rows[0].vramGbEach, 80);
  assert.equal(rows[1].formFactor, "vm");
  assert.equal(rows[1].pricePerGpuHour, 2.6);
});

test("Taiga rows are non-orderable USD price catalog with distinct ids", () => {
  const items = taigaHtmlToItems(HTML);
  assert.equal(items.length, 2);
  assert.notEqual(items[0].rawOfferId, items[1].rawOfferId);
  for (const item of items) {
    assert.equal(item.providerId, "taiga");
    assert.equal(item.currency, "USD");
    assert.equal(item.gpuCount, 8);
    assert.equal(item.checkoutSemantics, "provider_console");
    assert.equal(item.orderable, false);
  }
});
