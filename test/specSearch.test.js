import assert from "node:assert/strict";
import test from "node:test";
import { fixtureInventory } from "../src/connectors/fixtures.js";
import { createInventoryItem } from "../src/core/inventory.js";
import { alertMatchKey, parseSpec, searchInventory, specCompleteness } from "../src/core/specSearch.js";

test("parses a broker-style spec sheet", () => {
  const spec = parseSpec("8x H100 SXM, US, under $25/hr total");
  assert.deepEqual(spec.requestedModels, ["H100"]);
  assert.equal(spec.gpuCount, 8);
  assert.equal(spec.variant, "SXM");
  assert.equal(spec.budgetTotalHourly, 25);
});

test("parses model-specific counts in quick trader syntax", () => {
  const spec = parseSpec("2 H200 1 H100 cheapest available");
  assert.deepEqual(spec.modelRequirements, [
    { model: "H200", count: 2 },
    { model: "H100", count: 1 }
  ]);
});

test("parses Google accelerator specs", () => {
  const spec = parseSpec("8x B200 from GCP under $6/gpu/hr");
  assert.deepEqual(spec.requestedModels, ["B200"]);
  assert.equal(spec.gpuCount, 8);
  assert.equal(spec.budgetPerGpuHour, 6);
});

test("parses and filters fabric requirements", () => {
  const spec = parseSpec("8x H100 IB under $30/hr total");
  assert.equal(spec.networkFabric, "ib");

  const inventory = [
    createInventoryItem({
      provider: "Fabric Cloud",
      providerId: "fabric-cloud",
      rawOfferId: "ib-h100",
      gpuLabel: "8x H100 SXM 80GB",
      gpuCount: 8,
      pricePerGpuHour: 2.5,
      totalHourlyPrice: 20,
      region: "US",
      formFactor: "bare_metal",
      interconnect: "NVLink",
      networkFabric: "InfiniBand",
      availability: "available",
      sourceMode: "live",
      listingType: "marketplace_server",
      priceScope: "node_total"
    }),
    createInventoryItem({
      provider: "No Fabric Cloud",
      providerId: "no-fabric-cloud",
      rawOfferId: "plain-h100",
      gpuLabel: "8x H100 SXM 80GB",
      gpuCount: 8,
      pricePerGpuHour: 1.5,
      totalHourlyPrice: 12,
      region: "US",
      formFactor: "bare_metal",
      interconnect: "NVLink",
      networkFabric: "Not exposed",
      availability: "available",
      sourceMode: "live",
      listingType: "marketplace_server",
      priceScope: "node_total"
    })
  ];

  const result = searchInventory(inventory, {
    spec: "8x H100 IB under $30/hr total",
    filters: { fabric: "ib", availabilityOnly: true }
  });

  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].providerId, "fabric-cloud");
});

test("ranks exact H100 blocks above weaker substitutes", () => {
  const inventory = fixtureInventory(new Date("2026-06-04T12:00:00Z"));
  const result = searchInventory(inventory, {
    spec: "8x H100 SXM under $25/hr total",
    filters: { availabilityOnly: true }
  });
  assert.ok(result.bestOverall);
  assert.equal(result.bestOverall.gpuModel, "H100");
  assert.equal(result.bestOverall.gpuCount, 8);
  assert.ok(result.bestPerProvider.length > 5);
});

test("filters by max price per GPU", () => {
  const inventory = fixtureInventory(new Date("2026-06-04T12:00:00Z"));
  const result = searchInventory(inventory, {
    spec: "H100",
    filters: { gpuModel: "H100", maxPricePerGpu: 2.1, availabilityOnly: true }
  });
  assert.ok(result.results.length > 0);
  assert.ok(result.results.every((item) => item.pricePerGpuHour <= 2.1));
});

