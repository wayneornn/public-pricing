import assert from "node:assert/strict";
import test from "node:test";
import {
  createInventoryItem,
  isBrokerVisibleInventoryItem,
  isInterruptibleInventoryItem,
  isSpotInventoryItem
} from "../src/core/inventory.js";

test("inventory semantics mark exact host listings as high-trust node pricing", () => {
  const item = createInventoryItem({
    provider: "Vast.ai",
    providerId: "vast-ai",
    rawOfferId: "123",
    gpuLabel: "1x H100 80GB",
    gpuCount: 1,
    totalHourlyPrice: 2.5,
    region: "US",
    availability: "available",
    listingType: "marketplace_offer",
    priceScope: "node_total",
    sourceMode: "live",
    checkoutUrl: "https://cloud.vast.ai/create/?id=123",
    rawPayload: { id: 123, num_gpus: 1, dph_total: 2.5 }
  });

  assert.equal(item.availabilitySemantics, "host_capacity");
  assert.equal(item.priceSemantics, "node_total");
  assert.equal(item.checkoutSemantics, "exact_listing");
  assert.equal(item.confidence, "high");
  assert.equal(item.orderable, true);
  assert.equal(item.specs.gpu.model, "H100");
});

test("catalog GPU pricing is marked as price-only medium-trust data", () => {
  const item = createInventoryItem({
    provider: "Google Cloud",
    providerId: "google-cloud",
    rawOfferId: "sku:us",
    gpuLabel: "H100 80GB",
    gpuCount: 1,
    pricePerGpuHour: 11,
    region: "us-central1",
    listingType: "pricing_catalog",
    priceScope: "gpu_sku_only",
    sourceMode: "catalog",
    checkoutUrl: "https://console.cloud.google.com/compute/instancesAdd",
    rawPayload: { skuId: "sku" }
  });

  assert.equal(item.availabilitySemantics, "price_only");
  assert.equal(item.priceSemantics, "gpu_only");
  assert.equal(item.marketType, "catalog");
  assert.equal(item.checkoutSemantics, "provider_console");
  assert.equal(item.confidence, "medium");
  assert.equal(item.orderable, false);
  assert.match(item.orderabilityReason, /Not live provider inventory/);
});

test("region offerings and unpriced capacity do not claim exact price truth", () => {
  const aws = createInventoryItem({
    provider: "AWS",
    providerId: "aws",
    rawOfferId: "us-east-1:us-east-1a:p5.48xlarge",
    gpuLabel: "8x H100 80GB",
    gpuCount: 8,
    totalHourlyPrice: 98,
    region: "us-east-1",
    availability: "available",
    listingType: "ec2_instance_type_offering",
    priceScope: "node_total",
    sourceMode: "live",
    checkoutUrl: "https://console.aws.amazon.com/ec2/home?region=us-east-1#LaunchInstances:instanceType=p5.48xlarge",
    rawPayload: { instance_type: "p5.48xlarge" }
  });

  const crusoe = createInventoryItem({
    provider: "Crusoe",
    providerId: "crusoe",
    rawOfferId: "h100-8x:us-east",
    gpuLabel: "8x H100 SXM",
    gpuCount: 8,
    region: "us-east",
    availability: "available",
    listingType: "capacity",
    priceScope: "unpriced_capacity",
    sourceMode: "live",
    checkoutUrl: "https://cloud.crusoe.ai/compute/vms/create?type=h100-8x",
    rawPayload: { type: "h100-8x", location: "us-east" }
  });

  assert.equal(aws.availabilitySemantics, "region_offering");
  assert.equal(aws.priceSemantics, "node_total");
  assert.equal(aws.checkoutSemantics, "provider_console");
  assert.equal(aws.confidence, "medium");
  assert.equal(aws.orderable, false);
  assert.match(aws.orderabilityReason, /Availability truth is region_offering/);

  assert.equal(crusoe.availabilitySemantics, "sku_capacity");
  assert.equal(crusoe.priceSemantics, "unpriced");
  assert.equal(crusoe.marketType, "capacity");
  assert.equal(crusoe.confidence, "medium");
  assert.equal(crusoe.orderable, false);
  assert.match(crusoe.orderabilityReason, /Price truth is unpriced/);
});

