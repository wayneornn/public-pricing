import assert from "node:assert/strict";
import test from "node:test";
import { neevcloudInventoryToItems } from "../src/connectors/live/providers/neevcloud.js";

// Mirrors the live NeevCloud Inventory API response (captured 2026-06-14 with a real
// pat-nc-* token): GET api.ai.neevcloud.com/inventory/api/v1beta1/inventory -> { data: [...] }.
const DATA = [
  {
    config_id: "gpu-h100-80g-20cpu-125g", gpu_model: "NVIDIA H100", gpu_vendor: "NVIDIA",
    vram_gib: 80, default_cpu_cores: 20, default_memory_gib: 125, price_per_gpu_per_hour: 1.99,
    region: "as-south-1", min_gpu_count: 1, max_gpu_count: 0, available_gpu_count: 0,
    total_gpu_count: 0, availability: "None", instance_type: "airuntime", type: "GPU"
  },
  {
    config_id: "gpu-rtx5090-32g-16cpu-96g", gpu_model: "NVIDIA GeForce RTX 5090", gpu_vendor: "NVIDIA",
    vram_gib: 32, default_cpu_cores: 16, default_memory_gib: 96, price_per_gpu_per_hour: 0.98,
    region: "as-south-1", min_gpu_count: 1, max_gpu_count: 2, available_gpu_count: 4,
    total_gpu_count: 6, availability: "Low", instance_type: "airuntime", type: "GPU"
  }
];

test("NeevCloud maps inventory rows to per-GPU priced rows with model/VRAM cleaned", () => {
  const items = neevcloudInventoryToItems(DATA);
  assert.equal(items.length, 2);
  const h100 = items.find((i) => i.metadata.gpuModel === "NVIDIA H100");
  assert.equal(h100.gpuLabel, "1x H100 80GB");
  assert.equal(h100.pricePerGpuHour, 1.99);
  assert.equal(h100.region, "as-south-1");
  const rtx = items.find((i) => i.rawOfferId === "gpu-rtx5090-32g-16cpu-96g");
  assert.equal(rtx.gpuLabel, "1x RTX 5090 32GB"); // GeForce prefix dropped
  assert.equal(rtx.pricePerGpuHour, 0.98);
});

test("NeevCloud reflects live availability and stays a non-orderable catalog", () => {
  const items = neevcloudInventoryToItems(DATA);
  const h100 = items.find((i) => i.metadata.gpuModel === "NVIDIA H100");
  assert.equal(h100.availability, "unavailable");
  const rtx = items.find((i) => i.rawOfferId === "gpu-rtx5090-32g-16cpu-96g");
  assert.equal(rtx.availability, "available");
  assert.equal(rtx.availabilityCount, 4);
  for (const item of items) {
    assert.equal(item.providerId, "neevcloud");
    assert.equal(item.currency, "USD");
    assert.equal(item.checkoutSemantics, "provider_console");
    assert.equal(item.orderable, false);
  }
});
