import assert from "node:assert/strict";
import test from "node:test";
import { denvrToItems } from "../src/connectors/live/providers/denvr.js";

const CONFIGURATIONS = {
  items: [
    {
      id: 101,
      user_friendly_name: "A100 80GB SXM 1x",
      name: "A100_80GB_SXM_1x",
      description: "1x A100 80GB SXM",
      storage: 2125,
      gpu_type: "nvidia.com/A100SXM480GB",
      gpu_name: "A100",
      type: "GPU",
      brand_family: "NVIDIA",
      brand: "NVIDIA",
      text_name: "A100 80GB SXM",
      gpus: 1,
      vcpus: 24,
      memory: 116,
      price: 1.35,
      compute_network: "IB 1600G",
      is_gpu_platform: true,
      clusters: ["Hou1"]
    },
    {
      id: 202,
      name: "cpu_8x",
      gpus: 0,
      price: 0.31,
      is_gpu_platform: false,
      clusters: ["Hou1"]
    }
  ]
};

const AVAILABILITY = [
  {
    cluster: "Hou1",
    pool: "on-demand",
    payload: {
      items: [
        {
          configuration: "A100_80GB_SXM_1x",
          cluster: "Hou1",
          rpool: "on-demand",
          price: 1.35,
          available: true,
          count: 3,
          maxCount: 0
        },
        {
          configuration: "cpu_8x",
          cluster: "Hou1",
          rpool: "on-demand",
          price: 0.31,
          available: true,
          count: 10
        }
      ]
    }
  }
];

test("Denvr maps VM configuration availability into priced GPU rows", () => {
  const rows = denvrToItems({ configurations: CONFIGURATIONS, availabilityPayloads: AVAILABILITY });
  assert.equal(rows.length, 1);

  const row = rows[0];
  assert.equal(row.providerId, "denvr");
  assert.equal(row.rawOfferId, "Hou1:on-demand:A100_80GB_SXM_1x");
  assert.equal(row.gpuModel, "A100");
  assert.equal(row.gpuCount, 1);
  assert.equal(row.vramGbEach, 80);
  assert.equal(row.pricePerGpuHour, 1.35);
  assert.equal(row.totalHourlyPrice, 1.35);
  assert.equal(row.cpu, "24 vCPU");
  assert.equal(row.ramGb, 116);
  assert.equal(row.storage, "2125 GB");
  assert.equal(row.networkFabric, "InfiniBand");
  assert.equal(row.availability, "available");
  assert.equal(row.availabilityCount, 3);
});

test("Denvr rows are non-orderable provider-console catalog", () => {
  const rows = denvrToItems({ configurations: CONFIGURATIONS, availabilityPayloads: AVAILABILITY });
  assert.ok(rows.every((row) => row.orderable === false));
  assert.ok(rows.every((row) => row.checkoutSemantics === "provider_console"));
});

test("Denvr treats zero creatable count as unavailable even when the boolean is true", () => {
  const rows = denvrToItems({
    configurations: CONFIGURATIONS,
    availabilityPayloads: [
      {
        cluster: "Hou1",
        pool: "on-demand",
        payload: {
          items: [{ configuration: "A100_80GB_SXM_1x", price: 1.35, available: true, count: 0 }]
        }
      }
    ]
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].availability, "unavailable");
  assert.equal(rows[0].availabilityCount, 0);
});
