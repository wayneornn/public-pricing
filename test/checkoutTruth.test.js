import assert from "node:assert/strict";
import test from "node:test";
import { liveConnectors } from "../src/connectors/live.js";
import { createInventoryItem } from "../src/core/inventory.js";
import {
  CHECKOUT_TRUTH_CONTRACTS,
  providerHasCheckoutTruthContract,
  validateCheckoutTruthItem,
  validateCheckoutTruthSnapshot
} from "../src/core/checkoutTruth.js";

test("every live connector has an explicit checkout truth contract", () => {
  const missing = liveConnectors
    .map((connector) => connector.id)
    .filter((providerId) => !providerHasCheckoutTruthContract(providerId));
  assert.deepEqual(missing, []);
});

test("every checkout-capable provider declares approved checkout URL routes", () => {
  const missing = Object.entries(CHECKOUT_TRUTH_CONTRACTS)
    .filter(([, contract]) => !contract.mustNotDisplay)
    .filter(([, contract]) => !Array.isArray(contract.checkoutUrlRules) || !contract.checkoutUrlRules.length)
    .map(([providerId]) => providerId);
  assert.deepEqual(missing, []);
});

test("every checkout-capable provider accepts only proved orderable inventory", () => {
  const cases = {
    "runpod": {
      provider: "RunPod",
      rawOfferId: "NVIDIA H100 SXM",
      checkoutSemantics: "manual_provider",
      checkoutUrl: "https://www.runpod.io/console/gpu-cloud?gpuTypeId=NVIDIA+H100+SXM",
      rawPayload: { lowestPrice: { uninterruptablePrice: 3.25, stockStatus: "Available" } }
    },
    "vast-ai": {
      provider: "Vast.ai",
      rawOfferId: "12345",
      listingType: "marketplace_offer",
      checkoutUrl: "https://cloud.vast.ai/create/?id=12345&offer_id=12345&ask_id=12345",
      rawPayload: { id: 12345, dph_total: 8.4, rentable: true, rented: false }
    },
    "shadeform": {
      provider: "Shadeform",
      rawOfferId: "lambda:gpu_1x_h100_sxm5:us-east-1",
      checkoutSemantics: "manual_provider",
      checkoutUrl: "https://www.shadeform.ai/?cloud=lambda&shade_instance_type=gpu_1x_h100_sxm5&region=us-east-1",
      metadata: { providerAvailability: { available: true } },
      rawPayload: { cloud: "lambda", shade_instance_type: "gpu_1x_h100_sxm5", hourly_price: 3.2 }
    },
    "prime-intellect": {
      provider: "Prime Intellect",
      rawOfferId: "secure-cloud:H100:FIN-02",
      checkoutSemantics: "manual_provider",
      checkoutUrl: "https://app.primeintellect.ai/dashboard/create?cloudId=secure-cloud&gpuType=H100&gpuCount=1&provider=datacrunch&dataCenter=FIN-02",
      rawPayload: { cloudId: "secure-cloud", gpuType: "H100", gpuCount: 1, provider: "datacrunch", dataCenter: "FIN-02", prices: { onDemand: 3.25 }, stockStatus: "Available" }
    },
    "lambda": {
      provider: "Lambda",
      rawOfferId: "gpu_1x_h100_sxm5:us-west-1",
      checkoutSemantics: "manual_provider",
      checkoutUrl: "https://cloud.lambda.ai/instances?instance_type=gpu_1x_h100_sxm5&region=us-west-1",
      rawPayload: { name: "gpu_1x_h100_sxm5", price_cents_per_hour: 249, regions_with_capacity_available: [{ name: "us-west-1" }] }
    },
    "cudo": {
      provider: "CUDO Compute",
      rawOfferId: "vm:h100:us",
      checkoutSemantics: "manual_provider",
      checkoutUrl: "https://www.cudocompute.com/console?kind=vm&machineType=h100&dataCenterId=us",
      rawPayload: { machineType: "h100", maxGpuFree: 8, totalGpuFree: 8 }
    },
    "sesterce": {
      provider: "Sesterce",
      rawOfferId: "inst-1:us",
      checkoutSemantics: "manual_provider",
      checkoutUrl: "https://cloud.sesterce.com/clusters?instanceId=inst-1&region=us",
      metadata: { providerAvailability: { available: true } },
      rawPayload: { instanceId: "inst-1", hourlyPrice: 22.4 }
    },
    "clore-ai": {
      provider: "Clore.ai",
      rawOfferId: "555",
      listingType: "spot_server",
      checkoutUrl: "https://clore.ai/marketplace?server=555",
      rawPayload: { id: 555, rented: false }
    },
    "hyperstack": {
      provider: "Hyperstack",
      rawOfferId: "h100:uk-1",
      checkoutSemantics: "manual_provider",
      checkoutUrl: "https://console.hyperstack.cloud/deploy-vm?flavor=h100&region=uk-1",
      rawPayload: { stock_available: true, gpu_count: 8, price: 21.6 }
    },
    "verda-datacrunch": {
      provider: "Verda/DataCrunch",
      rawOfferId: "on_demand:h100:FIN-02",
      checkoutSemantics: "manual_provider",
      checkoutUrl: "https://console.verda.com/dashboard/projects/project-1/deploy-instance?instance_type=1H100.80S.32V&location_code=FIN-02&market=on_demand",
      rawPayload: { price_per_hour: 3.39 }
    },
    "vultr": {
      provider: "Vultr",
      rawOfferId: "vcg-a100-1c-6g-80vram:ewr",
      checkoutUrl: "https://my.vultr.com/deploy/?plan=vcg-a100-1c-6g-80vram&region=ewr&type=vcg",
      rawPayload: { hourly_cost: 2.5, deploy_ondemand: true, deploy_preemptible: false }
    },
    "scaleway": {
      provider: "Scaleway",
      rawOfferId: "H100:fr-par-1",
      checkoutUrl: "https://console.scaleway.com/instance/servers/create?commercial_type=H100&zone=fr-par-1",
      rawPayload: { hourly_price: 18.4, availability: { availability: "available" } }
    },
    "tensordock": {
      provider: "TensorDock",
      rawOfferId: "loc-1:H100",
      checkoutSemantics: "manual_provider",
      checkoutUrl: "https://dashboard.tensordock.com/deploy?location_id=loc-1&gpu=H100&max_count=8",
      rawPayload: { location: { id: "loc-1" }, gpu: { max_count: 8, price_per_hr: 2.2 } }
    },
    "gcore": {
      provider: "Gcore",
      rawOfferId: "baremetal:1204684:14:bm3-h100-8",
      checkoutSemantics: "manual_provider",
      checkoutUrl: "https://cloud.gcore.com/cloud/gpu?project_id=1204684&region_id=14&flavor=bm3-h100-8",
      rawPayload: { capacity: 1, disabled: false }
    },
    "massed-compute": {
      provider: "Massed Compute",
      rawOfferId: "gpu_1x_h100_sxm5:us-east",
      checkoutSemantics: "manual_provider",
      checkoutUrl: "https://vm.massedcompute.com/deploy?productName=gpu_1x_h100_sxm5&regionName=us-east",
      rawPayload: {
        capacity_available: 2,
        regions_with_capacity_available: [{ name: "us-east" }],
        instance_type: { price_cents_per_hour: 260 }
      }
    },
    "e2e-cloud": {
      provider: "E2E Cloud",
      rawOfferId: "Delhi:GDC-A.H100-1.120GB:GDC-1xH100-Ubuntu-Delhi",
      checkoutSemantics: "manual_provider",
      checkoutUrl: "https://myaccount.e2enetworks.com/?plan=GDC-1xH100-Ubuntu-Delhi&image=Ubuntu-22.04-GPU&location=Delhi",
      rawPayload: {
        plan: "GDC-1xH100-Ubuntu-Delhi",
        image: "Ubuntu-22.04-GPU",
        available_inventory_status: true,
        gpu_card_details: { UNIT_COUNT: 1, CARD_TYPE: "Nvidia-H100" },
        specs: { price_per_hour: 2.5 }
      }
    },
    "gmi": {
      provider: "GMI Cloud",
      rawOfferId: "bare_metal:gmi.bm.nh1.normal:asia-east-hanoi",
      checkoutSemantics: "manual_provider",
      checkoutUrl: "https://console.gmicloud.ai/create?product=gmi.bm.nh1.normal&idc=asia-east-hanoi",
      rawPayload: { name: "gmi.bm.nh1.normal", idc: "asia-east-hanoi", price: 23200000, valid: true }
    },
    "latitude": {
      provider: "Latitude.sh",
      rawOfferId: "gpu-h100:dal",
      checkoutSemantics: "manual_provider",
      checkoutUrl: "https://metal.new?plan=gpu-h100&location=dal",
      rawPayload: {
        location: "dal",
        region: { locations: { in_stock: ["dal"], available: [] } }
      }
    },
    "ovhcloud": {
      provider: "OVHcloud",
      rawOfferId: "l40s-90:US-WEST-OR-1",
      checkoutSemantics: "manual_provider",
      checkoutUrl: "https://us.ovhcloud.com/manager/#/public-cloud/pci/projects/proj/instances/new",
      rawPayload: { name: "l40s-90", region: "US-WEST-OR-1", available: true }
    },
    "digitalocean": {
      provider: "DigitalOcean",
      rawOfferId: "gpu-h100x1-80gb",
      checkoutSemantics: "manual_provider",
      checkoutUrl: "https://cloud.digitalocean.com/droplets/new?size=gpu-h100x1-80gb",
      rawPayload: {
        slug: "gpu-h100x1-80gb",
        available: true,
        price_hourly: 3.39,
        gpu_info: { count: 1, vram: { amount: 80, unit: "gib" }, model: "nvidia_h100" }
      }
    },
  };

  // Mithril is intentionally excluded: it has a checkout-truth contract but its
  // volatile auction pricing means a Mithril row must never be orderable, so it
  // has no "orderable row" fixture here (see the dedicated guard test below).
  const expected = Object.entries(CHECKOUT_TRUTH_CONTRACTS)
    .filter(([providerId, contract]) => !contract.mustNotDisplay && providerId !== "mithril")
    .map(([providerId]) => providerId)
    .sort();
  assert.deepEqual(Object.keys(cases).sort(), expected);

  for (const [providerId, overrides] of Object.entries(cases)) {
    const item = createInventoryItem({
      providerId,
      gpuLabel: "1x H100 SXM 80GB",
      gpuCount: 1,
      totalHourlyPrice: 3.25,
      availability: "available",
      availabilitySemantics: providerId === "vast-ai" || providerId === "clore-ai" ? "host_capacity" : "sku_capacity",
      region: "us-east-1",
      listingType: "instance_type",
      priceScope: "node_total",
      sourceMode: "live",
      ...overrides
    });
    assert.equal(item.orderable, true, providerId);
    assert.deepEqual(validateCheckoutTruthItem(item).failures, [], providerId);
  }
});

