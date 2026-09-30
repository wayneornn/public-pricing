import assert from "node:assert/strict";
import test from "node:test";
import {
  azureInventoryRowToInventoryItem,
  azurePublicRetailItemsToRows,
  azureSkuToOfferings,
  mapAzureGpuSku,
  parseAzureSkuMetadata,
  parseRetailPrices
} from "../src/providers/azure.js";

const h100Sku = {
  name: "Standard_NC40ads_H100_v5",
  resourceType: "virtualMachines",
  locations: ["eastus"],
  locationInfo: [
    {
      location: "eastus",
      zones: ["1", "2"]
    }
  ],
  restrictions: [
    {
      type: "Zone",
      reasonCode: "NotAvailableForSubscription",
      restrictionInfo: {
        locations: ["eastus"],
        zones: ["2"]
      }
    }
  ],
  capabilities: [
    { name: "GPUs", value: "1" },
    { name: "GPUMemoryGB", value: "80" },
    { name: "vCPUs", value: "40" },
    { name: "MemoryGB", value: "320" },
    { name: "AcceleratedNetworkingEnabled", value: "True" },
    { name: "PremiumIO", value: "True" },
    { name: "MaxResourceVolumeMB", value: "327680" },
    { name: "HyperVGenerations", value: "V2" }
  ]
};

test("Azure SKU parser extracts GPU and machine metadata", () => {
  const parsed = parseAzureSkuMetadata(h100Sku);
  assert.equal(parsed.sku_name, "Standard_NC40ads_H100_v5");
  assert.equal(parsed.gpu_model, "H100");
  assert.equal(parsed.gpu_count, 1);
  assert.equal(parsed.gpu_memory_gb, 80);
  assert.equal(parsed.vcpu, 40);
  assert.equal(parsed.ram_gb, 320);
  assert.equal(parsed.accelerated_networking, true);
  assert.equal(parsed.premium_storage, true);
  assert.equal(parsed.local_storage, "320 GB");
  assert.equal(parsed.generation, "V2");
});

test("Azure GPU mapping covers requested families", () => {
  assert.deepEqual(mapAzureGpuSku("Standard_NC4as_T4_v3", { GPUs: "1" }), {
    gpu_model: "T4",
    gpu_count: 1,
    gpu_memory_gb: 16
  });
  assert.deepEqual(mapAzureGpuSku("Standard_NV6adsA10_v5", { GPUs: "0.1667" }), {
    gpu_model: "A10",
    gpu_count: 0.1667,
    gpu_memory_gb: 4
  });
  assert.equal(mapAzureGpuSku("Standard_ND96amsr_A100_v4", { GPUs: "8" }).gpu_model, "A100");
  assert.equal(mapAzureGpuSku("Standard_ND96isr_H100_v5", { GPUs: "8" }).gpu_model, "H100 SXM");
});

test("Azure offering extraction expands regions, zones, and restrictions", () => {
  const rows = azureSkuToOfferings(h100Sku);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].region, "eastus");
  assert.equal(rows[0].availability_zone, "1");
  assert.equal(rows[0].offered, true);
  assert.equal(rows[0].restriction_reason, "");
  assert.equal(rows[1].availability_zone, "2");
  assert.match(rows[1].restriction_reason, /NotAvailableForSubscription/);
});

