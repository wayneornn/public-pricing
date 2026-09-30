import { createInventoryItem } from "../../../core/inventory.js";
import { buildGpuLabel, compactMetadata, numberOrNull, round, truthyEnv } from "../format.js";

const CLOUDCLUSTERS_GPU_URL = "https://www.cloudclusters.io/server/gpu";
const HOURS_PER_MONTH = 730;

export const cloudclustersConnector = {
  id: "cloudclusters",
  name: "CloudClusters",
  envVars: ["CLOUDCLUSTERS_ENABLED"],
  async fetch(env) {
    if (!truthyEnv(env.CLOUDCLUSTERS_ENABLED)) return [];
    const url = env.CLOUDCLUSTERS_GPU_URL || CLOUDCLUSTERS_GPU_URL;
    const response = await fetch(url, {
      headers: { Accept: "text/html", "User-Agent": "gpu-deal-terminal" },
      signal: AbortSignal.timeout(Number(env.CLOUDCLUSTERS_TIMEOUT_MS || 30_000))
    });
    if (!response.ok) throw new Error(`cloudclusters gpu page ${response.status}`);
    return cloudclustersHtmlToItems(await response.text(), { url });
  }
};

export function cloudclustersHtmlToItems(htmlText = "", { url = CLOUDCLUSTERS_GPU_URL } = {}) {
  return extractCloudclustersPlans(htmlText)
    .map((plan) => cloudclustersPlanToItem(plan, { url }))
    .filter(Boolean);
}

export function extractCloudclustersPlans(htmlText = "") {
  const text = cleanText(htmlText);
  const markerRe = /([A-Za-z][A-Za-z0-9\s()-]*?(?:GPU VPS|Dedicated GPU Server|Multi-GPU Dedicated Server)[^$]{0,80})\s*\$\s*([0-9,]+(?:\.[0-9]+)?)\s*\/mo/gi;
  const markers = [...text.matchAll(markerRe)];
  const rows = [];
  for (let i = 0; i < markers.length; i++) {
    const match = markers[i];
    const segment = text.slice(match.index, markers[i + 1]?.index ?? text.length);
    const fields = {
      gpuModel: field(segment, "GPU Model", "CPU"),
      cpu: field(segment, "CPU", "Memory"),
      memory: field(segment, "Memory", "Disk"),
      disk: field(segment, "Disk", "Bandwidth"),
      bandwidth: field(segment, "Bandwidth", "GPU Memory"),
      gpuMemory: field(segment, "GPU Memory", "IP"),
      location: field(segment, "Location", "Backup")
    };
    if (!fields.gpuModel || !fields.cpu) continue;
    rows.push({
      name: cleanupPlanName(match[1]),
      monthlyUsd: numberOrNull(match[2].replace(/,/g, "")),
      ...fields
    });
  }
  return rows.filter((row) => /RTX|A100|H100|V100|A40|P100|K80|P\d|GTX|GT730|K620/i.test(row.gpuModel));
}

function cloudclustersPlanToItem(plan, { url }) {
  const monthlyUsd = numberOrNull(plan.monthlyUsd);
  if (!plan.gpuModel || monthlyUsd == null || monthlyUsd <= 0) return null;
  const parsedGpu = parseGpu(plan.gpuModel);
  const gpuCount = parsedGpu.count || 1;
  const totalHourly = round(monthlyUsd / HOURS_PER_MONTH, 4);
  const pricePerGpuHour = round(totalHourly / gpuCount, 4);
  const gpuLabel = buildGpuLabel({ count: gpuCount, model: parsedGpu.model, vramGb: parsedGpu.vramGbEach });

  return createInventoryItem({
    provider: "CloudClusters",
    providerId: "cloudclusters",
    rawOfferId: `cloudclusters:${slug(plan.name)}:${slug(plan.gpuModel)}`,
    gpuLabel,
    gpuCount,
    vramGbEach: parsedGpu.vramGbEach,
    pricePerGpuHour,
    totalHourlyPrice: totalHourly,
    region: plan.location || "USA",
    formFactor: /vps/i.test(plan.name) ? "vm" : "bare_metal",
    cpu: plan.cpu,
    ramGb: memoryGb(plan.memory),
    storage: plan.disk,
    networkFabric: "Not exposed",
    currency: "USD",
    availability: "unknown",
    availabilityCount: null,
    checkoutUrl: url,
    sourceMode: "live",
    listingType: "gpu_sku_pricing",
    priceScope: "monthly_equivalent",
    availabilitySemantics: "price_only",
    dataNotes: [
      "CloudClusters public GPU server page publishes monthly USD prices; rows normalize monthly price to hourly at price/730",
      "No public stock API or exact deploy listing route is exposed, so rows are a price catalog"
    ],
    metadata: compactMetadata({
      name: plan.name,
      gpuModel: plan.gpuModel,
      monthlyUsd,
      billingGranularity: "monthly",
      bandwidth: plan.bandwidth,
      sourceUrl: url
    }),
    rawPayload: { ...plan, sourceUrl: url }
  });
}

function parseGpu(value = "") {
  const raw = String(value).replace(/\s+/g, " ").trim();
  const countMatch = raw.match(/^(\d+)\s*x\s*(.+)$/i);
  const count = countMatch ? numberOrNull(countMatch[1]) : 1;
  const modelText = (countMatch ? countMatch[2] : raw).split("|")[0].replace(/\bNvidia\b/gi, "").replace(/[^\x20-\x7E]+/g, " ").replace(/\s+/g, " ").trim();
  const vramGbEach = null;
  return { count, model: modelText, vramGbEach };
}

function memoryGb(value = "") {
  const match = String(value).match(/([0-9]+)\s*GB/i);
  return match ? numberOrNull(match[1]) : null;
}

function cleanText(htmlText = "") {
  return String(htmlText)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function field(segment, label, nextLabel) {
  const pattern = new RegExp(`${label}:\\s*([\\s\\S]*?)(?:\\s+${nextLabel}:|$)`, "i");
  return (segment.match(pattern)?.[1] || "").replace(/[^\x20-\x7E]+/g, " ").replace(/\s+/g, " ").trim();
}

function cleanupPlanName(value = "") {
  const text = String(value).replace(/[^\x20-\x7E]+/g, " ").replace(/\s+/g, " ").trim();
  const match = text.match(/(?:Express|Lite|Basic|Advanced|Enterprise|Premium|Professional|Ultimate|Dedicated|Multi-GPU)[A-Za-z0-9\s()-]*?(?:GPU VPS|Dedicated GPU Server|Multi-GPU Dedicated Server)[A-Za-z0-9\s()-]*/i);
  return (match ? match[0] : text).trim();
}

function slug(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
