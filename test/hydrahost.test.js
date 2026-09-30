import assert from "node:assert/strict";
import test from "node:test";
import { hydraCategoriesToItems } from "../src/connectors/live/providers/hydrahost.js";

// Fixtures mirror the real public Brokkr endpoints (verified live):
//   category-prices: { category, startPrice (USD) }
//   category-availability: { category, onDemandCount, reserveCount, preorderCount }
const PRICES = [
  { category: "nvidia h100 nvl", startPrice: 1.55 },
  { category: "nvidia a100 80gb pcie", startPrice: 0.5 },
  { category: "nvidia geforce rtx 4090", startPrice: 0.3 },
  { category: "nvidia b200", startPrice: 3 },
  { category: "broken", startPrice: 0 } // skipped
];
const AVAIL = [
  { category: "nvidia h100 nvl", onDemandCount: 96, reserveCount: 58, preorderCount: 5 },
  { category: "nvidia a100 80gb pcie", onDemandCount: 0, reserveCount: 1, preorderCount: 0 },
  { category: "nvidia geforce rtx 4090", onDemandCount: 1, reserveCount: 65, preorderCount: 1 },
  { category: "nvidia b200", onDemandCount: 0, reserveCount: 108, preorderCount: 0 }
];

test("Hydra joins category prices+availability into per-GPU rows", () => {
  const rows = hydraCategoriesToItems(PRICES, AVAIL);
  assert.equal(rows.length, 4); // zero-price "broken" skipped

  const h100 = rows.find((r) => r.gpuModel === "H100");
  assert.equal(h100.providerId, "hydra-host");
  assert.equal(h100.totalHourlyPrice, 1.55);
  assert.equal(h100.formFactor, "bare_metal");
  assert.equal(h100.interconnect, "NVLink"); // nvl
  assert.equal(h100.availability, "available");
  assert.equal(h100.availabilityCount, 96);
  assert.equal(h100.orderable, false); // catalog from-price
  assert.match(h100.dataNotes.join(" | "), /On-demand: 96, reserve: 58, preorder: 5/);

  const a100 = rows.find((r) => r.gpuModel === "A100");
  assert.equal(a100.vramGbEach, 80); // parsed from "80gb"
  assert.equal(a100.availability, "unavailable"); // onDemand 0
});

test("Hydra parses model and VRAM from category strings", () => {
  const rows = hydraCategoriesToItems(
    [{ category: "nvidia rtx pro 6000 blackwell server edition", startPrice: 0.55 }],
    [{ category: "nvidia rtx pro 6000 blackwell server edition", onDemandCount: 2 }]
  );
  assert.equal(rows[0].gpuModel, "RTX PRO 6000");
  assert.equal(rows[0].availabilityCount, 2);
});

test("Hydra tolerates a category with no availability entry", () => {
  const rows = hydraCategoriesToItems([{ category: "nvidia h200", startPrice: 1.5 }], []);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].gpuModel, "H200");
  assert.equal(rows[0].availability, "unavailable");
  assert.equal(rows[0].availabilityCount, 0);
});
