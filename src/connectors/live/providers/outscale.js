import { createInventoryItem } from "../../../core/inventory.js";
import { jsonFetch } from "../http.js";
import { buildGpuLabel, compactMetadata, fabricDataNote, numberOrNull, parseEnvList, truthyEnv } from "../format.js";

// 3DS Outscale (OUTSCALE_FCU "Flexible GPU"). Verified against the live API: the
// pricing catalog is PUBLIC (no auth):
//   POST https://api.<region>.outscale.com/api/v1/ReadPublicCatalog  {}
// Catalog.Entries includes per-GPU hourly EUR prices as
//   { Type: "Gpu:attach:nvidia-h100" | "Gpu:allocate:nvidia-h100", UnitPrice, SubregionName, ... }
// All 5 commercial regions expose it. We dedupe attach/allocate per (region, model),
// take the per-GPU EUR price (converted to USD via core FX). It is a price catalog with
// no live capacity, so rows are a region offering (provider_console), not orderable.
// No key needed; enable with OUTSCALE_ENABLED=1.
const OUTSCALE_DEFAULT_REGIONS = ["eu-west-2", "us-east-2", "us-west-1", "ap-northeast-1", "cloudgouv-eu-west-1"];
const GPU_TYPE_RE = /^Gpu:(attach|allocate):nvidia-(.+)$/;

export const outscaleConnector = {
  id: "outscale",
  name: "Outscale",
  envVars: ["OUTSCALE_ENABLED"],
  async fetch(env) {
    if (!truthyEnv(env.OUTSCALE_ENABLED)) return [];
    const regions = parseEnvList(env.OUTSCALE_REGIONS || "").length
      ? parseEnvList(env.OUTSCALE_REGIONS)
      : OUTSCALE_DEFAULT_REGIONS;
    const timeoutMs = Number(env.OUTSCALE_TIMEOUT_MS || 30_000);
    const results = await Promise.all(regions.map((region) => fetchOutscaleCatalog(region, env, timeoutMs)));
    return results.flat();
  }
};

async function fetchOutscaleCatalog(region, env, timeoutMs) {
  const host = (env.OUTSCALE_API_BASE_TEMPLATE || "https://api.{region}.outscale.com").replace("{region}", region);
  try {
    const data = await jsonFetch(`${host}/api/v1/ReadPublicCatalog`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: "{}",
      timeoutMs
    });
    return outscaleCatalogToItems(data?.Catalog?.Entries || [], region);
  } catch {
    return [];
  }
}

export function outscaleCatalogToItems(entries = [], region = "") {
  // Dedupe per model: "attach" and "allocate" carry the same per-GPU price; prefer
  // attach (the rate while the GPU is running on an instance).
  const byModel = new Map();
  for (const entry of entries) {
    const match = GPU_TYPE_RE.exec(entry.Type || "");
    if (!match) continue;
    const [, kind, token] = match;
    const price = numberOrNull(entry.UnitPrice);
    if (price == null || price <= 0) continue;
    const current = byModel.get(token);
    if (!current || (kind === "attach" && current.kind !== "attach")) {
      byModel.set(token, { token, kind, price, subregion: entry.SubregionName || region });
    }
  }
  return [...byModel.values()].map((row) => outscaleRow(row, region)).filter(Boolean);
}

function outscaleRow({ token, price, subregion }, region) {
  const model = outscaleModel(token);
  const vramGbEach = /a100-80/.test(token) ? 80 : null;
  const gpuLabel = buildGpuLabel({ count: 1, model, vramGb: vramGbEach });

  return createInventoryItem({
    provider: "Outscale",
    providerId: "outscale",
    rawOfferId: `${token}:${subregion || region}`,
    gpuLabel,
    gpuCount: 1,
    vramGbEach,
    pricePerGpuHour: price,
    totalHourlyPrice: price,
    region: subregion || region,
    formFactor: "vm",
    interconnect: "PCIe",
    networkFabric: "Not exposed",
    currency: "EUR",
    availability: "unknown",
    availabilityCount: null,
    checkoutUrl: "https://cockpit.outscale.com/",
    sourceMode: "live",
    listingType: "flexible_gpu_catalog",
    priceScope: "node_total",
    availabilitySemantics: "region_offering",
    dataNotes: [
      "Outscale Flexible GPU public price catalog (per-GPU, region offering; no live capacity)",
      `Catalog model token: nvidia-${token}`,
      fabricDataNote("Not exposed", gpuLabel, 1)
    ].filter(Boolean),
    metadata: compactMetadata({
      catalogToken: `nvidia-${token}`,
      region: subregion || region,
      unitPriceEur: price
    }),
    rawPayload: { token, region: subregion || region, unitPriceEur: price }
  });
}

function outscaleModel(token = "") {
  if (token === "a100-80") return "A100";
  // tokens: h200, h100, a100, l40, a10, v100, p100, p6, m60, k2 -> uppercase passes
  // through taxonomy (P6/K2/M60 may be Unknown, which is fine for older cards).
  return token.toUpperCase();
}
