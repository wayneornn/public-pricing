import assert from "node:assert/strict";
import test from "node:test";
import { oblivusToItems } from "../src/connectors/live/providers/oblivus.js";

// Fixtures mirror real /v2/cloud/metadata/ and /v2/cloud/stock/list/ responses
// (verified live): metadata.data.gpu.<FLAVOR> carries per-GPU hourlyCost + metaName +
// network + configurations[]; stock.data.gpu.<FLAVOR>.<LOCATION>.virtualservers is the
// deployable count.

const META = {
  H100_PCIE_80GB: {
    metaName: "H100 80GB PCIE",
    hourlyCost: "2.178",
    "1m": "2.1", "12m": "1.9", "36m": "1.7",
    network: "100Gbps",
    configurations: [
      { flavorID: "H100_PCIE_80GB_x1", type: "GPU", vCPU: "28", RAM: "180", rootStorage: "100", ephemeralStorage: "750", GPUAmount: "1" },
      { flavorID: "H100_PCIE_80GB_x8", type: "GPU", vCPU: "252", RAM: "1440", rootStorage: "100", ephemeralStorage: "6500", GPUAmount: "8" }
    ]
  },
  RTX_A6000: {
    metaName: "RTX A6000",
    hourlyCost: "0.55",
    network: "25Gbps",
    configurations: [
      { flavorID: "RTX_A6000_x1", type: "GPU", vCPU: "8", RAM: "60", rootStorage: "100", ephemeralStorage: "500", GPUAmount: "1" }
    ]
  }
};

const STOCK = {
  H100_PCIE_80GB: { MON1: { virtualservers: "46" }, OSL1: { virtualservers: "0" } },
  RTX_A6000: { MON1: { virtualservers: "0" } } // no stock anywhere
};

test("Oblivus parser emits one row per configuration per in-stock location with per-GPU price", () => {
  const rows = oblivusToItems(META, STOCK);

  // H100 PCIE: 2 configs x 1 in-stock location (MON1) = 2 rows; A6000: no stock -> 1 catalog row
  const h100 = rows.filter((r) => r.gpuModel === "H100");
  assert.equal(h100.length, 2);

  const x1 = h100.find((r) => r.gpuCount === 1);
  assert.equal(x1.providerId, "oblivus");
  assert.equal(x1.vramGbEach, 80);
  assert.equal(x1.pricePerGpuHour, 2.178);
  assert.equal(x1.totalHourlyPrice, 2.178);
  assert.equal(x1.region, "MON1");
  assert.equal(x1.availability, "available");
  assert.equal(x1.availabilityCount, 46);
  assert.equal(x1.interconnect, "PCIe");

  const x8 = h100.find((r) => r.gpuCount === 8);
  assert.equal(x8.totalHourlyPrice, round(2.178 * 8));
  assert.match(x8.rawOfferId, /H100_PCIE_80GB_x8:MON1/);
});

test("Oblivus parser surfaces a catalog row (unknown availability) when no location has stock", () => {
  const rows = oblivusToItems(META, STOCK);
  const a6000 = rows.filter((r) => r.gpuModel === "A6000");
  assert.equal(a6000.length, 1);
  assert.equal(a6000[0].region, "Oblivus");
  assert.equal(a6000[0].availability, "unknown");
  assert.equal(a6000[0].availabilityCount, null);
  assert.equal(a6000[0].pricePerGpuHour, 0.55);
});

test("Oblivus rows are a priced catalog, never orderable", () => {
  const rows = oblivusToItems(META, STOCK);
  for (const row of rows) {
    assert.equal(row.orderable, false);
    assert.equal(row.checkoutSemantics, "provider_console");
  }
});

function round(value) {
  return Math.round(value * 10000) / 10000;
}
