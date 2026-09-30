import { createInventoryItem } from "../../../core/inventory.js";
import { buildGpuLabel, compactMetadata, fabricDataNote, numberOrNull, round, truthyEnv } from "../format.js";

// IONOS Cloud — Cloud GPU VM (single/multi NVIDIA H200 PCIe bundles). The provisioning
// API (cloudapi/v6) is Bearer-token + active-account gated, but the public price
// CALCULATOR embeds the full GPU price catalog as self-describing JSON in its Vite
// bundle — multi-currency, no auth. Verified live: the bundle holds
//   {"id":"GPUH200S","name":"1h H200-S with AMD EPYC Turin and NVIDIA H200","pu":"per hour",
//    "priceLists":[{"name":"default","prices":{"EUR":3,"GBP":2.554,"USD":3.261,…}}]}
// for the 4 fixed SKUs S/M/L/XL = 1/2/4/8× H200. The bundle filename is content-hashed,
// so we fetch the calculator HTML, extract the /assets/index-<hash>.js URL, then parse the
// GPUH200* objects. GPU count comes from the SKU suffix and vCPU/RAM/storage from the
// bundle's static spec table (mirrored here). USD is in the data → no FX needed. The
// calculator exposes price but no live capacity, so rows are a region-offering price
// catalog (provider_console), not orderable. No key; opt-in with IONOS_ENABLED=1.
const IONOS_CALCULATOR_URL = "https://cloud-price-calculator.ionos.com/";
const ASSET_RE = /\/assets\/index-[A-Za-z0-9]+\.js/;
const SKU_RE =
  /\{"id":"(GPUH200[SMLX]+)","name":"([^"]*)","pg":"[^"]*","pu":"per hour","priceLists":\[\{"name":"default","prices":\{([^}]*)\}/g;

// SKU suffix -> GPU count + the bundle's published spec table (vCPU / RAM GiB / storage GB).
const SKU_SPECS = {
  S: { gpuCount: 1, vcpu: 15, ramGb: 267, storageGb: 1024 },
  M: { gpuCount: 2, vcpu: 30, ramGb: 534, storageGb: 1536 },
  L: { gpuCount: 4, vcpu: 60, ramGb: 1068, storageGb: 2048 },
  XL: { gpuCount: 8, vcpu: 127, ramGb: 2136, storageGb: 4096 }
};
const H200_VRAM_GB = 141; // NVIDIA H200 = 141GB HBM3e per GPU (not in the bundle; fixed spec)

export const ionosConnector = {
  id: "ionos",
  name: "IONOS Cloud",
  envVars: ["IONOS_ENABLED"],
  async fetch(env) {
    if (!truthyEnv(env.IONOS_ENABLED)) return [];
    const home = (env.IONOS_CALCULATOR_URL || IONOS_CALCULATOR_URL).replace(/\/$/, "");
    const timeoutMs = Number(env.IONOS_TIMEOUT_MS || 30_000);
    const html = await fetchText(`${home}/`, timeoutMs);
    const asset = html.match(ASSET_RE)?.[0];
    if (!asset) throw new Error("IONOS price calculator bundle URL not found in page");
    const bundle = await fetchText(`${home}${asset}`, timeoutMs);
    return ionosBundleToItems(bundle);
  }
};

export function ionosBundleToItems(bundleText = "") {
  const items = [];
  SKU_RE.lastIndex = 0;
  for (let match = SKU_RE.exec(bundleText); match; match = SKU_RE.exec(bundleText)) {
    const row = ionosRow(match[1], match[2], match[3]);
    if (row) items.push(row);
  }
  return items;
}

function ionosRow(skuId, name, pricesRaw) {
  const suffix = skuId.replace("GPUH200", "");
  const spec = SKU_SPECS[suffix];
  if (!spec) return null; // unknown SKU shape -> skip rather than guess count

  const prices = parsePrices(pricesRaw);
  const usd = numberOrNull(prices.USD);
  if (usd == null || usd <= 0) return null;

  const gpuLabel = buildGpuLabel({ count: spec.gpuCount, model: "H200", vramGb: H200_VRAM_GB });

  return createInventoryItem({
    provider: "IONOS Cloud",
    providerId: "ionos",
    rawOfferId: skuId,
    gpuLabel,
    gpuCount: spec.gpuCount,
    vramGbEach: H200_VRAM_GB,
    pricePerGpuHour: round(usd / spec.gpuCount, 4),
    totalHourlyPrice: usd,
    region: "IONOS Cloud",
    formFactor: "vm",
    interconnect: spec.gpuCount > 1 ? "NVLink" : "PCIe",
    cpu: `${spec.vcpu} vCPU`,
    ramGb: spec.ramGb,
    storage: `${spec.storageGb} GB`,
    networkFabric: "Not exposed",
    currency: "USD",
    availability: "unknown",
    availabilityCount: null,
    checkoutUrl: "https://cloud.ionos.com/compute/cloud-gpu-vm",
    sourceMode: "live",
    listingType: "gpu_sku_pricing",
    priceScope: "node_total",
    availabilitySemantics: "region_offering",
    dataNotes: [
      "IONOS Cloud GPU VM plan price (whole VM incl. GPUs, AMD EPYC Turin) from the public price calculator; no live capacity signal",
      "Provisioning API (cloudapi/v6) is account/token-gated; this is catalog pricing only",
      fabricDataNote("Not exposed", gpuLabel, spec.gpuCount)
    ].filter(Boolean),
    metadata: compactMetadata({
      sku: skuId,
      planName: name,
      gpuCount: spec.gpuCount,
      vcpu: spec.vcpu,
      ramGb: spec.ramGb,
      storageGb: spec.storageGb,
      priceUsd: usd,
      priceEur: numberOrNull(prices.EUR),
      priceGbp: numberOrNull(prices.GBP)
    }),
    rawPayload: { id: skuId, name, prices }
  });
}

function parsePrices(pricesRaw) {
  const prices = {};
  for (const pair of String(pricesRaw).split(",")) {
    const [key, value] = pair.split(":");
    if (!key) continue;
    prices[key.replace(/"/g, "").trim()] = Number(value);
  }
  return prices;
}

async function fetchText(url, timeoutMs) {
  const response = await fetch(url, {
    headers: { Accept: "text/html,application/javascript", "User-Agent": "gpu-deal-terminal" },
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) throw new Error(`IONOS ${url} ${response.status}`);
  return response.text();
}
