import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOvhSignature,
  crawl,
  isOvhCloudGpuFlavor,
  ovhCloudFlavorToInventoryItem,
  parseOvhCloudGpu,
  parseOvhCloudPrice
} from "../src/providers/ovhcloud.js";

test("OVHcloud parser extracts public cloud flavor specs but keeps catalog non-orderable", () => {
  const flavor = {
    name: "t2-90",
    technicalName: "t2-90",
    region: "GRA11",
    available: true,
    gpu: 2,
    vcpus: 30,
    ram: 90000,
    disk: 400,
    bandwidth: 1000,
    hourly: {
      value: 1.12,
      currencyCode: "EUR"
    },
    planCodes: {
      hourly: "project.2018-instance-gpu-t2-90.hour.consumption"
    }
  };

  assert.equal(isOvhCloudGpuFlavor(flavor), true);
  assert.deepEqual(parseOvhCloudGpu(flavor), {
    count: 2,
    model: "V100",
    vramGbEach: 32,
    interconnect: "PCIe",
    inferred: true
  });

  const row = ovhCloudFlavorToInventoryItem(flavor, "project-123");
  assert.equal(row.providerId, "ovhcloud");
  assert.equal(row.gpuModel, "V100");
  assert.equal(row.gpuCount, 2);
  assert.equal(row.vramGbEach, 32);
  assert.equal(row.cpu, "30 vCPU");
  assert.equal(row.ramGb, 87.89);
  assert.equal(row.storage, "400 GB root");
  assert.equal(row.networkBandwidth, "1 Gbps");
  assert.equal(row.totalHourlyPrice, 1.2096);
  assert.equal(row.pricePerGpuHour, 0.6048);
  assert.equal(row.currency, "USD");
  assert.equal(row.nativeCurrency, "EUR");
  assert.equal(row.availabilitySemantics, "region_offering");
  assert.equal(row.checkoutSemantics, "provider_console");
  assert.equal(row.orderable, false);
  assert.match(row.orderabilityReason, /Provider adapter marked this row non-orderable/);
});

test("OVHcloud parser preserves explicit modern GPU model details when exposed", () => {
  const flavor = {
    name: "h100-240",
    technicalName: "H100-SXM-80GB",
    region: "GRA11",
    available: true,
    gpu: { count: 8, memory: "80GB" },
    hourly: "EUR 21.60"
  };

  const gpu = parseOvhCloudGpu(flavor);
  assert.equal(gpu.model, "H100");
  assert.equal(gpu.count, 8);
  assert.equal(gpu.vramGbEach, 80);
  assert.equal(gpu.interconnect, "NVLink");
  assert.equal(gpu.inferred, false);

  const row = ovhCloudFlavorToInventoryItem(flavor, "project-123");
  assert.equal(row.gpuModel, "H100");
  assert.equal(row.gpuVariant, "SXM");
  assert.equal(row.totalHourlyPrice, 23.328);
  assert.equal(row.currency, "USD");
  assert.equal(row.nativeCurrency, "EUR");
});

test("OVHcloud price parser handles OVH price objects and display strings", () => {
  assert.deepEqual(parseOvhCloudPrice({ value: 2.4, currencyCode: "EUR" }), {
    amount: 2.4,
    currency: "EUR"
  });
  assert.deepEqual(parseOvhCloudPrice("$3.25"), {
    amount: 3.25,
    currency: "USD"
  });
});

test("OVHcloud API signature matches OVH signed request contract", () => {
  assert.equal(buildOvhSignature({
    applicationSecret: "secret",
    consumerKey: "consumer",
    method: "GET",
    url: "https://eu.api.ovh.com/1.0/cloud/project",
    body: "",
    timestamp: 1234567890
  }), "$1$9b8038489ece32916d99600fbd128f129d1be29f");
});

test("OVHcloud crawl discovers projects and filters GPU flavors", async () => {
  const requests = [];
  const fetcher = async (url, options = {}) => {
    requests.push({ url, headers: options.headers || {} });
    if (url.endsWith("/cloud/project")) return jsonResponse(["project-a"]);
    if (url.endsWith("/cloud/project/project-a/flavor")) {
      return jsonResponse([
        { name: "b3-8", region: "GRA11", gpu: 0, ram: 16000, hourly: { value: 0.2, currencyCode: "EUR" } },
        { name: "l40s-90", region: "GRA11", gpu: 1, ram: 90000, hourly: { value: 1.8, currencyCode: "EUR" }, available: true }
      ]);
    }
    throw new Error(`unexpected request ${url}`);
  };

  const rows = await crawl({
    OVH_APPLICATION_KEY: "app",
    OVH_APPLICATION_SECRET: "secret",
    OVH_CONSUMER_KEY: "consumer"
  }, { fetcher, timestamp: "1234567890" });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].rawOfferId, "project-a:GRA11:l40s-90");
  assert.equal(rows[0].gpuModel, "L40S");
  assert.equal(rows[0].orderable, false);
  assert.equal(requests[0].headers["X-Ovh-Application"], "app");
  assert.equal(requests[0].headers["X-Ovh-Consumer"], "consumer");
  assert.match(requests[0].headers["X-Ovh-Signature"], /^\$1\$[a-f0-9]{40}$/);
});

test("OVHcloud crawl can use a configured singular project id", async () => {
  const requests = [];
  const fetcher = async (url, options = {}) => {
    requests.push({ url, headers: options.headers || {} });
    if (url.endsWith("/cloud/project/project-b/flavor")) {
      return jsonResponse([
        { name: "h100-240", region: "GRA11", gpu: { count: 8, memory: "80GB" }, hourly: { value: 21.6, currencyCode: "EUR" }, available: true }
      ]);
    }
    throw new Error(`unexpected request ${url}`);
  };

  const rows = await crawl({
    OVH_APPLICATION_KEY: "app",
    OVH_APPLICATION_SECRET: "secret",
    OVH_CONSUMER_KEY: "consumer",
    OVH_PUBLIC_CLOUD_PROJECT_ID: "project-b"
  }, { fetcher, timestamp: "1234567890" });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].rawOfferId, "project-b:GRA11:h100-240");
  assert.equal(rows[0].gpuModel, "H100");
  assert.equal(rows[0].orderable, false);
  assert.equal(requests.length, 1);
});

function jsonResponse(value) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    async text() {
      return JSON.stringify(value);
    }
  };
}
