import assert from "node:assert/strict";
import test from "node:test";
import { leadergpuProductsToItems } from "../src/connectors/live/providers/leadergpu.js";

// Fixtures mirror real GET /users/{id}/servers/products objects (verified live):
// each physical server (server_configuration_id) appears as minute/day/week/month
// variants priced in EUR; free_time null = available now; code is GPU:Vendor:Model:Count.

function variant(cfgId, code, period, price, name, freeTime = null) {
  return { server_configuration_id: cfgId, code, period_type: period, period_count: 1, price: String(price), currency: "EUR", name, free_time: freeTime };
}

test("LeaderGPU groups billing variants per server and uses the per-minute on-demand rate", () => {
  const rows = leadergpuProductsToItems([
    variant(128, "GPU:Nvidia:3090:8:Minute", "minute", "0.08", "8 x 3090, 384 GB RAM (per-minute)"),
    variant(128, "GPU:Nvidia:3090:8:Day", "day", "60", "8 x 3090, 384 GB RAM (per-day)"),
    variant(128, "GPU:Nvidia:3090:8:Month", "month", "1200", "8 x 3090, 384 GB RAM (per-month)")
  ]);

  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.providerId, "leader-gpu");
  assert.equal(row.gpuModel, "RTX 3090");
  assert.equal(row.gpuCount, 8);
  assert.equal(row.formFactor, "bare_metal");
  // 0.08 EUR/min * 60 = 4.8 EUR/hr -> USD via FX (EUR 1.08) = 5.184
  assert.equal(row.nativeCurrency, "EUR");
  assert.equal(row.currency, "USD");
  assert.equal(row.totalHourlyPrice, 5.184);
  assert.equal(row.availability, "available");
  assert.equal(row.orderable, false); // provider_console catalog
});

test("LeaderGPU falls back to the daily rate when no per-minute tier exists", () => {
  const rows = leadergpuProductsToItems([
    variant(127, "GPU:Intel:Gaudi2:8:Intel:2:6338N:Day", "day", "716.37", "8 x Habana Gaudi-2, 2048GB RAM (per-day)"),
    variant(127, "GPU:Intel:Gaudi2:8:Intel:2:6338N:Week", "week", "990", "8 x Habana Gaudi-2 (per-week)")
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].gpuModel, "Gaudi2");
  assert.equal(rows[0].gpuCount, 8);
  // 716.37/24 = 29.849 EUR/hr -> *1.08 USD
  assert.equal(rows[0].totalHourlyPrice, round(round(716.37 / 24, 4) * 1.08));
  assert.match(rows[0].dataNotes.join(" | "), /day minimum commitment/i);
});

test("LeaderGPU parses datacenter models and counts from code+name", () => {
  const rows = leadergpuProductsToItems([
    variant(200, "GPU:Nvidia:H100:2:Minute", "minute", "2.0", "2 x H100 SXM, 1TB RAM (per-minute)"),
    variant(201, "GPU:Nvidia::A100", "minute", "1.5", "1 x A100 SXM4, 512GB RAM (per-minute)"),
    variant(202, "GPU:Nvidia:6000Ada:8:Minute", "minute", "3.0", "8 x RTX 6000 Ada (per-minute)")
  ]);
  const byModel = Object.fromEntries(rows.map((r) => [r.gpuModel, r]));
  assert.equal(byModel.H100.gpuCount, 2);
  assert.equal(byModel.H100.interconnect, "NVLink"); // SXM in name
  assert.equal(byModel.A100.gpuCount, 1);
  assert.equal(byModel["RTX 6000 Ada"].gpuCount, 8);
});

test("LeaderGPU marks unavailable when free_time is set", () => {
  const rows = leadergpuProductsToItems([
    variant(300, "GPU:Nvidia:4090:8:Minute", "minute", "0.1", "8 x 4090 (per-minute)", "2026-07-01T10:00:00+03:00")
  ]);
  assert.equal(rows[0].availability, "unavailable");
  assert.match(rows[0].dataNotes.join(" | "), /Free from 2026-07-01/);
});

function round(value) {
  return Math.round(value * 10000) / 10000;
}
