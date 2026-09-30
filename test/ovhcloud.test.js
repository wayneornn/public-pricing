import assert from "node:assert/strict";
import test from "node:test";
import {
  ovhCatalogPriceMap,
  ovhGpuSpec,
  ovhFlavorToItem,
  ovhDedupeItems
} from "../src/connectors/live.js";

const CATALOG = {
  locale: { currencyCode: "USD" },
  addons: [
    consumptionAddon("l4-90.consumption", 1.0),
    monthlyAddon("l4-90.monthly", 730),
    consumptionAddon("l40s-90.consumption", 1.8),
    consumptionAddon("t2-45.consumption", 0.88),
    // Monthly-only flavor: published monthly price, no consumption addon.
    monthlyAddon("a10-45.monthly", 1460)
  ]
};

test("ovhCatalogPriceMap reads hourly from .consumption (intervalUnit none) and monthly from .monthly", () => {
  const map = ovhCatalogPriceMap(CATALOG);
  assert.equal(map.get("l4-90").hourly, 1.0);
  assert.equal(map.get("l4-90").monthly, 730);
  assert.equal(map.get("l40s-90").hourly, 1.8);
  assert.equal(map.get("t2-45").hourly, 0.88);
  assert.equal(map.get("a10-45").hourly, null);
  assert.equal(map.get("a10-45").monthly, 1460);
});

test("ovhGpuSpec derives GPU model + count from flavor name (total RAM ÷ RAM-per-GPU)", () => {
  assert.deepEqual(ovhGpuSpec("l4-90"), { family: "l4", model: "NVIDIA L4", gpuCount: 1, vramGbEach: 24, totalRamGb: 90 });
  assert.equal(ovhGpuSpec("l40s-180").gpuCount, 2);
  assert.equal(ovhGpuSpec("t2-le-45").model, "NVIDIA V100S");
  assert.equal(ovhGpuSpec("win-l4-90").model, "NVIDIA L4");
  assert.equal(ovhGpuSpec("b2-15"), null);
});

test("ovhFlavorToItem makes hourly-priced available flavors orderable with a recognized model", () => {
  const map = ovhCatalogPriceMap(CATALOG);
  const item = ovhFlavorToItem(
    flavor({ name: "t2-45", planCodes: { hourly: "t2-45.consumption" }, available: true }),
    { region: "US-WEST-OR-1", priceMap: map, currency: "USD", projectId: "proj", env: {} }
  );
  assert.equal(item.providerId, "ovhcloud");
  assert.equal(item.gpuModel, "V100S");
  assert.equal(item.gpuCount, 1);
  assert.equal(item.totalHourlyPrice, 0.88);
  assert.equal(item.orderable, true);
  assert.equal(item.checkoutSemantics, "manual_provider");
});

test("ovhFlavorToItem skips Windows variants and non-GPU flavors", () => {
  const map = ovhCatalogPriceMap(CATALOG);
  const ctx = { region: "US-WEST-OR-1", priceMap: map, currency: "USD", projectId: "proj", env: {} };
  assert.equal(ovhFlavorToItem(flavor({ name: "win-l4-90", available: true }), ctx), null);
  assert.equal(ovhFlavorToItem(flavor({ name: "l4-90", osType: "windows", available: true }), ctx), null);
  assert.equal(ovhFlavorToItem(flavor({ name: "b2-15", available: true }), ctx), null);
});

test("ovhFlavorToItem keeps monthly-only flavors non-orderable unless explicitly opted in", () => {
  const map = ovhCatalogPriceMap(CATALOG);
  const ctx = { region: "US-WEST-OR-1", priceMap: map, currency: "USD", projectId: "proj" };
  const f = flavor({ name: "a10-45", planCodes: { monthly: "a10-45.monthly" }, available: true });

  const gated = ovhFlavorToItem(f, { ...ctx, env: {} });
  assert.equal(gated.orderable, false);
  assert.equal(gated.minTerm, "1 month");
  assert.match(gated.dataNotes.join(" "), /Billed monthly/);

  const optedIn = ovhFlavorToItem(f, { ...ctx, env: { OVH_ALLOW_MONTHLY_DERIVED: "1" } });
  assert.equal(optedIn.orderable, true);
});

test("ovhFlavorToItem leaves unavailable flavors non-orderable", () => {
  const map = ovhCatalogPriceMap(CATALOG);
  const item = ovhFlavorToItem(
    flavor({ name: "t2-45", planCodes: { hourly: "t2-45.consumption" }, available: false }),
    { region: "US-EAST-VA-1", priceMap: map, currency: "USD", projectId: "proj", env: {} }
  );
  assert.equal(item.availability, "unavailable");
  assert.equal(item.orderable, false);
});

test("ovhDedupeItems collapses same-hardware billing variants (t2 vs t2-le), keeping the orderable one", () => {
  const map = ovhCatalogPriceMap(CATALOG);
  const ctx = { region: "US-WEST-OR-1", priceMap: map, currency: "USD", projectId: "proj", env: {} };
  const t2 = ovhFlavorToItem(flavor({ name: "t2-45", planCodes: { hourly: "t2-45.consumption" }, available: false }), ctx);
  const t2le = ovhFlavorToItem(flavor({ name: "t2-le-45", planCodes: { hourly: "t2-45.consumption" }, available: true }), ctx);
  const deduped = ovhDedupeItems([t2, t2le]);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].orderable, true);
});

function consumptionAddon(planCode, hourly) {
  return {
    planCode,
    pricings: [{ price: Math.round(hourly * 1e8), intervalUnit: "none", capacities: ["consumption"] }]
  };
}

function monthlyAddon(planCode, monthly) {
  return {
    planCode,
    pricings: [{ price: Math.round(monthly * 1e8), intervalUnit: "month", capacities: ["renew"] }]
  };
}

function flavor(overrides = {}) {
  return {
    id: "flv-" + (overrides.name || "x"),
    name: "t2-45",
    region: "US-WEST-OR-1",
    vcpus: 14,
    ram: 45,
    type: "gpu",
    available: true,
    ...overrides
  };
}
