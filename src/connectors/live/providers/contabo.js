import { createInventoryItem } from "../../../core/inventory.js";
import { buildGpuLabel, compactMetadata, fabricDataNote, numberOrNull, round, truthyEnv } from "../format.js";

// Contabo GPU Cloud publishes its GPU product matrix on the public marketing page.
// The Contabo REST API is useful for account instance management, but the public docs
// do not expose a GPU SKU/stock endpoint. These rows are therefore a monthly-price
// catalog scrape, converted to hourly for comparison, and never checkout-grade supply.
const CONTABO_PRICING_URL = "https://contabo.com/en-us/gpu-cloud/";
const MONTHLY_HOURS = 730;

export const contaboConnector = {
  id: "contabo",
  name: "Contabo",
  envVars: ["CONTABO_ENABLED"],
  async fetch(env) {
    if (!truthyEnv(env.CONTABO_ENABLED)) return [];
    const url = env.CONTABO_PRICING_URL || CONTABO_PRICING_URL;
    const response = await fetch(url, {
      headers: { Accept: "text/html", "User-Agent": "gpu-deal-terminal" },
      signal: AbortSignal.timeout(Number(env.CONTABO_TIMEOUT_MS || 30_000))
    });
    if (!response.ok) throw new Error(`contabo gpu cloud page ${response.status}`);
    return contaboHtmlToItems(await response.text(), { url });
  }
};

export function contaboHtmlToItems(htmlText = "", { url = CONTABO_PRICING_URL } = {}) {
  const plans = extractContaboPlans(htmlText);
  return plans.map((plan) => contaboPlanToItem(plan, url)).filter(Boolean);
}

function extractContaboPlans(htmlText) {
  const start = htmlText.indexOf('<section id="product-smoke-test-tables"');
  if (start === -1) return [];
  const mobileStart = htmlText.indexOf('<div class="mobile-pricing-container', start);
  const block = htmlText.slice(start, mobileStart === -1 ? undefined : mobileStart);
  const sectionRe = /<section id="([^"]+)" class="smoketestproduct[^>]*>([\s\S]*?)<\/section>/gi;
  const plans = [];
  let match;
  while ((match = sectionRe.exec(block)) !== null) {
    const [, id, sectionHtml] = match;
    const title = cleanHtml(sectionHtml.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)?.[1]);
    const values = [...sectionHtml.matchAll(/<span class="spec-title[^"]*">([\s\S]*?)<\/span>/gi)]
      .map((valueMatch) => cleanHtml(valueMatch[1]))
      .filter(Boolean);
    if (!title || values.length < 7) continue;
    plans.push({
      id,
      title,
      gpuCell: values[0],
      gpuRam: values[1],
      vcpus: values[2],
      ram: values[3],
      storage: values[4],
      bandwidth: values[5],
      monthlyPrice: values[6]
    });
  }
  return plans;
}

function contaboPlanToItem(plan, url) {
  const gpuCount = parseGpuCount(plan);
  const model = parseGpuModel(plan.title);
  const monthlyPrice = parseMoney(plan.monthlyPrice);
  if (!model || !gpuCount || !monthlyPrice) return null;

  const totalHourlyPrice = round(monthlyPrice / MONTHLY_HOURS, 4);
  const pricePerGpuHour = round(totalHourlyPrice / gpuCount, 4);
  const totalVramGb = parseLocalizedMemoryGb(plan.gpuRam);
  const vramGbEach = totalVramGb ? round(totalVramGb / gpuCount, 2) : null;
  const ramGb = parseLocalizedMemoryGb(plan.ram);
  const cpu = numberOrNull(plan.vcpus);
  const storageGb = parseLocalizedMemoryGb(plan.storage);
  const gpuLabel = buildGpuLabel({ count: gpuCount, model, vramGb: vramGbEach });
  const formFactor = /^dedicated\b/i.test(plan.title) ? "bare_metal" : "vm";
  const networkFabric = "Not exposed";

  return createInventoryItem({
    provider: "Contabo",
    providerId: "contabo",
    rawOfferId: plan.id,
    gpuLabel,
    gpuCount,
    vramGbEach,
    pricePerGpuHour,
    totalHourlyPrice,
    region: "Contabo regions",
    formFactor,
    interconnect: "Not exposed",
    cpu: cpu ? `${cpu} vCPU` : "",
    ramGb,
    storage: plan.storage,
    networkFabric,
    currency: "EUR",
    availability: "unknown",
    availabilityCount: null,
    checkoutUrl: url,
    sourceMode: "live",
    listingType: "gpu_sku_pricing",
    priceScope: "node_total",
    availabilitySemantics: "region_offering",
    dataNotes: [
      "Contabo GPU Cloud monthly EUR price scraped from the public product table; converted to hourly using price/730 for comparison only",
      "Public Contabo API docs cover authenticated instance management, but no GPU SKU stock/capacity endpoint was found",
      "Page lists global regions/locations, but not per-region GPU availability",
      plan.title === "Cloud NVIDIA 8x H200" && plan.gpuCell !== "8"
        ? `Provider table GPU cell is ${plan.gpuCell}; using the plan title for 8 GPU count`
        : "",
      fabricDataNote(networkFabric, gpuLabel, gpuCount)
    ].filter(Boolean),
    metadata: compactMetadata({
      plan: plan.title,
      model,
      monthlyPriceEur: monthlyPrice,
      convertedHourlyEur: totalHourlyPrice,
      monthlyHours: MONTHLY_HOURS,
      gpuCell: plan.gpuCell,
      gpuRam: plan.gpuRam,
      vcpus: cpu,
      ramGb,
      storageGb,
      storage: plan.storage,
      bandwidth: plan.bandwidth,
      formFactor
    }),
    rawPayload: { ...plan, monthlyPriceEur: monthlyPrice, convertedHourlyEur: totalHourlyPrice }
  });
}

function parseGpuCount(plan) {
  const titleCount = String(plan.title || "").match(/\b(\d+)\s*x\b/i)?.[1];
  if (titleCount) return numberOrNull(titleCount);
  return numberOrNull(plan.gpuCell) || 1;
}

function parseGpuModel(title) {
  return String(title || "")
    .replace(/^(?:Dedicated|Cloud)\s+/i, "")
    .replace(/\bNVIDIA\s+/i, "")
    .replace(/\b\d+\s*x\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseMoney(value) {
  const cleaned = String(value || "").replace(/[^\d.,]/g, "");
  if (!cleaned) return null;
  const normalized = cleaned.includes(".")
    ? cleaned.replace(/,/g, "")
    : cleaned.replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseLocalizedMemoryGb(value) {
  const match = String(value || "").match(/(\d+(?:[.,]\d+)?)\s*(tb|tib|gb|gib|mb|mib)\b/i);
  if (!match) return null;
  const amount = Number(match[1].replace(",", "."));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = match[2].toLowerCase();
  if (/tb|tib/.test(unit)) return round(amount * 1024, 2);
  if (/mb|mib/.test(unit)) return round(amount / 1024, 2);
  return amount;
}

function cleanHtml(value = "") {
  return String(value)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x20AC;|&euro;/gi, "€")
    .replace(/\s+/g, " ")
    .trim();
}
