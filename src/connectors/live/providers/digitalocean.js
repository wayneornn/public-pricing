import { createInventoryItem } from "../../../core/inventory.js";
import { compactMetadata } from "../format.js";

const DIGITALOCEAN_GPU_LABELS = {
  nvidia_rtx4000_ada: "NVIDIA RTX 4000 Ada",
  nvidia_l40s: "NVIDIA L40S",
  nvidia_rtx6000_ada: "NVIDIA RTX 6000 Ada",
  amd_mi300x: "AMD MI300X",
  nvidia_h100: "NVIDIA H100",
  nvidia_h200: "NVIDIA H200"
};

export function digitaloceanSizeToItem(size) {
  const gi = size?.gpu_info;
  if (!gi || !gi.count) return null;
  const gpuLabel = DIGITALOCEAN_GPU_LABELS[gi.model] || String(gi.model || "").replace(/_/g, " ");
  const gpuCount = gi.count;
  const vramTotal = gi.vram?.amount || 0;
  const vramGbEach = gpuCount > 0 ? Math.round(vramTotal / gpuCount) : vramTotal;
  const totalHourlyPrice = Number(size.price_hourly) || null;
  const available = size.available === true;
  return createInventoryItem({
    provider: "DigitalOcean",
    providerId: "digitalocean",
    rawOfferId: size.slug,
    gpuLabel,
    gpuCount,
    vramGbEach,
    totalHourlyPrice,
    pricePerGpuHour: totalHourlyPrice && gpuCount ? totalHourlyPrice / gpuCount : null,
    region: "",
    formFactor: "vm",
    cpu: size.vcpus ? `${size.vcpus} vCPU` : "",
    ramGb: size.memory ? size.memory / 1024 : null,
    storage: size.disk ? `${size.disk} GB` : "",
    availability: available ? "available" : "unavailable",
    availabilityCount: available ? 1 : 0,
    checkoutUrl: `https://cloud.digitalocean.com/droplets/new?size=${encodeURIComponent(size.slug)}`,
    sourceMode: "live",
    listingType: "gpu_droplet",
    priceScope: "node_total",
    availabilitySemantics: "sku_capacity",
    priceSemantics: "node_total",
    checkoutSemantics: "manual_provider",
    dataNotes: ["Region selected at checkout (API does not expose per-size regions)"],
    metadata: compactMetadata({
      slug: size.slug,
      description: size.description,
      gpuModel: gi.model,
      vcpus: size.vcpus,
      memoryMb: size.memory,
      diskGb: size.disk,
      priceMonthly: size.price_monthly
    }),
    rawPayload: size
  });
}