test("provider-console routes are never orderable checkout inventory", () => {
  const item = createInventoryItem({
    provider: "Generic GPU Cloud",
    providerId: "generic-gpu-cloud",
    rawOfferId: "h100-console-row",
    gpuLabel: "8x H100 SXM 80GB",
    gpuCount: 8,
    totalHourlyPrice: 24,
    availability: "available",
    availabilitySemantics: "host_capacity",
    region: "US",
    listingType: "hostnode",
    priceScope: "node_total",
    checkoutSemantics: "provider_console",
    sourceMode: "live",
    rawPayload: { id: "h100-console-row" }
  });

  assert.equal(item.orderable, false);
  assert.match(item.orderabilityReason, /Checkout truth is provider_console/);
});

test("unknown availability is never orderable even when priced", () => {
  const item = createInventoryItem({
    provider: "Voltage Park",
    providerId: "voltage-park",
    rawOfferId: "hostnode:h100",
    gpuLabel: "8x H100 SXM",
    gpuCount: 8,
    totalHourlyPrice: 21,
    region: "Dallas",
    availability: "unknown",
    availabilitySemantics: "host_capacity",
    listingType: "vm_hostnode",
    priceScope: "node_total",
    sourceMode: "live",
    checkoutSemantics: "provider_console",
    rawPayload: { hostnode: true }
  });

  assert.equal(item.orderable, false);
  assert.match(item.orderabilityReason, /Availability is unknown/);
});

test("bandwidth-only fields do not become network fabric claims", () => {
  const item = createInventoryItem({
    provider: "Exactness Test Cloud",
    providerId: "exactness-test-cloud",
    rawOfferId: "h100-bandwidth-only",
    gpuLabel: "8x H100 80GB",
    gpuCount: 8,
    totalHourlyPrice: 24,
    region: "us-east",
    networkBandwidth: "100 Gbps",
    availability: "available",
    availabilitySemantics: "host_capacity",
    listingType: "hostnode",
    priceScope: "node_total",
    checkoutSemantics: "manual_provider",
    sourceMode: "live",
    rawPayload: { network_bandwidth: "100 Gbps" }
  });

  assert.equal(item.networkBandwidth, "100 Gbps");
  assert.equal(item.networkFabric, "Not exposed");
  assert.equal(item.specs.machine.networkFabric, "Not exposed");
});

test("spot and interruptible rows are orderable internally but not broker-visible by default", () => {
  const item = createInventoryItem({
    provider: "Verda/DataCrunch",
    providerId: "verda-datacrunch",
    rawOfferId: "spot:1B200.180V:FIN-02",
    gpuLabel: "1x B200 180GB",
    gpuCount: 1,
    totalHourlyPrice: 2.65,
    region: "FIN-02",
    availability: "available",
    availabilitySemantics: "sku_capacity",
    listingType: "spot_instance_type",
    priceScope: "node_total",
    checkoutSemantics: "manual_provider",
    checkoutUrl: "https://console.verda.com/dashboard/projects/project-1/deploy-instance?instance_type=1B200.180V&location_code=FIN-02&market=spot",
    sourceMode: "live",
    rawPayload: { spot_price: 2.65, price_per_hour: 7.55 }
  });

  assert.equal(item.orderable, true);
  assert.equal(item.priceSemantics, "spot");
  assert.equal(item.marketType, "spot");
  assert.equal(isInterruptibleInventoryItem(item), true);
  assert.equal(isBrokerVisibleInventoryItem(item), false);
});

