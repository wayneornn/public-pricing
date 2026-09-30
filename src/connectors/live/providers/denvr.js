import { createInventoryItem } from "../../../core/inventory.js";
import { jsonFetch } from "../http.js";
import { buildGpuLabel, compactMetadata, fabricDataNote, fabricFromText, nonNegativeNumber, numberOrNull, parseEnvList, round } from "../format.js";

// Denvr AI Cloud / Denvr Dataworks — authenticated VM capacity API.
//
// Public docs verify these non-mutating endpoints:
//   POST https://api.cloud.denvrdata.com/api/TokenAuth/Authenticate
//   GET  /api/v1/clusters/GetAll
//   GET  /api/v1/servers/virtual/GetConfigurations
//   GET  /api/v1/servers/virtual/GetAvailability?cluster=<cluster>&resourcePool=on-demand
//
// `GetAvailability` exposes a creatable-count signal for a VM configuration, but the only
// provisioning endpoint (`CreateServer`) is mutating, so rows stay provider_console /
// non-checkout until a safe exact deploy route is verified with live credentials.
const DENVR_API_BASE_URL = "https://api.cloud.denvrdata.com";
const DENVR_CONSOLE_URL = "https://cloud.denvrdata.com/";
const DEFAULT_RESOURCE_POOL = "on-demand";

export const denvrConnector = {
  id: "denvr",
  name: "Denvr Dataworks",
  envVars: ["DENVR_ACCESS_TOKEN", "DENVR_USERNAME", "DENVR_EMAIL", "DENVR_PASSWORD"],
  async fetch(env) {
    const base = (env.DENVR_API_BASE_URL || DENVR_API_BASE_URL).replace(/\/$/, "");
    const timeoutMs = Number(env.DENVR_TIMEOUT_MS || 30_000);
    const token = await denvrAccessToken(env, base, timeoutMs);
    if (!token) return [];

    const headers = denvrHeaders(token);
    const clusters = parseEnvList(env.DENVR_CLUSTERS);
    const clusterNames = clusters.length
      ? clusters
      : asArray(unwrapAbp(await jsonFetch(`${base}/api/v1/clusters/GetAll`, { headers, timeoutMs })));
    if (!clusterNames.length) return [];

    const configurations = unwrapAbp(await jsonFetch(`${base}/api/v1/servers/virtual/GetConfigurations`, { headers, timeoutMs }));
    const resourcePools = parseEnvList(env.DENVR_RESOURCE_POOLS);
    const pools = resourcePools.length ? resourcePools : [DEFAULT_RESOURCE_POOL];

    const availabilityPayloads = [];
    for (const cluster of clusterNames) {
      for (const pool of pools) {
        const url = `${base}/api/v1/servers/virtual/GetAvailability?cluster=${encodeURIComponent(cluster)}&resourcePool=${encodeURIComponent(pool)}&reportNodes=true`;
        availabilityPayloads.push({
          cluster,
          pool,
          payload: unwrapAbp(await jsonFetch(url, { headers, timeoutMs }))
        });
      }
    }

    return denvrToItems({ configurations, availabilityPayloads, consoleUrl: env.DENVR_CONSOLE_URL || DENVR_CONSOLE_URL });
  }
};

export function denvrToItems({ configurations = {}, availabilityPayloads = [], consoleUrl = DENVR_CONSOLE_URL } = {}) {
  const configItems = asArray(configurations?.items || configurations);
  const configByName = new Map();
  for (const config of configItems) {
    if (config?.name) configByName.set(String(config.name), config);
  }

  const items = [];
  for (const group of availabilityPayloads) {
    const rows = asArray(group?.payload?.items || group?.payload);
    for (const availability of rows) {
      const row = denvrAvailabilityToItem({
        availability,
        config: configByName.get(String(availability?.configuration || "")),
        cluster: group.cluster,
        pool: group.pool,
        consoleUrl
      });
      if (row) items.push(row);
    }
  }
  return items;
}

