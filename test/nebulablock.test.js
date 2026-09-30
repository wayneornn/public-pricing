import assert from "node:assert/strict";
import test from "node:test";
import { nebulablockToItems } from "../src/connectors/live/providers/nebulablock.js";

// Mirrors the live Nebula Block products API (captured 2026-06-14):
// data is keyed by country -> gpu_type -> [products].
const PAYLOAD = {
  status: "success",
  data: {
    CANADA: {
      A100: [
        { id: "a1", product_type: "Virtual Machine", country: "CANADA", region: "North America", price_per_hour: 1.428, cpu: 28, ram: 120, gpu: "A100-80G-PCIe", gpu_type: "A100", gpu_count: 1, disk_size: 100, stock: 99, is_available: true, is_spot: false }
      ],
      H100: [
        { id: "h8", product_type: "Virtual Machine", country: "CANADA", region: "North America", price_per_hour: 16.032, cpu: 200, ram: 1440, gpu: "H100-80G-SXM", gpu_type: "H100", gpu_count: 8, disk_size: 100, stock: 4, is_available: true, is_spot: false },
        { id: "hs", product_type: "Virtual Machine", country: "CANADA", region: "North America", price_per_hour: 0.5, gpu: "H100-80G-PCIe", gpu_type: "H100", gpu_count: 1, stock: 5, is_available: true, is_spot: true }
      ]
    }
  }
};

test("Nebula Block flattens country/gpu map into per-GPU priced rows and drops spot", () => {
  const items = nebulablockToItems(PAYLOAD);
  assert.equal(items.length, 2); // spot H100 dropped
  const a100 = items.find((i) => i.rawOfferId === "a1");
  assert.equal(a100.gpuLabel, "1x A100 80GB PCIe");
  assert.equal(a100.pricePerGpuHour, 1.428);
  assert.equal(a100.availabilityCount, 99);
  const h8 = items.find((i) => i.rawOfferId === "h8");
  assert.equal(h8.gpuCount, 8);
  assert.equal(h8.pricePerGpuHour, 2.004); // 16.032 / 8
  assert.equal(h8.totalHourlyPrice, 16.032);
});

test("Nebula Block rows are a non-orderable USD capacity catalog", () => {
  const items = nebulablockToItems(PAYLOAD);
  for (const item of items) {
    assert.equal(item.providerId, "nebulablock");
    assert.equal(item.currency, "USD");
    assert.equal(item.checkoutSemantics, "provider_console");
    assert.equal(item.orderable, false);
  }
});
