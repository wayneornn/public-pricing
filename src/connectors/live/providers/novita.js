import { createInventoryItem } from "../../../core/inventory.js";
import { jsonFetch, pickArray } from "../http.js";
import { buildGpuLabel, compactMetadata, fabricDataNote, numberOrNull, round } from "../format.js";

// Novita GPU instances. Verified against the live API:
//   GET https://api.novita.ai/gpu-instance/openapi/v1/products
//   Auth: Authorization: Bearer <key>
// Each product is a per-GPU SKU with on-demand `price` (and `spotPrice`) in units of
// 1e-5 USD/hr — e.g. "67000" = $0.67/hr (matches Novita's public RTX 4090 rate),
// "21000" = $0.21/hr (RTX 3090). `availableDeploy` + `inventoryState` are the live
// capacity signal; `regions` lists where the SKU runs.
//
// We surface the real ON-DEMAND price only (spot is dropped downstream and never
// emitted here). The Novita deploy console is a SPA at novita.ai/gpus-console; we could
// not verify that the ?productId= query actually prefills the deploy form, so per the
// repo's checkout-truth rule these rows are a priced catalog (provider_console,
// non-orderable) rather than a claimed prefilled checkout.
const NOVITA_API_BASE_URL = "https://api.novita.ai/gpu-instance/openapi/v1";
const NOVITA_PRICE_DIVISOR = 100_000; // price units are 1e-5 USD

export const novitaConnector = {
  id: "novita",
  name: "Novita AI",
  envVars: ["NOVITA_API_KEY", "NOVITA_TOKEN"],
  async fetch(env) {
    const key = env.NOVITA_API_KEY || env.NOVITA_TOKEN;
    if (!key) return [];
    const base = (env.NOVITA_API_BASE_URL || NOVITA_API_BASE_URL).replace(/\/$/, "");
    const data = await jsonFetch(`${base}/products`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      timeoutMs: Number(env.NOVITA_TIMEOUT_MS || 30_000)
    });
    return novitaProductsToItems(pickArray(data, ["data", "products"]));
  }
};

export function novitaProductsToItems(products = []) {
  return (products || []).map((product) => novitaProductToItem(product)).filter(Boolean);
}

function novitaProductToItem(product) {
  const onDemandHourly = novitaPrice(product.price);
  if (onDemandHourly == null) return null;
  const vramGbEach = novitaVramGb(product.name);
  const available = product.availableDeploy === true && String(product.inventoryState || "").toLowerCase() !== "none";
  const region = pickArray(product, ["regions"])[0] || "Novita";
  const gpuLabel = buildGpuLabel({ count: 1, model: product.name, vramGb: vramGbEach });

  return createInventoryItem({
    provider: "Novita AI",
    providerId: "novita",
    rawOfferId: String(product.id),
    gpuLabel,
    gpuCount: 1,
    vramGbEach,
    pricePerGpuHour: onDemandHourly,
    totalHourlyPrice: onDemandHourly,
    region,
    formFactor: "container",
    interconnect: "PCIe",
    cpu: product.cpuPerGpu ? `${product.cpuPerGpu} vCPU` : "",
    ramGb: numberOrNull(product.memoryPerGpu),
    storage: product.diskPerGpu ? `${product.diskPerGpu} GB` : "",
    networkFabric: "Not exposed",
    currency: "USD",
    availability: available ? "available" : "unavailable",
    availabilityCount: null,
    checkoutUrl: `https://novita.ai/gpus-console?productId=${encodeURIComponent(product.id)}`,
    sourceMode: "live",
    listingType: "gpu_instance_product",
    priceScope: "node_total",
    availabilitySemantics: "sku_capacity",
    dataNotes: [
      "Novita on-demand product price (per GPU); spot pricing excluded",
      `Inventory: ${product.inventoryState || "unknown"}${product.availableDeploy === true ? ", deployable" : ", not currently deployable"}`,
      pickArray(product, ["regions"]).length > 1 ? `Also in: ${pickArray(product, ["regions"]).slice(1).join(", ")}` : "",
      fabricDataNote("Not exposed", gpuLabel, 1)
    ].filter(Boolean),
    metadata: compactMetadata({
      productId: product.id,
      name: product.name,
      cpuPerGpu: product.cpuPerGpu,
      memoryPerGpu: product.memoryPerGpu,
      diskPerGpu: product.diskPerGpu,
      availableDeploy: product.availableDeploy,
      inventoryState: product.inventoryState,
      canBuy: product.canBuy,
      billingMethods: product.billingMethods,
      regions: product.regions,
      onDemandHourlyUsd: onDemandHourly
    }),
    rawPayload: product
  });
}

function novitaPrice(value) {
  const parsed = numberOrNull(value);
  if (parsed == null || parsed <= 0) return null;
  return round(parsed / NOVITA_PRICE_DIVISOR, 4);
}

function novitaVramGb(name = "") {
  const match = String(name).match(/(\d{2,3})\s*GB/i);
  return match ? Number(match[1]) : null;
}
