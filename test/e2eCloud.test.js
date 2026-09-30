import assert from "node:assert/strict";
import test from "node:test";
import { e2ePlansToItems } from "../src/connectors/live.js";

test("E2E parser emits deduped GPU plans with orderability tied to available_inventory_status", () => {
  const rows = e2ePlansToItems([
    e2ePlan({
      image: "Windows-2022-Windows-GPU",
      os: { name: "Windows", version: "2022", category: "Gpu" },
      available_inventory_status: true
    }),
    e2ePlan({
      image: "Ubuntu-22.04-GPU",
      os: { name: "Ubuntu", version: "22.04", category: "Gpu" },
      available_inventory_status: true
    }),
    e2ePlan({
      name: "GDC-A.A100-1.120GB",
      plan: "GDC-1xA100-Ubuntu-Delhi",
      image: "Ubuntu-22.04-GPU",
      available_inventory_status: false,
      gpu_card_details: {
        CARD_NAME: "NVIDIA-1xA100",
        CARD_TYPE: "Nvidia-A100",
        UNIT_COUNT: 1,
        UNIT_MEMORY: 80
      }
    })
  ]);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].providerId, "e2e-cloud");
  assert.equal(rows[0].gpuModel, "H100");
  assert.equal(rows[0].checkoutSemantics, "manual_provider");
  assert.equal(rows[0].orderable, true);
  assert.match(rows[0].checkoutUrl, /plan=GDC-1xH100-Ubuntu-Delhi/);
  assert.match(rows[0].checkoutUrl, /image=Ubuntu-22\.04-GPU/);
  assert.equal(rows[0].metadata.os.name, "Ubuntu");

  const unavailable = rows.find((row) => row.gpuModel === "A100");
  assert.equal(unavailable.orderable, false);
  assert.match(unavailable.orderabilityReason, /Availability is unavailable/);
});

test("E2E parser extracts GPU identity when card details are absent", () => {
  const rows = e2ePlansToItems([
    e2ePlan({
      name: "GDC3.A10080-16.115GB",
      plan: "GDC3-A10080-Ubuntu-Delhi",
      gpu_card_details: {}
    }),
    e2ePlan({
      name: "GDC.2xA30-32.180GB",
      plan: "GPU-32vCPU-180RAM-1280DISK-GDC.A30GB_Rocky 9-Delhi",
      image: "Rocky-9-GPU",
      os: { name: "Rocky", version: "9", category: "Gpu" },
      gpu_card_details: {}
    })
  ]);

  assert.equal(rows.length, 2);
  const a100 = rows.find((row) => row.gpuModel === "A100");
  assert.equal(a100.gpuCount, 1);
  assert.equal(a100.vramGbEach, 80);
  assert.equal(a100.orderable, true);

  const a30 = rows.find((row) => row.gpuModel === "A30");
  assert.equal(a30.gpuCount, 2);
  assert.equal(a30.orderable, true);
});

test("E2E parser does not infer fabric from generic network bandwidth", () => {
  const rows = e2ePlansToItems([
    e2ePlan({
      network: "100 Gbps",
      network_type: "",
      node_description: ""
    })
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].networkFabric, "Not exposed");
  assert.equal(rows[0].specs.network.fabric, "Not exposed");
});

function e2ePlan(overrides = {}) {
  return {
    name: "GDC-A.H100-1.120GB",
    plan: "GDC-1xH100-Ubuntu-Delhi",
    image: "Ubuntu-22.04-GPU",
    os: { name: "Ubuntu", version: "22.04", image: "Ubuntu-22.04-GPU", category: "Gpu" },
    location: "Delhi",
    specs: {
      id: "1400",
      sku_name: "GDC-A.H100-1.120GB",
      ram: "120.00",
      cpu: 32,
      disk_space: 900,
      price_per_month: 1825,
      price_per_hour: 2.5,
      family: "GPU"
    },
    cpu_type: "vCPU",
    gpu_card_details: {
      CARD_NAME: "NVIDIA-1xH100",
      CARD_TYPE: "Nvidia-H100",
      UNIT_COUNT: 1,
      UNIT_MEMORY: 80
    },
    available_inventory_status: true,
    currency: "USD",
    iops: {
      READ_IOPS_SEC: "54000",
      WRITE_IOPS_SEC: "27000"
    },
    ...overrides
  };
}
