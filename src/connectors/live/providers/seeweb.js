import { createInventoryItem } from "../../../core/inventory.js";
import { buildGpuLabel, compactMetadata, fabricDataNote, numberOrNull, round, truthyEnv } from "../format.js";

// Seeweb Cloud Server GPU (Italy, OpenStack-based ECS). OpenStack has no pricing API and
// the flavor list needs project credentials, but Seeweb publishes per-GPU hourly EUR
// prices on its product page as "CLOUD GPU <model> ... Hourly Cost <price> €" cards.
// We scrape those cards (more fragile than a JSON API → opt-in via SEEWEB_ENABLED=1) and
// emit a region-offering price catalog (provider_console), not orderable capacity.
//
// Verified live: page exposes cards for MI300X, H200, H100, RTX PRO 6000, A100, L40S,
// RTX A6000, L4, Quadro RTX, A30 with their hourly EUR rates.
const SEEWEB_PRICING_URL = "https://www.seeweb.it/en/products/cloud-server-gpu";

export const seewebConnector = {
  id: "seeweb",
  name: "Seeweb",
  envVars: ["SEEWEB_ENABLED"],
  async fetch(env) {
    if (!truthyEnv(env.SEEWEB_ENABLED)) return [];
    const url = env.SEEWEB_PRICING_URL || SEEWEB_PRICING_URL;
    const response = await fetch(url, {
      headers: { Accept: "text/html", "User-Agent": "Mozilla/5.0 (gpu-deal-terminal)" },
      signal: AbortSignal.timeout(Number(env.SEEWEB_TIMEOUT_MS || 30_000))
    });
    if (!response.ok) throw new Error(`Seeweb pricing page ${response.status}`);
    return seewebHtmlToItems(await response.text());
  }
};

export function seewebHtmlToItems(htmlText = "") {
  const flat = String(htmlText).replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ");
  // Collect GPU cards and hourly prices in document order, then pair each price with the
  // most recent preceding card title.
  const tokens = [];
  for (const m of flat.matchAll(/CLOUD GPU ([A-Za-z0-9 /]+?) (?:\d|Hourly|Configuration|Select)/g)) {
    tokens.push({ kind: "card", pos: m.index, text: m[1].trim() });
  }
  for (const m of flat.matchAll(/Hourly Cost\s+([0-9]+[.,][0-9]+)/g)) {
    tokens.push({ kind: "price", pos: m.index, value: numberOrNull(m[1].replace(",", ".")) });
  }
  tokens.sort((a, b) => a.pos - b.pos);

  const items = [];
  let card = null;
  const seen = new Set();
  for (const token of tokens) {
    if (token.kind === "card") { card = token.text; continue; }
    if (!card || token.value == null || token.value <= 0) continue;
    const key = `${card}:${token.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(seewebRow(card, token.value));
  }
  return items;
}

function seewebRow(cardText, priceEur) {
  const model = seewebModel(cardText);
  const gpuLabel = buildGpuLabel({ count: 1, model });
  return createInventoryItem({
    provider: "Seeweb",
    providerId: "seeweb",
    rawOfferId: `${cardText.replace(/\s+/g, "-").toLowerCase()}`,
    gpuLabel,
    gpuCount: 1,
    pricePerGpuHour: round(priceEur, 4),
    totalHourlyPrice: round(priceEur, 4),
    region: "Seeweb (IT)",
    country: "IT",
    formFactor: "vm",
    interconnect: "PCIe",
    networkFabric: "Not exposed",
    currency: "EUR",
    availability: "unknown",
    availabilityCount: null,
    checkoutUrl: "https://www.seeweb.it/en/products/cloud-server-gpu",
    sourceMode: "live",
    listingType: "gpu_price_listing",
    priceScope: "node_total",
    availabilitySemantics: "region_offering",
    dataNotes: [
      "Seeweb published per-GPU hourly price; scraped from product page",
      "OpenStack flavor capacity not exposed without project credentials",
      fabricDataNote("Not exposed", gpuLabel, 1)
    ].filter(Boolean),
    metadata: compactMetadata({ card: cardText, model, unitPriceEur: priceEur }),
    rawPayload: { card: cardText, unitPriceEur: priceEur }
  });
}

// Seeweb's card titles are sometimes truncated by the page layout (e.g. "NVIDIA RTX
// PRO", "NVIDIA Quadro RTX"); detect the model by keyword against their known lineup.
function seewebModel(cardText = "") {
  const text = cardText.toUpperCase();
  if (/MI300X/.test(text)) return "MI300X";
  if (/H200/.test(text)) return "H200";
  if (/H100/.test(text)) return "H100";
  if (/A100/.test(text)) return "A100";
  if (/L40S/.test(text)) return "L40S";
  if (/\bL40\b/.test(text)) return "L40";
  if (/A6000/.test(text)) return "A6000";
  if (/A30/.test(text)) return "A30";
  if (/\bL4\b/.test(text)) return "L4";
  if (/RTX\s*PRO/.test(text)) return "RTX PRO 6000";
  if (/QUADRO\s*RTX/.test(text)) return "RTX 6000";
  return cardText.replace(/^NVIDIA\s*|^AMD\s*/i, "").trim() || "GPU";
}
