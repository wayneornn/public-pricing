import assert from "node:assert/strict";
import test from "node:test";
import { chargHtmlToItems } from "../src/connectors/live/providers/charg.js";

const HTML = `
Simple, Predictable GPU Cloud Pricing
From $0.99/hr for a single GPU, scaling up to $17/hr for a full 8x V100 node
(64 vCPU, 512 GB RAM, 1.9 TB NVMe).
200 Gbit Infiniband Networking.
`;

test("Charg extracts the public whole-node GPU price", () => {
  const items = chargHtmlToItems(HTML);
  assert.equal(items.length, 1);
  assert.equal(items[0].rawOfferId, "charg:8x-v100");
  assert.equal(items[0].gpuCount, 8);
  assert.equal(items[0].totalHourlyPrice, 17);
  assert.equal(items[0].pricePerGpuHour, 2.125);
});

test("Charg rows are non-orderable USD price catalog", () => {
  const [item] = chargHtmlToItems(HTML);
  assert.equal(item.providerId, "charg");
  assert.equal(item.currency, "USD");
  assert.equal(item.checkoutSemantics, "provider_console");
  assert.equal(item.orderable, false);
});