test("filters by selected provider ids", () => {
  const inventory = fixtureInventory(new Date("2026-06-04T12:00:00Z"));
  const lambdaOnly = searchInventory(inventory, {
    spec: "H100",
    filters: { providerIds: ["lambda"], availabilityOnly: true }
  });
  assert.ok(lambdaOnly.results.length > 0);
  assert.ok(lambdaOnly.results.every((item) => item.providerId === "lambda"));

  const noneSelected = searchInventory(inventory, {
    spec: "H100",
    filters: { providerIds: [], availabilityOnly: true }
  });
  assert.ok(noneSelected.results.length > lambdaOnly.results.length);
  assert.ok(noneSelected.results.some((item) => item.providerId !== "lambda"));
});

test("filters by multiple GPU models at once", () => {
  const make = (model, label) => createInventoryItem({
    provider: `${model} Cloud`,
    providerId: `${model.toLowerCase()}-cloud`,
    rawOfferId: `${model.toLowerCase()}-1`,
    gpuLabel: label,
    gpuCount: 8,
    pricePerGpuHour: 2,
    totalHourlyPrice: 16,
    region: "US",
    availability: "available",
    sourceMode: "live",
    listingType: "marketplace_server",
    priceScope: "node_total"
  });
  const inventory = [
    make("H100", "8x H100 SXM 80GB"),
    make("H200", "8x H200 SXM 141GB"),
    make("A100", "8x A100 SXM 80GB")
  ];

  const result = searchInventory(inventory, {
    spec: "",
    filters: { gpuModels: ["H100", "H200"], availabilityOnly: true }
  });

  assert.equal(result.results.length, 2);
  assert.ok(result.results.every((item) => ["H100", "H200"].includes(item.gpuModel)));
  assert.ok(result.results.every((item) => item.gpuModel !== "A100"));

  // Comma-separated strings and lower-case input normalize the same way.
  const viaString = searchInventory(inventory, {
    spec: "",
    filters: { gpuModels: "h100,h200", availabilityOnly: true }
  });
  assert.equal(viaString.results.length, 2);
});

test("multi-model spec hard-filters alerts to the requested models", () => {
  const make = (model, label) => createInventoryItem({
    provider: `${model} Cloud`,
    providerId: `${model.toLowerCase()}-cloud`,
    rawOfferId: `${model.toLowerCase()}-1`,
    gpuLabel: label,
    gpuCount: 8,
    totalHourlyPrice: 16,
    availability: "available",
    availabilitySemantics: "host_capacity",
    region: "US",
    formFactor: "bare_metal",
    networkFabric: "InfiniBand",
    // Datacenter-vendor rows (not marketplace) so alert evaluation keeps them.
    listingType: "instance_type",
    priceScope: "node_total",
    checkoutSemantics: "exact_listing",
    checkoutUrl: `https://cloud.example.com/create?id=${model.toLowerCase()}`,
    sourceMode: "live",
    rawPayload: { id: model.toLowerCase() }
  });
  const inventory = [
    make("H100", "8x H100 SXM 80GB"),
    make("H200", "8x H200 SXM 141GB"),
    make("A100", "8x A100 SXM 80GB")
  ];

  const result = searchInventory(inventory, {
    spec: "",
    filters: { availabilityOnly: true, orderableOnly: true },
    alerts: [{ id: "alert-h100-h200", spec: "8x H100 8x H200", minScore: 500, filters: {} }]
  });

  const models = result.alerts[0].matchIds
    .map((key) => inventory.find((item) => alertMatchKey(item) === key)?.gpuModel)
    .sort();
  assert.deepEqual(models, ["H100", "H200"]);
});

