import assert from "node:assert/strict";
import test from "node:test";
import {
  parseGetdeployingIndex,
  selectGetdeployingModels,
  parseGetdeployingDetail
} from "../src/connectors/live/providers/getdeploying.js";

// Mirrors the live getDeploying reference pages (captured 2026-06-14).
const INDEX = `
<table>
<tr data-gpu data-segment="HIGH_PERFORMANCE" data-name="Nvidia H100" data-vram="80.0" data-minprice="0.4478" data-providers="45"></tr>
<tr data-gpu data-segment="HIGH_PERFORMANCE" data-name="Nvidia A100" data-vram="80.0" data-minprice="0.66" data-providers="38"></tr>
<tr data-gpu data-segment="MID" data-name="Nvidia L4" data-vram="24.0" data-minprice="0.20" data-providers="9"></tr>
</table>`;

const DETAIL = `
<tr data-offering-id="120528" data-provider="lyceum" data-billing="ON_DEMAND" data-gpu-count="1" data-vram="80" data-price="2.7900" data-price-per-gpu="2.79" data-availability="UNKNOWN" data-source-url-organic="https://lyceum.technology/pricing"></tr>
<tr data-offering-id="30288" data-provider="sesterce" data-billing="ON_DEMAND" data-gpu-count="1" data-vram="80" data-price="2.0900" data-price-per-gpu="2.09" data-availability="AVAILABLE" data-source-url-organic=""></tr>
<tr data-offering-id="99999" data-provider="vastai" data-billing="SPOT" data-gpu-count="1" data-vram="80" data-price="0.4500" data-price-per-gpu="0.45" data-availability="AVAILABLE"></tr>
<tr data-offering-id="88888" data-provider="aws" data-billing="RESERVED" data-gpu-count="8" data-vram="80" data-price="40.00" data-price-per-gpu="5.00"></tr>`;

test("getDeploying index parses model cards and ranks by provider count", () => {
  const models = parseGetdeployingIndex(INDEX);
  assert.equal(models.length, 3);
  assert.equal(models[0].slug, "nvidia-h100");
  assert.equal(models[0].providers, 45);
  const top2 = selectGetdeployingModels(models, { GETDEPLOYING_MAX_MODELS: "2" });
  assert.deepEqual(top2.map((m) => m.slug), ["nvidia-h100", "nvidia-a100"]);
});

test("getDeploying detail keeps only ON_DEMAND offerings (spot/reserved dropped)", () => {
  const offerings = parseGetdeployingDetail(DETAIL);
  assert.equal(offerings.length, 2);
  assert.deepEqual(offerings.map((o) => o.provider).sort(), ["lyceum", "sesterce"]);
  assert.equal(offerings[0].pricePerGpuHour, 2.79);
  assert.ok(!offerings.some((o) => o.provider === "vastai"), "spot dropped");
  assert.ok(!offerings.some((o) => o.provider === "aws"), "reserved dropped");
});

test("getDeploying allowlist override selects exactly the named slugs", () => {
  const models = parseGetdeployingIndex(INDEX);
  const picked = selectGetdeployingModels(models, { GETDEPLOYING_MODELS: "nvidia-l4" });
  assert.deepEqual(picked.map((m) => m.slug), ["nvidia-l4"]);
});
