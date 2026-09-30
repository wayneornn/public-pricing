import assert from "node:assert/strict";
import test from "node:test";
import { core42HtmlToItems, extractCore42Cards } from "../src/connectors/live/providers/core42.js";

// Mirrors the live Core42 AI Cloud product page cards (captured 2026-06-13): a model title
// then a "Price: From $X/hr" sub-title. Some SKUs are "On Request" (unpriced) and dropped.
const HTML = `
<div class="slide-right-inner">
  <div class="slide-right-title"><h5>NVIDIA H100</h5></div>
  <div class="slide-sub-title"><h6>Price: From $2.50/hr </h6></div>
</div>
<div class="slide-right-inner">
  <div class="slide-right-title"><h5>AMD MI300X</h5></div>
  <div class="slide-sub-title"><h6>Price: FROM $3.50/HR</h6></div>
</div>
<div class="slide-right-inner">
  <div class="slide-right-title"><h5>NVIDIA GB300</h5></div>
  <div class="slide-sub-title"><h6>On Request</h6></div>
</div>
`;

test("Core42 parses From $X/hr cards into per-GPU starting-floor rows", () => {
  const items = core42HtmlToItems(HTML);
  const h100 = items.find((i) => i.metadata.gpuModel === "NVIDIA H100");
  assert.ok(h100);
  assert.equal(h100.gpuCount, 1);
  assert.equal(h100.pricePerGpuHour, 2.5);
  assert.equal(h100.metadata.priceQualifier, "from");
});

test("Core42 handles the AMD title and upper-case FROM/HR", () => {
  const items = core42HtmlToItems(HTML);
  const mi300x = items.find((i) => i.metadata.gpuModel === "AMD MI300X");
  assert.ok(mi300x);
  assert.equal(mi300x.pricePerGpuHour, 3.5);
});

test("Core42 skips On Request (unpriced) cards", () => {
  const cards = extractCore42Cards(HTML);
  assert.equal(cards.length, 2);
  assert.ok(!cards.some((c) => c.gpuModel.includes("GB300")));
});

test("Core42 rows are non-orderable USD price catalog", () => {
  const items = core42HtmlToItems(HTML);
  assert.equal(items.length, 2);
  for (const item of items) {
    assert.equal(item.providerId, "core42");
    assert.equal(item.currency, "USD");
    assert.equal(item.checkoutSemantics, "provider_console");
  }
});
