import assert from "node:assert/strict";
import test from "node:test";
import { qubridHtmlToItems, extractQubridConfigs } from "../src/connectors/live/providers/qubrid.js";

// Mirrors the live Qubrid pricing page embedded (minified) JS catalog (captured 2026-06-13).
// prices.hourly.amount is the whole-config hourly USD rate; an 8-GPU config is 8x the 1-GPU
// rate, so per-GPU = amount / gpuCount. availability:!0 / !1 is true / false.
const HTML = `window.__data = [
{id:"nvidia-h100-80gb-1-0",family:"NVIDIA H100 (80GB)",name:"NVIDIA H100 (80GB) - 1 GPU",gpuCount:"1",gpuMemory:"80 GB",ram:"200 GB",vcpu:"16",storage:"2500 GB",networkBandwidth:null,bootTime:"5 to 10 Minutes",prices:{hourly:{amount:3.83,availability:!0},weekly:{amount:3.45,availability:!0},monthly:{amount:3.06,availability:!0}}},
{id:"nvidia-h100-80gb-8-0",family:"NVIDIA H100 (80GB)",name:"NVIDIA H100 (80GB) - 8 GPUs",gpuCount:"8",gpuMemory:"80 GB",ram:"1600 GB",vcpu:"128",storage:"20000 GB",prices:{hourly:{amount:30.64,availability:!0},monthly:{amount:24.48,availability:!0}}},
{id:"nvidia-l40s-48gb-1-0",family:"NVIDIA L40S (48GB)",name:"NVIDIA L40S (48GB) - 1 GPU",gpuCount:"1",gpuMemory:"48 GB",ram:"100 GB",vcpu:"12",storage:"1000 GB",prices:{hourly:{amount:2.42,availability:!1},weekly:{amount:2.18,availability:!0}}}
];`;

test("Qubrid parses embedded configs into per-GPU rows", () => {
  const items = qubridHtmlToItems(HTML);
  const h100 = items.find((i) => i.rawOfferId === "nvidia-h100-80gb-1-0");
  assert.ok(h100, "H100 1-GPU row present");
  assert.equal(h100.gpuCount, 1);
  assert.equal(h100.vramGbEach, 80);
  assert.equal(h100.totalHourlyPrice, 3.83);
  assert.equal(h100.pricePerGpuHour, 3.83);
  assert.equal(h100.metadata.gpuModel ?? h100.gpuLabel.includes("H100"), true);
});

test("Qubrid derives per-GPU price from the whole-config amount (8-GPU)", () => {
  const items = qubridHtmlToItems(HTML);
  const h100x8 = items.find((i) => i.rawOfferId === "nvidia-h100-80gb-8-0");
  assert.equal(h100x8.gpuCount, 8);
  assert.equal(h100x8.totalHourlyPrice, 30.64);
  assert.equal(h100x8.pricePerGpuHour, 3.83); // 30.64 / 8
});

test("Qubrid maps the hourly availability flag", () => {
  const items = qubridHtmlToItems(HTML);
  const l40s = items.find((i) => i.rawOfferId === "nvidia-l40s-48gb-1-0");
  assert.equal(l40s.availability, "unavailable"); // availability:!1
  const h100 = items.find((i) => i.rawOfferId === "nvidia-h100-80gb-1-0");
  assert.equal(h100.availability, "available"); // availability:!0
});

test("Qubrid extracts exactly the catalog configs and is non-orderable", () => {
  const configs = extractQubridConfigs(HTML);
  assert.equal(configs.length, 3);
  const items = qubridHtmlToItems(HTML);
  for (const item of items) {
    assert.equal(item.providerId, "qubrid");
    assert.equal(item.checkoutSemantics, "provider_console");
    assert.equal(item.currency, "USD");
  }
});
