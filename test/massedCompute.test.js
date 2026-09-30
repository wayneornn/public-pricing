import assert from "node:assert/strict";
import test from "node:test";
import { massedInventoryToItems } from "../src/connectors/live.js";

test("Massed Compute parser emits orderable region rows from gpu inventory", () => {
  const rows = massedInventoryToItems({
    gpu_inventory: {
      gpu_1x_h100: {
        instance_type: {
          name: "gpu_1x_h100",
          description: "1x H100 (80GB)",
          price_cents_per_hour: 273,
          specs: {
            vcpu_count: 20,
            memory_gib: 128,
            storage_gb: 1250
          }
        },
        regions_with_capacity_available: [
          { name: "us-central-3", description: "Des Moines, IA" }
        ],
        capacity_available: 1
      },
      gpu_2x_h100: {
        instance_type: {
          name: "gpu_2x_h100",
          description: "2x H100 (80GB)",
          price_cents_per_hour: 546,
          specs: {
            vcpu_count: 40,
            memory_gib: 256,
            storage_gb: 2500
          }
        },
        regions_with_capacity_available: [],
        capacity_available: 0
      },
      cpu_small_amd_epyc: {
        instance_type: {
          name: "cpu_small_amd_epyc",
          description: "Small AMD EPYC",
          price_cents_per_hour: 8
        },
        regions_with_capacity_available: [
          { name: "us-central-3", description: "Des Moines, IA" }
        ],
        capacity_available: 4
      }
    }
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].providerId, "massed-compute");
  assert.equal(rows[0].rawOfferId, "gpu_1x_h100:us-central-3");
  assert.equal(rows[0].gpuModel, "H100");
  assert.equal(rows[0].gpuCount, 1);
  assert.equal(rows[0].vramGbEach, 80);
  assert.equal(rows[0].totalHourlyPrice, 2.73);
  assert.equal(rows[0].pricePerGpuHour, 2.73);
  assert.equal(rows[0].cpu, "20 vCPU");
  assert.equal(rows[0].ramGb, 128);
  assert.equal(rows[0].storage, "1250 GB");
  assert.equal(rows[0].availability, "available");
  assert.equal(rows[0].availabilitySemantics, "sku_capacity");
  assert.equal(rows[0].checkoutSemantics, "manual_provider");
  assert.equal(rows[0].orderable, true);
  assert.match(rows[0].checkoutUrl, /productName=gpu_1x_h100/);
  assert.match(rows[0].checkoutUrl, /regionName=us-central-3/);
});

test("Massed Compute high-end multi-GPU rows expose missing fabric clearly", () => {
  const rows = massedInventoryToItems({
    gpu_inventory: {
      gpu_8x_h100_nvl: {
        instance_type: {
          name: "gpu_8x_h100_nvl",
          description: "8x H100 (80GB)",
          price_cents_per_hour: 2184,
          specs: {
            vcpu_count: 160,
            memory_gib: 1024,
            storage_gb: 5000
          }
        },
        regions_with_capacity_available: [
          { name: "us-central-3", description: "Des Moines, IA" }
        ],
        capacity_available: 1
      }
    }
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].gpuCount, 8);
  assert.equal(rows[0].interconnect, "NVLink");
  assert.equal(rows[0].networkFabric, "Not exposed");
  assert.match(rows[0].dataNotes.join(" "), /No IB\/RDMA fabric listed/);
  assert.equal(rows[0].specs.network.fabric, "Not exposed");
});