test("buyable-only filtering excludes available rows that are not checkout-grade", () => {
  const inventory = [
    createInventoryItem({
      provider: "Exact Cloud",
      providerId: "exact-cloud",
      rawOfferId: "exact-h100",
      gpuLabel: "1x H100 SXM 80GB",
      gpuCount: 1,
      totalHourlyPrice: 3,
      availability: "available",
      availabilitySemantics: "host_capacity",
      region: "US",
      listingType: "instance_type",
      priceScope: "node_total",
      checkoutSemantics: "exact_listing",
      sourceMode: "live",
      rawPayload: { id: "exact-h100" }
    }),
    createInventoryItem({
      provider: "Console Cloud",
      providerId: "console-cloud",
      rawOfferId: "console-h100",
      gpuLabel: "1x H100 SXM 80GB",
      gpuCount: 1,
      totalHourlyPrice: 2,
      availability: "available",
      availabilitySemantics: "host_capacity",
      region: "US",
      listingType: "hostnode",
      priceScope: "node_total",
      checkoutSemantics: "provider_console",
      sourceMode: "live",
      rawPayload: { id: "console-h100" }
    })
  ];

  const result = searchInventory(inventory, {
    spec: "H100",
    filters: { availabilityOnly: true, orderableOnly: true }
  });

  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].providerId, "exact-cloud");
});

test("broker filters exclude risky high-end fabric and manual checkout when requested", () => {
  const inventory = [
    createInventoryItem({
      provider: "IB Cloud",
      providerId: "ib-cloud",
      rawOfferId: "ib-h100",
      gpuLabel: "8x H100 SXM 80GB",
      gpuCount: 8,
      totalHourlyPrice: 24,
      availability: "available",
      availabilitySemantics: "host_capacity",
      region: "US",
      formFactor: "bare_metal",
      networkFabric: "InfiniBand",
      listingType: "instance_type",
      priceScope: "node_total",
      checkoutSemantics: "exact_listing",
      checkoutUrl: "https://cloud.example.com/create?id=ib-h100",
      sourceMode: "live",
      rawPayload: { id: "ib-h100" }
    }),
    createInventoryItem({
      provider: "Manual Cloud",
      providerId: "manual-cloud",
      rawOfferId: "manual-h100",
      gpuLabel: "8x H100 SXM 80GB",
      gpuCount: 8,
      totalHourlyPrice: 18,
      availability: "available",
      availabilitySemantics: "sku_capacity",
      region: "US",
      formFactor: "bare_metal",
      networkFabric: "Not exposed",
      listingType: "instance_type",
      priceScope: "node_total",
      checkoutSemantics: "manual_provider",
      checkoutUrl: "https://console.example.com/deploy?sku=manual-h100",
      sourceMode: "live",
      rawPayload: { id: "manual-h100" }
    })
  ];

  const result = searchInventory(inventory, {
    spec: "8x H100",
    filters: {
      availabilityOnly: true,
      orderableOnly: true,
      directCheckoutOnly: true,
      excludeRiskyFabric: true
    }
  });

  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].providerId, "ib-cloud");
  assert.ok(result.results[0].specCompleteness >= 60);
});

test("negative fabric notes do not satisfy an IB filter", () => {
  const inventory = [
    createInventoryItem({
      provider: "Negative Note Cloud",
      providerId: "negative-note-cloud",
      rawOfferId: "h100-no-ib",
      gpuLabel: "8x H100 SXM 80GB",
      gpuCount: 8,
      totalHourlyPrice: 20,
      availability: "available",
      availabilitySemantics: "sku_capacity",
      region: "US",
      formFactor: "bare_metal",
      networkFabric: "Not exposed",
      listingType: "instance_type",
      priceScope: "node_total",
      checkoutSemantics: "manual_provider",
      checkoutUrl: "https://console.example.com/deploy?sku=h100-no-ib",
      sourceMode: "live",
      dataNotes: ["No IB/RDMA fabric listed by provider API"],
      rawPayload: { id: "h100-no-ib" }
    })
  ];

  const result = searchInventory(inventory, {
    spec: "8x H100 IB",
    filters: { fabric: "ib", availabilityOnly: true, orderableOnly: true }
  });

  assert.equal(result.results.length, 0);
  assert.ok(specCompleteness(inventory[0]).missing.includes("fabric/topology"));
});

