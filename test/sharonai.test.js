import assert from "node:assert/strict";
import test from "node:test";
import { sharonaiToItems } from "../src/connectors/live/providers/sharonai.js";

// Real profiles captured live from
//   GET console.compute.sharonai.cloud/apis/paas.envmgmt.io/v1/projects/defaultproject/computeprofiles
// (field names + values verbatim from the response). The non-hourly row is synthetic,
// added only to exercise the time_unit guard.
const PAYLOAD = {
  apiVersion: "paas.envmgmt.io/v1",
  kind: "ComputeProfileList",
  metadata: { count: 4, limit: 50 },
  items: [
    {
      metadata: {
        name: "od-ssd-h100-vm-8",
        displayName: "Ubuntu On-Demand 8 x H100 VM - 1x IPv4",
        id: "019b3b5c-426d-7cf2-a792-4204965a7fdb"
      },
      spec: {
        variables: [
          { name: "Guest CPU Count", value: "112" },
          { name: "Guest Memory Size", value: "720000" },
          { name: "Guest GPU Count", value: "8" }
        ]
      },
      status: {
        globalSettings: {
          billing: { currency: ["AUD"], ratecard: { instance: [{ currency: "AUD", price: 31.49, time_unit: "h" }] } }
        }
      }
    },
    {
      metadata: { name: "od-ssd-l40s-vm-1", displayName: "Ubuntu On-Demand 1 x L40S VM - 1x IPv4" },
      spec: {
        variables: [
          { name: "Guest CPU Count", value: "14" },
          { name: "Guest Memory Size", value: "90000" },
          { name: "Guest GPU Count", value: "1" }
        ]
      },
      status: {
        globalSettings: { billing: { ratecard: { instance: [{ currency: "AUD", price: 1.7, time_unit: "h" }] } } }
      }
    },
    {
      // Developer Pod: no Guest* variables; count + model come from the displayName tuple
      metadata: { name: "od-service-h100-2-devpod", displayName: "On-Demand Developer Pod - 2 x H100 GPU" },
      spec: { variables: [] },
      status: {
        globalSettings: { billing: { ratecard: { instance: [{ currency: "AUD", price: 8.59, time_unit: "h" }] } } }
      }
    },
    {
      // synthetic: a monthly-priced row must be dropped (only hourly instance rates emit)
      metadata: { name: "od-ssd-l40s-monthly", displayName: "1 x L40S monthly" },
      spec: { variables: [] },
      status: {
        globalSettings: { billing: { ratecard: { instance: [{ currency: "AUD", price: 1000, time_unit: "mo" }] } } }
      }
    }
  ]
};

test("Sharon AI emits one row per GPU profile and drops non-hourly rates", () => {
  const rows = sharonaiToItems(PAYLOAD);
  assert.equal(rows.length, 3); // monthly row excluded
  assert.ok(rows.every((r) => r.providerId === "sharon-ai"));
});

test("Sharon AI maps the 8x H100 VM exactly, converting AUD node total to USD", () => {
  const r = sharonaiToItems(PAYLOAD).find((x) => x.rawOfferId === "defaultproject:od-ssd-h100-vm-8");
  const round4 = (n) => Math.round(n * 10000) / 10000;
  assert.equal(r.gpuModel, "H100");
  assert.equal(r.gpuCount, 8);
  assert.equal(r.currency, "USD"); // converted; native AUD kept in metadata + note
  assert.equal(r.metadata.instancePriceAud, 31.49);
  assert.equal(r.cpu, "112 vCPU");
  assert.equal(r.ramGb, 720);
  assert.equal(r.interconnect, "NVLink");
  // 31.49 AUD node total → USD @ 0.66; per-GPU = total / 8
  assert.equal(r.totalHourlyPrice, round4(31.49 * 0.66));
  assert.equal(r.pricePerGpuHour, round4(round4(31.49 / 8) * 0.66));
  assert.ok(r.dataNotes.some((n) => /Converted to USD from AUD/.test(n)));
});

test("Sharon AI derives count+model from displayName when Guest variables are absent (devpod)", () => {
  const r = sharonaiToItems(PAYLOAD).find((x) => /devpod/.test(x.rawOfferId));
  assert.equal(r.gpuModel, "H100");
  assert.equal(r.gpuCount, 2);
  assert.equal(r.formFactor, "container");
});

test("Sharon AI rows are non-orderable catalog", () => {
  const rows = sharonaiToItems(PAYLOAD);
  assert.ok(rows.every((r) => r.orderable === false));
});
