import { createInventoryItem } from "../../../core/inventory.js";
import { buildGpuLabel, compactMetadata, fabricDataNote, numberOrNull, round, truthyEnv } from "../format.js";

// AceCloud exposes OpenStack APIs, but those require account/project credentials.
// Public GPU prices/specs are published on static AceCloud pricing pages.
const ACECLOUD_BASE_URL = "https://acecloud.ai";
const MONTHLY_HOURS = 730;
const DEFAULT_GPU_SLUGS = [
  "nvidia-h100-hgx",
  "nvidia-h200-nvl",
  "nvidia-a100-80gb",
  "nvidia-a30-24gb",
  "nvidia-a2-16gb",
  "rtx-a6000-48gb",
  "nvidia-rtx-6000-ada-48gb",
  "rtx-pro-6000-96gb",
  "nvidia-l4-24gb",
  "nvidia-l40s-48gb"
];
const GPU_METADATA = {
  "nvidia-h100-hgx": { model: "H100 HGX", vramGbEach: 80 },
  "nvidia-h200-nvl": { model: "H200", variant: "NVL", vramGbEach: 141 },
  "nvidia-a100-80gb": { model: "A100", vramGbEach: 80 },
  "nvidia-a30-24gb": { model: "A30", vramGbEach: 24 },
  "nvidia-a2-16gb": { model: "A2", vramGbEach: 16 },
  "rtx-a6000-48gb": { model: "RTX A6000", vramGbEach: 48 },
  "nvidia-rtx-6000-ada-48gb": { model: "RTX 6000 Ada", vramGbEach: 48 },
  "rtx-pro-6000-96gb": { model: "RTX PRO 6000", vramGbEach: 96 },
  "nvidia-l4-24gb": { model: "L4", vramGbEach: 24 },
  "nvidia-l40s-48gb": { model: "L40S", vramGbEach: 48 }
};
const REGIONS = {
  noida: { code: "ap-south-noi-1", label: "Noida" },
  mumbai: { code: "ap-south-mum-1", label: "Mumbai" },
  atlanta: { code: "us-east-at-2", label: "Atlanta" }
};

export const acecloudConnector = {
  id: "acecloud",
  name: "ACE Cloud",
  envVars: ["ACECLOUD_ENABLED"],
  async fetch(env) {
    if (!truthyEnv(env.ACECLOUD_ENABLED)) return [];
    const baseUrl = env.ACECLOUD_BASE_URL || ACECLOUD_BASE_URL;
    const slugs = envList(env.ACECLOUD_GPU_SLUGS, DEFAULT_GPU_SLUGS);
    const regions = envList(env.ACECLOUD_REGIONS, ["noida"]);
    const timeoutMs = Number(env.ACECLOUD_TIMEOUT_MS || 30_000);
    const items = [];

    for (const region of regions) {
      for (const slug of slugs) {
        const url = acecloudPricingUrl({ baseUrl, region, slug });
        const response = await fetch(url, {
          headers: { Accept: "text/html", "User-Agent": "gpu-deal-terminal" },
          signal: AbortSignal.timeout(timeoutMs)
        });
        if (!response.ok) throw new Error(`acecloud pricing page ${response.status} ${url}`);
        items.push(...acecloudHtmlToItems(await response.text(), { url, region, slug }));
      }
    }
    return items;
  }
};

export function acecloudHtmlToItems(htmlText = "", { url = "", region = "noida", slug = "" } = {}) {
  const page = extractAceCloudPage(htmlText);
  const gpu = GPU_METADATA[slug] || gpuMetadataFromTitle(page.title);
  return page.rows
    .map((row) => acecloudRowToItem(row, { gpu, region, slug, title: page.title, url }))
    .filter(Boolean);
}

