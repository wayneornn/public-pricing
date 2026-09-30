import { createHash } from "node:crypto";
import { createInventoryItem } from "../../../core/inventory.js";
import { jsonFetch } from "../http.js";
import { compactMetadata, numberOrNull, truthyEnv } from "../format.js";

// Hours used to express an OVH monthly-billed plan as an hourly-equivalent when
// the provider publishes no hourly (consumption) price. 730 = average hours per
// month. Only used for display when OVH_ALLOW_MONTHLY_DERIVED is enabled; such
// rows are clearly labelled "billed monthly" and stay non-orderable otherwise.
const OVH_MONTHLY_HOURS = 730;
// OVH instance-flavor families → GPU model + memory + RAM-per-GPU. The flavor
// name encodes total system RAM (e.g. "l40s-180" = 2x L40S, 180GB RAM), so GPU
// count = round(totalRamGb / ramPerGpu). Covers both the US line (l4/l40s/t2)
// and the EU line (a100/h100/h200/a10/t1) so the connector works on either
// subsidiary without code changes.
const OVH_GPU_FAMILIES = {
  l4: { model: "NVIDIA L4", vramGbEach: 24, ramPerGpu: 90 },
  l40s: { model: "NVIDIA L40S", vramGbEach: 48, ramPerGpu: 90 },
  t1: { model: "NVIDIA V100", vramGbEach: 16, ramPerGpu: 45 },
  t2: { model: "NVIDIA V100S", vramGbEach: 32, ramPerGpu: 45 },
  a10: { model: "NVIDIA A10", vramGbEach: 24, ramPerGpu: 45 },
  a100: { model: "NVIDIA A100", vramGbEach: 80, ramPerGpu: 180 },
  h100: { model: "NVIDIA H100", vramGbEach: 80, ramPerGpu: 380 },
  h200: { model: "NVIDIA H200", vramGbEach: 141, ramPerGpu: 480 }
};

// OVH signatures must use the provider's server clock; cache the offset to our
// local clock so we don't fetch /auth/time on every signed request.
let ovhTimeOffsetMs = null;
async function ovhTimestamp(base) {
  if (ovhTimeOffsetMs == null) {
    try {
      const res = await fetch(`${base}/auth/time`, { headers: { Accept: "application/json" } });
      const serverSec = Number((await res.text()).trim());
      ovhTimeOffsetMs = Number.isFinite(serverSec) ? serverSec * 1000 - Date.now() : 0;
    } catch {
      ovhTimeOffsetMs = 0;
    }
  }
  return Math.floor((Date.now() + ovhTimeOffsetMs) / 1000);
}

// OVH "v1" request signing: X-Ovh-Signature = "$1$" + sha1(AS+CK+METHOD+URL+BODY+TS).
async function ovhSignedJson(env, base, method, path) {
  const url = `${base}${path}`;
  const ts = await ovhTimestamp(base);
  const body = "";
  const toSign = `${env.OVH_APPLICATION_SECRET}+${env.OVH_CONSUMER_KEY}+${method}+${url}+${body}+${ts}`;
  const signature = "$1$" + createHash("sha1").update(toSign).digest("hex");
  return jsonFetch(url, {
    method,
    headers: {
      "X-Ovh-Application": env.OVH_APPLICATION_KEY,
      "X-Ovh-Timestamp": String(ts),
      "X-Ovh-Consumer": env.OVH_CONSUMER_KEY,
      "X-Ovh-Signature": signature
    }
  });
}

async function ovhSignedJsonSafe(env, base, method, path) {
  try {
    return await ovhSignedJson(env, base, method, path);
  } catch {
    return null;
  }
}

