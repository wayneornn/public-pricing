import assert from "node:assert/strict";
import test from "node:test";
import {
  googleTpuSkusToItems,
  isGoogleTpuSku,
  parseTpuType
} from "../src/connectors/live/providers/google-tpu.js";

// Captured live from the Cloud Billing Catalog API (service 6F81-5844-456A, resourceGroup
// "TPU") on 2026-06-14. Four plain on-demand per-chip-hour SKUs plus three rows that must be
// dropped: a reservation/calendar SKU, a spot/preemptible SKU, and a committed-use SKU.
const SKUS = [
  {
    skuId: "04C3-5B71-D137",
    description: "TpuV5e running in Delhi",
    category: { resourceGroup: "TPU", usageType: "OnDemand" },
    serviceRegions: ["asia-south2"],
    pricingInfo: [{ pricingExpression: { usageUnit: "h", tieredRates: [{ unitPrice: { currencyCode: "USD", units: "1", nanos: 441320000 } }] } }],
    geoTaxonomy: { type: "REGIONAL", regions: ["asia-south2"] }
  },
  {
    skuId: "082F-763E-B398",
    description: "TpuV5p running in Sao Paulo",
    category: { resourceGroup: "TPU", usageType: "OnDemand" },
    serviceRegions: ["southamerica-east1"],
    pricingInfo: [{ pricingExpression: { usageUnit: "h", tieredRates: [{ unitPrice: { currencyCode: "USD", units: "6", nanos: 430995000 } }] } }],
    geoTaxonomy: { type: "REGIONAL", regions: ["southamerica-east1"] }
  },
  {
    skuId: "2549-F208-72FA",
    description: "TpuV6e running in Dallas",
    category: { resourceGroup: "TPU", usageType: "OnDemand" },
    serviceRegions: ["us-south1"],
    pricingInfo: [{ pricingExpression: { usageUnit: "h", tieredRates: [{ unitPrice: { currencyCode: "USD", units: "2", nanos: 700000000 } }] } }],
    geoTaxonomy: { type: "REGIONAL", regions: ["us-south1"] }
  },
  {
    skuId: "0F71-4391-B6CA",
    description: "TPU7x running in Americas",
    category: { resourceGroup: "TPU", usageType: "OnDemand" },
    serviceRegions: ["us-west1", "us-central1", "us-east1"],
    pricingInfo: [{ pricingExpression: { usageUnit: "h", tieredRates: [{ unitPrice: { currencyCode: "USD", units: "12", nanos: 0 } }] } }],
    geoTaxonomy: { type: "MULTI_REGIONAL", regions: ["us-west1", "us-central1", "us-east1"] }
  },
  {
    skuId: "026F-E6A1-BDBB",
    description: "Reserved TpuV5p in Delhi in Calendar Mode",
    category: { resourceGroup: "TPU", usageType: "OnDemand" },
    serviceRegions: ["asia-south2"],
    pricingInfo: [{ pricingExpression: { usageUnit: "h", tieredRates: [{ unitPrice: { currencyCode: "USD", units: "2", nanos: 940000000 } }] } }],
    geoTaxonomy: { type: "REGIONAL", regions: ["asia-south2"] }
  },
  {
    skuId: "0561-8741-3BC7",
    description: "TpuV5e attached to Spot Preemptible VMs running in Singapore",
    category: { resourceGroup: "TPU", usageType: "Preemptible" },
    serviceRegions: ["asia-southeast1"],
    pricingInfo: [{ pricingExpression: { usageUnit: "h", tieredRates: [{ unitPrice: { currencyCode: "USD", units: "0", nanos: 780000000 } }] } }],
    geoTaxonomy: { type: "REGIONAL", regions: ["asia-southeast1"] }
  },
  {
    skuId: "0115-21ED-7F03",
    description: "Commitment v1: TpuV5p running in Netherlands for 3 Years",
    category: { resourceGroup: "TPU", usageType: "Commit3Yr" },
    serviceRegions: ["europe-west4"],
    pricingInfo: [{ pricingExpression: { usageUnit: "h", tieredRates: [{ unitPrice: { currencyCode: "USD", units: "1", nanos: 911000000 } }] } }],
    geoTaxonomy: { type: "REGIONAL", regions: ["europe-west4"] }
  }
];

test("parseTpuType reads Google's TPU naming variants", () => {
  assert.equal(parseTpuType("TpuV5e running in Delhi"), "v5e");
  assert.equal(parseTpuType("TpuV5p running in Sao Paulo"), "v5p");
  assert.equal(parseTpuType("TpuV6e running in Dallas"), "v6e");
  assert.equal(parseTpuType("TPU7x running in Americas"), "7x");
  assert.equal(parseTpuType("Reserved V5e TPU in Calendar Mode"), "v5e");
  assert.equal(parseTpuType("Tpu-v4 Pod Accelerator USA"), "v4");
  assert.equal(parseTpuType("8x NVIDIA H100 SXM"), null);
});

test("isGoogleTpuSku keeps only plain on-demand TPU SKUs", () => {
  assert.equal(isGoogleTpuSku(SKUS[0]), true); // v5e on-demand
  assert.equal(isGoogleTpuSku(SKUS[4]), false); // Reserved/Calendar
  assert.equal(isGoogleTpuSku(SKUS[5]), false); // Spot/Preemptible
  assert.equal(isGoogleTpuSku(SKUS[6]), false); // Committed use
  // not a TPU resource group
  assert.equal(isGoogleTpuSku({ description: "Nvidia H100 GPU", category: { resourceGroup: "GPU", usageType: "OnDemand" } }), false);
});

test("googleTpuSkusToItems emits per-chip-hour non-orderable USD catalog rows", () => {
  const items = googleTpuSkusToItems(SKUS, {});
  // 3 single-region SKUs + 1 multi-region (3 regions) = 6 rows; reserved/spot/commit dropped.
  assert.equal(items.length, 6);

  const v5e = items.find((i) => i.rawOfferId.startsWith("04C3-5B71-D137"));
  assert.equal(v5e.providerId, "google-tpu");
  assert.equal(v5e.gpuLabel.includes("TPU v5e"), true);
  assert.equal(v5e.gpuCount, 1);
  assert.equal(v5e.vramGbEach, 16);
  assert.equal(v5e.rawRegion, "asia-south2");
  assert.equal(v5e.currency, "USD");
  assert.equal(v5e.pricePerGpuHour, 1.4413); // 1 + 441320000/1e9, rounded to 4dp
  assert.equal(v5e.checkoutSemantics, "provider_console");
  assert.equal(v5e.orderable, false);

  // multi-region SKU fans out to one row per region
  const sevenX = items.filter((i) => i.rawOfferId.startsWith("0F71-4391-B6CA"));
  assert.equal(sevenX.length, 3);
  assert.deepEqual(sevenX.map((i) => i.rawRegion).sort(), ["us-central1", "us-east1", "us-west1"]);
  assert.equal(sevenX[0].pricePerGpuHour, 12);
  assert.equal(sevenX[0].vramGbEach, 192);

  // no spot/reserved/committed price leaked in
  for (const item of items) {
    assert.equal(item.orderable, false);
    assert.ok(!/Reserved|Preemptible|Commitment/i.test(item.metadata?.description || ""));
  }
});
