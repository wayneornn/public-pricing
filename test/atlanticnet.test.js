import assert from "node:assert/strict";
import test from "node:test";
import { atlanticnetHtmlToItems } from "../src/connectors/live/providers/atlanticnet.js";

// Minimal page wrapping the real schema.org JSON-LD offers captured live from
// atlantic.net/cloud-hosting/gpu-cloud-hosting/ (field names + values verbatim). A
// General-Purpose offer is included to prove only "Accelerated Compute" rows are emitted.
const HTML = `<!doctype html><html><head>
<script type="application/ld+json">
{
  "@type": "ItemList",
  "itemListElement": [
    {
      "@type": "Offer", "name": "G3.2GB", "category": "General Purpose", "priceCurrency": "USD",
      "priceSpecification": [ { "@type": "UnitPriceSpecification", "name": "Linux \\u2013 On-Demand", "price": 0.014881, "unitCode": "HUR", "unitText": "per hour" } ]
    },
    {
      "@type": "Offer", "name": "AL40S.192GB", "category": "Accelerated Compute", "priceCurrency": "USD",
      "priceSpecification": [
        { "@type": "UnitPriceSpecification", "name": "Linux \\u2013 On-Demand", "price": 1.668, "unitCode": "HUR", "unitText": "per hour", "description": "$1120.9/mo ($1.668/hr)" },
        { "@type": "UnitPriceSpecification", "name": "Linux \\u2013 3-Year Term", "price": 1.57549, "unitCode": "HUR", "billingDuration": "P3Y" }
      ],
      "additionalProperty": [
        { "@type": "PropertyValue", "name": "RAM", "value": "192GB" },
        { "@type": "PropertyValue", "name": "vCPU", "value": 32 },
        { "@type": "PropertyValue", "name": "SSD Storage", "value": "1400GB" },
        { "@type": "PropertyValue", "name": "Transfer", "value": "12 TB" }
      ]
    },
    {
      "@type": "Offer", "name": "AH100NVL.240GB", "category": "Accelerated Compute", "priceCurrency": "USD",
      "priceSpecification": [
        { "@type": "UnitPriceSpecification", "name": "Linux \\u2013 On-Demand", "price": 3.941, "unitCode": "HUR", "unitText": "per hour" }
      ],
      "additionalProperty": [
        { "@type": "PropertyValue", "name": "RAM", "value": "240GB" },
        { "@type": "PropertyValue", "name": "vCPU", "value": 28 },
        { "@type": "PropertyValue", "name": "SSD Storage", "value": "2400GB" }
      ]
    }
  ]
}
</script></head><body></body></html>`;

test("Atlantic.Net emits only Accelerated Compute GPU plans", () => {
  const rows = atlanticnetHtmlToItems(HTML);
  assert.equal(rows.length, 2); // G3.2GB general-purpose excluded
  assert.ok(rows.every((r) => r.providerId === "atlantic-net"));
});

test("Atlantic.Net maps the L40S on-demand plan exactly", () => {
  const r = atlanticnetHtmlToItems(HTML).find((x) => x.rawOfferId === "AL40S.192GB");
  assert.equal(r.gpuModel, "L40S");
  assert.equal(r.gpuCount, 1);
  assert.equal(r.vramGbEach, 48);
  assert.equal(r.pricePerGpuHour, 1.668); // on-demand, not the 3-year term
  assert.equal(r.totalHourlyPrice, 1.668);
  assert.equal(r.currency, "USD");
  assert.equal(r.cpu, "32 vCPU");
  assert.equal(r.ramGb, 192);
  assert.equal(r.storage, "1400 GB SSD");
});

test("Atlantic.Net parses the H100 NVL variant from the plan name", () => {
  const r = atlanticnetHtmlToItems(HTML).find((x) => x.rawOfferId === "AH100NVL.240GB");
  assert.equal(r.gpuModel, "H100"); // normalized base model
  assert.equal(r.gpuVariant, "NVL");
  assert.equal(r.vramGbEach, 94);
  assert.equal(r.totalHourlyPrice, 3.941);
});

test("Atlantic.Net rows are non-orderable catalog", () => {
  const rows = atlanticnetHtmlToItems(HTML);
  assert.ok(rows.every((r) => r.orderable === false));
});
