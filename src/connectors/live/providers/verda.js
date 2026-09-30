import { createInventoryItem } from "../../../core/inventory.js";
import { extractGpuCount } from "../../../core/taxonomy.js";
import { jsonFetch, pickArray } from "../http.js";
import { compactMetadata, fabricDataNote, fabricFromText, numberOrNull } from "../format.js";

const VERDA_API_BASE_URL = "https://api.datacrunch.io/v1";

export const verdaConnector = {
  id: "verda-datacrunch",
  name: "Verda/DataCrunch",
  envVars: ["DATACRUNCH_CLIENT_ID", "DATACRUNCH_CLIENT_SECRET", "DATACRUNCH_API_KEY"],
  async fetch(env) {
    const token = await fetchVerdaAccessToken(env);
    const projectId = env.DATACRUNCH_PROJECT_ID || verdaProjectIdFromToken(token);
    const base = (env.DATACRUNCH_API_BASE_URL || VERDA_API_BASE_URL).replace(/\/$/, "");
    const headers = { Authorization: `Bearer ${token}` };
    const [types, locations, onDemandAvailability, spotAvailability] = await Promise.all([
      jsonFetch(`${base}/instance-types?currency=${encodeURIComponent(env.DATACRUNCH_CURRENCY || "usd")}`),
      jsonFetch(`${base}/locations`, { headers }),
      jsonFetch(`${base}/instance-availability`, { headers }),
      jsonFetch(`${base}/instance-availability?is_spot=true`, { headers })
    ]);
    return verdaTypesToItems(types, locations, onDemandAvailability, spotAvailability, { projectId });
  }
};

