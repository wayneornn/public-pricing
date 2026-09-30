import assert from "node:assert/strict";
import test from "node:test";
import { polarisPricingToItems } from "../src/connectors/live/providers/polaris.js";

const PAYLOAD = {
  currency: "USD",
  gpus: [
    { billing_key: "elite_80gb", display_name: "H100 SXM5 80GB", spot_per_hour: 1.602, on_demand_per_hour: 2.748 },
    { billing_key: "broken", display_name: "No Price 80GB", spot_per_hour: 1.1 }
  ],
  cpus: [
    { billing_key: "cpu_small", display_name: "CPU Small (4 vCPU / 16 GB)", on_demand_per_hour: 0.03 }
  ]
};

test("Polaris parses public on-demand GPU prices and drops unpriced rows", () => {
  const items = polarisPricingToItems(PAYLOAD);
  assert.equal(items.length, 1);
  assert.equal(items[0].rawOfferId, "polaris:elite-80gb:on-demand");
  assert.equal(items[0].gpuLabel, "1x H100 SXM5 80GB");
  assert.equal(items[0].pricePerGpuHour, 2.748);
  assert.equal(items[0].metadata.spotPerHour, 1.602);
});

test("Polaris rows are non-orderable USD catalog rows", () => {
  const [item] = polarisPricingToItems(PAYLOAD);
  assert.equal(item.providerId, "polaris");
  assert.equal(item.currency, "USD");
  assert.equal(item.checkoutSemantics, "provider_console");
  assert.equal(item.orderable, false);
});
