import { createInventoryItem } from "../../../core/inventory.js";
import { jsonFetch } from "../http.js";
import { buildGpuLabel, compactMetadata, fabricDataNote, numberOrNull, round } from "../format.js";

// LeaderGPU (operated by LeaderTelecom; the real API host is api.leaderssl.com — the
// api.leadergpu.com URL only serves the HTML docs). Verified against the live API:
//   POST https://api.leaderssl.com/api/v1/users/signin            {login,password} -> {id, auth_token}
//   GET  https://api.leaderssl.com/api/v1/users/{id}/servers/products  (X-AUTH-TOKEN header)
// Auth is account email + password (no API-key option): set LEADERGPU_LOGIN +
// LEADERGPU_PASSWORD.
//
// products is a flat list where each physical server (server_configuration_id) appears
// as separate billing variants (period_type = minute|day|week|month), priced in EUR.
// We group by server_configuration_id, take the most granular period as the on-demand
// rate (minute*60, else day/24, week/168, month/730), convert EUR->USD via core FX, and
// emit one row per server. Bare-metal dedicated; ordering creates a proforma invoice
// (payment), so rows are a priced catalog (provider_console), not a deep-link checkout.
const LEADERGPU_API_BASE_URL = "https://api.leaderssl.com/api/v1";
const PERIOD_HOURS = { minute: 1 / 60, hour: 1, day: 24, week: 168, month: 730 };
const PERIOD_PREFERENCE = ["minute", "day", "week", "month"];

export const leadergpuConnector = {
  id: "leader-gpu",
  name: "LeaderGPU",
  envVars: ["LEADERGPU_LOGIN", "LEADERGPU_PASSWORD"],
  async fetch(env) {
    const login = env.LEADERGPU_LOGIN;
    const password = env.LEADERGPU_PASSWORD;
    if (!login || !password) return [];
    const base = (env.LEADERGPU_API_BASE_URL || LEADERGPU_API_BASE_URL).replace(/\/$/, "");
    const timeoutMs = Number(env.LEADERGPU_TIMEOUT_MS || 30_000);

    const auth = await jsonFetch(`${base}/users/signin`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ login, password }).toString(),
      timeoutMs
    });
    if (!auth?.id || !auth?.auth_token) throw new Error("LeaderGPU signin did not return an auth token");

    const products = await jsonFetch(`${base}/users/${auth.id}/servers/products`, {
      headers: { "X-AUTH-TOKEN": auth.auth_token, Accept: "application/json" },
      timeoutMs
    });
    return leadergpuProductsToItems(Array.isArray(products) ? products : []);
  }
};

export function leadergpuProductsToItems(products = []) {
  const byConfig = new Map();
  for (const product of products) {
    const key = product.server_configuration_id ?? product.code;
    if (!byConfig.has(key)) byConfig.set(key, {});
    byConfig.get(key)[product.period_type] = product;
  }
  return [...byConfig.values()].map(leadergpuConfigToItem).filter(Boolean);
}

function leadergpuConfigToItem(byPeriod) {
  const chosen = PERIOD_PREFERENCE.map((p) => byPeriod[p]).find(Boolean);
  if (!chosen) return null;
  const hourlyEur = leadergpuHourly(chosen);
  if (hourlyEur == null) return null;

  const gpuCount = leadergpuGpuCount(chosen);
  const model = leadergpuModel(chosen.code, chosen.name);
  const gpuLabel = buildGpuLabel({ count: gpuCount, model });
  const available = chosen.free_time == null;
  const onDemand = chosen.period_type === "minute";

  return createInventoryItem({
    provider: "LeaderGPU",
    providerId: "leader-gpu",
    rawOfferId: String(chosen.server_configuration_id ?? chosen.code),
    gpuLabel,
    gpuCount,
    totalHourlyPrice: hourlyEur,
    region: "LeaderGPU (EU)",
    formFactor: "bare_metal",
    interconnect: /nvlink|sxm|hgx/i.test(`${chosen.code || ""} ${chosen.name || ""}`) ? "NVLink" : "PCIe",
    currency: chosen.currency || "EUR",
    availability: available ? "available" : "unavailable",
    availabilityCount: null,
    checkoutUrl: "https://www.leadergpu.com/",
    sourceMode: "live",
    listingType: "bare_metal_server",
    priceScope: "node_total",
    availabilitySemantics: "sku_capacity",
    dataNotes: [
      onDemand
        ? "Per-minute on-demand rate (converted to hourly)"
        : `Derived from ${chosen.period_type}ly rate (no per-minute tier; ${chosen.period_type} minimum commitment)`,
      available ? "" : chosen.free_time ? `Free from ${chosen.free_time}` : "Not currently free",
      fabricDataNote("Not exposed", gpuLabel, gpuCount)
    ].filter(Boolean),
    metadata: compactMetadata({
      serverConfigurationId: chosen.server_configuration_id,
      code: chosen.code,
      name: chosen.name,
      chosenPeriod: chosen.period_type,
      minuteSupported: chosen.minute_supported,
      freeTime: chosen.free_time,
      os: chosen.os,
      pricesByPeriod: Object.fromEntries(
        Object.values(byPeriod).map((p) => [p.period_type, { price: p.price, currency: p.currency }])
      )
    }),
    rawPayload: chosen
  });
}

function leadergpuHourly(product) {
  const price = numberOrNull(product.price);
  const hours = PERIOD_HOURS[product.period_type] * (Number(product.period_count) || 1);
  if (price == null || !hours) return null;
  return round(price / hours, 4);
}

function leadergpuGpuCount(product) {
  const fromName = String(product.name || "").match(/^\s*(\d+)\s*x/i);
  if (fromName) return Number(fromName[1]);
  const parts = String(product.code || "").split(":");
  const countPart = parts[2] ? parts[3] : parts[4];
  return numberOrNull(countPart) || 1;
}

// LeaderGPU codes look like GPU:Vendor:Model:Count:... (model is parts[3] when the
// vendor-model slot is empty, e.g. "GPU:Nvidia::A10"). The model token is compact
// (e.g. "6000Ada", "GTX1080TI", "T4Tesla"); normalize it into taxonomy-friendly text.
function leadergpuModel(code = "", name = "") {
  const parts = String(code).split(":");
  const token = (parts[2] || parts[3] || "").trim();
  const normalized = {
    Gaudi2: "Gaudi2",
    "6000Ada": "RTX 6000 Ada",
    RTX6000: "RTX 6000",
    GTX1080TI: "GTX 1080 Ti",
    GTX1080: "GTX 1080",
    RTX2080TI: "RTX 2080 Ti",
    "2080TI": "RTX 2080 Ti",
    RTX3090: "RTX 3090",
    "3090": "RTX 3090",
    RTX4090: "RTX 4090",
    "4090": "RTX 4090",
    RTX5090: "RTX 5090",
    "5090": "RTX 5090",
    P100PCI: "P100",
    T4Tesla: "T4"
  }[token];
  if (normalized) return normalized;
  // A100/A6000/A40/A10/H100/H200/L40S/L20/V100 pass through; fall back to the name when
  // the code token is empty/unknown.
  return token || String(name).replace(/^\s*\d+\s*x\s*/i, "").replace(/[,(].*$/, "").trim();
}
