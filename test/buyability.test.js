import assert from "node:assert/strict";
import test from "node:test";
import { revalidateBuyableCheckout } from "../src/core/buyability.js";
import { createInventoryItem } from "../src/core/inventory.js";

test("buyability revalidation passes for a fresh matching orderable provider row", () => {
  const snapshot = runpodItem({ price: 3.25 });
  const fresh = runpodItem({ price: 3.25 });

  const result = revalidateBuyableCheckout({ requestedItem: snapshot, freshRows: [fresh] });

  assert.equal(result.ok, true);
  assert.equal(result.status, "buyable");
  assert.equal(result.item.id, snapshot.id);
});

test("buyability revalidation blocks offers missing from the live provider response", () => {
  const result = revalidateBuyableCheckout({
    requestedItem: runpodItem({ price: 3.25 }),
    freshRows: []
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "not_found_live");
});

test("buyability revalidation blocks rows that only open a generic provider console", () => {
  const snapshot = createInventoryItem({
    provider: "Lambda",
    providerId: "lambda",
    rawOfferId: "gpu_1x_h100_sxm5:us-west-1",
    gpuLabel: "1x H100 SXM 80GB",
    gpuCount: 1,
    totalHourlyPrice: 2.49,
    availability: "available",
    availabilitySemantics: "sku_capacity",
    region: "us-west-1",
    listingType: "instance_type",
    priceScope: "node_total",
    checkoutSemantics: "manual_provider",
    checkoutUrl: "https://cloud.lambda.ai/instances",
    sourceMode: "live",
    rawPayload: {
      price_cents_per_hour: 249,
      regions_with_capacity_available: [{ name: "us-west-1" }]
    }
  });

  const result = revalidateBuyableCheckout({ requestedItem: snapshot, freshRows: [snapshot] });

  assert.equal(result.ok, false);
  assert.equal(result.status, "snapshot_truth_failed");
  assert.match(result.failures.join("\n"), /checkoutUrl missing instance_type/);
});

test("buyability revalidation blocks repriced rows beyond tolerance", () => {
  const result = revalidateBuyableCheckout({
    requestedItem: runpodItem({ price: 3.25 }),
    freshRows: [runpodItem({ price: 3.75 })],
    priceTolerancePct: 0.01,
    priceToleranceUsd: 0.01
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "price_changed");
  assert.equal(result.priceComparison.changed, true);
});

function runpodItem({ price }) {
  return createInventoryItem({
    provider: "Runpod",
    providerId: "runpod",
    rawOfferId: "NVIDIA H100 SXM",
    gpuLabel: "1x H100 SXM 80GB",
    gpuCount: 1,
    totalHourlyPrice: price,
    availability: "available",
    availabilitySemantics: "sku_capacity",
    region: "US",
    listingType: "gpu_type_lowest_price",
    priceScope: "node_total",
    checkoutSemantics: "manual_provider",
    checkoutUrl: "https://www.runpod.io/console/gpu-cloud?gpuTypeId=NVIDIA+H100+SXM",
    sourceMode: "live",
    rawPayload: {
      id: "NVIDIA H100 SXM",
      lowestPrice: {
        uninterruptablePrice: price,
        stockStatus: "Available"
      }
    }
  });
}
