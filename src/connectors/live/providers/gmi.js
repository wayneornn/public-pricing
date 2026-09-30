import { createInventoryItem } from "../../../core/inventory.js";
import { extractGpuCount } from "../../../core/taxonomy.js";
import { safeJsonFetch, pickArray } from "../http.js";
import { buildGpuLabel, compactMetadata, fabricDataNote, fabricFromText, parseMemoryGb } from "../format.js";

const GMI_API_BASE_URL = "https://console.gmicloud.ai";

export const gmiConnector = {
  id: "gmi",
  name: "GMI Cloud",
  envVars: ["GMI_API_KEY"],
  async fetch(env) {
    const key = env.GMI_API_KEY;
    if (!key) return [];
    const base = (env.GMI_API_BASE_URL || GMI_API_BASE_URL).replace(/\/$/, "");
    const headers = { Authorization: `Bearer ${key}` };
    const [idcsData, containerProducts, bareMetalProducts] = await Promise.all([
      safeJsonFetch(`${base}/api/v1/idcs`, { headers }),
      safeJsonFetch(`${base}/api/v1/containers/products`, { headers }),
      safeJsonFetch(`${base}/api/v1/baremetals/products`, { headers })
    ]);
    return gmiProductsToItems({
      idcs: pickArray(idcsData, ["idcs", "data"]),
      containerProducts,
      bareMetalProducts
    }, env);
  }
};

export function gmiProductsToItems({ idcs = [], containerProducts, bareMetalProducts } = {}, env = {}) {
  const idcMap = new Map(idcs.map((idc) => [idc.idcId || idc.id || idc.name, idc]));
  return [
    ...pickArray(containerProducts, ["products", "data"]).map((raw) => gmiProductToItem(raw, idcMap, "container", env)),
    ...pickArray(bareMetalProducts, ["products", "data"]).map((raw) => gmiProductToItem(raw, idcMap, "bare_metal", env))
  ].filter(Boolean);
}

function gmiProductToItem(raw, idcMap, fallbackFormFactor, env = {}) {
  const gpuText = gmiSpecValue(raw, /gpu/i) || raw.gpuModel || raw.name || "";
  const gpuCount = extractGpuCount(gpuText, extractGpuCount(raw.name, 1));
  if (!gpuCount || !/\b(gpu|h100|h200|a100|l40s|l40|a30|a10|rtx|nvidia)\b/i.test(`${gpuText} ${raw.gpuModel || ""}`)) return null;
  const totalHourlyPrice = gmiPriceToDollars(raw.price ?? raw.pricePerHour ?? raw.hourlyPrice);
  const idc = idcMap.get(raw.idc) || {};
  const valid = raw.valid === true || /^available|active|valid$/i.test(String(raw.status || ""));
  const formFactor = /bare/i.test(raw.type || raw.productLine || fallbackFormFactor) ? "bare_metal" : fallbackFormFactor;
  const networkBandwidth = gmiNetwork(raw);
  const networkFabric = fabricFromText(networkBandwidth);

  return createInventoryItem({
    provider: "GMI Cloud",
    providerId: "gmi",
    rawOfferId: `${fallbackFormFactor}:${raw.name || raw.id || raw.productId}:${raw.idc || "unknown"}`,
    gpuLabel: buildGpuLabel({
      count: gpuCount,
      model: raw.gpuModel || gpuText,
      vramGb: gmiVramGb(gpuText),
      variant: `${gpuText} ${raw.name || ""} ${raw.type || ""} ${raw.productLine || ""}`
    }),
    gpuCount,
    vramGbEach: gmiVramGb(gpuText),
    pricePerGpuHour: totalHourlyPrice && gpuCount ? totalHourlyPrice / gpuCount : null,
    totalHourlyPrice,
    region: gmiRegionLabel(raw, idc),
    country: idc.country,
    formFactor,
    interconnect: gmiInterconnect(raw),
    cpu: gmiSpecValue(raw, /cpu/i),
    ramGb: gmiMemoryGb(gmiSpecValue(raw, /memory|ram/i)),
    storage: gmiSpecValue(raw, /storage|disk/i),
    networkBandwidth,
    networkFabric,
    availability: valid ? "available" : "unavailable",
    availabilityCount: valid ? 1 : 0,
    checkoutUrl: buildGmiUrl(raw, env),
    sourceMode: "live",
    listingType: `${fallbackFormFactor}_product`,
    priceScope: "node_total",
    availabilitySemantics: "sku_capacity",
    checkoutSemantics: "manual_provider",
    dataNotes: [
      valid ? "" : "GMI API returned valid=false",
      fabricDataNote(networkFabric, gpuText, gpuCount),
      raw.productLine ? `Product line: ${raw.productLine}` : ""
    ].filter(Boolean),
    metadata: compactMetadata({
      idc,
      productName: raw.name,
      productLine: raw.productLine,
      type: raw.type,
      valid: raw.valid,
      rawPrice: raw.price,
      networkFabric,
      spec: raw.spec
    }),
    specs: {
      network: {
        fabric: networkFabric,
        adapters: networkBandwidth
      }
    },
    rawPayload: raw
  });
}

function gmiSpecValue(raw, pattern) {
  const specs = raw?.spec || {};
  const entries = [
    ...(Array.isArray(specs.basic) ? specs.basic : []),
    ...(Array.isArray(specs.extra) ? specs.extra : []),
    ...(Array.isArray(specs) ? specs : [])
  ];
  const match = entries.find((entry) => pattern.test(String(entry?.name || "")));
  if (match) return String(match.value || "").trim();
  for (const [key, value] of Object.entries(specs)) {
    if (pattern.test(key) && typeof value !== "object") return String(value || "").trim();
  }
  return "";
}

function gmiPriceToDollars(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  if (parsed > 100_000) return parsed / 1_000_000;
  if (parsed > 1_000) return parsed / 100;
  return parsed;
}

function gmiVramGb(value = "") {
  const text = String(value || "");
  return Number(text.match(/\b(\d+(?:\.\d+)?)\s*GB\b/i)?.[1] || 0) || null;
}

function gmiMemoryGb(value = "") {
  const text = String(value || "");
  const multiplied = text.match(/\b(\d+(?:\.\d+)?)\s*GB\s*x\s*(\d+)\b/i);
  if (multiplied) return Number(multiplied[1]) * Number(multiplied[2]);
  return parseMemoryGb(text);
}

function gmiInterconnect(raw) {
  const gpuText = gmiSpecValue(raw, /gpu/i);
  if (/nvlink|sxm/i.test(gpuText)) return "NVLink";
  return "PCIe";
}

function gmiNetwork(raw) {
  const common = gmiSpecValue(raw, /network|adapter/i);
  const specs = raw?.spec || {};
  const extra = Array.isArray(specs.extra)
    ? specs.extra
      .filter((entry) => /network|adapter/i.test(String(entry?.name || "")))
      .map((entry) => `${entry.name}: ${entry.value}`)
      .join(" / ")
    : "";
  return extra || common;
}

function gmiRegionLabel(raw, idc = {}) {
  return [
    idc.name,
    idc.countrySubdivision,
    idc.country,
    raw.idc
  ].filter(Boolean).join(" / ") || raw.idc || "GMI Cloud";
}

function buildGmiUrl(raw, env = {}) {
  const base = (env.GMI_WEB_BASE_URL || "https://console.gmicloud.ai").replace(/\/$/, "");
  const params = new URLSearchParams();
  if (raw.name) params.set("product", raw.name);
  if (raw.idc) params.set("idc", raw.idc);
  const query = params.toString();
  return `${base}/create${query ? `?${query}` : ""}`;
}
