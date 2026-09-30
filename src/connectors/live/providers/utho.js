import { createInventoryItem } from "../../../core/inventory.js";
import { buildGpuLabel, compactMetadata, fabricDataNote, numberOrNull, parseMemoryGb, round, truthyEnv } from "../format.js";

// Utho publishes concrete GPU plan prices/specs in the public GPU page bundle.
// The REST API root is auth-gated and the GPU page routes users through a quote
// flow, so this adapter exposes pricing context only, not checkout-grade supply.
const UTHO_GPU_URL = "https://utho.com/gpu";
const MONTHLY_HOURS = 730;

export const uthoConnector = {
  id: "utho",
  name: "Utho",
  envVars: ["UTHO_ENABLED"],
  async fetch(env) {
    if (!truthyEnv(env.UTHO_ENABLED)) return [];
    const sourceUrl = env.UTHO_GPU_URL || UTHO_GPU_URL;
    const htmlResponse = await fetch(sourceUrl, {
      headers: { Accept: "text/html", "User-Agent": "gpu-deal-terminal" },
      signal: AbortSignal.timeout(Number(env.UTHO_TIMEOUT_MS || 30_000))
    });
    if (!htmlResponse.ok) throw new Error(`utho gpu page ${htmlResponse.status}`);

    const bundleUrl = uthoBundleUrl(await htmlResponse.text(), sourceUrl);
    const bundleResponse = await fetch(bundleUrl, {
      headers: { Accept: "application/javascript", "User-Agent": "gpu-deal-terminal" },
      signal: AbortSignal.timeout(Number(env.UTHO_TIMEOUT_MS || 30_000))
    });
    if (!bundleResponse.ok) throw new Error(`utho gpu bundle ${bundleResponse.status}`);
    return uthoBundleToItems(await bundleResponse.text(), { sourceUrl, bundleUrl });
  }
};

export function uthoBundleToItems(bundleText = "", { sourceUrl = UTHO_GPU_URL, bundleUrl = "" } = {}) {
  return extractUthoPlans(bundleText)
    .map((plan) => uthoPlanToItem(plan, { sourceUrl, bundleUrl }))
    .filter(Boolean);
}

export function uthoBundleUrl(htmlText = "", sourceUrl = UTHO_GPU_URL) {
  const match = htmlText.match(/<script[^>]+type="module"[^>]+src="([^"]*\/assets\/index-[^"]+\.js)"/i)
    || htmlText.match(/<script[^>]+src="([^"]*\/assets\/index-[^"]+\.js)"[^>]+type="module"/i);
  if (!match) throw new Error("utho gpu page bundle URL not found");
  return new URL(match[1], sourceUrl).toString();
}

function extractUthoPlans(bundleText) {
  const markerIndex = bundleText.indexOf('name:"A6000 Blackwell",vram:"96 GB"');
  if (markerIndex === -1) return [];
  const arrayStart = bundleText.lastIndexOf("=[", markerIndex);
  const arrayEnd = bundleText.indexOf("]", markerIndex);
  if (arrayStart === -1 || arrayEnd === -1 || arrayEnd <= arrayStart) return [];

  const block = bundleText.slice(arrayStart + 1, arrayEnd + 1);
  const planRe = /\{name:"([^"]+)",vram:"([^"]+)",vcpu:"([^"]+)",ram:"([^"]+)",monthly:([0-9.]+),sixMonths:([0-9.]+),twelveMonths:([0-9.]+)(?:,popular:!0)?\}/g;
  const plans = [];
  let match;
  while ((match = planRe.exec(block)) !== null) {
    plans.push({
      name: match[1],
      vram: match[2],
      vcpu: match[3],
      ram: match[4],
      monthlyInr: numberOrNull(match[5]),
      sixMonthsInr: numberOrNull(match[6]),
      twelveMonthsInr: numberOrNull(match[7])
    });
  }
  return plans;
}

function uthoPlanToItem(plan, { sourceUrl, bundleUrl }) {
  const monthlyInr = numberOrNull(plan.monthlyInr);
  if (!plan.name || !monthlyInr) return null;

  const gpuCount = 1;
  const hourlyInr = round(monthlyInr / MONTHLY_HOURS, 4);
  const vramGbEach = parseMemoryGb(plan.vram);
  const ramGb = parseMemoryGb(plan.ram);
  const vcpu = numberOrNull(plan.vcpu);
  const gpuLabel = buildGpuLabel({ count: gpuCount, model: plan.name, vramGb: vramGbEach });
  const networkFabric = "Not exposed";

  return createInventoryItem({
    provider: "Utho",
    providerId: "utho",
    rawOfferId: slug(plan.name),
    gpuLabel,
    gpuCount,
    vramGbEach,
    pricePerGpuHour: hourlyInr,
    totalHourlyPrice: hourlyInr,
    region: "Utho regions",
    formFactor: "vm",
    interconnect: "Not exposed",
    cpu: vcpu ? `${vcpu} vCPU` : plan.vcpu,
    ramGb,
    storage: "",
    networkFabric,
    currency: "INR",
    availability: "unknown",
    availabilityCount: null,
    checkoutUrl: `${sourceUrl}#gpu-quote`,
    sourceMode: "live",
    listingType: "gpu_sku_pricing",
    priceScope: "node_total",
    availabilitySemantics: "price_only",
    dataNotes: [
      "Utho GPU plan monthly INR price/specs extracted from the public GPU page JavaScript bundle; converted to hourly using price/730 for comparison only",
      "REST API responds as API-key-gated, but no public GPU stock/capacity endpoint was found in docs or the site bundle",
      "GPU page uses a custom quote flow rather than exact deploy/listing URLs, so this row is provider_console only",
      "Plan location is not exposed per GPU SKU",
      fabricDataNote(networkFabric, gpuLabel, gpuCount)
    ].filter(Boolean),
    metadata: compactMetadata({
      plan: plan.name,
      monthlyInr,
      convertedHourlyInr: hourlyInr,
      sixMonthsInr: plan.sixMonthsInr,
      twelveMonthsInr: plan.twelveMonthsInr,
      monthlyHours: MONTHLY_HOURS,
      sourceBundle: bundleUrl,
      vcpu,
      ramGb,
      vramGbEach
    }),
    rawPayload: { ...plan, convertedHourlyInr: hourlyInr, sourceBundle: bundleUrl }
  });
}

function slug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