function denvrAvailabilityToItem({ availability = {}, config = {}, cluster, pool, consoleUrl }) {
  const configuration = String(availability.configuration || config.name || "");
  if (!configuration) return null;

  const gpuCount = numberOrNull(config.gpus) || gpuCountFromText(configuration) || 1;
  if (config.is_gpu_platform === false || gpuCount <= 0) return null;

  const gpuInfo = parseDenvrGpu(config, availability, configuration);
  if (!gpuInfo.model) return null;

  const apiPrice = numberOrNull(availability.price) ?? numberOrNull(config.price);
  if (apiPrice == null || apiPrice <= 0) return null;

  const effectiveCluster = availability.cluster || cluster || firstArrayValue(config.clusters) || "Denvr";
  const effectivePool = availability.rpool || pool || DEFAULT_RESOURCE_POOL;
  const computeNetwork = config.compute_network || "";
  const networkFabric = fabricFromText(computeNetwork);
  const count = nonNegativeNumber(availability.count);
  const maxCount = nonNegativeNumber(availability.maxCount);
  const available = availability.available === true && (count == null || count > 0);
  const gpuLabel = buildGpuLabel({
    count: gpuCount,
    model: gpuInfo.model,
    vramGb: gpuInfo.vramGb,
    variant: gpuInfo.variant
  });

  return createInventoryItem({
    provider: "Denvr Dataworks",
    providerId: "denvr",
    rawOfferId: `${effectiveCluster}:${effectivePool}:${configuration}`,
    gpuLabel,
    gpuCount,
    vramGbEach: gpuInfo.vramGb,
    pricePerGpuHour: apiPrice,
    totalHourlyPrice: round(apiPrice * gpuCount, 4),
    region: effectiveCluster,
    formFactor: "vm",
    interconnect: gpuInfo.variant || "",
    cpu: numberOrNull(config.vcpus) ? `${numberOrNull(config.vcpus)} vCPU` : "",
    ramGb: numberOrNull(config.memory),
    storage: numberOrNull(config.storage) ? `${numberOrNull(config.storage)} GB` : "",
    networkFabric,
    availability: available ? "available" : "unavailable",
    availabilityCount: count,
    checkoutUrl: consoleUrl,
    sourceMode: "live",
    listingType: "vm_configuration_availability",
    priceScope: "gpu_sku_only",
    availabilitySemantics: "sku_capacity",
    checkoutSemantics: "provider_console",
    dataNotes: [
      "Denvr VM API availability count is a creatable configuration signal, not an exact checkout listing",
      "Denvr public billing docs state GPU prices are per GPU/hour; node total is price x GPU count",
      maxCount != null && maxCount > 0 ? `Resource pool max creatable count: ${maxCount}` : "",
      fabricDataNote(networkFabric, gpuLabel, gpuCount)
    ].filter(Boolean),
    metadata: compactMetadata({
      configuration,
      configurationId: config.id,
      userFriendlyName: config.user_friendly_name,
      description: config.description,
      textName: config.text_name,
      gpuType: config.gpu_type || availability.type,
      gpuName: config.gpu_name,
      gpuFamily: config.gpu_family,
      brandFamily: config.brand_family,
      brand: config.brand,
      type: config.type,
      cluster: effectiveCluster,
      resourcePool: effectivePool,
      count,
      maxCount,
      availableNodeNames: availability.availableNodeNames,
      computeNetwork,
      isGpuPlatform: config.is_gpu_platform
    }),
    rawPayload: { availability, configuration: config }
  });
}

async function denvrAccessToken(env, base, timeoutMs) {
  const directToken = env.DENVR_ACCESS_TOKEN || env.DENVR_TOKEN;
  if (directToken) return directToken;

  const username = env.DENVR_USERNAME || env.DENVR_EMAIL;
  const password = env.DENVR_PASSWORD;
  if (!username || !password) return "";

  const payload = await jsonFetch(`${base}/api/TokenAuth/Authenticate`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json-patch+json" },
    body: JSON.stringify({ userNameOrEmailAddress: username, password }),
    timeoutMs
  });
  return unwrapAbp(payload)?.accessToken || "";
}

function denvrHeaders(token) {
  return {
    Accept: "application/json",
    "Content-Type": "application/json-patch+json",
    Authorization: `Bearer ${token}`
  };
}

function unwrapAbp(payload) {
  if (payload && typeof payload === "object" && Object.prototype.hasOwnProperty.call(payload, "success") && payload.success === false) {
    const message = payload?.error?.message || payload?.error?.details || "Denvr API request failed";
    throw new Error(message);
  }
  return payload && typeof payload === "object" && Object.prototype.hasOwnProperty.call(payload, "result")
    ? payload.result
    : payload;
}

function asArray(value) {
  return Array.isArray(value) ? value.filter((item) => item != null) : [];
}

function firstArrayValue(value) {
  return Array.isArray(value) && value.length ? value[0] : "";
}

function parseDenvrGpu(config = {}, availability = {}, configuration = "") {
  const source = [
    config.gpu_name,
    config.gpu_type,
    config.text_name,
    config.user_friendly_name,
    config.description,
    availability.type,
    configuration
  ].filter(Boolean).join(" ");
  const cleaned = source.replace(/nvidia\.com\//gi, " ").replace(/_/g, " ");

  const modelMatch = /(GH200|H200|H100|A100|A40|L40S|GAUDI2|MI300X|MI325X|B200)/i.exec(cleaned);
  const model = modelMatch ? normalizeDenvrModel(modelMatch[1]) : "";
  const vramGb = denvrVramGb(cleaned);
  const variantMatch = /(SXM\d?|PCIe|HGX|NVL)/i.exec(cleaned);

  return {
    model,
    vramGb,
    variant: variantMatch ? normalizeDenvrVariant(variantMatch[1]) : ""
  };
}

function denvrVramGb(text) {
  const compactVariant = /(?:SXM|PCIe|HGX|NVL)\d(\d{2,3})GB/i.exec(text);
  if (compactVariant) return numberOrNull(compactVariant[1]);
  const explicit = /(\d{2,3})\s*GB/i.exec(text);
  if (explicit) return numberOrNull(explicit[1]);
  const compactModel = /\b(?:A100|H100|H200|B200|A40|L40S|GH200)[A-Z0-9]*?(\d{2,3})GB/i.exec(text);
  return numberOrNull(compactModel?.[1]);
}

function gpuCountFromText(value) {
  const match = /(?:^|[ _-])(\d+)\s*[x×]\b/i.exec(String(value || ""));
  return numberOrNull(match?.[1]);
}

function normalizeDenvrModel(value) {
  const text = String(value || "").toUpperCase();
  if (text === "GAUDI2") return "Gaudi2";
  return text;
}

function normalizeDenvrVariant(value) {
  const text = String(value || "");
  if (/pcie/i.test(text)) return "PCIe";
  if (/nvl/i.test(text)) return "NVL";
  if (/hgx/i.test(text)) return "HGX";
  if (/sxm/i.test(text)) return "SXM";
  return text;
}
