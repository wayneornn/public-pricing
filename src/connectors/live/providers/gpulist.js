import { createInventoryItem } from "../../../core/inventory.js";
import { buildGpuLabel, compactMetadata, fabricFromText, numberOrNull, round, truthyEnv } from "../format.js";

// gpulist.ai — a community GPU *listings board* (brokerage), not a provisioning cloud.
// Companies post GPU clusters for reservation; gpulist verifies them (state="approved").
// Each listing carries a per-GPU hourly price but books in minimum chunks of
// min_bookable_gpu / min_bookable_weeks over a start_date..end_date window — i.e. reserved
// capacity, contact-the-seller, NOT instant on-demand supply (unlike Shadeform's API).
//
// There is no public JSON API; the approved listings are embedded in the landing page's
// Next.js RSC payload (`self.__next_f.push([1,"…"])`). We scrape that one structured blob.
// Verified live, each listing object is e.g.:
//   { id, gpu_type:"RTX PRO 6000", num_gpus:80, price_per_gpu_per_hour_in_cents:130,
//     interconnect_network:"Ethernet 100GbE", node_ram_in_gb, node_cpu_count,
//     node_nvme_storage_in_gb, geographical_location:"Salt Lake City, UT",
//     cluster_stack_type:"Bare Metal", cloud_service_provider, company_name:"Helios Cloud INC",
//     min_bookable_gpu:8, min_bookable_weeks:1, start_date, end_date, state:"approved" }
//
// Rows are a region-offering price catalog (provider_console / contact-seller), never
// orderable. Opt-in with GPULIST_ENABLED=1 (page scrape, no key).
const GPULIST_URL = "https://gpulist.ai/";
const PRICE_FIELD = "price_per_gpu_per_hour_in_cents";

export const gpulistConnector = {
  id: "gpulist-ai",
  name: "gpulist.ai",
  envVars: ["GPULIST_ENABLED"],
  async fetch(env) {
    if (!truthyEnv(env.GPULIST_ENABLED)) return [];
    const url = env.GPULIST_URL || GPULIST_URL;
    const response = await fetch(url, {
      headers: { Accept: "text/html", "User-Agent": "gpu-deal-terminal" },
      signal: AbortSignal.timeout(Number(env.GPULIST_TIMEOUT_MS || 30_000))
    });
    if (!response.ok) throw new Error(`gpulist.ai page ${response.status}`);
    return gpulistHtmlToItems(await response.text());
  }
};

export function gpulistHtmlToItems(htmlText = "", now = Date.now()) {
  const items = [];
  for (const listing of extractListings(htmlText)) {
    const row = gpulistRow(listing, now);
    if (row) items.push(row);
  }
  return items;
}

// Pull approved GPU-listing objects out of the page's Next.js RSC string chunks.
export function extractListings(htmlText = "") {
  const chunkRe = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g;
  const chunks = [];
  let m;
  while ((m = chunkRe.exec(htmlText)) !== null) {
    try {
      chunks.push(JSON.parse(m[1])); // decode the JS string literal
    } catch {
      /* skip undecodable chunk */
    }
  }
  const blob = chunks.join("");

  const listings = [];
  const seen = new Set();
  let idx = 0;
  while ((idx = blob.indexOf(PRICE_FIELD, idx)) !== -1) {
    const start = blob.lastIndexOf("{", idx);
    const end = start === -1 ? -1 : matchObjectEnd(blob, start);
    if (start !== -1 && end !== -1) {
      try {
        const obj = JSON.parse(blob.slice(start, end + 1));
        if (obj && obj.id && !seen.has(obj.id)) {
          seen.add(obj.id);
          listings.push(obj);
        }
      } catch {
        /* fragment wasn't a clean object; skip */
      }
      idx = end + 1;
    } else {
      idx += PRICE_FIELD.length;
    }
  }
  return listings;
}