test("Mithril volatile pricing keeps rows non-orderable, and the contract fails any orderable Mithril row", () => {
  const realItem = createInventoryItem({
    provider: "Mithril",
    providerId: "mithril",
    gpuLabel: "1x H100 SXM 80GB",
    gpuCount: 1,
    totalHourlyPrice: 3.25,
    availability: "available",
    availabilitySemantics: "host_capacity",
    listingType: "instance_type",
    priceScope: "node_total",
    sourceMode: "live",
    checkoutSemantics: "manual_provider",
    checkoutUrl: "https://app.mithril.ai",
    volatilePricing: true,
    rawPayload: {
      instanceType: { fid: "it_RrgkIZz6c9BZu5gi", gpu_type: "H100", num_gpus: 1 },
      region: "us-central3-a",
      pricing: { reserved_price_cents: 325, available_capacity: 3, total_capacity: 26 }
    }
  });
  assert.equal(realItem.orderable, false);
  assert.deepEqual(validateCheckoutTruthItem(realItem).failures, []);

  // Simulate a regression where the volatile-pricing guard is removed and the row
  // becomes orderable: the checkout-truth contract must catch it.
  const leaked = { ...realItem, orderable: true };
  const result = validateCheckoutTruthItem(leaked);
  assert.ok(result.failures.some((f) => /must not be displayed as orderable/i.test(f)));
});

