import assert from "node:assert/strict";
import test from "node:test";
import { hasNscaleConfiguration, isNscaleGpuFlavor, nscaleFlavorToInventoryItem } from "../src/providers/nscale.js";

test("Nscale configuration accepts official service token names and explicit disable", () => {
  assert.equal(hasNscaleConfiguration({ NSCALE_SERVICE_TOKEN: "service-token" }), true);
  assert.equal(hasNscaleConfiguration({ NSCALE_API_TOKEN: "api-token" }), true);
  assert.equal(hasNscaleConfiguration({ NSCALE_TOKEN: "token" }), true);
  assert.equal(hasNscaleConfiguration({ NSCALE_SERVICE_TOKEN: "service-token", NSCALE_COMPUTE_ENABLED: "0" }), false);
  assert.equal(hasNscaleConfiguration({}), false);
});

test("Nscale parser extracts flavor specs but keeps accessible flavors non-orderable", () => {
  const flavor = {
    metadata: {
      id: "flavor-h100-8x",
      name: "g.8.h100.80gb"
    },
    spec: {
      architecture: "x86_64",
      cpus: 192,
      cpuFamily: "AMD EPYC",
      disk: 7200,
      memory: 1800,
      gpu: {
        vendor: "NVIDIA",
        model: "H100",
        memory: 80,
        physicalCount: 8
      }
    }
  };
  const region = {
    id: "uk-west-1",
    name: "uk-west-1",
    spec: { features: { physicalNetworks: true } }
  };
  const organization = { id: "org-123", name: "ornn" };

  assert.equal(isNscaleGpuFlavor(flavor), true);
  const row = nscaleFlavorToInventoryItem(flavor, region, organization);

  assert.equal(row.providerId, "nscale");
  assert.equal(row.gpuModel, "H100");
  assert.equal(row.gpuCount, 8);
  assert.equal(row.vramGbEach, 80);
  assert.equal(row.cpu, "192 vCPU");
  assert.equal(row.ramGb, 1800);
  assert.equal(row.networkFabric, "Not exposed");
  assert.match(row.networkBandwidth, /physical networks/);
  assert.equal(row.availabilitySemantics, "region_offering");
  assert.equal(row.checkoutSemantics, "provider_console");
  assert.equal(row.orderable, false);
  assert.match(row.orderabilityReason, /Availability truth is region_offering/);
});
