import assert from "node:assert/strict";
import test from "node:test";
import { hpcaiPagesToItems, hpcaiPageToItem } from "../src/connectors/live/providers/hpcai.js";

// Mirrors the real escaped Next.js RSC payload on https://www.hpc-ai.com/gpus/<slug>:
// exactly one on-demand `"pricePerGpu"` per page, with spot/tide variants alongside that
// must never be emitted. Verified live 2026-06-13 (h200 -> 2.5, b200 -> 4, b300 -> Contact).
const H200_HTML = `
<main>
  <h1>NVIDIA H200 GPU Cloud</h1>
  <div>Instance: 8 x NVIDIA H200-SXM5-141GB, 8 x 400Gb/s InfiniBand, Pay per second billing</div>
  <script>self.__next_f.push([1,"{\\"pricePerGpu\\":2.5,\\"spotPricePerGpu\\":1.5,\\"tidePricePerGpu\\":1.5,\\"saving\\":0.41}"])</script>
</main>`;

const B200_HTML = `
<main>
  <h1>NVIDIA B200 GPU Cloud</h1>
  <div>Instance: 8x NVIDIA B200 SXM6 180GB, InfiniBand, Pay per second billing</div>
  <script>self.__next_f.push([1,"{\\"pricePerGpu\\":4,\\"spotPricePerGpu\\":2.5}"])</script>
</main>`;

const B300_HTML = `
<main>
  <h1>NVIDIA B300 GPU Cloud</h1>
  <div>Instance: 8 x NVIDIA B300 SXM6. Contact sales for pricing.</div>
</main>`;

test("HPC-AI parses the H200 page into a per-GPU on-demand price row (spot ignored)", () => {
  const item = hpcaiPageToItem(H200_HTML, { slug: "h200", url: "https://www.hpc-ai.com/gpus/h200" });
  assert.ok(item);
  assert.equal(item.providerId, "hpc-ai");
  assert.equal(item.provider, "HPC-AI.com");
  assert.equal(item.rawOfferId, "gpus:h200");
  assert.equal(item.gpuModel, "H200");
  assert.equal(item.gpuLabel, "8x H200 141GB SXM");
  assert.equal(item.gpuCount, 8);
  assert.equal(item.vramGbEach, 141);
  assert.equal(item.pricePerGpuHour, 2.5); // on-demand, NOT the 1.5 spot/tide price
  assert.equal(item.totalHourlyPrice, 20); // 2.5 * 8
  assert.equal(item.currency, "USD");
  assert.equal(item.networkFabric, "InfiniBand");
  assert.equal(item.availability, "unknown");
  assert.equal(item.availabilitySemantics, "price_only");
  assert.equal(item.priceScope, "gpu_sku_only");
  assert.equal(item.priceSemantics, "gpu_only");
  assert.equal(item.checkoutSemantics, "provider_console");
  assert.equal(item.orderable, false);
  assert.equal(item.metadata.billingGranularity, "per-second");
  // no spot price leaks anywhere on the row
  assert.equal(JSON.stringify(item).includes("1.5"), false);
});

test("HPC-AI parses the B200 page price and specs", () => {
  const item = hpcaiPageToItem(B200_HTML, { slug: "b200", url: "https://www.hpc-ai.com/gpus/b200" });
  assert.ok(item);
  assert.equal(item.gpuModel, "B200");
  assert.equal(item.gpuCount, 8);
  assert.equal(item.vramGbEach, 180);
  assert.equal(item.pricePerGpuHour, 4);
  assert.equal(item.totalHourlyPrice, 32);
  assert.equal(item.orderable, false);
});

test("HPC-AI skips unpriced 'Contact' models (B300)", () => {
  assert.equal(hpcaiPageToItem(B300_HTML, { slug: "b300", url: "x" }), null);
});

test("HPC-AI skips unknown slugs", () => {
  assert.equal(hpcaiPageToItem(H200_HTML, { slug: "not-a-gpu", url: "x" }), null);
});

test("HPC-AI maps a batch of pages, dropping unpriced ones", () => {
  const items = hpcaiPagesToItems([
    { slug: "h200", url: "https://www.hpc-ai.com/gpus/h200", html: H200_HTML },
    { slug: "b200", url: "https://www.hpc-ai.com/gpus/b200", html: B200_HTML },
    { slug: "b300", url: "https://www.hpc-ai.com/gpus/b300", html: B300_HTML }
  ]);
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((i) => i.gpuModel), ["H200", "B200"]);
});
