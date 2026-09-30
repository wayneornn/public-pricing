import { createInventoryItem } from "../../../core/inventory.js";
import { buildGpuLabel, compactMetadata, numberOrNull, round, truthyEnv } from "../format.js";

const CATO_GPU_URL = "https://cato.digital/product/gpu/";

export const catoConnector = {
  id: "cato-digital",
  name: "Cato Digital",
  envVars: ["CATO_ENABLED"],
  async fetch(env) {
    if (!truthyEnv(env.CATO_ENABLED)) return [];
    const url = env.CATO_GPU_URL || CATO_GPU_URL;
    const response = await fetch(url, {
      headers: { Accept: "text/html", "User-Agent": "gpu-deal-terminal" },
      signal: AbortSignal.timeout(Number(env.CATO_TIMEOUT_MS || 30_000))
    });
    if (!response.ok) throw new Error(`cato gpu page ${response.status}`);
    return catoHtmlToItems(await response.text(), { url });
  }
};

export function catoHtmlToItems(htmlText = "", { url = CATO_GPU_URL } = {}) {
  return extractCatoRows(htmlText)
    .map((row) => catoRowToItem(row, { url }))
    .filter(Boolean);
}

export function extractCatoRows(htmlText = "") {
  const text = cleanText(htmlText);
  const tableMatch = text.match(/(g2\.large\s+g2\.medium\s+g2\.xlarge[\s\S]*?Tensor Cores:\s*[\d,\s]+)/i);
  const table = tableMatch ? tableMatch[1] : text;
  const ids = table.match(/\bg2\.(?:large|medium|xlarge)\b/gi) || [];
  const hourly = table.match(/Hourly\s*1\s*:\s*\$\s*([0-9.]+)\s*\$\s*([0-9.]+)\s*\$\s*([0-9.]+)/i);
  const memory = table.match(/Memory:\s*([0-9]+)GB\s*([0-9]+)GB\s*([0-9]+)GB/i);
  const network = table.match(/Network Speed:\s*([0-9]+Gbps)\s*([0-9]+Gbps)\s*([0-9]+Gbps)/i);
  const gpu = table.match(/GPU:\s*(\d+x\s+Nvidia\s+V100\s+\(\d+GB\))\s*(\d+x\s+Nvidia\s+V100\s+\(\d+GB\))\s*(\d+x\s+Nvidia\s+V100\s+\(\d+GB\))/i);
  const rows = [];
  if (!ids.length || !hourly || !gpu) return rows;
  for (let i = 0; i < 3; i++) {
    rows.push({
      sku: ids[i],
      totalHourlyPrice: numberOrNull(hourly[i + 1]),
      ramGb: memory ? numberOrNull(memory[i + 1]) : null,
      networkSpeed: network ? network[i + 1] : "",
      gpuText: gpu[i + 1]
    });
  }
  return rows;
}

function catoRowToItem(row, { url }) {
  const gpuMatch = String(row.gpuText || "").match(/(\d+)x\s+Nvidia\s+(.+?)\s+\((\d+)GB\)/i);
  const totalHourly = numberOrNull(row.totalHourlyPrice);
  if (!gpuMatch || totalHourly == null || totalHourly <= 0) return null;
  const gpuCount = numberOrNull(gpuMatch[1]) || 1;
  const model = gpuMatch[2].replace(/\s+/g, " ").trim();
  const vramGbEach = numberOrNull(gpuMatch[3]);
  const pricePerGpuHour = round(totalHourly / gpuCount, 4);
  const gpuLabel = buildGpuLabel({ count: gpuCount, model, vramGb: vramGbEach });

  return createInventoryItem({
    provider: "Cato Digital",
    providerId: "cato-digital",
    rawOfferId: `cato:${row.sku}`,
    gpuLabel,
    gpuCount,
    vramGbEach,
    pricePerGpuHour,
    totalHourlyPrice: round(totalHourly, 4),
    region: "Cato Digital",
    formFactor: "bare_metal",
    ramGb: row.ramGb,
    networkFabric: /100gbps/i.test(row.networkSpeed) ? "NVSwitch/NVLink + 100Gbps" : "NVSwitch/NVLink",
    currency: "USD",
    availability: "unknown",
    availabilityCount: null,
    checkoutUrl: url,
    sourceMode: "live",
    listingType: "gpu_sku_pricing",
    priceScope: "node_total",
    availabilitySemantics: "price_only",
    dataNotes: [
      "Cato Digital public GPU page publishes whole-node hourly USD prices for V100 servers",
      "The page says availability is subject to change and exposes no public stock or exact deploy listing route, so rows are a price catalog"
    ],
    metadata: compactMetadata({
      sku: row.sku,
      gpuText: row.gpuText,
      networkSpeed: row.networkSpeed,
      totalHourlyUsd: totalHourly,
      pricePerGpuHourUsd: pricePerGpuHour,
      billingGranularity: "hourly",
      sourceUrl: url
    }),
    rawPayload: { ...row, sourceUrl: url }
  });
}

function cleanText(htmlText = "") {
  return String(htmlText)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}
