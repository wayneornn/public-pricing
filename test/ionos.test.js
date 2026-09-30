import assert from "node:assert/strict";
import test from "node:test";
import { ionosBundleToItems } from "../src/connectors/live/providers/ionos.js";

// Fixture mirrors the real price-calculator bundle (verified live): the GPU catalog is
// embedded as self-describing JSON objects keyed by SKU id. The connector parses the
// GPUH200* objects out of the surrounding minified JS, derives GPU count from the SKU
// suffix (S/M/L/XL = 1/2/4/8), and attaches the bundle's static vCPU/RAM/storage table.
// USD is in the data → emitted directly (no FX). Non-GPU bundle noise must be ignored.
const BUNDLE = `someMinifiedJs(){};x=[{"id":"CPU","name":"per vCPU","pg":"A","pu":"per hour","priceLists":[{"name":"default","prices":{"USD":0.0175}}]},` +
  `{"id":"GPUH200S","name":"1h H200-S with AMD EPYC Turin and NVIDIA H200","pg":"A","pu":"per hour","priceLists":[{"name":"default","prices":{"EUR":3,"GBP":2.554,"USD":3.261,"CAD":4.438,"MXN":57.626}}]},` +
  `{"id":"GPUH200M","name":"1h H200-M with AMD EPYC Turin and NVIDIA H200","pg":"A","pu":"per hour","priceLists":[{"name":"default","prices":{"EUR":6,"GBP":5.109,"USD":6.521,"CAD":8.876,"MXN":115.252}}]},` +
  `{"id":"GPUH200L","name":"1h H200-L with AMD EPYC Turin and NVIDIA H200","pg":"A","pu":"per hour","priceLists":[{"name":"default","prices":{"EUR":12,"GBP":10.218,"USD":13.043,"CAD":17.752,"MXN":230.503}}]},` +
  `{"id":"GPUH200XL","name":"1h H200-XL with AMD EPYC Turin and NVIDIA H200","pg":"A","pu":"per hour","priceLists":[{"name":"default","prices":{"EUR":24,"GBP":20.436,"USD":26.086,"CAD":35.503,"MXN":461.007}}]}];`;

test("IONOS parses the 4 H200 SKUs and ignores non-GPU price objects", () => {
  const rows = ionosBundleToItems(BUNDLE);
  assert.equal(rows.length, 4); // CPU object ignored
  assert.ok(rows.every((r) => r.providerId === "ionos"));
  assert.ok(rows.every((r) => r.gpuModel === "H200"));
});

test("IONOS H200-S: 1 GPU, USD price direct, full specs", () => {
  const s = ionosBundleToItems(BUNDLE).find((r) => r.rawOfferId === "GPUH200S");
  assert.equal(s.gpuCount, 1);
  assert.equal(s.vramGbEach, 141);
  assert.equal(s.currency, "USD"); // USD in data -> no FX conversion
  assert.equal(s.totalHourlyPrice, 3.261);
  assert.equal(s.pricePerGpuHour, 3.261);
  assert.equal(s.cpu, "15 vCPU");
  assert.equal(s.ramGb, 267);
  assert.equal(s.storage, "1024 GB");
  assert.equal(s.interconnect, "PCIe");
});

test("IONOS H200-XL: 8 GPUs, per-GPU price and NVLink for multi-GPU", () => {
  const xl = ionosBundleToItems(BUNDLE).find((r) => r.rawOfferId === "GPUH200XL");
  assert.equal(xl.gpuCount, 8);
  assert.equal(xl.totalHourlyPrice, 26.086);
  assert.equal(xl.pricePerGpuHour, round(26.086 / 8));
  assert.equal(xl.cpu, "127 vCPU");
  assert.equal(xl.ramGb, 2136);
  assert.equal(xl.interconnect, "NVLink");
});

test("IONOS rows are non-orderable catalog and keep EUR in metadata", () => {
  const m = ionosBundleToItems(BUNDLE).find((r) => r.rawOfferId === "GPUH200M");
  assert.equal(m.gpuCount, 2);
  assert.equal(m.orderable, false);
  assert.equal(m.metadata.priceEur, 6);
});

function round(value) {
  return Math.round(value * 10000) / 10000;
}
