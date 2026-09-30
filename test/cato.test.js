import assert from "node:assert/strict";
import test from "node:test";
import { catoHtmlToItems, extractCatoRows } from "../src/connectors/live/providers/cato.js";

const HTML = `
g2.large g2.medium g2.xlarge
Processor: 2 x Intel Xeon 8168 2 x Intel Xeon E5-2680v4 2 x Intel Xeon 8174
vCores: 96 56 96
Hourly 1 : $ 11.1990 $ 6.6290 $ 26.9520
Monthly 2 : $ 4,905.16 $ 2,903.50 $ 11,804.98
Memory: 512GB 512GB 1536GB
Network Speed: 100Gbps 25Gbps 100Gbps
GPU: 8x Nvidia V100 (32GB) 8x Nvidia V100 (16GB) 16x Nvidia V100 (32GB)
GPU Memory: 256GB 128GB 512GB
Cuda Cores: 40,960 40,960 81,920
Tensor Cores: 5,120 5,120 10,240`;

test("Cato extracts whole-node hourly rows", () => {
  const rows = extractCatoRows(HTML);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].sku, "g2.large");
  assert.equal(rows[0].totalHourlyPrice, 11.199);
  assert.equal(rows[2].gpuText, "16x Nvidia V100 (32GB)");
});

test("Cato computes per-GPU price and marks catalog non-orderable", () => {
  const items = catoHtmlToItems(HTML);
  const large = items.find((item) => item.rawOfferId === "cato:g2.large");
  assert.equal(large.gpuCount, 8);
  assert.equal(large.pricePerGpuHour, 1.3999);
  assert.equal(large.currency, "USD");
  assert.equal(large.checkoutSemantics, "provider_console");
  assert.equal(large.orderable, false);
});
