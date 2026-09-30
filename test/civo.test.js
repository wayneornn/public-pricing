import assert from "node:assert/strict";
import test from "node:test";
import { civoSizesToItems } from "../src/connectors/live/providers/civo.js";

// Fixtures mirror real GET /v2/sizes and /v2/regions responses (verified live):
// GPU sizes carry gpu_count + gpu_type (e.g. "nvidia.com/AD102GL_L40S") and NO price;
// regions gate GPU via features.gpu (only lon1/nyc1 in the live account).

const REGIONS = [
  { code: "fra1", country: "de", out_of_capacity: false, features: { gpu: false } },
  { code: "lon1", country: "uk", out_of_capacity: false, features: { gpu: true } },
  { code: "nyc1", country: "us", out_of_capacity: false, features: { gpu: true } }
];

function l40s(name, type, gpuCount, cpu, ramMb, diskGb) {
  return {
    type, name, nice_name: `Nvidia L40S 40GB`, cpu_cores: cpu, gpu_count: gpuCount,
    gpu_type: "nvidia.com/AD102GL_L40S", ram_mb: ramMb, disk_gb: diskGb, transfer_tb: 12, selectable: true
  };
}

test("Civo parser emits one unpriced GPU row per GPU-enabled region", () => {
  const rows = civoSizesToItems([
    l40s("an.g1.l40s.x1", "Instance", 1, 12, 98304, 200),
    // non-GPU size ignored
    { type: "Instance", name: "g4s.medium", nice_name: "Medium", cpu_cores: 2, gpu_count: 0, ram_mb: 4096, disk_gb: 50, selectable: true }
  ], REGIONS);

  assert.equal(rows.length, 2); // lon1 + nyc1, fra1 excluded (gpu:false)
  const lon = rows.find((r) => r.region === "lon1");
  assert.equal(lon.providerId, "civo");
  assert.equal(lon.gpuModel, "L40S");
  assert.equal(lon.gpuCount, 1);
  assert.equal(lon.vramGbEach, 40);
  assert.equal(lon.country, "UK");
  assert.equal(lon.priceSemantics, "unpriced");
  assert.equal(lon.totalHourlyPrice, null);
  assert.equal(lon.orderable, false); // unpriced → never orderable
  assert.match(lon.checkoutUrl, /size=an\.g1\.l40s\.x1&region=lon1/);
  assert.ok(rows.find((r) => r.region === "nyc1"));
  assert.ok(!rows.find((r) => r.region === "fra1"));
});

test("Civo parser scales gpu_count and marks Kubernetes node sizes as containers", () => {
  const rows = civoSizesToItems([
    l40s("an.g1.l40s.x8", "Instance", 8, 96, 786432, 1600),
    l40s("an.g1.l40s.kube.x2", "Kubernetes", 2, 24, 196608, 400)
  ], [REGIONS[1]]); // lon1 only

  const big = rows.find((r) => r.rawOfferId.startsWith("an.g1.l40s.x8"));
  assert.equal(big.gpuCount, 8);
  assert.equal(big.formFactor, "vm");
  assert.equal(big.interconnect, "NVLink");

  const kube = rows.find((r) => /kube/.test(r.rawOfferId));
  assert.equal(kube.formFactor, "container");
  assert.match(kube.checkoutUrl, /kubernetes\/new/);
});

test("Civo parser still surfaces the SKU when no region advertises GPU", () => {
  const rows = civoSizesToItems(
    [l40s("an.g1.l40s.x1", "Instance", 1, 12, 98304, 200)],
    [REGIONS[0]] // fra1 gpu:false → no GPU regions
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].region, "Civo");
  assert.equal(rows[0].availability, "unknown");
});
