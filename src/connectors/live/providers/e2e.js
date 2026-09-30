import { createInventoryItem } from "../../../core/inventory.js";
import { extractGpuCount } from "../../../core/taxonomy.js";
import { jsonFetch, pickArray } from "../http.js";
import { buildGpuLabel, compactMetadata, fabricDataNote, fabricFromText, fabricIsExposed, numberOrNull, parseEnvList, parseMemoryGb } from "../format.js";

const E2E_API_BASE_URL = "https://api.e2enetworks.com/myaccount";
// E2E's images API requires an explicit `location` and rejects unknown ones with
// HTTP 412, so we must enumerate the regions to query. Hardcoding a single region
// (previously "Delhi") risks silently dropping supply from any other region.
// These are E2E's GPU-serving regions; as of this writing only Delhi actually
// lists GPU plans (Mumbai/Chennai expose CPU instances only), but querying all of
// them means new GPU capacity in another region surfaces automatically instead of
// being hidden by a stale hardcode. Override with E2E_LOCATIONS to narrow.
const E2E_DEFAULT_LOCATIONS = ["Delhi", "Mumbai", "Chennai"];

export const e2eConnector = {
  id: "e2e-cloud",
  name: "E2E Cloud",
  envVars: ["E2E_API_KEY", "E2E_AUTH_TOKEN"],
  async fetch(env) {
    if (!env.E2E_API_KEY || !env.E2E_AUTH_TOKEN) return [];
    const configured = parseEnvList(env.E2E_LOCATIONS || "");
    const locations = configured.length ? configured : E2E_DEFAULT_LOCATIONS;
    const responses = await Promise.all(locations.map((location) => fetchE2EPlans(location, env)));
    return e2ePlansToItems(responses.flat(), env);
  }
};