async function fetchVerdaAccessToken(env) {
  const existingToken = env.DATACRUNCH_ACCESS_TOKEN || env.DATACRUNCH_API_KEY;
  if (existingToken) return existingToken;
  if (!env.DATACRUNCH_CLIENT_ID || !env.DATACRUNCH_CLIENT_SECRET) {
    throw new Error("Missing Verda/DataCrunch client credentials");
  }
  const base = (env.DATACRUNCH_API_BASE_URL || VERDA_API_BASE_URL).replace(/\/$/, "");
  const data = await jsonFetch(`${base}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: env.DATACRUNCH_CLIENT_ID,
      client_secret: env.DATACRUNCH_CLIENT_SECRET
    })
  });
  if (!data.access_token) throw new Error("Verda/DataCrunch token response did not include access_token");
  return data.access_token;
}

function verdaTypesToItems(types, locations, onDemandAvailability, spotAvailability, context = {}) {
  const locationsByCode = new Map(pickArray(locations, ["locations", "data"]).map((location) => [location.code, location]));
  const onDemandByType = verdaAvailabilityByType(onDemandAvailability);
  const spotByType = verdaAvailabilityByType(spotAvailability);
  return pickArray(types, ["instance_types", "data"])
    .filter((raw) => Number(raw.gpu?.number_of_gpus || 0) > 0)
    .filter((raw) => !/^cpu/i.test(raw.instance_type || raw.name || raw.display_name || ""))
    .flatMap((raw) => {
      const type = raw.instance_type || raw.id || raw.name;
      const onDemandLocations = onDemandByType.get(type) || [];
      const spotLocations = spotByType.get(type) || [];
      const rows = [];
      const catalogLocations = onDemandLocations.length ? onDemandLocations : ["catalog"];
      for (const locationCode of catalogLocations) {
        rows.push(verdaTypeToItem(raw, locationsByCode.get(locationCode), {
          market: "on_demand",
          available: locationCode !== "catalog",
          locationCode,
          projectId: context.projectId
        }));
      }
      for (const locationCode of spotLocations) {
        rows.push(verdaTypeToItem(raw, locationsByCode.get(locationCode), {
          market: "spot",
          available: true,
          locationCode,
          projectId: context.projectId
        }));
      }
      return rows;
    });
}

function verdaAvailabilityByType(availability) {
  const map = new Map();
  for (const entry of pickArray(availability, ["availability", "availabilities", "data"])) {
    const locationCode = entry.location_code || entry.locationCode;
    for (const type of entry.availabilities || []) {
      if (!map.has(type)) map.set(type, []);
      map.get(type).push(locationCode);
    }
  }
  return map;
}

function verdaTypeToItem(raw, location, options) {
  const gpuCount = Number(raw.gpu?.number_of_gpus || extractGpuCount(raw.gpu?.description || raw.display_name || raw.name, 1));
  const totalHourlyPrice = numberOrNull(options.market === "spot" ? raw.spot_price : raw.price_per_hour);
  const networkFabric = fabricFromText(raw.network, raw.network_type, raw.network_bandwidth, raw.cluster_network);
  const locationLabel = location?.name
    ? `${location.name}${location.code ? ` (${location.code})` : ""}`
    : options.locationCode === "catalog" ? "Verda catalog" : options.locationCode;
  return createInventoryItem({
    provider: "Verda/DataCrunch",
    providerId: "verda-datacrunch",
    rawOfferId: `${options.market}:${raw.instance_type || raw.id}:${options.locationCode || "catalog"}`,
    gpuLabel: raw.display_name || raw.gpu?.description || raw.name || raw.instance_type,
    gpuCount,
    vramGbEach: raw.gpu_memory?.size_in_gigabytes,
    pricePerGpuHour: totalHourlyPrice && gpuCount ? totalHourlyPrice / gpuCount : null,
    totalHourlyPrice,
    region: locationLabel,
    country: location?.country_code,
    formFactor: "vm",
    interconnect: verdaInterconnect(raw),
    networkBandwidth: raw.network_bandwidth || raw.network?.bandwidth || "",
    networkFabric,
    cpu: raw.cpu?.number_of_cores ? `${raw.cpu.number_of_cores} vCPU` : raw.cpu?.description,
    ramGb: raw.memory?.size_in_gigabytes,
    storage: raw.storage?.description || "",
    availability: options.available ? "available" : "unavailable",
    availabilityCount: options.available ? 1 : 0,
    currency: String(raw.currency || "usd").toUpperCase(),
    checkoutUrl: buildVerdaUrl(raw, location, options.market, options.projectId),
    checkoutSemantics: "manual_provider",
    sourceMode: "live",
    listingType: options.market === "spot" ? "spot_instance_type" : "instance_type",
    priceScope: totalHourlyPrice ? "node_total" : "unknown",
    availabilitySemantics: "sku_capacity",
    dataNotes: [
      options.market === "spot" ? "Spot" : "",
      fabricDataNote(networkFabric, raw.display_name || raw.gpu?.description || raw.name || raw.instance_type, gpuCount),
      raw.serverless_price ? `Serverless: ${raw.serverless_price} ${raw.currency || "usd"}/hr` : "",
      raw.deploy_warning || ""
    ].filter(Boolean),
    metadata: compactMetadata({
      instanceType: raw.instance_type,
      instanceTypeId: raw.id,
      market: options.market,
      dashboardProjectId: options.projectId,
      location,
      manufacturer: raw.manufacturer,
      model: raw.model,
      name: raw.name,
      p2p: raw.p2p,
      bestFor: raw.best_for,
      supportedOs: raw.supported_os,
      prices: {
        onDemand: numberOrNull(raw.price_per_hour),
        spot: numberOrNull(raw.spot_price),
        serverless: numberOrNull(raw.serverless_price),
        serverlessSpot: numberOrNull(raw.serverless_spot_price)
      },
      cpu: raw.cpu,
      memory: raw.memory,
      gpu: raw.gpu,
      gpuMemory: raw.gpu_memory,
      storage: raw.storage
    }),
    rawPayload: raw
  });
}

function verdaInterconnect(raw) {
  const text = `${raw.p2p || ""} ${raw.name || ""} ${raw.display_name || ""} ${(raw.best_for || []).join(" ")}`;
  if (/pcie|pci-e/i.test(text)) return "PCIe";
  if (/sxm|nvlink|p2p/i.test(text)) return "NVLink";
  return raw.p2p || "";
}

function buildVerdaUrl(raw, location, market, projectId) {
  const params = new URLSearchParams();
  if (raw.instance_type) params.set("instance_type", raw.instance_type);
  if (location?.code) params.set("location_code", location.code);
  if (market) params.set("market", market);
  const query = params.toString();
  const path = projectId
    ? `/dashboard/projects/${encodeURIComponent(projectId)}/deploy-instance`
    : "/dashboard/projects";
  return `https://console.verda.com${path}${query ? `?${query}` : ""}`;
}

function verdaProjectIdFromToken(token) {
  const payload = decodeJwtPayload(token);
  return typeof payload?.project_id === "string" ? payload.project_id : "";
}

function decodeJwtPayload(token) {
  try {
    const [, payload] = String(token || "").split(".");
    if (!payload) return {};
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return {};
  }
}