test("saved alerts evaluate their own strict filters", () => {
  const inventory = [
    createInventoryItem({
      provider: "Exact IB Cloud",
      providerId: "exact-ib-cloud",
      rawOfferId: "ib-h100",
      gpuLabel: "8x H100 SXM 80GB",
      gpuCount: 8,
      totalHourlyPrice: 22,
      availability: "available",
      availabilitySemantics: "host_capacity",
      region: "US",
      formFactor: "bare_metal",
      networkFabric: "InfiniBand",
      listingType: "instance_type",
      priceScope: "node_total",
      checkoutSemantics: "exact_listing",
      checkoutUrl: "https://cloud.example.com/create?id=ib-h100",
      sourceMode: "live",
      rawPayload: { id: "ib-h100" }
    }),
    createInventoryItem({
      provider: "Cheap No Fabric Cloud",
      providerId: "cheap-no-fabric-cloud",
      rawOfferId: "cheap-h100",
      gpuLabel: "8x H100 SXM 80GB",
      gpuCount: 8,
      totalHourlyPrice: 12,
      availability: "available",
      availabilitySemantics: "sku_capacity",
      region: "US",
      formFactor: "bare_metal",
      networkFabric: "Not exposed",
      listingType: "instance_type",
      priceScope: "node_total",
      checkoutSemantics: "manual_provider",
      checkoutUrl: "https://console.example.com/deploy?sku=cheap-h100",
      sourceMode: "live",
      rawPayload: { id: "cheap-h100" }
    })
  ];

  const result = searchInventory(inventory, {
    spec: "",
    filters: { availabilityOnly: true, orderableOnly: true },
    alerts: [{
      id: "alert-ib",
      spec: "8x H100 IB under $25/hr total",
      minScore: 500,
      filters: {
        availabilityOnly: true,
        orderableOnly: true,
        directCheckoutOnly: true,
        excludeRiskyFabric: true,
        fabric: "ib"
      }
    }]
  });

  assert.equal(result.alerts[0].matchCount, 1);
  assert.equal(result.alerts[0].topMatch.providerId, "exact-ib-cloud");
  assert.deepEqual(result.alerts[0].matchIds, [result.alerts[0].topMatch.alertMatchKey]);
});

test("spec-only alert hard-filters fabric, not just soft scores it", () => {
  const inventory = [
    createInventoryItem({
      provider: "IB H100 Cloud",
      providerId: "ib-h100-cloud",
      rawOfferId: "ib-h100",
      gpuLabel: "8x H100 SXM 80GB",
      gpuCount: 8,
      totalHourlyPrice: 24,
      availability: "available",
      availabilitySemantics: "host_capacity",
      region: "US",
      formFactor: "bare_metal",
      networkFabric: "InfiniBand",
      listingType: "instance_type",
      priceScope: "node_total",
      checkoutSemantics: "exact_listing",
      checkoutUrl: "https://cloud.example.com/create?id=ib-h100",
      sourceMode: "live",
      rawPayload: { id: "ib-h100" }
    }),
    createInventoryItem({
      provider: "No Fabric H100 Cloud",
      providerId: "no-fabric-h100-cloud",
      rawOfferId: "plain-h100",
      gpuLabel: "8x H100 SXM 80GB",
      gpuCount: 8,
      totalHourlyPrice: 16,
      availability: "available",
      availabilitySemantics: "host_capacity",
      region: "US",
      formFactor: "bare_metal",
      networkFabric: "Not exposed",
      listingType: "instance_type",
      priceScope: "node_total",
      checkoutSemantics: "exact_listing",
      checkoutUrl: "https://cloud.example.com/create?id=plain-h100",
      sourceMode: "live",
      rawPayload: { id: "plain-h100" }
    })
  ];

  // Alert created from free-text only (no explicit fabric filter), as the
  // one-click "Alert me" flow does.
  const result = searchInventory(inventory, {
    spec: "",
    filters: { availabilityOnly: true, orderableOnly: true },
    alerts: [{ id: "alert-spec-ib", spec: "H100 SXM IB", minScore: 500, filters: {} }]
  });

  assert.equal(result.alerts[0].matchCount, 1);
  assert.equal(result.alerts[0].topMatch.providerId, "ib-h100-cloud");
});

