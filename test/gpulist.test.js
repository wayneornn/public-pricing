import assert from "node:assert/strict";
import test from "node:test";
import { gpulistHtmlToItems, extractListings } from "../src/connectors/live/providers/gpulist.js";

// A minimal page that embeds two real-shaped listings in the same Next.js RSC envelope
// gpulist.ai uses (`self.__next_f.push([1,"<escaped json>"])`). The first record is the
// verified live "Helios Cloud INC" listing (field names + values verbatim); the others are
// synthetic to exercise the state filter and the expired-window drop.
const NOW = Date.parse("2026-06-13T00:00:00.000Z");

const LISTINGS_JSON = JSON.stringify([
  {
    id: "876b9e6", gpu_type: "RTX PRO 6000", num_gpus: 80, price_per_gpu_per_hour_in_cents: 130,
    interconnect_network: "Ethernet 100GbE", node_ram_in_gb: 1536, node_cpu_count: 144,
    node_nvme_storage_in_gb: 31334, geographical_location: "Salt Lake City, UT",
    cluster_stack_type: "Bare Metal", cloud_service_provider: "On-Prem Bare metal",
    company_name: "Helios Cloud INC", min_bookable_gpu: 8, min_bookable_weeks: 1,
    start_date: "$D2026-05-29T05:00:00.000Z", end_date: "$D2026-12-31T06:00:00.000Z", state: "approved"
  },
  {
    id: "pending-1", gpu_type: "H100", num_gpus: 8, price_per_gpu_per_hour_in_cents: 199,
    geographical_location: "Asia", company_name: "Pending Co", min_bookable_gpu: 8,
    min_bookable_weeks: 4, end_date: "$D2026-12-31T06:00:00.000Z", state: "pending" // not approved → dropped
  },
  {
    id: "expired-1", gpu_type: "A100", num_gpus: 16, price_per_gpu_per_hour_in_cents: 150,
    geographical_location: "North America", company_name: "Stale Co", min_bookable_gpu: 8,
    min_bookable_weeks: 2, end_date: "$D2026-01-01T06:00:00.000Z", state: "approved" // window ended → dropped
  }
]);

// Build the page the way Next streams it: the array is JSON-string-encoded inside push([1,"…"]).
const HTML = `<!doctype html><html><body><script>self.__next_f.push([1,${JSON.stringify(
  `a:["$","$L1",null,{"listings":${LISTINGS_JSON}}]`
)}])</script></body></html>`;

test("gpulist extracts approved listings from the RSC payload", () => {
  const listings = extractListings(HTML);
  assert.equal(listings.length, 3); // all three parsed out of the blob
  assert.ok(listings.some((l) => l.id === "876b9e6"));
});

test("gpulist emits only approved, in-window listings", () => {
  const rows = gpulistHtmlToItems(HTML, NOW);
  assert.equal(rows.length, 1); // pending + expired dropped
  assert.ok(rows.every((r) => r.providerId === "gpulist-ai"));
});

test("gpulist maps the Helios RTX PRO 6000 listing exactly", () => {
  const r = gpulistHtmlToItems(HTML, NOW).find((x) => x.rawOfferId === "876b9e6");
  assert.equal(r.gpuModel, "RTX PRO 6000");
  assert.equal(r.gpuCount, 80);
  assert.equal(r.pricePerGpuHour, 1.3); // 130¢ → $1.30
  assert.equal(r.totalHourlyPrice, 104); // 1.30 × 80
  assert.equal(r.currency, "USD");
  assert.equal(r.region, "Salt Lake City, UT");
  assert.equal(r.ramGb, 1536);
  assert.equal(r.metadata.sellerCompany, "Helios Cloud INC");
  assert.equal(r.metadata.minBookableGpu, 8);
  assert.equal(r.metadata.minBookableWeeks, 1);
});

test("gpulist rows are non-orderable reservation catalog", () => {
  const rows = gpulistHtmlToItems(HTML, NOW);
  assert.ok(rows.every((r) => r.orderable === false));
  assert.ok(rows[0].dataNotes.some((n) => /Reservation offer/.test(n)));
});
