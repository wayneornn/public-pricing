import assert from "node:assert/strict";
import test from "node:test";
import { digitalOceanSizeToItems, isDigitalOceanGpuSize, parseDigitalOceanGpu } from "../src/providers/digitalocean.js";

test("DigitalOcean parser extracts GPU specs and keeps size catalog non-orderable", () => {
  const size = {
    slug: "gpu-h100x1-240gb",
    description: "GPU Droplet 1x NVIDIA H100",
    memory: 245760,
    vcpus: 20,
    disk: 720,
    price_hourly: 3.39,
    regions: ["nyc2"],
    gpu_info: {
      count: 1,
      model: "nvidia_h100",
      vram: { amount: 80, unit: "gib" }
    },
    disk_info: [
      { type: "local", size: { amount: 720, unit: "gib" } },
      { type: "scratch", size: { amount: 400, unit: "gib" } }
    ]
  };
  const regions = [
    { slug: "nyc2", name: "New York 2", available: true }
  ];

  assert.equal(isDigitalOceanGpuSize(size), true);
  assert.deepEqual(parseDigitalOceanGpu(size), {
    count: 1,
    model: "H100",
    vramGbEach: 80,
    interconnect: ""
  });

  const rows = digitalOceanSizeToItems(size, regions);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].providerId, "digitalocean");
  assert.equal(rows[0].gpuModel, "H100");
  assert.equal(rows[0].gpuCount, 1);
  assert.equal(rows[0].vramGbEach, 80);
  assert.equal(rows[0].totalHourlyPrice, 3.39);
  assert.equal(rows[0].ramGb, 240);
  assert.equal(rows[0].availabilitySemantics, "region_offering");
  assert.equal(rows[0].checkoutSemantics, "provider_console");
  assert.equal(rows[0].orderable, false);
  assert.match(rows[0].orderabilityReason, /Availability truth is region_offering/);
});
