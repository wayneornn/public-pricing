import assert from "node:assert/strict";
import test from "node:test";
import { novitaProductsToItems } from "../src/connectors/live/providers/novita.js";

// Fixtures mirror real GET /gpu-instance/openapi/v1/products objects (verified live):
// price is 1e-5 USD/hr ("67000" = $0.67), availableDeploy + inventoryState are the
// capacity signal, regions lists locations.

function product(overrides = {}) {
  return {
    id: "4090.16c62g",
    name: "RTX 4090 24GB",
    cpuPerGpu: 16,
    memoryPerGpu: 62,
    diskPerGpu: 6144,
    availableDeploy: true,
    price: "35000",
    spotPrice: "17500",
    regions: ["US-CA-06 (California)", "EU-GB-01 (United Kingdom)"],
    billingMethods: ["onDemand", "spot", "monthly"],
    inventoryState: "normal",
    canBuy: true,
    ...overrides
  };
}

test("Novita parser converts 1e-5 USD price units to hourly USD and parses VRAM", () => {
  const rows = novitaProductsToItems([
    product({ id: "26", name: "RTX 4090 24GB", price: "67000", availableDeploy: false, inventoryState: "none", regions: ["US-01 (Dallas)"] }),
    product({ id: "A100-80GB.14c240g", name: "A100 SXM 80GB", price: "160000", availableDeploy: true, inventoryState: "high", regions: ["US-CA-06 (California)"] })
  ]);

  assert.equal(rows.length, 2);
  const a100 = rows.find((r) => r.gpuModel === "A100");
  assert.equal(a100.providerId, "novita");
  assert.equal(a100.totalHourlyPrice, 1.6);
  assert.equal(a100.pricePerGpuHour, 1.6);
  assert.equal(a100.vramGbEach, 80);
  assert.equal(a100.availability, "available");

  const rtx = rows.find((r) => r.rawOfferId === "26");
  assert.equal(rtx.totalHourlyPrice, 0.67);
  assert.equal(rtx.availability, "unavailable"); // availableDeploy false / inventory none
});

test("Novita parser never emits a spot price and is not marked orderable", () => {
  const rows = novitaProductsToItems([product({ price: "35000", spotPrice: "17500" })]);
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.totalHourlyPrice, 0.35); // on-demand, not the 0.175 spot
  assert.equal(row.nativePricePerGpuHour ?? row.pricePerGpuHour, 0.35);
  // provider_console catalog → never orderable, regardless of price/availability
  assert.equal(row.orderable, false);
  assert.equal(row.checkoutSemantics, "provider_console");
});

test("Novita parser skips products with no usable on-demand price", () => {
  const rows = novitaProductsToItems([product({ price: "0" }), product({ price: null })]);
  assert.equal(rows.length, 0);
});

test("Novita parser uses first region and lists the rest in data notes", () => {
  const rows = novitaProductsToItems([product({ regions: ["US-CA-06 (California)", "EU-GB-01 (United Kingdom)", "AS-IN-01 (India)"] })]);
  // region is normalized to a canonical label; the raw value is preserved in rawRegion.
  assert.equal(rows[0].rawRegion, "US-CA-06 (California)");
  assert.match(rows[0].dataNotes.join(" | "), /Also in: EU-GB-01 \(United Kingdom\), AS-IN-01 \(India\)/);
});