export function extractAceCloudPage(htmlText = "") {
  const title = cleanHtml(
    String(htmlText).match(/<div class="section-header[\s\S]*?<h3>([\s\S]*?)<\/h3>/i)?.[1]
      || String(htmlText).match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
      || ""
  );
  const tableBody = String(htmlText).match(
    /<table[^>]*id=["']compute_data["'][\s\S]*?<tbody>([\s\S]*?)<\/tbody>/i
  )?.[1] || "";
  const rows = [];
  for (const rowMatch of tableBody.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...rowMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => cleanHtml(cell[1]));
    if (cells.length < 8 || !/^N\./i.test(cells[0])) continue;
    rows.push({
      flavor: cells[0],
      gpuCount: parseGpuCount(cells[1]),
      vcpu: numberOrNull(cells[2]),
      ramGb: numberOrNull(cells[3]),
      hourlyInr: parseMoney(cells[4]),
      monthlyInr: parseMoney(cells[5]),
      sixMonthInr: parseMoney(cells[6]),
      twelveMonthInr: parseMoney(cells[7])
    });
  }
  return { title, rows };
}

function acecloudRowToItem(row, { gpu, region, slug, title, url }) {
  const gpuCount = numberOrNull(row.gpuCount);
  const totalHourlyPrice = row.hourlyInr || (row.monthlyInr ? round(row.monthlyInr / MONTHLY_HOURS, 4) : null);
  if (!gpu?.model || !gpuCount || !totalHourlyPrice) return null;

  const gpuLabel = buildGpuLabel({
    count: gpuCount,
    model: gpu.model,
    vramGb: gpu.vramGbEach,
    variant: gpu.variant
  });
  const pricePerGpuHour = round(totalHourlyPrice / gpuCount, 4);
  const networkFabric = "Not exposed";
  const regionInfo = REGIONS[region] || { code: region || "AceCloud regions", label: region || "AceCloud regions" };

  return createInventoryItem({
    provider: "ACE Cloud",
    providerId: "acecloud",
    rawOfferId: row.flavor,
    gpuLabel,
    gpuCount,
    vramGbEach: gpu.vramGbEach,
    pricePerGpuHour,
    totalHourlyPrice,
    region: regionInfo.code,
    formFactor: "vm",
    interconnect: "Not exposed",
    cpu: row.vcpu ? `${row.vcpu} vCPU` : "",
    ramGb: row.ramGb,
    storage: "",
    networkFabric,
    currency: "INR",
    availability: "unknown",
    availabilityCount: null,
    checkoutUrl: url,
    sourceMode: "live",
    listingType: "gpu_sku_pricing",
    priceScope: "node_total",
    availabilitySemantics: "price_only",
    dataNotes: [
      row.hourlyInr
        ? "ACE Cloud hourly INR price/specs parsed from the official public pricing page"
        : "ACE Cloud monthly INR price/specs parsed from the official public pricing page; converted to hourly using price/730 for comparison only",
      "ACE Cloud documents OpenStack APIs, but those require account/project credentials and do not provide a public stock/capacity feed",
      "Pricing page Launch Now flow routes through the provider console rather than an exact public listing URL",
      `Pricing page region: ${regionInfo.label}`,
      "Plan storage is not exposed per GPU SKU",
      fabricDataNote(networkFabric, gpuLabel, gpuCount)
    ].filter(Boolean),
    metadata: compactMetadata({
      flavor: row.flavor,
      gpuSlug: slug,
      pageTitle: title,
      region: regionInfo.label,
      regionCode: regionInfo.code,
      hourlyInr: row.hourlyInr,
      monthlyInr: row.monthlyInr,
      convertedHourlyInr: row.hourlyInr ? null : totalHourlyPrice,
      sixMonthInr: row.sixMonthInr,
      twelveMonthInr: row.twelveMonthInr,
      monthlyHours: row.hourlyInr ? null : MONTHLY_HOURS,
      priceSource: row.hourlyInr ? "hourly" : "monthly_converted",
      vcpu: row.vcpu,
      ramGb: row.ramGb,
      vramGbEach: gpu.vramGbEach,
      sourceUrl: url
    }),
    rawPayload: { ...row, title, gpuSlug: slug, region: regionInfo.label, regionCode: regionInfo.code, sourceUrl: url }
  });
}

function acecloudPricingUrl({ baseUrl, region, slug }) {
  return new URL(`/pricing/linux/inr/${region}/${slug}/`, baseUrl).toString();
}

function gpuMetadataFromTitle(title = "") {
  const text = cleanHtml(title).replace(/\s+/g, " ");
  const vramGbEach = numberOrNull(text.match(/(\d+)\s*GB/i)?.[1]);
  return compactMetadata({
    model: text
      .replace(/^NVIDIA\s+/i, "")
      .replace(/\s+–\s+/g, " ")
      .trim(),
    vramGbEach
  });
}

function envList(value, fallback) {
  const list = String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return list.length ? list : fallback;
}

function parseGpuCount(value) {
  return numberOrNull(String(value || "").match(/(\d+)\s*x?/i)?.[1]);
}

function parseMoney(value) {
  const text = String(value || "").replace(/[^\d.,]/g, "");
  if (!text) return null;
  const parsed = Number(text.replace(/,/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function cleanHtml(value = "") {
  return String(value)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#8211;|&ndash;/g, "–")
    .replace(/&#x20B9;|&#8377;/g, "₹")
    .replace(/\s+/g, " ")
    .trim();
}
