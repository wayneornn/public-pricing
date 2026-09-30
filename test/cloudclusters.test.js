import assert from "node:assert/strict";
import test from "node:test";
import { cloudclustersHtmlToItems, extractCloudclustersPlans } from "../src/connectors/live/providers/cloudclusters.js";

const HTML = `
Enterprise Dedicated GPU Server - H100
$ 2099.00 /mo
1mo 3mo 12mo 24mo Order Now
GPU Model: H100
CPU: 36-Core Dual E5-2697v4
Memory: 256GB RAM
Disk: 240GB SSD+2TB NVMe+8TB SATA
Bandwidth: 100Mbps Unmetered
GPU Memory: 80 GB HBM2e
IP: 1 Dedicated IPv4
Location: USA
Enterprise Multi-GPU Dedicated Server - 2xRTX 4090
$ 729.00 /mo
GPU Model: 2 x RTX 4090
CPU: 36-Core Dual E5-2697v4
Memory: 256GB RAM
Disk: 240GB SSD+2TB NVMe+8TB SATA
Bandwidth: 1000Mbps Unmetered
GPU Memory: 24 GB GDDR6X
IP: 1 Dedicated IPv4
Location: USA`;

test("CloudClusters extracts monthly GPU server plans", () => {
  const plans = extractCloudclustersPlans(HTML);
  assert.equal(plans.length, 2);
  assert.equal(plans[0].monthlyUsd, 2099);
  assert.equal(plans[1].gpuModel, "2 x RTX 4090");
});

test("CloudClusters normalizes monthly price to hourly and keeps non-orderable semantics", () => {
  const items = cloudclustersHtmlToItems(HTML);
  const h100 = items.find((item) => item.rawOfferId.includes("h100"));
  assert.equal(h100.priceScope, "monthly_equivalent");
  assert.equal(h100.pricePerGpuHour, 2.8753);
  assert.equal(h100.currency, "USD");
  assert.equal(h100.checkoutSemantics, "provider_console");
  assert.equal(h100.orderable, false);
});
