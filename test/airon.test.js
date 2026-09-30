import assert from "node:assert/strict";
import test from "node:test";
import { aironHtmlToItems, extractAironOffers } from "../src/connectors/live/providers/airon.js";

const HTML = `
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "Offer", "itemOffered": { "@type": "Product", "name": "NVIDIA H100 NVL PCI-E", "description": "Available with 1x, 2x, 4x or 8x GPUs single-nodes with NVLink", "offers": { "@type": "Offer", "price": "1.88", "priceCurrency": "USD" } } },
    { "@type": "Offer", "itemOffered": { "@type": "Product", "name": "NVIDIA HGX B200", "description": "Blackwell GPU architecture", "offers": { "@type": "Offer", "price": "4.13", "priceCurrency": "USD" } } }
  ]
}
</script>`;

test("Airon extracts structured data GPU offers", () => {
  const offers = extractAironOffers(HTML);
  assert.equal(offers.length, 2);
  assert.equal(offers[0].name, "NVIDIA H100 NVL PCI-E");
  assert.equal(offers[0].price, 1.88);
});

test("Airon rows are non-orderable per-GPU USD price catalog", () => {
  const items = aironHtmlToItems(HTML);
  assert.equal(items.length, 2);
  const h100 = items.find((item) => item.rawOfferId === "airon:h100-nvl-pci-e");
  assert.equal(h100.gpuCount, 1);
  assert.equal(h100.pricePerGpuHour, 1.88);
  assert.equal(h100.totalHourlyPrice, 1.88);
  assert.equal(h100.checkoutSemantics, "provider_console");
  assert.equal(h100.orderable, false);
});
