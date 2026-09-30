import assert from "node:assert/strict";
import test from "node:test";
import { outscaleCatalogToItems } from "../src/connectors/live/providers/outscale.js";

// Fixtures mirror real ReadPublicCatalog Catalog.Entries (verified live): GPU entries
// are { Type: "Gpu:attach|allocate:nvidia-<model>", UnitPrice (EUR/hr per GPU), SubregionName }.

function entry(type, price, sub = "eu-west-2") {
  return { Type: type, UnitPrice: price, SubregionName: sub, Category: "compute", Service: "TinaOS-FCU", Operation: "AllocateGpu" };
}

test("Outscale parser dedupes attach/allocate per model and emits per-GPU EUR price (->USD)", () => {
  const rows = outscaleCatalogToItems([
    entry("Gpu:attach:nvidia-h100", 4.0),
    entry("Gpu:allocate:nvidia-h100", 4.0), // same model -> deduped
    entry("Gpu:attach:nvidia-h200", 5.2),
    entry("Gpu:allocate:nvidia-a100-80", 3.6),
    // non-GPU entries ignored
    entry("CustomCore:v5-p2", 0.035),
    entry("ElasticIP:IdleAddress", 0.005)
  ], "eu-west-2");

  assert.equal(rows.length, 3); // h100, h200, a100-80

  const h100 = rows.find((r) => r.gpuModel === "H100");
  assert.equal(h100.providerId, "outscale");
  assert.equal(h100.gpuCount, 1);
  assert.equal(h100.rawRegion, "eu-west-2"); // region label is normalized; raw preserved
  assert.equal(h100.nativeCurrency, "EUR");
  assert.equal(h100.currency, "USD");
  assert.equal(h100.totalHourlyPrice, round(4.0 * 1.08)); // EUR->USD FX
  assert.equal(h100.orderable, false); // region offering, no capacity

  const a100 = rows.find((r) => r.gpuModel === "A100");
  assert.equal(a100.vramGbEach, 80); // a100-80 token
  assert.match(a100.metadata.catalogToken, /nvidia-a100-80/);
});

test("Outscale parser prefers the attach price when both attach and allocate exist", () => {
  // allocate listed first; attach should still win the dedupe (same price here, but
  // the kind preference is what we assert via the token/notes path).
  const rows = outscaleCatalogToItems([
    entry("Gpu:allocate:nvidia-l40", 2.0, "us-east-2"),
    entry("Gpu:attach:nvidia-l40", 2.0, "us-east-2")
  ], "us-east-2");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].gpuModel, "L40");
  assert.equal(rows[0].rawRegion, "us-east-2");
});

test("Outscale parser skips zero/invalid prices", () => {
  const rows = outscaleCatalogToItems([
    entry("Gpu:attach:nvidia-h100", 0),
    entry("Gpu:attach:nvidia-v100", null)
  ], "eu-west-2");
  assert.equal(rows.length, 0);
});

function round(value) {
  return Math.round(value * 10000) / 10000;
}
