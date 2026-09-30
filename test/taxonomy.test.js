import assert from "node:assert/strict";
import test from "node:test";
import { extractGpuCount, gpuTier, inferCountry, normalizeGpuLabel, normalizeRegion } from "../src/core/taxonomy.js";

test("normalizes H100 SXM labels", () => {
  const gpu = normalizeGpuLabel("8x NVIDIA H100 SXM5 80GB");
  assert.equal(gpu.model, "H100");
  assert.equal(gpu.variant, "SXM");
  assert.equal(gpu.vramGbEach, 80);
});

test("normalizes H200 labels with VRAM", () => {
  const gpu = normalizeGpuLabel("H200-141G-SXM5");
  assert.equal(gpu.model, "H200");
  assert.equal(gpu.variant, "SXM");
  assert.equal(gpu.vramGbEach, 141);
});

test("extracts GPU counts from marketplace labels", () => {
  assert.equal(extractGpuCount("8x NVIDIA H100 SXM"), 8);
  assert.equal(extractGpuCount("H100 80GB x4"), 4);
  assert.equal(extractGpuCount("4x NVIDIA TITAN RTX"), 4);
  assert.equal(extractGpuCount("2x NVIDIA GeForce GTX 1080 Ti"), 2);
});

test("normalizes common marketplace GPU labels", () => {
  const cases = [
    ["RTX 4070S Ti", "RTX 4070 Ti"],
    ["RTX 4090D", "RTX 4090D"],
    ["RTX 4500Ada", "RTX 4500 Ada"],
    ["RTX 4060 Ti", "RTX 4060 Ti"],
    ["Titan RTX", "Titan RTX"],
    ["Q RTX 8000", "Quadro RTX 8000"],
    ["A100_80G", "A100"],
    ["NVIDIA B200 GPU running in Americas", "B200"],
    ["NVIDIA B300 SXM", "B300"],
    ["NVIDIA GB200 Grace Blackwell Superchip running in us-central1", "GB200"],
    ["NVIDIA GB300 NVL72", "GB300"],
    ["1x A16 16GB", "A16"],
    ["1x L4 24GB", "L4"],
    ["NVIDIA P100 GPU running in Europe", "P100"],
    ["1x A10 24GB PCIe", "A10"],
    ["16x Trainium2 trn2.48xlarge", "Trainium2"],
    ["12x Inferentia2 inf2.48xlarge", "Inferentia2"],
    ["8x RTX PRO Server 6000 96GB g7e.48xlarge", "RTX PRO 6000"],
    ["1x MI25 16GB Standard_NV8as_v4", "MI25"]
  ];

  for (const [label, expectedModel] of cases) {
    assert.equal(normalizeGpuLabel(label).model, expectedModel);
  }
});

test("delineates Grace-Blackwell GB-series from standalone B-series", () => {
  // The GB superchips must not collapse into the bare B200/B300 GPU entries,
  // and the bare B-series labels must not be mistaken for the GB superchips.
  assert.equal(normalizeGpuLabel("GB200").model, "GB200");
  assert.equal(normalizeGpuLabel("GB300").model, "GB300");
  assert.equal(normalizeGpuLabel("B200").model, "B200");
  assert.equal(normalizeGpuLabel("B300").model, "B300");
  assert.notEqual(normalizeGpuLabel("GB200").model, "B200");
  assert.notEqual(normalizeGpuLabel("GB300").model, "B300");
});

test("normalizes common regions", () => {
  assert.equal(normalizeRegion("US East").canonical, "us-east");
  assert.equal(normalizeRegion("us-east-1").canonical, "us-east");
  assert.equal(normalizeRegion("France").canonical, "europe");
});

test("maps E2E India locations to Asia and country IN (B3)", () => {
  for (const city of ["Delhi", "Mumbai", "Chennai"]) {
    const region = normalizeRegion(city);
    assert.equal(region.canonical, "asia", `${city} should canonicalize to asia`);
    assert.equal(region.raw, city, `${city} should keep its raw label for display`);
    assert.equal(inferCountry(city), "IN", `${city} should infer country IN`);
  }
  assert.equal(inferCountry("India"), "IN");
});

test("recognizes Intel Gaudi accelerators (L2)", () => {
  const gaudi3 = normalizeGpuLabel("8x Intel Gaudi 3 HL-325 128GB OAM");
  assert.equal(gaudi3.model, "Gaudi3");
  assert.equal(gaudi3.variant, "OAM");
  assert.equal(gaudi3.vramGbEach, 128);

  assert.equal(normalizeGpuLabel("Intel Gaudi2 96GB").model, "Gaudi2");
  assert.equal(normalizeGpuLabel("HL-225").model, "Gaudi2");

  // Bare "Gaudi" must fall through to the first-gen entry, not Gaudi2/Gaudi3.
  assert.equal(normalizeGpuLabel("Intel Gaudi HL-205").model, "Gaudi");

  // Previously unknown; now classified instead of rank 0 / "Unknown".
  assert.notEqual(normalizeGpuLabel("Gaudi2").model, "Unknown");
  assert.ok(normalizeGpuLabel("Gaudi3").rank > 0);
});

test("extracts GPU count for Gaudi labels (L2)", () => {
  assert.equal(extractGpuCount("8x Gaudi3 OAM"), 8);
  assert.equal(extractGpuCount("4x Intel Gaudi2"), 4);
});

test("classifies consumer vs datacenter GPU tiers", () => {
  // Consumer / gaming GPUs (dominant on vast.ai / clore.ai marketplaces).
  for (const label of [
    "RTX 4090",
    "8x NVIDIA GeForce RTX 4090 24GB",
    "RTX 3090",
    "RTX 5090",
    "Titan RTX",
    "2x NVIDIA GeForce GTX 1080 Ti"
  ]) {
    assert.equal(normalizeGpuLabel(label).tier, "consumer", `${label} should be consumer`);
  }

  // Datacenter / professional GPUs.
  for (const label of [
    "8x NVIDIA H100 SXM5 80GB",
    "A100 80GB",
    "L40S",
    "1x L4 24GB",
    "RTX A6000",
    "RTX PRO 6000",
    "8x Intel Gaudi 3 HL-325 128GB OAM"
  ]) {
    assert.equal(normalizeGpuLabel(label).tier, "datacenter", `${label} should be datacenter`);
  }
});

test("gpuTier falls back to label regex for unrecognized consumer cards", () => {
  // vast.ai-style labels the taxonomy may not map to a known model.
  assert.equal(gpuTier("Unknown", "GeForce RTX 4080S"), "consumer");
  assert.equal(gpuTier("Unknown", "NVIDIA Titan V"), "consumer");
  assert.equal(gpuTier("Unknown", "Some Future Datacenter Card"), "datacenter");
});
