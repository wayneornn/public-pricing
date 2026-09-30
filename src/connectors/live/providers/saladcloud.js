import { createInventoryItem } from "../../../core/inventory.js";
import { jsonFetch, pickArray } from "../http.js";
import { buildGpuLabel, compactMetadata, fabricDataNote, numberOrNull, round } from "../format.js";

// SaladCloud. Verified against the live API:
//   GET https://api.salad.com/api/public/organizations/{org}/gpu-classes
//   Auth header: Salad-Api-Key: <key>  (needs an org name in the path)
// Each class is a consumer GPU sourced from distributed/idle machines ("community"),
// with priority-tier USD prices (high/medium/low/batch). We use the `high` tier as the
// headline per-GPU rate and keep the full range. Salad supply is interruptible community
// hardware and has no live capacity signal here, so rows are a priced catalog
// (provider_console), not orderable.
const SALAD_API_BASE_URL = "https://api.salad.com/api/public";

export const saladcloudConnector = {
  id: "saladcloud",
  name: "SaladCloud",
  envVars: ["SALAD_API_KEY", "SALAD_ORG"],
  async fetch(env) {
    const key = env.SALAD_API_KEY;
    const org = env.SALAD_ORG;
    if (!key || !org) return [];
    const base = (env.SALAD_API_BASE_URL || SALAD_API_BASE_URL).replace(/\/$/, "");
    const data = await jsonFetch(`${base}/organizations/${encodeURIComponent(org)}/gpu-classes`, {
      headers: { "Salad-Api-Key": key, Accept: "application/json" },
      timeoutMs: Number(env.SALAD_TIMEOUT_MS || 30_000)
    });
    return saladGpuClassesToItems(pickArray(data, ["items", "data"]));
  }
};

export function saladGpuClassesToItems(classes = []) {
  return (classes || []).map(saladClassToItem).filter(Boolean);
}

function saladClassToItem(gpuClass) {
  const name = String(gpuClass.name || "").trim();
  const vramGbEach = saladVramGb(name);
  // "Stable Diffusion Compatible" and any class without a parseable GPU + VRAM are
  // capability buckets, not a specific GPU — skip them.
  if (!vramGbEach && !/\b(RTX|GTX|GeForce|A\d{4})\b/i.test(name)) return null;

  const prices = pickArray(gpuClass, ["prices"]);
  const tier = (priority) => numberOrNull(prices.find((p) => p.priority === priority)?.price);
  const high = tier("high");
  const headline = high ?? numberOrNull(prices[0]?.price);
  if (headline == null || headline <= 0) return null;

  const model = saladModel(name);
  const gpuLabel = buildGpuLabel({ count: 1, model, vramGb: vramGbEach });

  return createInventoryItem({
    provider: "SaladCloud",
    providerId: "saladcloud",
    rawOfferId: gpuClass.id || name,
    gpuLabel,
    gpuCount: 1,
    vramGbEach,
    pricePerGpuHour: round(headline, 4),
    totalHourlyPrice: round(headline, 4),
    region: "SaladCloud (distributed)",
    formFactor: "container",
    interconnect: "PCIe",
    networkFabric: "Not exposed",
    currency: "USD",
    availability: gpuClass.is_high_demand ? "unavailable" : "unknown",
    availabilityCount: null,
    checkoutUrl: "https://portal.salad.com/",
    sourceMode: "live",
    listingType: "gpu_class_priority_pricing",
    priceScope: "node_total",
    availabilitySemantics: "catalog_only",
    dataNotes: [
      "SaladCloud community (distributed, interruptible) consumer GPU",
      saladPriceRangeNote(tier),
      gpuClass.is_high_demand ? "Marked high-demand by Salad" : "",
      fabricDataNote("Not exposed", gpuLabel, 1)
    ].filter(Boolean),
    metadata: compactMetadata({
      gpuClassId: gpuClass.id,
      name,
      gpuClassType: gpuClass.gpu_class_type,
      isHighDemand: gpuClass.is_high_demand,
      pricesByPriority: Object.fromEntries(prices.map((p) => [p.priority, p.price]))
    }),
    rawPayload: gpuClass
  });
}

function saladVramGb(name = "") {
  const match = name.match(/\((\d+)\s*GB\)/i);
  return match ? Number(match[1]) : null;
}

function saladModel(name = "") {
  return name.replace(/\s*\(\d+\s*GB\)\s*$/i, "").trim();
}

function saladPriceRangeNote(tier) {
  const high = tier("high");
  const batch = tier("batch");
  if (high != null && batch != null) return `Priority pricing: high $${high}/hr, batch $${batch}/hr`;
  return "";
}
