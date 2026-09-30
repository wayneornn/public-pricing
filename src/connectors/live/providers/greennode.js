import { createInventoryItem } from "../../../core/inventory.js";
import { buildGpuLabel, compactMetadata, fabricDataNote, numberOrNull, round, truthyEnv } from "../format.js";

// GreenNode/VNG publishes concrete H100 on-demand pricing in public page state.
// The documented vServer flavor APIs require Authorization + portal-user-id +
// project context, so this adapter emits only public price catalog rows.
const GREENNODE_PRICING_URL = "https://greennode.ai/pricing";
const FULL_H100_FLAVOR_RE = /^g5-standard-(\d+)x(\d+)-(\d+)h100-0ib$/i;

export const greennodeConnector = {
  id: "greennode",
  name: "GreenNode",
  envVars: ["GREENNODE_ENABLED"],
  async fetch(env) {
    if (!truthyEnv(env.GREENNODE_ENABLED)) return [];
    const url = env.GREENNODE_PRICING_URL || GREENNODE_PRICING_URL;
    const response = await fetch(url, {
      headers: { Accept: "text/html", "User-Agent": "gpu-deal-terminal" },
      signal: AbortSignal.timeout(Number(env.GREENNODE_TIMEOUT_MS || 30_000))
    });
    if (!response.ok) throw new Error(`greennode pricing page ${response.status}`);
    return greennodeHtmlToItems(await response.text(), { url });
  }
};

export function greennodeHtmlToItems(htmlText = "", { url = GREENNODE_PRICING_URL } = {}) {
  const pricingHtml = extractGreenNodePricingHtml(htmlText);
  const sourceFormat = pricingHtml ? "embedded_cms_state" : "rendered_html";
  return extractGreenNodePlans(pricingHtml || htmlText)
    .map((plan) => greennodePlanToItem(plan, { url, sourceFormat }))
    .filter(Boolean);
}

export function extractGreenNodePricingHtml(htmlText = "") {
  const stateMatch = String(htmlText).match(
    /<script[^>]+id=["']greennode-state["'][^>]*>([\s\S]*?)<\/script>/i
  );
  if (!stateMatch) return "";

  try {
    return findPricingContent(JSON.parse(stateMatch[1])) || "";
  } catch {
    return "";
  }
}

function extractGreenNodePlans(htmlText) {
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const plans = [];
  let rowMatch;
  while ((rowMatch = rowRe.exec(htmlText)) !== null) {
    const rawCells = [...rowMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => cell[1]);
    const cells = rawCells.map((cell) => cleanHtml(cell));
    if (cells.length < 8) continue;

    const flavor = cells[0];
    const flavorMatch = FULL_H100_FLAVOR_RE.exec(flavor);
    if (!flavorMatch) continue;

    const gpuCount = numberOrNull(flavorMatch[3]) || numberOrNull(cells[4]);
    const totalHourlyUsd = lastMoneyValue(rawCells[6]);
    if (!gpuCount || !totalHourlyUsd) continue;

    plans.push({
      flavor,
      vcpu: numberOrNull(cells[1]),
      ramGb: numberOrNull(cells[2]),
      vramTotalGb: numberOrNull(cells[3]),
      gpuCount,
      localStorageTb: greenNodeDecimalNumber(cells[5]),
      totalHourlyUsd,
      oneYearPricePerGpuHourUsd: firstMoneyValue(cells[7])
    });
  }
  return plans;
}

function findPricingContent(value) {
  if (!value || typeof value !== "object") return "";

  if (Array.isArray(value)) {
    for (const item of value) {
      const content = findPricingContent(item);
      if (content) return content;
    }
    return "";
  }

  const title = cleanHtml(value.title);
  const content = typeof value.content === "string" ? value.content : "";
  if (
    /H100 Server Configurations/i.test(title) &&
    /g5-standard-\d+x\d+-\d+h100-0ib/i.test(content)
  ) {
    return content;
  }

  if (
    value.__component === "product.product-features" &&
    value.type === "pricing" &&
    /g5-standard-\d+x\d+-\d+h100-0ib/i.test(content)
  ) {
    return content;
  }

  for (const child of Object.values(value)) {
    const nestedContent = findPricingContent(child);
    if (nestedContent) return nestedContent;
  }
  return "";
}

function greennodePlanToItem(plan, { url, sourceFormat }) {
  const vramGbEach = plan.vramTotalGb && plan.gpuCount ? round(plan.vramTotalGb / plan.gpuCount, 2) : 80;
  const gpuLabel = buildGpuLabel({ count: plan.gpuCount, model: "H100 SXM5", vramGb: vramGbEach });
  const pricePerGpuHour = round(plan.totalHourlyUsd / plan.gpuCount, 4);
  const networkFabric = "Not exposed";

  return createInventoryItem({
    provider: "GreenNode",
    providerId: "greennode",
    rawOfferId: plan.flavor,
    gpuLabel,
    gpuCount: plan.gpuCount,
    vramGbEach,
    pricePerGpuHour,
    totalHourlyPrice: plan.totalHourlyUsd,
    region: "GreenNode regions",
    formFactor: "vm",
    interconnect: "Not exposed",
    cpu: plan.vcpu ? `${plan.vcpu} vCPU` : "",
    ramGb: plan.ramGb,
    storage: plan.localStorageTb ? `${plan.localStorageTb} TB local` : "",
    networkFabric,
    currency: "USD",
    availability: "unknown",
    availabilityCount: null,
    checkoutUrl: url,
    sourceMode: "live",
    listingType: "gpu_sku_pricing",
    priceScope: "node_total",
    availabilitySemantics: "price_only",
    dataNotes: [
      "GreenNode H100 on-demand USD price/specs parsed from public page CMS state/pricing table; no public stock/capacity endpoint was found",
      "VNG vServer flavor/project APIs are documented but require Authorization, portal-user-id, and project context",
      "GreenNode purchase flow is login/cart based, so this row is provider_console only",
      "Mini/fractional H100 rows are intentionally skipped until fractional GPU semantics are modeled",
      "Pricing page says rates can be updated from time to time",
      fabricDataNote(networkFabric, gpuLabel, plan.gpuCount)
    ].filter(Boolean),
    metadata: compactMetadata({
      flavor: plan.flavor,
      hourlyUsd: plan.totalHourlyUsd,
      pricePerGpuHourUsd: pricePerGpuHour,
      oneYearPricePerGpuHourUsd: plan.oneYearPricePerGpuHourUsd,
      vcpu: plan.vcpu,
      ramGb: plan.ramGb,
      vramTotalGb: plan.vramTotalGb,
      localStorageTb: plan.localStorageTb,
      sourceFormat,
      sourceUrl: url
    }),
    rawPayload: plan
  });
}

function cleanHtml(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

function lastMoneyValue(htmlCell) {
  const values = moneyValues(cleanHtml(htmlCell));
  return values.length ? values[values.length - 1] : null;
}

function firstMoneyValue(text) {
  const values = moneyValues(text);
  return values.length ? values[0] : null;
}

function moneyValues(text) {
  return [...String(text || "").matchAll(/\$?\s*([0-9]+(?:[.,][0-9]+)?)/g)]
    .map((match) => Number(match[1].replace(",", ".")))
    .filter((value) => Number.isFinite(value) && value > 0);
}

function greenNodeDecimalNumber(value) {
  const text = String(value || "").trim();
  if (/^\d+,\d+$/.test(text)) return numberOrNull(text.replace(",", "."));
  return numberOrNull(text);
}
