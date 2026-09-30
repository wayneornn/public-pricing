import assert from "node:assert/strict";
import test from "node:test";
import { mithrilSpotAvailabilityToItems } from "../src/providers/mithril.js";
import { validateCheckoutTruthItem } from "../src/core/checkoutTruth.js";

test("Mithril spot parser emits non-orderable spot capacity rows", () => {
  const rows = mithrilSpotAvailabilityToItems([
    {
      fid: "auc_123",
      instance_type: "it_h100_8x",
      region: "us-central1-a",
      capacity: 3,
      last_instance_price: "$20.00",
      lowest_allocated_price: "$21.00",
      adjustable_memory: true,
      default_image_version: "imgver_123"
    },
    {
      fid: "auc_empty",
      instance_type: "it_h100_8x",
      region: "us-central1-a",
      capacity: 0,
      last_instance_price: "$20.00"
    }
  ], [
    {
      fid: "it_h100_8x",
      name: "h100.80gb.sxm",
      num_cpus: 192,
      ram_gb: 1800,
      num_gpus: 8,
      gpu_type: "H100",
      gpu_memory_gb: 80,
      gpu_socket: "SXM5",
      local_storage_gb: 7800,
      network_type: "InfiniBand",
      ib_count: 8,
      bridge_count: 4
    }
  ], [
    { fid: "proj_123", name: "Broker project" }
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].providerId, "mithril");
  assert.equal(rows[0].gpuModel, "H100");
  assert.equal(rows[0].gpuCount, 8);
  assert.equal(rows[0].vramGbEach, 80);
  assert.equal(rows[0].totalHourlyPrice, 20);
  assert.equal(rows[0].pricePerGpuHour, 2.5);
  assert.equal(rows[0].networkFabric, "InfiniBand");
  assert.equal(rows[0].availabilityCount, 3);
  assert.equal(rows[0].availabilitySemantics, "sku_capacity");
  assert.equal(rows[0].checkoutSemantics, "provider_console");
  assert.equal(rows[0].orderable, false);
  assert.match(rows[0].orderabilityReason, /Provider adapter marked this row non-orderable/);

  const validation = validateCheckoutTruthItem(rows[0]);
  assert.deepEqual(validation.failures, []);
});