test("non-USD prices are converted to USD at a labeled rate and ranked in USD", () => {
  const item = createInventoryItem({
    provider: "Scaleway",
    providerId: "scaleway",
    rawOfferId: "H100:fr-par-2",
    gpuLabel: "1x H100 SXM 80GB",
    gpuCount: 1,
    totalHourlyPrice: 2.5,
    currency: "EUR",
    region: "fr-par-2",
    availability: "available",
    availabilitySemantics: "region_offering",
    listingType: "commercial_type",
    priceScope: "node_total",
    sourceMode: "live",
    checkoutUrl: "https://console.scaleway.com/instance/servers/create?commercial_type=H100&zone=fr-par-2",
    rawPayload: { hourly_price: 2.5 }
  });

  assert.equal(item.currency, "USD");
  assert.equal(item.nativeCurrency, "EUR");
  assert.ok(Math.abs(item.totalHourlyPrice - 2.5 * 1.08) < 1e-6);
  assert.ok(item.dataNotes.some((n) => /Converted to USD from EUR/.test(n)));
});

test("USD prices are left unchanged with no conversion note", () => {
  const item = createInventoryItem({
    provider: "DigitalOcean",
    providerId: "digitalocean",
    rawOfferId: "gpu-h100x1-80gb",
    gpuLabel: "1x H100 80GB",
    gpuCount: 1,
    totalHourlyPrice: 3.39,
    currency: "USD",
    region: "nyc2",
    availability: "available",
    listingType: "instance_type",
    priceScope: "node_total",
    sourceMode: "live",
    checkoutSemantics: "manual_provider",
    checkoutUrl: "https://cloud.digitalocean.com/droplets/new?size=gpu-h100x1-80gb",
    rawPayload: { available: true, price_hourly: 3.39 }
  });

  assert.equal(item.currency, "USD");
  assert.equal(item.totalHourlyPrice, 3.39);
  assert.equal(item.dataNotes.some((n) => /Converted to USD/.test(n)), false);
});

test("spot-priced rows (rawPayload.isSpot) are not orderable and tagged Spot", () => {
  const item = createInventoryItem({
    provider: "Prime Intellect",
    providerId: "prime-intellect",
    rawOfferId: "spot:A100:FIN-02",
    gpuLabel: "1x A100 80GB",
    gpuCount: 1,
    totalHourlyPrice: 0.51,
    availability: "available",
    availabilitySemantics: "sku_capacity",
    listingType: "secure_cloud",
    priceScope: "node_total",
    sourceMode: "live",
    checkoutSemantics: "manual_provider",
    checkoutUrl: "https://app.primeintellect.ai/dashboard/create?cloudId=secure-cloud&gpuType=A100&gpuCount=1&provider=datacrunch",
    rawPayload: { isSpot: true, provider: "datacrunch", prices: { onDemand: 0.51 } }
  });

  assert.equal(item.orderable, false);
  assert.match(item.orderabilityReason, /spot/i);
  assert.ok(item.dataNotes.some((n) => /spot/i.test(n)));
  // It must also be classified as spot so the ingestion pipeline drops it.
  assert.equal(isSpotInventoryItem(item), true);
});

test("isSpotInventoryItem flags interruptible spot but not firm on-demand/reserved", () => {
  const spotByFlag = createInventoryItem({
    provider: "Prime Intellect", providerId: "prime-intellect", rawOfferId: "spot:B300:FIN-03",
    gpuLabel: "1x B300", gpuCount: 1, totalHourlyPrice: 2.68, availability: "available",
    availabilitySemantics: "sku_capacity", listingType: "secure_cloud", priceScope: "node_total",
    sourceMode: "live", checkoutSemantics: "manual_provider", checkoutUrl: "https://app.primeintellect.ai",
    rawPayload: { isSpot: true }
  });
  const spotByScope = createInventoryItem({
    provider: "AWS", providerId: "aws", rawOfferId: "us-east-1:us-east-1a:p5.48xlarge",
    gpuLabel: "8x H100", gpuCount: 8, totalHourlyPrice: 12, availability: "available",
    availabilitySemantics: "region_offering", listingType: "region_offering", priceScope: "spot",
    sourceMode: "live", checkoutSemantics: "manual_provider", rawPayload: { spot: true }
  });
  const onDemand = createInventoryItem({
    provider: "Prime Intellect", providerId: "prime-intellect", rawOfferId: "od:B300:FIN-03",
    gpuLabel: "1x B300", gpuCount: 1, totalHourlyPrice: 7.55, availability: "available",
    availabilitySemantics: "sku_capacity", listingType: "secure_cloud", priceScope: "node_total",
    sourceMode: "live", checkoutSemantics: "manual_provider", checkoutUrl: "https://app.primeintellect.ai",
    rawPayload: { isSpot: false }
  });

  assert.equal(isSpotInventoryItem(spotByFlag), true);
  assert.equal(isSpotInventoryItem(spotByScope), true);
  assert.equal(isSpotInventoryItem(onDemand), false);
});

