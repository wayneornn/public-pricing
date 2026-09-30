import assert from "node:assert/strict";
import test from "node:test";
import { digitaloceanSizeToItem } from "../src/connectors/live.js";

function gpuSize(overrides = {}) {
  return {
    slug: "gpu-h100x1-80gb",
    memory: 245760,
    vcpus: 20,
    disk: 500,
    transfer: 10.0,
    price_monthly: 2522.16,
    price_hourly: 3.39,
    regions: [],
    available: true,
    description: "H100 GPU Droplet - 1X",
    gpu_info: {
      count: 1,
      vram: { amount: 80, unit: "gib" },
      model: "nvidia_h100"
    },
    disk_info: [{ type: "local", size: { amount: 500, unit: "gib" } }],
    ...overrides
  };
}

test("digitaloceanSizeToItem maps a GPU size to an orderable item", () => {
  const item = digitaloceanSizeToItem(gpuSize());
  assert.equal(item.providerId, "digitalocean");
  assert.equal(item.gpuModel, "H100");
  assert.equal(item.gpuCount, 1);
  assert.equal(item.vramGbEach, 80);
  assert.equal(item.totalHourlyPrice, 3.39);
  assert.equal(item.availability, "available");
  assert.equal(item.orderable, true);
  assert.equal(item.sourceMode, "live");
  assert.equal(item.checkoutSemantics, "manual_provider");
  assert.match(item.checkoutUrl, /size=gpu-h100x1-80gb/);
  assert.ok(item.rawPayload);
});

test("digitaloceanSizeToItem handles multi-GPU sizes correctly (8x H100)", () => {
  const item = digitaloceanSizeToItem(gpuSize({
    slug: "gpu-h100x8-640gb",
    price_hourly: 23.92,
    gpu_info: { count: 8, vram: { amount: 640, unit: "gib" }, model: "nvidia_h100" }
  }));
  assert.equal(item.gpuCount, 8);
  assert.equal(item.vramGbEach, 80);
  assert.equal(item.totalHourlyPrice, 23.92);
  assert.ok(Math.abs(item.pricePerGpuHour - 2.99) < 0.01);
});

test("digitaloceanSizeToItem maps AMD MI300X model correctly", () => {
  const item = digitaloceanSizeToItem(gpuSize({
    slug: "gpu-mi300x1-192gb",
    price_hourly: 1.99,
    gpu_info: { count: 1, vram: { amount: 192, unit: "gib" }, model: "amd_mi300x" }
  }));
  assert.equal(item.gpuModel, "MI300X");
  assert.equal(item.vramGbEach, 192);
});

test("digitaloceanSizeToItem maps RTX 4000 Ada model correctly", () => {
  const item = digitaloceanSizeToItem(gpuSize({
    slug: "gpu-4000adax1-20gb",
    price_hourly: 0.76,
    gpu_info: { count: 1, vram: { amount: 20, unit: "gib" }, model: "nvidia_rtx4000_ada" }
  }));
  assert.equal(item.gpuModel, "RTX 4000 Ada");
});

test("digitaloceanSizeToItem returns non-orderable item when available=false", () => {
  const item = digitaloceanSizeToItem(gpuSize({ available: false }));
  assert.equal(item.availability, "unavailable");
  assert.equal(item.orderable, false);
});

test("digitaloceanSizeToItem returns null for sizes without gpu_info", () => {
  assert.equal(digitaloceanSizeToItem({ slug: "s-1vcpu-1gb", gpu_info: null }), null);
  assert.equal(digitaloceanSizeToItem({ slug: "s-1vcpu-1gb", gpu_info: { count: 0 } }), null);
});