test("saved alerts exclude marketplace rows even when they otherwise match", () => {
  const inventory = [
    createInventoryItem({
      provider: "Vast.ai",
      providerId: "vast-ai",
      rawOfferId: "taiwan-h100",
      gpuLabel: "8x H100 SXM 80GB",
      gpuCount: 8,
      totalHourlyPrice: 12,
      availability: "available",
      availabilitySemantics: "host_capacity",
      region: "Taiwan",
      formFactor: "bare_metal",
      networkFabric: "InfiniBand",
      listingType: "marketplace_offer",
      priceScope: "node_total",
      checkoutSemantics: "exact_listing",
      checkoutUrl: "https://cloud.vast.ai/create?offer=taiwan-h100",
      sourceMode: "live",
      rawPayload: { id: "taiwan-h100" }
    })
  ];

  const result = searchInventory(inventory, {
    alerts: [{ id: "alert-marketplace", spec: "8x H100 SXM IB", minScore: 500, filters: {} }]
  });

  assert.equal(result.alerts[0].matchCount, 0);
  assert.equal(result.alerts[0].topMatch, null);
});

test("spec completeness exposes missing broker-critical fields", () => {
  const item = createInventoryItem({
    provider: "Thin Cloud",
    providerId: "thin-cloud",
    rawOfferId: "thin-h100",
    gpuLabel: "2x H100",
    gpuCount: 2,
    totalHourlyPrice: 6,
    availability: "available",
    availabilitySemantics: "sku_capacity",
    region: "US",
    networkFabric: "Not exposed",
    listingType: "instance_type",
    priceScope: "node_total",
    checkoutSemantics: "manual_provider",
    checkoutUrl: "https://console.example.com/deploy?sku=thin-h100",
    sourceMode: "live",
    rawPayload: { id: "thin-h100" }
  });

  const completeness = specCompleteness(item);
  assert.ok(completeness.score < 90);
  assert.ok(completeness.missing.includes("fabric/topology"));
});

test("datacenterOnly filter hides consumer GPUs but keeps them by default", () => {
  const inventory = [
    createInventoryItem({
      provider: "Vast Marketplace",
      providerId: "vast-ai",
      rawOfferId: "consumer-4090",
      gpuLabel: "1x NVIDIA GeForce RTX 4090 24GB",
      gpuCount: 1,
      pricePerGpuHour: 0.4,
      totalHourlyPrice: 0.4,
      region: "US",
      availability: "available",
      sourceMode: "live",
      listingType: "marketplace_server",
      priceScope: "node_total"
    }),
    createInventoryItem({
      provider: "Datacenter Cloud",
      providerId: "datacenter-cloud",
      rawOfferId: "dc-h100",
      gpuLabel: "8x H100 SXM 80GB",
      gpuCount: 8,
      pricePerGpuHour: 2.5,
      totalHourlyPrice: 20,
      region: "US",
      availability: "available",
      sourceMode: "live",
      listingType: "marketplace_server",
      priceScope: "node_total"
    })
  ];

  const all = searchInventory(inventory, { spec: "", filters: { availabilityOnly: true } });
  assert.equal(all.results.length, 2);

  const datacenterOnly = searchInventory(inventory, {
    spec: "",
    filters: { availabilityOnly: true, datacenterOnly: true }
  });
  assert.equal(datacenterOnly.results.length, 1);
  assert.equal(datacenterOnly.results[0].providerId, "datacenter-cloud");
  assert.ok(datacenterOnly.results.every((item) => item.gpuTier === "datacenter"));
});
