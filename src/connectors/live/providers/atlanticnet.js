import { createInventoryItem } from "../../../core/inventory.js";
import { buildGpuLabel, compactMetadata, fabricDataNote, numberOrNull, truthyEnv } from "../format.js";

// Atlantic.net — GPU Cloud Hosting. The legacy CloudAPI (Version=2010-12-30, AWS-style
// signature auth) only lists general-purpose plans and is account-gated, but the public
// GPU pricing page embeds a complete schema.org JSON-LD catalog of every plan, including
// the "Accelerated Compute" GPU SKUs, with per-instance hourly USD prices + specs.
// We scrape that single structured blob (no key). Verified live: each GPU plan is an Offer
//   { name:"AH100NVL.240GB", category:"Accelerated Compute",
//     priceSpecification:[ {name:"Linux – On-Demand", price:3.941, unitCode:"HUR", ...},
//                          {name:"Linux – 1-Year Term", ...}, {name:"Linux – 3-Year Term", ...} ],
//     additionalProperty:[ {name:"RAM",value:"240GB"}, {name:"vCPU",value:28},
//                          {name:"SSD Storage",value:"2400GB"}, {name:"Transfer",value:"15 TB"} ] }
// Plan names are single-GPU (the leading "A" = Accelerated; no count multiplier), so
// gpuCount=1 and the price is the whole-VM on-demand hourly rate (node total). The page
// exposes price but no live capacity, so rows are a region-offering price catalog
// (provider_console), not orderable. Opt-in with ATLANTICNET_ENABLED=1 (page scrape).
const ATLANTICNET_PRICING_URL =
  "https://www.atlantic.net/cloud-hosting/gpu-cloud-hosting/";
const ACCELERATED_CATEGORY = "Accelerated Compute";
const KNOWN_VRAM = { L40S: 48, "H100 NVL": 94, H100: 80, A100: 80, A40: 48, MI300X: 192 };

export const atlanticnetConnector = {
  id: "atlantic-net",
  name: "Atlantic.Net",
  envVars: ["ATLANTICNET_ENABLED"],
  async fetch(env) {
    if (!truthyEnv(env.ATLANTICNET_ENABLED)) return [];
    const url = env.ATLANTICNET_PRICING_URL || ATLANTICNET_PRICING_URL;
    const response = await fetch(url, {
      headers: { Accept: "text/html", "User-Agent": "gpu-deal-terminal" },
      signal: AbortSignal.timeout(Number(env.ATLANTICNET_TIMEOUT_MS || 30_000))
    });
    if (!response.ok) throw new Error(`atlantic.net pricing page ${response.status}`);
    return atlanticnetHtmlToItems(await response.text());
  }
};

export function atlanticnetHtmlToItems(htmlText = "") {
  const offers = extractAcceleratedOffers(htmlText);
  const items = [];
  for (const offer of offers) {
    const row = atlanticnetRow(offer);
    if (row) items.push(row);
  }
  return items;
}

// Pull every schema.org Offer with category "Accelerated Compute" out of the page's
// <script type="application/ld+json"> blocks.
function extractAcceleratedOffers(htmlText) {
  const offers = [];
  const blockRe = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = blockRe.exec(htmlText)) !== null) {
    let parsed;
    try {
      parsed = JSON.parse(match[1].trim());
    } catch {
      continue; // skip malformed blocks
    }
    walkOffers(parsed, offers);
  }
  return offers;
}

function walkOffers(node, out) {
  if (Array.isArray(node)) {
    for (const child of node) walkOffers(child, out);
  } else if (node && typeof node === "object") {
    if (node.name && node.category === ACCELERATED_CATEGORY && Array.isArray(node.priceSpecification)) {
      out.push(node);
    }
    for (const value of Object.values(node)) walkOffers(value, out);
  }
}

function atlanticnetRow(offer = {}) {
  const name = String(offer.name || "");
  const model = parseModel(name);
  if (!model) return null; // never emit a GPU row whose model we cannot identify

  const price = onDemandHourly(offer.priceSpecification);
  if (price == null || price <= 0) return null;

  const props = propertyMap(offer.additionalProperty);
  const gpuCount = 1; // single-GPU plans; the catalog exposes no multi-GPU SKU or count field
  const vramGbEach = KNOWN_VRAM[model] || null;
  const cpu = numberOrNull(props.vCPU);
  const ramGb = numberOrNull(String(props.RAM || "").replace(/gb/i, ""));
  const storageGb = numberOrNull(String(props["SSD Storage"] || "").replace(/gb/i, ""));

  const gpuLabel = buildGpuLabel({ count: gpuCount, model, vramGb: vramGbEach });

  return createInventoryItem({
    provider: "Atlantic.Net",
    providerId: "atlantic-net",
    rawOfferId: name,
    gpuLabel,
    gpuCount,
    vramGbEach,
    pricePerGpuHour: price, // 1 GPU → per-GPU == node total
    totalHourlyPrice: price,
    region: "United States",
    formFactor: "vm",
    interconnect: "PCIe",
    cpu: cpu ? `${cpu} vCPU` : "",
    ramGb,
    storage: storageGb ? `${storageGb} GB SSD` : "",
    networkFabric: "Not exposed",
    currency: "USD",
    availability: "unknown",
    availabilityCount: null,
    checkoutUrl: "https://www.atlantic.net/cloud-hosting/gpu-cloud-hosting/",
    sourceMode: "live",
    listingType: "gpu_sku_pricing",
    priceScope: "node_total",
    availabilitySemantics: "region_offering",
    dataNotes: [
      "Atlantic.Net on-demand hourly price (whole VM incl. 1 GPU) scraped from the GPU cloud page's schema.org JSON-LD; 1- and 3-year term rates also published but not emitted",
      "GPU count not exposed in the catalog; single-GPU SKU assumed from the plan name (no multiplier)",
      fabricDataNote("Not exposed", gpuLabel, gpuCount)
    ].filter(Boolean),
    metadata: compactMetadata({
      plan: name,
      gpuModel: model,
      vramGb: vramGbEach,
      cpu,
      ramGb,
      ssdGb: storageGb,
      transfer: props.Transfer,
      onDemandHourlyUsd: price
    }),
    rawPayload: { name, category: offer.category, onDemandHourlyUsd: price, additionalProperty: offer.additionalProperty }
  });
}

// "AL40S.192GB" -> "L40S"; "AH100NVL.240GB" -> "H100 NVL". The leading "A" is the
// Accelerated-Compute prefix; the part before "." is "<A><MODEL>".
function parseModel(name) {
  const head = String(name).split(".")[0].replace(/^A/, "");
  if (!head) return "";
  const upper = head.toUpperCase();
  const known = { L40S: "L40S", H100NVL: "H100 NVL", H100: "H100", A100: "A100", A40: "A40", MI300X: "MI300X" };
  if (known[upper]) return known[upper];
  return upper.replace(/NVL$/i, " NVL"); // generic: split a trailing NVL variant
}

function onDemandHourly(specs = []) {
  if (!Array.isArray(specs)) return null;
  const hourly = specs.filter((s) => s && s.unitCode === "HUR");
  const onDemand = hourly.find((s) => /on-demand/i.test(String(s.name || "")));
  return numberOrNull((onDemand || hourly[0])?.price);
}

function propertyMap(props = []) {
  const map = {};
  if (Array.isArray(props)) {
    for (const p of props) if (p && p.name != null) map[p.name] = p.value;
  }
  return map;
}
