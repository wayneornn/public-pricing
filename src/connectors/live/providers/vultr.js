import { createInventoryItem } from "../../../core/inventory.js";
import { jsonFetch, safeJsonFetch, pickArray } from "../http.js";
import { buildGpuLabel, compactMetadata, fabricDataNote, fabricFromText, normalizeGpuModelText, normalizeMbToGb, numberOrNull } from "../format.js";

const VULTR_API_BASE_URL = "https://api.vultr.com/v2";

export const vultrConnector = {
  id: "vultr",
  name: "Vultr",
  envVars: ["VULTR_API_KEY"],
  async fetch(env) {
    const base = (env.VULTR_API_BASE_URL || VULTR_API_BASE_URL).replace(/\/$/, "");
    const headers = env.VULTR_API_KEY ? { Authorization: `Bearer ${env.VULTR_API_KEY}` } : {};
    const [plansData, regionsData] = await Promise.all([
      jsonFetch(`${base}/plans?per_page=500`, { headers }),
      jsonFetch(`${base}/regions`, { headers })
    ]);
    const regions = pickArray(regionsData, ["regions", "data"]);
    const availabilityPairs = await Promise.all(regions.map(async (region) => {
      const data = await safeJsonFetch(`${base}/regions/${encodeURIComponent(region.id)}/availability`, { headers });
      return [region.id, new Set(pickArray(data, ["available_plans", "availablePlans", "plans"]))];
    }));
    return vultrPlansToItems(pickArray(plansData, ["plans", "data"]), regions, new Map(availabilityPairs));
  }
};

function vultrPlansToItems(plans, regions, availabilityByRegion) {
  const regionById = new Map(regions.map((region) => [region.id, region]));
  return plans
    .filter(vultrIsGpuPlan)
    .flatMap((plan) => {
      const regionIds = new Set(Array.isArray(plan.locations) ? plan.locations : []);
      for (const [regionId, availablePlans] of availabilityByRegion.entries()) {
        if (availablePlans.has(plan.id)) regionIds.add(regionId);
      }
      if (!regionIds.size) regionIds.add("catalog");
      return [...regionIds].map((regionId) => {
        const available = availabilityByRegion.get(regionId)?.has(plan.id) || false;
        return vultrPlanToItem(plan, regionById.get(regionId), { available, regionId });
      });
    });
}

function vultrIsGpuPlan(plan) {
  return plan.gpu_brand && plan.gpu_brand !== "none"
    || /^v(?:cg|dm|bm).*gpu/i.test(String(plan.id || ""))
    || /\b(a16|a40|a100|b200|h100|l40s|mi325x|mi355x)\b/i.test(String(plan.id || plan.gpu_type || ""));
}

function vultrPlanToItem(plan, region, options) {
  const gpuCountInfo = vultrGpuCountInfo(plan);
  const totalHourlyPrice = numberOrNull(plan.hourly_cost);
  const networkFabric = fabricFromText(plan.network_type, plan.network, plan.features?.join?.(" "));
  const regionLabel = region
    ? [region.city, region.country].filter(Boolean).join(", ") || region.id
    : options.regionId === "catalog" ? "Vultr catalog" : options.regionId;
  return createInventoryItem({
    provider: "Vultr",
    providerId: "vultr",
    rawOfferId: `${plan.id}:${options.regionId || "catalog"}`,
    gpuLabel: vultrGpuLabel(plan, gpuCountInfo),
    gpuCount: gpuCountInfo.normalizedCount,
    vramGbEach: vultrVramEach(plan, gpuCountInfo),
    pricePerGpuHour: totalHourlyPrice && gpuCountInfo.normalizedCount ? totalHourlyPrice / gpuCountInfo.normalizedCount : null,
    totalHourlyPrice,
    region: regionLabel,
    country: region?.country,
    formFactor: plan.type === "vdm" || /dedicated|metal/i.test(plan.disk_type || "") ? "bare_metal" : "vm",
    interconnect: vultrInterconnect(plan),
    cpu: plan.vcpu_count ? `${plan.vcpu_count} vCPU` : "",
    ramGb: normalizeMbToGb(plan.ram),
    storage: vultrStorage(plan),
    networkBandwidth: plan.bandwidth ? `${plan.bandwidth} GB included` : "",
    networkFabric,
    availability: options.available ? "available" : "unavailable",
    availabilityCount: options.available ? 1 : 0,
    checkoutUrl: buildVultrUrl(plan, region),
    sourceMode: "live",
    listingType: gpuCountInfo.fractionalLabel ? "fractional_gpu_plan" : "gpu_plan",
    priceScope: totalHourlyPrice ? "node_total" : "unknown",
    availabilitySemantics: "sku_capacity",
    dataNotes: [
      gpuCountInfo.fractionalLabel ? `Fractional GPU: ${gpuCountInfo.fractionalLabel}` : "",
      fabricDataNote(networkFabric, vultrGpuLabel(plan, gpuCountInfo), gpuCountInfo.normalizedCount),
      plan.deploy_preemptible ? "Preemptible available" : "",
      plan.deploy_ondemand === false ? "On-demand deployment disabled" : ""
    ].filter(Boolean),
    metadata: compactMetadata({
      planId: plan.id,
      type: plan.type,
      gpuType: plan.gpu_type,
      gpuBrand: plan.gpu_brand,
      gpuCount: plan.gpu_count,
      gpuFraction: gpuCountInfo.fraction,
      gpuVramGb: plan.gpu_vram_gb,
      invoiceType: plan.invoice_type,
      cpuVendor: plan.cpu_vendor,
      storageType: plan.storage_type,
      diskType: plan.disk_type,
      diskCount: plan.disk_count,
      deployOndemand: plan.deploy_ondemand,
      deployPreemptible: plan.deploy_preemptible,
      preemptibleHourlyCost: plan.hourly_cost_preemptible,
      monthlyCost: plan.monthly_cost,
      region
    }),
    rawPayload: plan
  });
}