async function fetchE2EPlans(location, env = {}) {
  const base = (env.E2E_API_BASE_URL || E2E_API_BASE_URL).replace(/\/$/, "");
  const url = new URL(`${base}/api/v1/images/`);
  url.searchParams.set("apikey", env.E2E_API_KEY);
  if (location) url.searchParams.set("location", location);
  if (env.E2E_PROJECT_ID) url.searchParams.set("project_id", env.E2E_PROJECT_ID);
  const data = await jsonFetch(url.toString(), {
    timeoutMs: Number(env.E2E_TIMEOUT_MS || 60_000),
    headers: {
      Authorization: `Bearer ${env.E2E_AUTH_TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "gpu-deal-terminal"
    }
  });
  return pickArray(data, ["data"]).map((raw) => ({ ...raw, _e2eQueryLocation: location }));
}

export function e2ePlansToItems(rows = [], env = {}) {
  const bestBySku = new Map();
  for (const raw of rows.filter(e2eIsGpuPlan)) {
    const key = e2ePlanKey(raw);
    const current = bestBySku.get(key);
    if (!current || e2ePlanPreference(raw) > e2ePlanPreference(current)) {
      bestBySku.set(key, raw);
    }
  }
  return [...bestBySku.values()].map((raw) => e2ePlanToItem(raw, env)).filter(Boolean);
}

function e2ePlanToItem(raw, env = {}) {
  const card = raw.gpu_card_details || {};
  const specs = raw.specs || {};
  const gpuCount = Number(card.UNIT_COUNT || card.unit_count || 0) || extractGpuCount(card.CARD_NAME || raw.name || raw.plan, 1);
  if (!gpuCount) return null;
  const vramGbEach = numberOrNull(card.UNIT_MEMORY || card.MEMORY || card.memory) || e2eVramGb(raw);
  const totalHourlyPrice = numberOrNull(specs.price_per_hour ?? raw.price_per_hour);
  const gpuLabel = buildGpuLabel({
    count: gpuCount,
    model: e2eGpuModelText(raw) || card.CARD_TYPE || card.CARD_NAME || raw.name || raw.plan,
    vramGb: vramGbEach,
    variant: `${card.CARD_NAME || ""} ${raw.name || ""} ${raw.plan || ""}`
  });
  const networkBandwidth = e2eNetworkBandwidth(raw);
  const networkFabric = fabricFromText(raw.network, raw.network_type, raw.node_description);
  const available = raw.available_inventory_status === true;

  return createInventoryItem({
    provider: "E2E Cloud",
    providerId: "e2e-cloud",
    rawOfferId: `${raw.location || raw._e2eQueryLocation || "unknown"}:${raw.name || specs.sku_name || "gpu"}:${raw.plan || specs.id || raw.image}`,
    gpuLabel,
    gpuCount,
    vramGbEach,
    pricePerGpuHour: totalHourlyPrice && gpuCount ? totalHourlyPrice / gpuCount : null,
    totalHourlyPrice,
    region: raw.location || raw._e2eQueryLocation || "E2E Cloud",
    formFactor: "vm",
    interconnect: e2eInterconnect(raw),
    cpu: specs.cpu ? `${specs.cpu} ${raw.cpu_type || "vCPU"}` : "",
    ramGb: parseMemoryGb(specs.ram),
    storage: specs.disk_space ? `${specs.disk_space} GB` : "",
    networkBandwidth,
    networkFabric,
    currency: raw.currency || "USD",
    availability: available ? "available" : "unavailable",
    availabilityCount: available ? 1 : 0,
    checkoutUrl: buildE2EUrl(raw, env),
    sourceMode: "live",
    listingType: "gpu_image_plan",
    priceScope: "node_total",
    availabilitySemantics: "sku_capacity",
    checkoutSemantics: "manual_provider",
    dataNotes: [
      available ? "" : "E2E API returned available_inventory_status=false",
      fabricDataNote(networkFabric, gpuLabel, gpuCount),
      raw.os?.name || raw.os?.version ? `Image: ${[raw.os?.name, raw.os?.version].filter(Boolean).join(" ")}` : "",
      Array.isArray(specs.committed_sku) && specs.committed_sku.length ? "Committed SKU options exposed" : ""
    ].filter(Boolean),
    metadata: compactMetadata({
      plan: raw.plan,
      name: raw.name,
      image: raw.image,
      os: raw.os,
      location: raw.location,
      queryLocation: raw._e2eQueryLocation,
      availableInventoryStatus: raw.available_inventory_status,
      cpuType: raw.cpu_type,
      gpuCardDetails: card,
      iops: raw.iops,
      blockStorageAttachable: raw.is_blockstorage_attachable,
      blockStoragePricePerGbMonth: raw.blockstorage_price_per_GB_per_month,
      minimumBillingAmount: specs.minimum_billing_amount,
      committedSku: specs.committed_sku,
      rawSpecs: specs
    }),
    specs: {
      provider: {
        rawSpecs: specs,
        os: raw.os,
        image: raw.image
      },
      network: {
        fabric: networkFabric,
        bandwidth: networkBandwidth,
        iops: raw.iops,
        ibListed: fabricIsExposed(networkFabric) && /infiniband|\bib\b|ndr|hdr|edr|rdma|roce/i.test(networkFabric)
      },
      storage: {
        diskGb: specs.disk_space,
        blockStorageAttachable: raw.is_blockstorage_attachable,
        blockStoragePricePerGbMonth: raw.blockstorage_price_per_GB_per_month
      }
    },
    rawPayload: raw
  });
}

function e2eIsGpuPlan(raw = {}) {
  const card = raw.gpu_card_details || {};
  return Boolean(card.CARD_TYPE || card.CARD_NAME || card.UNIT_COUNT || e2eGpuModelText(raw))
    || /gpu/i.test(`${raw.os?.category || ""} ${raw.specs?.family || ""} ${raw.name || ""} ${raw.plan || ""}`);
}

function e2eGpuModelText(raw = {}) {
  const text = `${raw.gpu_card_details?.CARD_TYPE || ""} ${raw.gpu_card_details?.CARD_NAME || ""} ${raw.name || ""} ${raw.plan || ""}`;
  if (/h200/i.test(text)) return "H200";
  if (/h100/i.test(text)) return "H100";
  if (/a100\s*80|a10080/i.test(text)) return "A100";
  if (/a100/i.test(text)) return "A100";
  if (/l40s/i.test(text)) return "L40S";
  if (/a40/i.test(text)) return "A40";
  if (/a30/i.test(text)) return "A30";
  if (/v100/i.test(text)) return "V100";
  if (/\bt4\b/i.test(text)) return "T4";
  if (/\bl4\b/i.test(text)) return "L4";
  return "";
}

function e2eVramGb(raw = {}) {
  const text = `${raw.name || ""} ${raw.plan || ""}`;
  if (/a100\s*80|a10080/i.test(text)) return 80;
  return null;
}

function e2ePlanKey(raw = {}) {
  const card = raw.gpu_card_details || {};
  const specs = raw.specs || {};
  return [
    raw.location || raw._e2eQueryLocation || "unknown",
    raw.name || specs.sku_name || "gpu",
    card.CARD_TYPE || card.CARD_NAME || "",
    specs.cpu || "",
    specs.ram || "",
    specs.disk_space || ""
  ].join(":");
}

function e2ePlanPreference(raw = {}) {
  const os = raw.os || {};
  const text = `${os.name || ""} ${os.version || ""} ${raw.image || ""}`;
  let score = raw.available_inventory_status === true ? 10_000 : 0;
  if (/ubuntu/i.test(text)) score += 400;
  if (/22\.04/i.test(text)) score += 80;
  if (/24\.04/i.test(text)) score += 70;
  if (/20\.04/i.test(text)) score += 50;
  if (/windows/i.test(text)) score -= 300;
  return score;
}

function e2eNetworkBandwidth(raw = {}) {
  const iops = raw.iops || {};
  const parts = [
    iops.READ_IOPS_SEC ? `${iops.READ_IOPS_SEC} read IOPS` : "",
    iops.WRITE_IOPS_SEC ? `${iops.WRITE_IOPS_SEC} write IOPS` : ""
  ].filter(Boolean);
  return parts.join(" / ");
}

function e2eInterconnect(raw = {}) {
  const text = `${raw.gpu_card_details?.CARD_NAME || ""} ${raw.gpu_card_details?.CARD_TYPE || ""} ${raw.name || ""} ${raw.plan || ""}`;
  if (/nvlink|sxm|hgx/i.test(text)) return "NVLink";
  if (/pcie|pci-e/i.test(text)) return "PCIe";
  return "";
}

function buildE2EUrl(raw = {}, env = {}) {
  const base = (env.E2E_WEB_BASE_URL || "https://myaccount.e2enetworks.com").replace(/\/$/, "");
  const params = new URLSearchParams();
  if (raw.plan) params.set("plan", raw.plan);
  if (raw.image) params.set("image", raw.image);
  if (raw.location || raw._e2eQueryLocation) params.set("location", raw.location || raw._e2eQueryLocation);
  if (env.E2E_PROJECT_ID) params.set("project_id", env.E2E_PROJECT_ID);
  const query = params.toString();
  return `${base}/${query ? `?${query}` : ""}`;
}
