import { createHmac } from "node:crypto";
import { createInventoryItem } from "../../../core/inventory.js";
import { jsonFetch, pickArray } from "../http.js";
import { buildGpuLabel, compactMetadata, fabricDataNote, fabricFromText } from "../format.js";

export const crusoeConnector = {
  id: "crusoe",
  name: "Crusoe",
  envVars: ["CRUSOE_ACCESS_KEY", "CRUSOE_SECRET_KEY"],
  async fetch(env) {
    if (!env.CRUSOE_ACCESS_KEY || !env.CRUSOE_SECRET_KEY) return [];
    const data = await crusoeFetch("/capacities", env);
    const capacities = aggregateCrusoeCapacities(pickArray(data, ["items", "data"]));
    return capacities
      .filter((raw) => isCrusoeGpuType(raw.type))
      .map((raw) => {
        const parsed = parseCrusoeType(raw.type, raw.quota_type);
        return createInventoryItem({
          provider: "Crusoe",
          rawOfferId: `${raw.type}:${raw.location}`,
          gpuLabel: parsed.label,
          gpuCount: parsed.count,
          vramGbEach: parsed.vramGb,
          region: raw.location,
          formFactor: "vm",
          interconnect: parsed.interconnect,
          networkFabric: parsed.networkFabric,
          cpu: parsed.cpu ? `${parsed.cpu} vCPU` : "",
          ramGb: parsed.ramGb,
          availability: raw.quantity > 0 ? "available" : "unavailable",
          availabilityCount: raw.quantity,
          checkoutUrl: buildCrusoeUrl(raw),
          sourceMode: "live",
          listingType: "capacity",
          priceScope: "unpriced_capacity",
          dataNotes: [
            "Capacity API does not return price",
            fabricDataNote(parsed.networkFabric, parsed.label, parsed.count)
          ].filter(Boolean),
          metadata: compactMetadata({
            type: raw.type,
            quotaType: raw.quota_type,
            networkFabric: parsed.networkFabric,
            numSlices: raw.num_slices,
            rawCapacityItemCount: raw.rawItems?.length,
            rawQuantities: raw.rawItems?.map((item) => item.quantity)
          }),
          rawPayload: raw
        });
      });
  }
};

async function crusoeFetch(path, env, query = "") {
  const version = "/v1alpha5";
  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00");
  const payload = `${version}${path}\n${query}\nGET\n${timestamp}\n`;
  const secret = String(env.CRUSOE_SECRET_KEY || "");
  const decodedSecret = Buffer.from(secret + "=".repeat((4 - (secret.length % 4)) % 4), "base64url");
  const signature = createHmac("sha256", decodedSecret).update(payload, "ascii").digest("base64url");
  return jsonFetch(`https://api.crusoecloud.com${version}${path}${query ? `?${query}` : ""}`, {
    headers: {
      "X-Crusoe-Timestamp": timestamp,
      Authorization: `Bearer 1.0:${env.CRUSOE_ACCESS_KEY}:${signature}`
    }
  });
}

function aggregateCrusoeCapacities(items) {
  const groups = new Map();
  for (const item of items) {
    const key = `${item.type}:${item.location}`;
    const existing = groups.get(key);
    if (existing) {
      existing.quantity += Number(item.quantity || 0);
      existing.rawItems.push(item);
    } else {
      groups.set(key, {
        ...item,
        quantity: Number(item.quantity || 0),
        rawItems: [item]
      });
    }
  }
  return [...groups.values()];
}

function isCrusoeGpuType(value) {
  return /\b(a100|b200|b300|gb200|h100|h200|l40s|mi300x|mi355x)\b/i.test(String(value || ""));
}

function parseCrusoeType(type, quotaType = "") {
  const text = String(type || "");
  const count = Number(text.match(/[.-](\d+)x$/i)?.[1] || 1);
  const model = text.match(/\b(a100|b200|b300|gb200|h100|h200|l40s|mi300x|mi355x)\b/i)?.[1]?.toUpperCase() || text;
  const vramGb = Number(text.match(/(\d+)gb/i)?.[1] || 0) || null;
  const variant = /nvl/i.test(text) ? "NVL" : /sxm/i.test(text) ? "SXM" : /pcie/i.test(text) ? "PCIe" : "";
  const interconnect = /nvl|sxm/i.test(text) ? "NVLink" : /pcie/i.test(text) ? "PCIe" : variant || "Unknown";
  const networkFabric = fabricFromText(text);
  const quota = String(quotaType || "").match(/VCPU_(\d+)_MEM_(\d+)/i);
  return {
    count,
    vramGb,
    interconnect,
    networkFabric,
    cpu: quota ? Number(quota[1]) : null,
    ramGb: quota ? Number(quota[2]) : null,
    label: buildGpuLabel({ count, model, vramGb, variant })
  };
}

function buildCrusoeUrl(raw) {
  const params = new URLSearchParams();
  if (raw.type) params.set("type", raw.type);
  if (raw.location) params.set("location", raw.location);
  const query = params.toString();
  return `https://cloud.crusoe.ai/compute/vms/create${query ? `?${query}` : ""}`;
}