function vultrGpuCountInfo(plan) {
  const rawCount = String(plan.gpu_count || "").trim();
  const fractionMatch = rawCount.match(/^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/);
  if (fractionMatch) {
    return {
      normalizedCount: 1,
      physicalCount: Number(fractionMatch[1]) / Number(fractionMatch[2]),
      fraction: Number(fractionMatch[1]) / Number(fractionMatch[2]),
      fractionalLabel: rawCount
    };
  }
  const explicitCount = Number(rawCount);
  if (Number.isFinite(explicitCount) && explicitCount > 0) {
    return { normalizedCount: explicitCount, physicalCount: explicitCount, fraction: null, fractionalLabel: "" };
  }
  const idCount = String(plan.id || "").match(/-(\d+)-(?:a100|h100|b200|mi355x|mi325x)-gpu\b/i)?.[1];
  if (idCount) return { normalizedCount: Number(idCount), physicalCount: Number(idCount), fraction: null, fractionalLabel: "" };
  const model = vultrGpuModel(plan);
  const totalVram = vultrTotalVram(plan);
  const defaultVram = vultrDefaultVram(model);
  if (totalVram && defaultVram) {
    const inferred = Math.round(totalVram / defaultVram);
    if (inferred > 0) return { normalizedCount: inferred, physicalCount: inferred, fraction: null, fractionalLabel: "" };
  }
  return { normalizedCount: 1, physicalCount: 1, fraction: null, fractionalLabel: "" };
}

function vultrGpuLabel(plan, gpuCountInfo) {
  const model = vultrGpuModel(plan);
  const vramGb = vultrVramEach(plan, gpuCountInfo);
  if (gpuCountInfo.fractionalLabel) {
    return `${model} ${vramGb ? `${vramGb}GB ` : ""}vGPU slice ${gpuCountInfo.fractionalLabel}`.trim();
  }
  return buildGpuLabel({
    count: gpuCountInfo.normalizedCount,
    model,
    vramGb,
    variant: vultrInterconnect(plan)
  });
}

function vultrGpuModel(plan) {
  const source = plan.gpu_type || plan.id || "";
  const match = String(source).match(/\b(NVIDIA_|AMD_)?(MI355X|MI325X|B200|H100|A100|L40S|A40|A16)\b/i);
  return match ? match[2].toUpperCase() : normalizeGpuModelText(source);
}

function vultrVramEach(plan, gpuCountInfo) {
  if (plan.gpu_vram_gb) return Number(plan.gpu_vram_gb);
  const totalVram = vultrTotalVram(plan);
  if (totalVram && gpuCountInfo.normalizedCount > 1) return Math.round(totalVram / gpuCountInfo.normalizedCount);
  return totalVram || vultrDefaultVram(vultrGpuModel(plan));
}

function vultrTotalVram(plan) {
  const match = String(plan.id || "").match(/-(\d+)vram\b/i);
  return match ? Number(match[1]) : null;
}

function vultrDefaultVram(model) {
  const defaults = {
    A16: 16,
    A40: 48,
    A100: 80,
    B200: 192,
    H100: 80,
    L40S: 48,
    MI325X: 256,
    MI355X: 288
  };
  return defaults[String(model || "").toUpperCase()] || null;
}

function vultrInterconnect(plan) {
  const text = `${plan.id || ""} ${plan.disk_type || ""}`;
  if (/dedicated|metal|a100|b200|h100|mi325x|mi355x/i.test(text)) return "NVLink";
  return "PCIe";
}

function vultrStorage(plan) {
  const count = Number(plan.disk_count || 1);
  const disk = Number(plan.disk || 0);
  if (!disk) return "";
  return `${count > 1 ? `${count}x ` : ""}${disk} GB ${plan.storage_type || plan.disk_type || ""}`.trim();
}

function buildVultrUrl(plan, region) {
  const params = new URLSearchParams();
  if (plan.id) params.set("plan", plan.id);
  if (region?.id) params.set("region", region.id);
  if (plan.type) params.set("type", plan.type);
  const query = params.toString();
  return `https://my.vultr.com/deploy/${query ? `?${query}` : ""}`;
}
