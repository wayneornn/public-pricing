import assert from "node:assert/strict";
import test from "node:test";
import { uthoBundleToItems, uthoBundleUrl } from "../src/connectors/live/providers/utho.js";

const HTML = `<!doctype html><html><head><script type="module" crossorigin src="/assets/index-0sX1sg8r.js"></script></head></html>`;

const BUNDLE = `const iW=[
{name:"A6000 Blackwell",vram:"96 GB",vcpu:"16 vCPU",ram:"128 GB RAM",monthly:93995,sixMonths:535771.5,twelveMonths:992587.2,popular:!0},
{name:"RTX 6000",vram:"48 GB",vcpu:"8 vCPU",ram:"32 GB RAM",monthly:51995,sixMonths:296371.5,twelveMonths:561546},
{name:"A40",vram:"48 GB",vcpu:"8 vCPU",ram:"32 GB RAM",monthly:49995,sixMonths:284971.5,twelveMonths:539946}
],oW=[];`;

test("Utho resolves the public GPU page module bundle URL", () => {
  assert.equal(
    uthoBundleUrl(HTML, "https://utho.com/gpu"),
    "https://utho.com/assets/index-0sX1sg8r.js"
  );
});

test("Utho parses public GPU page bundle pricing into non-orderable catalog rows", () => {
  const rows = uthoBundleToItems(BUNDLE, {
    sourceUrl: "https://utho.com/gpu",
    bundleUrl: "https://utho.com/assets/index-0sX1sg8r.js"
  });
  assert.equal(rows.length, 3);

  const row = rows[0];
  assert.equal(row.providerId, "utho");
  assert.equal(row.rawOfferId, "a6000-blackwell");
  assert.equal(row.gpuLabel, "1x A6000 Blackwell 96GB");
  assert.equal(row.gpuCount, 1);
  assert.equal(row.vramGbEach, 96);
  assert.equal(row.cpu, "16 vCPU");
  assert.equal(row.ramGb, 128);
  assert.equal(row.nativeCurrency, "INR");
  assert.equal(row.currency, "USD");
  assert.equal(row.nativePricePerGpuHour, 128.7603);
  assert.equal(row.pricePerGpuHour, 1.5451);
  assert.equal(row.totalHourlyPrice, 1.5451);
  assert.equal(row.metadata.monthlyInr, 93995);
  assert.equal(row.metadata.sixMonthsInr, 535771.5);
  assert.equal(row.metadata.twelveMonthsInr, 992587.2);
  assert.equal(row.availability, "unknown");
  assert.equal(row.orderable, false);
  assert.equal(row.checkoutSemantics, "provider_console");
});
