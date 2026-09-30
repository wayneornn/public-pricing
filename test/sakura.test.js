import assert from "node:assert/strict";
import test from "node:test";
import { sakuraToItems } from "../src/connectors/live/providers/sakura.js";
import { fxRateToUsd } from "../src/core/inventory.js";

const JPY = fxRateToUsd("JPY");
const usd = (jpy) => Math.round(jpy * JPY * 10000) / 10000;

// Fixture mirrors the real public price.json (verified live, is1a + is1b zones):
//   GET https://secure.sakura.ad.jp/cloud/zone/<zone>/api/cloud/1.1/public/price.json
//       -H "X-Requested-With: XMLHttpRequest"
// GPU plans are "cloud/uptime" classes whose ServiceClassName encodes cores/RAM/GPU-count
// (and VRAM for H100); model+count come from the DisplayName tail "…-H100x1". Non-GPU
// classes (plan/1, disks, …) must be ignored. Prices are whole-instance JPY/hour.

const IS1A = {
  Count: 4,
  ResponsedAt: "2026-06-13T00:06:55+09:00",
  ServiceClasses: {
    0: {
      DisplayName: "プラン1(ディスクなし)",
      IsPublic: true,
      Price: { Daily: 110, Hourly: 11, Monthly: 2179, Zone: "is1a" },
      ServiceCharge: "cloud/uptime",
      ServiceClassID: 50050,
      ServiceClassName: "plan/1",
      ServiceClassPath: "cloud/plan/1"
    },
    1: {
      DisplayName: "高火力 VRT/4Core-56GB-V100x1",
      IsPublic: true,
      Price: { Daily: 11550, Hourly: 481, Monthly: 231000, Zone: "is1a" },
      ServiceCharge: "cloud/uptime",
      ServiceClassID: 50761,
      ServiceClassName: "plan/4core-56gb-1gpu-g2",
      ServiceClassPath: "cloud/plan/4core-56gb-1gpu-g2"
    },
    2: {
      DisplayName: "高火力 VRT/24Core-240GB-H100x1",
      IsPublic: true,
      Price: { Daily: 23100, Hourly: 990, Monthly: 385000, Zone: "is1a" },
      ServiceCharge: "cloud/uptime",
      ServiceClassID: 51077,
      ServiceClassName: "plan/24core-240gb-1gpu-nvidia_h100_80gbvram-g2",
      ServiceClassPath: "cloud/plan/24core-240gb-1gpu-nvidia_h100_80gbvram-g2"
    }
  }
};

const IS1B = {
  Count: 1,
  ServiceClasses: {
    0: {
      DisplayName: "高火力 VRT/24Core-240GB-H100x1",
      IsPublic: true,
      Price: { Daily: 23100, Hourly: 990, Monthly: 385000, Zone: "is1b" },
      ServiceCharge: "cloud/uptime",
      ServiceClassID: 51051,
      ServiceClassName: "plan/24core-240gb-1gpu-nvidia_h100_80gbvram",
      ServiceClassPath: "cloud/plan/24core-240gb-1gpu-nvidia_h100_80gbvram"
    }
  }
};

test("Sakura emits only GPU plans and ignores non-GPU classes", () => {
  const rows = sakuraToItems(IS1A);
  assert.equal(rows.length, 2); // plan/1 (non-GPU) ignored
  assert.ok(rows.every((r) => r.providerId === "sakura"));
});

test("Sakura V100 plan: model/VRAM/cores/RAM and per-GPU price", () => {
  const v100 = sakuraToItems(IS1A).find((r) => r.gpuModel === "V100");
  assert.ok(v100, "expected a V100 row");
  assert.equal(v100.gpuCount, 1);
  assert.equal(v100.vramGbEach, 32); // not in name -> known Sakura V100 = 32GB
  assert.equal(v100.nativeCurrency, "JPY");
  assert.equal(v100.nativePricePerGpuHour, 481); // native JPY price preserved
  assert.equal(v100.totalHourlyPrice, usd(481)); // converted to USD via repo FX
  assert.equal(v100.cpu, "4 vCPU");
  assert.equal(v100.ramGb, 56);
  assert.equal(v100.region, "is1a");
  assert.equal(v100.rawOfferId, "is1a:plan/4core-56gb-1gpu-g2");
});

test("Sakura H100 plan: VRAM parsed from plan name", () => {
  const h100 = sakuraToItems(IS1A).find((r) => r.gpuModel === "H100");
  assert.ok(h100);
  assert.equal(h100.gpuCount, 1);
  assert.equal(h100.vramGbEach, 80); // "…_h100_80gbvram…"
  assert.equal(h100.nativePricePerGpuHour, 990);
  assert.equal(h100.totalHourlyPrice, usd(990));
  assert.equal(h100.cpu, "24 vCPU");
  assert.equal(h100.ramGb, 240);
});

test("Sakura prices are JPY and rows are non-orderable catalog", () => {
  const h100 = sakuraToItems(IS1A).find((r) => r.gpuModel === "H100");
  assert.equal(h100.currency, "USD"); // JPY converted via repo FX
  assert.match(h100.dataNotes.join(" | "), /JPY @|Converted to USD from JPY/i);
  assert.equal(h100.orderable, false);
});

test("Sakura keeps the same H100 SKU in a different zone as a distinct region offering", () => {
  const a = sakuraToItems(IS1A).find((r) => r.region === "is1a" && r.gpuModel === "H100");
  const b = sakuraToItems(IS1B).find((r) => r.region === "is1b" && r.gpuModel === "H100");
  assert.ok(a && b);
  assert.notEqual(a.rawOfferId, b.rawOfferId); // zone-scoped offer ids stay unique
  assert.equal(b.rawOfferId, "is1b:plan/24core-240gb-1gpu-nvidia_h100_80gbvram");
});
