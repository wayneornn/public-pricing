import assert from "node:assert/strict";
import test from "node:test";
import { exabitsToItems } from "../src/connectors/live/providers/exabits.js";

// The RTX4090/DALLAS product is the official example response from the Exabits docs
// (GET /api/v1/flavors). The H100 multi-GPU and the "-spot" product are synthetic rows
// added only to exercise the per-GPU→node-total math and spot filtering — their numbers
// are not real Exabits prices. Field names mirror the documented schema exactly.
const PAYLOAD = {
  status: true,
  message: "Getting flavors successful",
  data: [
    {
      region: "DALLAS",
      products: [
        {
          id: "66b9c8fd557590e4e474a298",
          name: "1 x RTX4090",
          region_name: "DALLAS",
          price: 0.56,
          cpu: 16,
          disk: 250,
          ram: 32,
          gpu: "RTX4090",
          gpu_count: 1,
          bandwidth: "100 Mbps",
          cycle: "hourly",
          stock_available: true
        },
        {
          id: "spot-row",
          name: "1 x RTX4090 (spot)",
          region_name: "DALLAS",
          price: 0.3,
          cpu: 16,
          ram: 32,
          gpu: "RTX4090-spot", // -spot suffix => spot instance, must be dropped
          gpu_count: 1,
          stock_available: true
        }
      ]
    },
    {
      region: "VIRGINIA",
      products: [
        {
          id: "h100-8x",
          name: "8 x H100",
          region_name: "VIRGINIA",
          region_id: "va-1",
          price: 2.5, // per-GPU/hr per docs
          cpu: 192,
          disk: 1000,
          ram: 1024,
          gpu: "H100",
          gpu_count: 8,
          stock_available: false
        }
      ]
    }
  ]
};

test("Exabits flattens region groups and drops spot flavors", () => {
  const rows = exabitsToItems(PAYLOAD);
  assert.equal(rows.length, 2); // RTX4090-spot excluded
  assert.ok(rows.every((r) => r.providerId === "exabits"));
  assert.ok(!rows.some((r) => /spot/i.test(r.gpuLabel)));
});

test("Exabits maps the documented RTX4090 example exactly", () => {
  const r = exabitsToItems(PAYLOAD).find((x) => x.rawOfferId === "66b9c8fd557590e4e474a298");
  assert.equal(r.gpuModel, "RTX 4090"); // normalized from "RTX4090"
  assert.equal(r.gpuCount, 1);
  assert.equal(r.pricePerGpuHour, 0.56);
  assert.equal(r.totalHourlyPrice, 0.56);
  assert.equal(r.currency, "USD");
  assert.equal(r.cpu, "16 vCPU");
  assert.equal(r.ramGb, 32);
  assert.equal(r.storage, "250 GB");
  assert.equal(r.region, "DALLAS");
  assert.equal(r.availability, "available");
});

test("Exabits treats price as per-GPU and computes node total for multi-GPU", () => {
  const h100 = exabitsToItems(PAYLOAD).find((x) => x.gpuModel === "H100");
  assert.equal(h100.gpuCount, 8);
  assert.equal(h100.pricePerGpuHour, 2.5);
  assert.equal(h100.totalHourlyPrice, 20); // 2.5 × 8
  assert.equal(h100.interconnect, "NVLink");
  assert.equal(h100.availability, "unavailable"); // stock_available: false
});

test("Exabits rows are non-orderable catalog", () => {
  const rows = exabitsToItems(PAYLOAD);
  assert.ok(rows.every((r) => r.orderable === false));
});
