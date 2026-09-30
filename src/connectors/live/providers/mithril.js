import { createInventoryItem } from "../../../core/inventory.js";
import { compactMetadata } from "../format.js";

export function mithrilInstanceToItem(instanceType, region, pricing) {
  if (!instanceType || !pricing) return null;
  const reservedCents = Number(pricing.reserved_price_cents);
  if (!reservedCents || reservedCents <= 0) return null;
  const totalHourlyPrice = reservedCents / 100;
  const gpuCount = instanceType.num_gpus || 1;
  const availableCapacity = Number(pricing.available_capacity) || 0;
  const dataNotes = ["Auction/reserved clearing price — varies hour to hour, not a fixed on-demand rate"];
  return createInventoryItem({
    provider: "Mithril",
    providerId: "mithril",
    rawOfferId: `${instanceType.fid}:${region}`,
    gpuLabel: instanceType.gpu_type || "Unknown",
    gpuCount,
    vramGbEach: instanceType.gpu_memory_gb || null,
    totalHourlyPrice,
    pricePerGpuHour: gpuCount ? totalHourlyPrice / gpuCount : null,
    region,
    formFactor: "bare_metal",
    availability: availableCapacity > 0 ? "available" : "unavailable",
    availabilityCount: availableCapacity,
    checkoutUrl: "https://app.mithril.ai",
    sourceMode: "live",
    listingType: "instance_type",
    priceScope: "node_total",
    availabilitySemantics: "host_capacity",
    priceSemantics: "on_demand",
    checkoutSemantics: "manual_provider",
    volatilePricing: true,
    dataNotes,
    metadata: compactMetadata({
      fid: instanceType.fid,
      instanceName: instanceType.name,
      gpuType: instanceType.gpu_type,
      numGpus: instanceType.num_gpus,
      gpuMemoryGb: instanceType.gpu_memory_gb,
      region,
      reservedPriceCents: reservedCents,
      minimumPriceCents: pricing.minimum_price_cents,
      availableCapacity,
      totalCapacity: Number(pricing.total_capacity) || 0
    }),
    rawPayload: { instanceType, region, pricing }
  });
}

export function mithrilDedupeItems(items) {
  const best = new Map();
  for (const item of items) {
    // Key on the raw region (e.g. "us-central3-a"), not the coarse canonical
    // region, so distinct Mithril zones that share a canonical bucket aren't
    // collapsed into one row.
    const key = `${item.rawRegion}|${item.gpuModel}|${item.gpuCount}|${item.totalHourlyPrice ?? "x"}`;
    const current = best.get(key);
    if (!current || mithrilItemRank(item) > mithrilItemRank(current)) best.set(key, item);
  }
  return [...best.values()];
}

function mithrilItemRank(item) {
  return (item.orderable ? 2 : 0) + (item.availability === "available" ? 1 : 0);
}
