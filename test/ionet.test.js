import assert from "node:assert/strict";
import test from "node:test";
import { ionetToItems } from "../src/connectors/live/providers/ionet.js";

// Captured verbatim from the live io.net IO Cloud public API on 2026-06-13:
//   GET https://api.io.solutions/v1/io-cloud/vmaas/hardware  (specs + price, no auth)
//   GET https://api.io.solutions/v1/io-cloud/caas/hardware   (brand_name + available_replicas)
// `price` is the whole-config hourly USD rate; per-GPU = price / num_cards.
const VMAAS = {
  data: {
    hardware: [
      { id: "8H100.80S.176V__FI", deploy_id: "8H100.80S.176V", name: "H100", num_cards: 8, supplier: "external", sold_out: false, price: 27.875342465753423, vram_per_card: 80, interconnect: "sxm5", nvlink: true, storage: 2000, vcpu: 176, memory: 1480, location: "FI" },
      { id: "8B300.240V__FI", deploy_id: "8B300.240V", name: "B300", num_cards: 8, supplier: "external", sold_out: true, price: 63.86301369863014, vram_per_card: 288, interconnect: "sxm6", nvlink: true, storage: 3000, vcpu: 240, memory: 2040, location: "FI" },
      { id: "1CPU__US", deploy_id: "1CPU", name: "", num_cards: 0, supplier: "external", sold_out: false, price: 0.1, vram_per_card: 0, location: "US" },
      { id: "1L40S.0V__US", deploy_id: "1L40S", name: "L40S", num_cards: 1, supplier: "external", sold_out: false, price: 0, vram_per_card: 48, location: "US" }
    ]
  }
};

const CAAS = {
  data: {
    hardware: [
      { id: "8H100.80S.176V__FI", name: "H100", brand_name: "NVIDIA", num_cards: 8, available_replicas: 3, sold_out: false, price: 27.875342465753423, location: "FI", vram_per_card: 80 },
      { id: "8B300.240V__FI", name: "B300", brand_name: "NVIDIA", num_cards: 8, available_replicas: 0, sold_out: true, price: 63.86301369863014, location: "FI", vram_per_card: 288 }
    ]
  }
};

test("io.net maps priced VM hardware into per-GPU capacity rows", () => {
  const items = ionetToItems({ vmaas: VMAAS, caas: CAAS });
  const h100 = items.find((i) => i.rawOfferId === "8H100.80S.176V__FI");
  assert.ok(h100, "H100 row present");
  assert.equal(h100.gpuCount, 8);
  assert.equal(h100.totalHourlyPrice, 27.8753); // rounded to 4dp by createInventoryItem
  // per-GPU = 27.8753.../8 = 3.4844
  assert.equal(h100.pricePerGpuHour, 3.4844);
  assert.equal(h100.vramGbEach, 80);
  assert.equal(h100.region, "FI");
  assert.equal(h100.availabilityCount, 3);
  assert.equal(h100.availability, "available");
  assert.equal(h100.networkFabric, "NVLink");
});

test("io.net marks sold-out / zero-replica configs unavailable", () => {
  const items = ionetToItems({ vmaas: VMAAS, caas: CAAS });
  const b300 = items.find((i) => i.rawOfferId === "8B300.240V__FI");
  assert.ok(b300);
  assert.equal(b300.availability, "unavailable");
  assert.equal(b300.availabilityCount, 0);
});

test("io.net skips CPU-only and unpriced configs", () => {
  const items = ionetToItems({ vmaas: VMAAS, caas: CAAS });
  assert.ok(!items.some((i) => i.rawOfferId === "1CPU__US"), "CPU-only dropped");
  assert.ok(!items.some((i) => i.rawOfferId === "1L40S.0V__US"), "zero-price dropped");
});

test("io.net falls back to sold_out when caas replica data is missing", () => {
  const items = ionetToItems({ vmaas: VMAAS, caas: null });
  const h100 = items.find((i) => i.rawOfferId === "8H100.80S.176V__FI");
  assert.equal(h100.availabilityCount, null);
  assert.equal(h100.availability, "unknown");
});

test("io.net rows are non-orderable priced catalog (provider_console)", () => {
  const items = ionetToItems({ vmaas: VMAAS, caas: CAAS });
  assert.ok(items.length > 0);
  for (const item of items) {
    assert.equal(item.providerId, "ionet");
    assert.equal(item.checkoutSemantics, "provider_console");
    assert.equal(item.currency, "USD");
  }
});