// String-aware matching brace finder (ignores braces inside JSON string literals).
function matchObjectEnd(s, start) {
  let depth = 0;
  let inStr = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === "\\") i++; // skip escaped char
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// "$D2026-12-31T06:00:00.000Z" -> epoch ms (RSC date marker), else null
function rscDateMs(value) {
  const iso = String(value || "").replace(/^\$D/, "");
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

function gpulistRow(listing = {}, now = Date.now()) {
  if (String(listing.state || "").toLowerCase() !== "approved") return null; // only verified/approved

  const model = String(listing.gpu_type || "").trim();
  if (!model) return null; // never emit a GPU row whose model we cannot identify

  const cents = numberOrNull(listing.price_per_gpu_per_hour_in_cents);
  if (cents == null || cents <= 0) return null;
  const perGpuHour = round(cents / 100, 4);

  const gpuCount = numberOrNull(listing.num_gpus) || 1;

  // Drop listings whose availability window has already ended.
  const endMs = rscDateMs(listing.end_date);
  if (endMs != null && endMs < now) return null;

  const region = listing.geographical_location || "Unknown";
  const interconnect = listing.interconnect_network || "";
  const seller = listing.company_name || listing.cloud_service_provider || "gpulist.ai seller";
  const minGpu = numberOrNull(listing.min_bookable_gpu);
  const minWeeks = numberOrNull(listing.min_bookable_weeks);

  const gpuLabel = buildGpuLabel({ count: gpuCount, model });
  const bookingNote = [
    minGpu ? `min ${minGpu} GPU` : null,
    minWeeks ? `min ${minWeeks} week${minWeeks === 1 ? "" : "s"}` : null
  ].filter(Boolean).join(", ");

  return createInventoryItem({
    provider: "gpulist.ai",
    providerId: "gpulist-ai",
    rawOfferId: String(listing.id),
    gpuLabel,
    gpuCount,
    pricePerGpuHour: perGpuHour,
    totalHourlyPrice: round(perGpuHour * gpuCount, 4),
    region,
    formFactor: /bare ?metal/i.test(listing.cluster_stack_type || "") ? "bare_metal" : "cluster",
    interconnect: /nvlink|infiniband/i.test(interconnect) ? interconnect : interconnect || "Not exposed",
    cpu: numberOrNull(listing.node_cpu_count) ? `${numberOrNull(listing.node_cpu_count)} vCPU` : "",
    ramGb: numberOrNull(listing.node_ram_in_gb),
    storage: numberOrNull(listing.node_nvme_storage_in_gb) ? `${numberOrNull(listing.node_nvme_storage_in_gb)} GB NVMe` : "",
    networkFabric: fabricFromText(interconnect),
    currency: "USD",
    availability: "unknown", // a listing, not a live-bookable count
    availabilityCount: null,
    checkoutUrl: "https://gpulist.ai/",
    sourceMode: "live",
    listingType: "gpu_reservation_listing",
    priceScope: "node_total",
    availabilitySemantics: "region_offering",
    dataNotes: [
      `gpulist.ai verified listing brokered by "${seller}" (${listing.cloud_service_provider || "unspecified infra"}); contact the seller to book, not orderable here`,
      `Reservation offer (${bookingNote || "minimum booking applies"}) over an availability window — committed capacity, not instant on-demand supply`,
      `Per-GPU hourly price from price_per_gpu_per_hour_in_cents (${cents}¢/GPU/hr); node total = per-GPU × ${gpuCount} listed GPUs`
    ].filter(Boolean),
    metadata: compactMetadata({
      listingId: listing.id,
      gpuType: model,
      numGpus: gpuCount,
      pricePerGpuHour: perGpuHour,
      sellerCompany: listing.company_name,
      cloudServiceProvider: listing.cloud_service_provider,
      clusterStackType: listing.cluster_stack_type,
      interconnect,
      region,
      minBookableGpu: minGpu,
      minBookableWeeks: minWeeks,
      startDate: String(listing.start_date || "").replace(/^\$D/, "") || null,
      endDate: String(listing.end_date || "").replace(/^\$D/, "") || null
    }),
    rawPayload: { ...listing }
  });
}
