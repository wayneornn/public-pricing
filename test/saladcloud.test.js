import assert from "node:assert/strict";
import test from "node:test";
import { saladGpuClassesToItems } from "../src/connectors/live/providers/saladcloud.js";

// Fixtures mirror real GET /organizations/{org}/gpu-classes items (verified live): name
// carries "<model> (<vram> GB)", prices[] has high/medium/low/batch USD tiers.
function gpuClass(name, high, batch, extra = {}) {
  return {
    id: `id-${name}`,
    gpu_class_type: "community",
    is_high_demand: false,
    name,
    prices: [
      { price: String(high), priority: "high" },
      { price: String(batch), priority: "batch" }
    ],
    ...extra
  };
}

test("Salad parser maps gpu-classes to per-GPU rows using the high-priority USD price", () => {
  const rows = saladGpuClassesToItems([
    gpuClass("RTX 4090 (24 GB)", "0.3", "0.16"),
    gpuClass("RTX 3090 (24 GB)", "0.25", "0.09"),
    // capability bucket with no GPU model -> skipped
    gpuClass("Stable Diffusion Compatible", "0.08", "0.04")
  ]);

  assert.equal(rows.length, 2);
  const r4090 = rows.find((r) => r.gpuModel === "RTX 4090");
  assert.equal(r4090.providerId, "saladcloud");
  assert.equal(r4090.vramGbEach, 24);
  assert.equal(r4090.totalHourlyPrice, 0.3);
  assert.equal(r4090.formFactor, "container");
  assert.equal(r4090.gpuTier, "consumer");
  assert.equal(r4090.orderable, false);
  assert.match(r4090.dataNotes.join(" | "), /high \$0.3\/hr, batch \$0.16\/hr/);
});

test("Salad parser parses VRAM from the name and keeps the full price tier map", () => {
  const rows = saladGpuClassesToItems([gpuClass("RTX 4080 (16 GB)", "0.28", "0.11", {
    prices: [
      { price: "0.28", priority: "high" },
      { price: "0.22", priority: "medium" },
      { price: "0.16", priority: "low" },
      { price: "0.11", priority: "batch" }
    ]
  })]);
  assert.equal(rows[0].vramGbEach, 16);
  assert.deepEqual(rows[0].metadata.pricesByPriority, { high: "0.28", medium: "0.22", low: "0.16", batch: "0.11" });
});

test("Salad parser marks high-demand classes unavailable and skips priceless classes", () => {
  const rows = saladGpuClassesToItems([
    gpuClass("RTX 5090 (32 GB)", "0.45", "0.25", { is_high_demand: true }),
    gpuClass("RTX 3060 (12 GB)", "0", "0") // no usable price -> skipped
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].availability, "unavailable");
});
