import { createInventoryItem } from "../../../core/inventory.js";
import { jsonFetch } from "../http.js";
import { centsToDollars, compactMetadata, fabricDataNote, fabricFromText } from "../format.js";

export const lambdaConnector = {
  id: "lambda",
  name: "Lambda",
  envVars: ["LAMBDA_API_KEY"],
  async fetch(env) {
    const headers = env.LAMBDA_API_KEY ? { Authorization: `Bearer ${env.LAMBDA_API_KEY}` } : {};
    const data = await jsonFetch("https://cloud.lambda.ai/api/v1/instance-types", { headers });
    const instanceTypes = flattenLambdaInstanceTypes(data);
    return instanceTypes.flatMap(([name, raw]) => {
      const regions = raw.regions_with_capacity_available || raw.available_regions || [];
      if (!regions.length) return [];
      const specs = raw.instance_type?.specs || raw.specs || {};
      const gpuCount = raw.gpu_count || raw.gpus || raw.instance_type?.gpu_count || specs.gpus || 1;
      const priceCents = raw.price_cents_per_hour || raw.instance_type?.price_cents_per_hour;
      const gpuLabel = raw.instance_type?.description || raw.description || raw.gpu_description || name;
      const networkFabric = fabricFromText(specs.network, specs.networking, specs.interconnect);
      return regions.map((region) => createInventoryItem({
        provider: "Lambda",
        rawOfferId: `${name}:${region.name || region}`,
        gpuLabel,
        gpuCount,
        pricePerGpuHour: centsToDollars(priceCents, gpuCount),
        totalHourlyPrice: centsToDollars(priceCents, 1),
        region: region.description || region.name || region,
        formFactor: "vm",
        interconnect: raw.description || name,
        cpu: specs.vcpus ? `${specs.vcpus} vCPU` : "",
        ramGb: raw.ram_gib || raw.memory_gib || specs.memory_gib,
        storage: raw.storage_gib || specs.storage_gib ? `${raw.storage_gib || specs.storage_gib} GB` : "",
        networkBandwidth: specs.network || specs.networking || "",
        networkFabric,
        availability: "available",
        availabilityCount: regions.length,
        checkoutUrl: buildLambdaUrl(name, region),
        checkoutSemantics: "manual_provider",
        sourceMode: "live",
        listingType: "instance_type",
        priceScope: "node_total",
        dataNotes: [
          fabricDataNote(networkFabric, gpuLabel, gpuCount)
        ].filter(Boolean),
        availabilitySemantics: "sku_capacity",
        metadata: compactMetadata({
          instanceTypeName: raw.instance_type?.name || name,
          description: raw.instance_type?.description || raw.description,
          gpuDescription: raw.instance_type?.gpu_description || raw.gpu_description,
          specs,
          regionsWithCapacity: regions
        }),
        rawPayload: raw
      }));
    });
  }
};

function flattenLambdaInstanceTypes(data) {
  const source = data?.data || data?.instance_types || data;
  if (Array.isArray(source)) return source.map((item) => [item.name || item.instance_type_name || item.description, item]);
  if (source && typeof source === "object") return Object.entries(source);
  return [];
}

function buildLambdaUrl(name, region) {
  const params = new URLSearchParams();
  if (name) params.set("instance_type", name);
  const regionName = region?.name || region;
  if (regionName) params.set("region", regionName);
  const query = params.toString();
  return `https://cloud.lambda.ai/instances${query ? `?${query}` : ""}`;
}