// Public Cloud catalog → { planCodeBase: { hourly, monthly } } in major currency
// units. OVH publishes the on-demand hourly rate under the "<base>.consumption"
// addon (its pricing has intervalUnit "none" + capacity "consumption", NOT
// "hour") and the committed monthly rate under "<base>.monthly" (intervalUnit
// "month", capacity "renew"). All prices are integers scaled by 1e8.
export function ovhCatalogPriceMap(catalog) {
  const map = new Map();
  const addons = Array.isArray(catalog?.addons) ? catalog.addons : [];
  const firstPositive = (addon, predicate) => {
    for (const pricing of Array.isArray(addon?.pricings) ? addon.pricings : []) {
      const price = Number(pricing?.price);
      if (Number.isFinite(price) && price > 0 && predicate(pricing)) return price / 1e8;
    }
    return null;
  };
  for (const addon of addons) {
    const planCode = String(addon?.planCode || "");
    let planBase = null;
    let kind = null;
    if (/\.consumption$/.test(planCode)) {
      planBase = planCode.replace(/\.consumption$/, "");
      kind = "hourly";
    } else if (/\.monthly$/.test(planCode)) {
      planBase = planCode.replace(/\.monthly$/, "");
      kind = "monthly";
    } else {
      continue;
    }
    if (!planBase) continue;
    const entry = map.get(planBase) || { hourly: null, monthly: null };
    if (kind === "hourly" && entry.hourly == null) {
      entry.hourly = firstPositive(addon, () => true);
    } else if (kind === "monthly" && entry.monthly == null) {
      entry.monthly = firstPositive(addon, (pricing) => pricing.intervalUnit === "month");
    }
    map.set(planBase, entry);
  }
  return map;
}

// Resolve an OVH instance flavor name (e.g. "l40s-180", "win-l4-90", "t2-le-45")
// to its GPU model + count. The numeric suffix is total system RAM in GB, so the
// GPU count = round(totalRam / ramPerGpu). Returns null for non-GPU flavors.
export function ovhGpuSpec(flavorName) {
  const name = String(flavorName || "").trim().toLowerCase();
  if (!name) return null;
  const parts = name.replace(/^win-/, "").split("-");
  const totalRamGb = Number(parts[parts.length - 1]);
  if (!Number.isFinite(totalRamGb) || totalRamGb <= 0) return null;
  const family = parts.slice(0, -1).join("-").replace(/-le$/, "");
  const def = OVH_GPU_FAMILIES[family];
  if (!def) return null;
  const gpuCount = Math.max(1, Math.round(totalRamGb / def.ramPerGpu));
  return { family, model: def.model, gpuCount, vramGbEach: def.vramGbEach, totalRamGb };
}

// Map a flavor to its catalog price base via the authoritative planCodes field
// (e.g. { hourly: "l4-90.consumption", monthly: "l4-90.monthly" } → "l4-90").
// Falls back to the flavor name (minus any OS prefix) when planCodes is absent.
function ovhPlanBase(flavor) {
  const hourly = flavor?.planCodes?.hourly;
  if (hourly) return String(hourly).replace(/\.consumption$/, "");
  const monthly = flavor?.planCodes?.monthly;
  if (monthly) return String(monthly).replace(/\.monthly$/, "");
  return String(flavor?.name || "").toLowerCase().replace(/^win-/, "");
}