test("Azure Retail Prices parser extracts On-Demand VM price", () => {
  const rows = parseRetailPrices([
    {
      serviceName: "Virtual Machines",
      currencyCode: "USD",
      unitOfMeasure: "1 Hour",
      armRegionName: "eastus",
      armSkuName: "Standard_NC40ads_H100_v5",
      meterName: "NC40ads H100 v5",
      productName: "Virtual Machines NC H100 v5 Series",
      retailPrice: 12.34,
      unitPrice: 12.34,
      type: "Consumption"
    },
    {
      serviceName: "Virtual Machines",
      currencyCode: "USD",
      unitOfMeasure: "1 Hour",
      armRegionName: "eastus",
      armSkuName: "Standard_NC40ads_H100_v5",
      meterName: "NC40ads H100 v5",
      productName: "Virtual Machines NC H100 v5 Series Windows",
      retailPrice: 2,
      unitPrice: 2,
      type: "Consumption"
    },
    {
      serviceName: "Virtual Machines",
      currencyCode: "USD",
      unitOfMeasure: "1 Hour",
      armRegionName: "eastus",
      armSkuName: "Standard_NC40ads_H100_v5",
      meterName: "NC40ads H100 v5 Spot",
      productName: "Virtual Machines NC H100 v5 Series",
      retailPrice: 4.56,
      unitPrice: 4.56,
      type: "Consumption"
    }
  ], new Set(["Standard_NC40ads_H100_v5"]), { spot: false });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].on_demand_price_usd_per_hour, 12.34);
  assert.equal(rows[0].meterName, "NC40ads H100 v5");
});

test("Azure Retail Prices parser extracts Spot VM price", () => {
  const rows = parseRetailPrices([
    {
      serviceName: "Virtual Machines",
      currencyCode: "USD",
      unitOfMeasure: "1 Hour",
      armRegionName: "eastus",
      armSkuName: "Standard_NC40ads_H100_v5",
      meterName: "NC40ads H100 v5 Spot",
      productName: "Virtual Machines NC H100 v5 Series",
      retailPrice: 4.56,
      unitPrice: 4.56,
      type: "Consumption"
    }
  ], new Set(["Standard_NC40ads_H100_v5"]), { spot: true });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].spot_price_usd_per_hour, 4.56);
});

test("Azure public retail prices keep known on-demand VM sizes and drop spot rows", () => {
  const rows = azurePublicRetailItemsToRows([
    {
      serviceName: "Virtual Machines",
      currencyCode: "USD",
      unitOfMeasure: "1 Hour",
      type: "Consumption",
      armSkuName: "Standard_ND96isr_H100_v5",
      armRegionName: "eastus",
      productName: "Virtual Machines NDsr H100 v5 Series Linux",
      meterName: "ND96isr H100 v5",
      retailPrice: 98.32
    },
    {
      serviceName: "Virtual Machines",
      currencyCode: "USD",
      unitOfMeasure: "1 Hour",
      type: "Consumption",
      armSkuName: "Standard_ND96isr_H100_v5",
      armRegionName: "eastus",
      productName: "Virtual Machines NDsr H100 v5 Series Linux",
      meterName: "ND96isr H100 v5",
      retailPrice: 120
    },
    {
      serviceName: "Virtual Machines",
      currencyCode: "USD",
      unitOfMeasure: "1 Hour",
      type: "Consumption",
      armSkuName: "Standard_NC40ads_H100_v5",
      armRegionName: "eastus",
      productName: "Virtual Machines NCads H100 v5 Series",
      meterName: "NC40ads H100 v5 Low Priority",
      retailPrice: 3.63
    },
    {
      serviceName: "Virtual Machines",
      currencyCode: "USD",
      unitOfMeasure: "1 Hour",
      type: "Consumption",
      armSkuName: "Standard_ND128isr_NDR_GB200_v6",
      armRegionName: "eastus",
      productName: "Virtual Machines NDsr GB200 v6 Series",
      meterName: "ND128isr",
      retailPrice: 108.16
    }
  ], { now: "2026-09-30T00:00:00.000Z" });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].gpu_count, 8);
  assert.equal(rows[0].gpu_memory_gb, 80);
  assert.equal(rows[0].on_demand_price_usd_per_hour, 98.32);
  assert.equal(rows[0].network_fabric, "InfiniBand");
  const item = azureInventoryRowToInventoryItem(rows[0]);
  assert.equal(item.provider, "Azure");
  assert.equal(item.gpuModel, "H100");
  assert.equal(item.gpuVariant, "SXM");
  assert.equal(item.gpuCount, 8);
  assert.equal(item.pricePerGpuHour, 12.29);
  assert.equal(item.totalHourlyPrice, 98.32);
  assert.equal(item.orderable, false);
});