test("Verda old non-project deploy route is not treated as prefilled checkout", () => {
  const item = createInventoryItem({
    provider: "Verda/DataCrunch",
    providerId: "verda-datacrunch",
    rawOfferId: "spot:8B300.240V:FIN-03",
    gpuLabel: "8x B300 SXM 262GB",
    gpuCount: 8,
    totalHourlyPrice: 21,
    availability: "available",
    availabilitySemantics: "sku_capacity",
    region: "FIN-03",
    listingType: "spot_instance_type",
    priceScope: "node_total",
    checkoutUrl: "https://console.verda.com/deploy?instance_type=8B300.240V&location_code=FIN-03&market=spot",
    sourceMode: "live",
    rawPayload: { spot_price: 21 }
  });

  const validation = validateCheckoutTruthItem(item);
  assert.match(validation.failures.join("\n"), /expected manual_provider/);
  assert.match(validation.failures.join("\n"), /not an approved prefilled_deploy route/);
});

test("catalog, pricing, and non-checkout providers are never searchable as orderable inventory", () => {
  const providerIds = Object.entries(CHECKOUT_TRUTH_CONTRACTS)
    .filter(([, contract]) => contract.mustNotDisplay)
    .map(([providerId]) => providerId);

  for (const providerId of providerIds) {
    const item = createInventoryItem({
      provider: providerId,
      providerId,
      rawOfferId: "catalog-row",
      gpuLabel: "8x H100 80GB",
      gpuCount: 8,
      totalHourlyPrice: 24,
      availability: "available",
      availabilitySemantics: "host_capacity",
      region: "us-east-1",
      listingType: "catalog",
      priceScope: "node_total",
      checkoutUrl: `https://example.com/deploy?provider=${providerId}`,
      checkoutSemantics: "prefilled_deploy",
      sourceMode: "live",
      rawPayload: { id: "catalog-row" }
    });

    const validation = validateCheckoutTruthSnapshot([item], [{ id: providerId, itemCount: 1 }]);
    assert.match(validation.failures.join("\n"), /must not (?:be )?display/, providerId);
  }
});