export function ovhFlavorToItem(flavor, { region, priceMap, currency, projectId, env }) {
  const name = flavor?.name;
  // Skip Windows variants: they duplicate the same physical GPU as the Linux
  // flavor (same compute plan code) and would double-count supply.
  if (/^win-/i.test(String(name)) || flavor?.osType === "windows") return null;
  const spec = ovhGpuSpec(name);
  if (!spec) return null;
  const regionName = flavor?.region || region;
  const price = priceMap.get(ovhPlanBase(flavor)) || { hourly: null, monthly: null };
  const hasHourly = Number(price.hourly) > 0;
  const hasMonthly = Number(price.monthly) > 0;
  const monthlyDerived = !hasHourly && hasMonthly;
  const totalHourlyPrice = hasHourly ? price.hourly : monthlyDerived ? price.monthly / OVH_MONTHLY_HOURS : null;
  const available = flavor?.available === true;
  const allowMonthly = truthyEnv(env?.OVH_ALLOW_MONTHLY_DERIVED);
  // Truthfulness gate: only let a row become orderable when it has a
  // provider-published hourly price. Monthly-only flavors are surfaced but stay
  // non-orderable (never "Buy now") unless the operator explicitly opts in via
  // OVH_ALLOW_MONTHLY_DERIVED, since their hourly figure is an estimate.
  const orderable = available && totalHourlyPrice != null && (hasHourly || (monthlyDerived && allowMonthly)) ? undefined : false;
  const dataNotes = [];
  if (monthlyDerived) {
    dataNotes.push(`Billed monthly (${currency} ${Math.round(price.monthly)}/mo); hourly is an estimate (monthly ÷ ${OVH_MONTHLY_HOURS})`);
  }
  if (!hasHourly && !hasMonthly) dataNotes.push("No published price in the OVH catalog");
  if (spec.gpuCount > 1) dataNotes.push(`${spec.gpuCount}× ${spec.model} node`);
  return createInventoryItem({
    provider: "OVHcloud",
    providerId: "ovhcloud",
    rawOfferId: `${name}:${regionName}`,
    gpuLabel: `${spec.model} ${spec.vramGbEach}GB`,
    gpuCount: spec.gpuCount,
    vramGbEach: spec.vramGbEach,
    totalHourlyPrice,
    pricePerGpuHour: totalHourlyPrice && spec.gpuCount ? totalHourlyPrice / spec.gpuCount : null,
    region: regionName,
    formFactor: "vm",
    cpu: flavor?.vcpus ? `${flavor.vcpus} vCPU` : "",
    ramGb: numberOrNull(flavor?.ram),
    availability: available ? "available" : "unavailable",
    availabilityCount: available ? 1 : 0,
    currency,
    minTerm: monthlyDerived ? "1 month" : "",
    checkoutUrl: `https://us.ovhcloud.com/manager/#/public-cloud/pci/projects/${projectId}/instances/new`,
    sourceMode: "live",
    listingType: "flavor",
    priceScope: hasHourly ? "node_total" : monthlyDerived ? "node_total_variable" : "unknown",
    availabilitySemantics: "sku_capacity",
    priceSemantics: hasHourly ? "node_total" : monthlyDerived ? "node_total_variable" : "unpriced",
    // Deep-links to the project's instance-creation console; the flavor/region
    // aren't prefilled (they live in OVH's hash router), so this is a manual
    // provider hand-off, not an exact prefilled checkout.
    checkoutSemantics: "manual_provider",
    orderable,
    dataNotes: dataNotes.filter(Boolean),
    metadata: compactMetadata({
      flavorName: name,
      flavorId: flavor?.id,
      region: regionName,
      vcpus: flavor?.vcpus,
      ramGb: flavor?.ram,
      type: flavor?.type,
      osType: flavor?.osType,
      planCodes: flavor?.planCodes,
      hourlyPrice: price.hourly || null,
      monthlyPrice: price.monthly || null,
      monthlyDerived
    }),
    rawPayload: flavor
  });
}

// OVH publishes near-identical billing SKUs for the same hardware (e.g. "t2-45"
// and "t2-le-45" are both 1x V100S at the same hourly rate). Collapse rows that
// resolve to the same region + GPU model + count + hourly price, keeping the
// orderable/available one so we never show the same machine twice.
export function ovhDedupeItems(items) {
  const best = new Map();
  for (const item of items) {
    const key = `${item.regionCanonical}|${item.gpuModel}|${item.gpuCount}|${item.totalHourlyPrice ?? "x"}`;
    const current = best.get(key);
    if (!current || ovhItemRank(item) > ovhItemRank(current)) best.set(key, item);
  }
  return [...best.values()];
}

function ovhItemRank(item) {
  return (item.orderable ? 2 : 0) + (item.availability === "available" ? 1 : 0);
}

export { ovhSignedJsonSafe };
