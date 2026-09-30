import assert from "node:assert/strict";
import test from "node:test";
import { thundercomputeToItems } from "../src/connectors/live/providers/thundercompute.js";

// Fixtures mirror the real public GET /v1/pricing and /v1/specs responses (verified
// live): SKU keys are "<gpu>_x<count>_<mode>" and join across both maps; non-SKU keys
// (disk_gb, additional_vcpus, bare aliases) must be ignored.

const PRICING = {
  h100_x1_production: 2.49,
  h100_x1_prototyping: 1.38,
  h100_x8_production: 19.92,
  l40s_x1_production: 1.49, // present in pricing but NOT in specs
  a100xl: 0.78,             // bare alias -> ignored
  disk_gb: 0.0005,          // non-GPU -> ignored
  additional_vcpus: 0.06    // non-GPU -> ignored
};

const SPECS = {
  h100_x1_production: { displayName: "NVIDIA H100", vramGB: 80, gpuCount: 1, mode: "production", vcpuOptions: [15], ramPerVCPUGiB: 8, storageGB: { min: 100, max: 300 } },
  h100_x1_prototyping: { displayName: "NVIDIA H100", vramGB: 80, gpuCount: 1, mode: "prototyping", vcpuOptions: [4, 8, 12], ramPerVCPUGiB: 8 },
  h100_x8_production: { displayName: "NVIDIA H100", vramGB: 80, gpuCount: 8, mode: "production", vcpuOptions: [120], ramPerVCPUGiB: 8 }
};

test("Thunder joins pricing+specs into priced SKU rows and ignores non-GPU keys", () => {
  const rows = thundercomputeToItems(PRICING, SPECS);
  // h100 x1 prod, h100 x1 proto, h100 x8 prod, l40s x1 prod = 4 (bare/disk/vcpu ignored)
  assert.equal(rows.length, 4);

  const h1 = rows.find((r) => r.rawOfferId === "h100_x1_production");
  assert.equal(h1.providerId, "thunder-compute");
  assert.equal(h1.gpuModel, "H100");
  assert.equal(h1.gpuCount, 1);
  assert.equal(h1.vramGbEach, 80);
  assert.equal(h1.totalHourlyPrice, 2.49);
  assert.equal(h1.pricePerGpuHour, 2.49);
  assert.equal(h1.orderable, false); // catalog, no capacity
  assert.match(h1.dataNotes.join(" | "), /production mode/i);
});

test("Thunder computes per-GPU price for multi-GPU SKUs", () => {
  const rows = thundercomputeToItems(PRICING, SPECS);
  const x8 = rows.find((r) => r.rawOfferId === "h100_x8_production");
  assert.equal(x8.gpuCount, 8);
  assert.equal(x8.totalHourlyPrice, 19.92);
  assert.equal(x8.pricePerGpuHour, round(19.92 / 8));
  assert.equal(x8.interconnect, "NVLink");
});

test("Thunder derives model/VRAM from the SKU key when specs are missing", () => {
  const rows = thundercomputeToItems(PRICING, SPECS);
  const l40s = rows.find((r) => r.rawOfferId === "l40s_x1_production");
  assert.ok(l40s, "expected the specs-less l40s SKU to still be priced");
  assert.equal(l40s.gpuModel, "L40S");
  assert.equal(l40s.vramGbEach, 48);
  assert.equal(l40s.totalHourlyPrice, 1.49);
});

test("Thunder distinguishes prototyping vs production", () => {
  const rows = thundercomputeToItems(PRICING, SPECS);
  const proto = rows.find((r) => r.rawOfferId === "h100_x1_prototyping");
  assert.equal(proto.totalHourlyPrice, 1.38);
  assert.match(proto.dataNotes.join(" | "), /prototyping/i);
});

function round(value) {
  return Math.round(value * 10000) / 10000;
}