test("non-checkout providers infer provider-console semantics, not prefilled checkout", () => {
  const providerIds = Object.entries(CHECKOUT_TRUTH_CONTRACTS)
    .filter(([, contract]) => contract.mustNotDisplay)
    .map(([providerId]) => providerId);

  for (const providerId of providerIds) {
    const item = createInventoryItem({
      provider: providerId,
      providerId,
      rawOfferId: "console-row",
      gpuLabel: "8x H100 80GB",
      gpuCount: 8,
      totalHourlyPrice: 24,
      availability: "available",
      availabilitySemantics: "host_capacity",
      region: "us-east-1",
      listingType: "hostnode",
      priceScope: "node_total",
      checkoutUrl: `https://example.com/deploy?provider=${providerId}`,
      sourceMode: "live",
      rawPayload: { id: "console-row" }
    });

    assert.equal(item.checkoutSemantics, "provider_console", providerId);
    assert.equal(item.orderable, false, providerId);
  }
});

test("orderable rows must have provider-specific checkout proof and a non-generic checkout URL", () => {
  const lambda = createInventoryItem({
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
      instance_type: {
        price_cents_per_hour: 249,
        specs: { gpus: 1 }
      },
      regions_with_capacity_available: [{ name: "us-west-1" }]
    }
  });

  const validation = validateCheckoutTruthItem(lambda);
  assert.match(validation.failures.join("\n"), /checkoutUrl missing instance_type/);
  assert.match(validation.failures.join("\n"), /checkoutUrl missing region/);
});

test("catalog and region-offering providers cannot become displayed orderable rows", () => {
  const aws = createInventoryItem({
    provider: "AWS",
    providerId: "aws",
    rawOfferId: "us-east-1:us-east-1a:p5.48xlarge",
    gpuLabel: "8x H100 80GB",
    gpuCount: 8,
    totalHourlyPrice: 98,
    availability: "available",
    availabilitySemantics: "host_capacity",
    region: "us-east-1",
    listingType: "ec2_instance_type_offering",
    priceScope: "node_total",
    checkoutUrl: "https://console.aws.amazon.com/ec2/home?region=us-east-1#LaunchInstances:instanceType=p5.48xlarge",
    checkoutSemantics: "prefilled_deploy",
    sourceMode: "live",
    rawPayload: { instance_type: "p5.48xlarge" }
  });

  const validation = validateCheckoutTruthSnapshot([aws], [
    { id: "aws", itemCount: 1 }
  ]);
  assert.match(validation.failures.join("\n"), /must not be displayed/);
});

test("invalid GMI products are accepted as raw live data but not as orderable rows", () => {
  const gmi = createInventoryItem({
    provider: "GMI Cloud",
    providerId: "gmi",
    rawOfferId: "bare_metal:gmi.bm.nh1.normal:asia-east-hanoi",
    gpuLabel: "8x H100 80GB SXM",
    gpuCount: 8,
    totalHourlyPrice: 23.2,
    availability: "unavailable",
    availabilitySemantics: "sku_capacity",
    region: "asia-east-hanoi",
    listingType: "bare_metal_product",
    priceScope: "node_total",
    checkoutUrl: "https://console.gmicloud.ai/create?product=gmi.bm.nh1.normal&idc=asia-east-hanoi",
    sourceMode: "live",
    rawPayload: {
      name: "gmi.bm.nh1.normal",
      idc: "asia-east-hanoi",
      price: 23200000,
      valid: false
    }
  });

  assert.equal(gmi.orderable, false);
  const validation = validateCheckoutTruthItem(gmi);
  assert.deepEqual(validation.failures, []);
});