test("volatilePricing rows (Mithril auction) are not orderable", () => {
  const item = createInventoryItem({
    provider: "Mithril",
    providerId: "mithril",
    rawOfferId: "it_x:us-central3-a",
    gpuLabel: "1x A100 80GB",
    gpuCount: 1,
    totalHourlyPrice: 1.1,
    availability: "available",
    availabilitySemantics: "host_capacity",
    listingType: "instance_type",
    priceScope: "node_total",
    sourceMode: "live",
    checkoutSemantics: "manual_provider",
    checkoutUrl: "https://app.mithril.ai",
    volatilePricing: true,
    rawPayload: { pricing: { reserved_price_cents: 110, available_capacity: 3 } }
  });

  assert.equal(item.orderable, false);
  assert.match(item.orderabilityReason, /spot|auction/i);
});

test("known non-USD currencies beyond EUR are converted (e.g. INR)", () => {
  const item = createInventoryItem({
    provider: "E2E",
    providerId: "e2e-cloud",
    rawOfferId: "inr:a100",
    gpuLabel: "1x A100 80GB",
    gpuCount: 1,
    totalHourlyPrice: 200,
    currency: "INR",
    availability: "available",
    availabilitySemantics: "sku_capacity",
    listingType: "instance_type",
    priceScope: "node_total",
    sourceMode: "live",
    checkoutSemantics: "manual_provider",
    checkoutUrl: "https://myaccount.e2enetworks.com/",
    rawPayload: { available: true, price: 200 }
  });

  assert.equal(item.currency, "USD");
  assert.equal(item.nativeCurrency, "INR");
  assert.ok(Math.abs(item.totalHourlyPrice - 200 * 0.012) < 1e-6);
  assert.equal(item.orderable, true);
});

test("unknown currency is never silently treated as USD: kept native and non-orderable", () => {
  const item = createInventoryItem({
    provider: "Mystery Cloud",
    providerId: "mystery-cloud",
    rawOfferId: "xyz:h100",
    gpuLabel: "1x H100 80GB",
    gpuCount: 1,
    totalHourlyPrice: 200,
    currency: "XYZ",
    availability: "available",
    availabilitySemantics: "sku_capacity",
    listingType: "instance_type",
    priceScope: "node_total",
    sourceMode: "live",
    checkoutSemantics: "manual_provider",
    rawPayload: { available: true, price: 200 }
  });

  assert.equal(item.currency, "XYZ");
  assert.equal(item.totalHourlyPrice, 200);
  assert.equal(item.orderable, false);
  assert.match(item.orderabilityReason, /currency/i);
  assert.ok(item.dataNotes.some((n) => /no USD FX rate/i.test(n)));
});

test("FX_<CUR>_USD env override sets the conversion rate", () => {
  const prev = process.env.FX_EUR_USD;
  process.env.FX_EUR_USD = "1.5";
  try {
    const item = createInventoryItem({
      provider: "Scaleway",
      providerId: "scaleway",
      rawOfferId: "eur-env:h100",
      gpuLabel: "1x H100 80GB",
      gpuCount: 1,
      totalHourlyPrice: 2,
      currency: "EUR",
      availability: "available",
      availabilitySemantics: "sku_capacity",
      listingType: "instance_type",
      priceScope: "node_total",
      sourceMode: "live",
      checkoutSemantics: "manual_provider",
      rawPayload: { available: true }
    });
    assert.ok(Math.abs(item.totalHourlyPrice - 3) < 1e-6);
  } finally {
    if (prev === undefined) delete process.env.FX_EUR_USD;
    else process.env.FX_EUR_USD = prev;
  }
});
