import {
  DescribeInstanceTypeOfferingsCommand,
  DescribeInstanceTypesCommand,
  DescribeRegionsCommand,
  DescribeSpotPriceHistoryCommand,
  EC2Client
} from "@aws-sdk/client-ec2";
import { GetProductsCommand, PricingClient } from "@aws-sdk/client-pricing";
import { createInventoryItem } from "../core/inventory.js";
import { hasEnvValue, truthyEnv } from "../core/env.js";
import { numberOrNull, round } from "../core/num.js";
import { normalizedList, parseEnvList } from "../core/format.js";
import { cacheKeyForList, cachedApiStage } from "../core/apiCache.js";

export const AWS_PROVIDER_ID = "aws";
export const AWS_CRAWLER_SCHEDULE = Object.freeze({
  regions: "daily",
  instanceTypes: "daily",
  offerings: "daily",
  onDemandPricing: "every_12_hours",
  spotPricing: "every_15_minutes"
});

export const AWS_STAGE_TTLS_MS = Object.freeze({
  regions: 24 * 60 * 60 * 1000,
  instanceTypes: 24 * 60 * 60 * 1000,
  offerings: 24 * 60 * 60 * 1000,
  onDemandPricing: 12 * 60 * 60 * 1000,
  spotPricing: 15 * 60 * 1000
});

export const AWS_PRICING_LOCATION_BY_REGION = Object.freeze({
  "af-south-1": "Africa (Cape Town)",
  "ap-east-1": "Asia Pacific (Hong Kong)",
  "ap-east-2": "Asia Pacific (Taipei)",
  "ap-northeast-1": "Asia Pacific (Tokyo)",
  "ap-northeast-2": "Asia Pacific (Seoul)",
  "ap-northeast-3": "Asia Pacific (Osaka)",
  "ap-south-1": "Asia Pacific (Mumbai)",
  "ap-south-2": "Asia Pacific (Hyderabad)",
  "ap-southeast-1": "Asia Pacific (Singapore)",
  "ap-southeast-2": "Asia Pacific (Sydney)",
  "ap-southeast-3": "Asia Pacific (Jakarta)",
  "ap-southeast-4": "Asia Pacific (Melbourne)",
  "ap-southeast-5": "Asia Pacific (Malaysia)",
  "ap-southeast-7": "Asia Pacific (Thailand)",
  "ca-central-1": "Canada (Central)",
  "ca-west-1": "Canada West (Calgary)",
  "eu-central-1": "EU (Frankfurt)",
  "eu-central-2": "EU (Zurich)",
  "eu-north-1": "EU (Stockholm)",
  "eu-south-1": "EU (Milan)",
  "eu-south-2": "EU (Spain)",
  "eu-west-1": "EU (Ireland)",
  "eu-west-2": "EU (London)",
  "eu-west-3": "EU (Paris)",
  "il-central-1": "Israel (Tel Aviv)",
  "me-central-1": "Middle East (UAE)",
  "me-south-1": "Middle East (Bahrain)",
  "mx-central-1": "Mexico (Central)",
  "sa-east-1": "South America (Sao Paulo)",
  "us-east-1": "US East (N. Virginia)",
  "us-east-2": "US East (Ohio)",
  "us-west-1": "US West (N. California)",
  "us-west-2": "US West (Oregon)"
});

export function hasAwsConfiguration(env = process.env) {
  return truthyEnv(env.AWS_GPU_INVENTORY_ENABLED)
    || (hasEnvValue(env.AWS_ACCESS_KEY_ID) && hasEnvValue(env.AWS_SECRET_ACCESS_KEY))
    || hasEnvValue(env.AWS_PROFILE)
    || hasEnvValue(env.AWS_WEB_IDENTITY_TOKEN_FILE)
    || hasEnvValue(env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI)
    || hasEnvValue(env.AWS_CONTAINER_CREDENTIALS_FULL_URI);
}

export async function get_regions(env = process.env, options = {}) {
  const cached = await cachedAwsStage(env, "regions", AWS_STAGE_TTLS_MS.regions, options, async () => {
    const client = options.ec2Client || createEc2Client(env.AWS_REGION || env.AWS_DEFAULT_REGION || "us-east-1", env);
    const response = await client.send(new DescribeRegionsCommand({
      AllRegions: false
    }));
    return (response.Regions || [])
      .filter((region) => !region.OptInStatus || region.OptInStatus === "opt-in-not-required" || region.OptInStatus === "opted-in")
      .map((region) => region.RegionName)
      .filter(Boolean)
      .sort();
  });
  return Array.isArray(cached) ? cached : [];
}

export async function get_instance_types(region, env = process.env, options = {}) {
  const cacheKey = `instance-types/${region}/${cacheKeyForList(options.instanceTypes)}`;
  const rows = await cachedAwsStage(env, cacheKey, AWS_STAGE_TTLS_MS.instanceTypes, options, async () => {
    const client = options.ec2Client || createEc2Client(region, env);
    const instanceTypes = normalizedList(options.instanceTypes);
    const rawRows = instanceTypes.length
      ? await describeSpecificInstanceTypes(client, instanceTypes, env)
      : await paginateEc2(client, DescribeInstanceTypesCommand, { MaxResults: 100 }, "InstanceTypes", env);
    return rawRows
      .map(parseInstanceTypeMetadata)
      .filter(Boolean)
      .sort((left, right) => left.instance_type.localeCompare(right.instance_type));
  });
  return Array.isArray(rows) ? rows : [];
}

export async function get_offerings(region, instanceTypes, env = process.env, options = {}) {
  const types = normalizedList(instanceTypes);
  const cacheKey = `offerings/${region}/${cacheKeyForList(types)}`;
  const rows = await cachedAwsStage(env, cacheKey, AWS_STAGE_TTLS_MS.offerings, options, async () => {
    const client = options.ec2Client || createEc2Client(region, env);
    const offerings = [];
    const batches = types.length ? chunk(types, 100) : [[]];
    for (const batch of batches) {
      const filters = batch.length ? [{ Name: "instance-type", Values: batch }] : [];
      offerings.push(...await paginateEc2(client, DescribeInstanceTypeOfferingsCommand, {
        LocationType: "availability-zone",
        Filters: filters,
        MaxResults: 1000
      }, "InstanceTypeOfferings", env));
    }
    const allowed = types.length ? new Set(types) : null;
    return offerings
      .filter((offering) => offering.LocationType === "availability-zone")
      .filter((offering) => !allowed || allowed.has(offering.InstanceType))
      .map((offering) => ({
        region,
        availability_zone: offering.Location,
        instance_type: offering.InstanceType,
        offered: true
      }))
      .filter((offering) => offering.availability_zone && offering.instance_type)
      .sort(compareOfferings);
  });
  return Array.isArray(rows) ? rows : [];
}

export async function get_on_demand_prices(region, instanceTypes, env = process.env, options = {}) {
  const types = normalizedList(instanceTypes);
  const cacheKey = `on-demand/${region}/${cacheKeyForList(types)}`;
  const rows = await cachedAwsStage(env, cacheKey, AWS_STAGE_TTLS_MS.onDemandPricing, options, async () => {
    const location = pricingLocationForRegion(region, env);
    if (!location) {
      logMissingPricingLocation(region, options.logger);
      return [];
    }
    const client = options.pricingClient || createPricingClient(env);
    const prices = [];
    for (const instanceType of types) {
      const price = await fetchOnDemandPrice(client, instanceType, location, env);
      if (price != null) {
        prices.push({
          region,
          instance_type: instanceType,
          on_demand_price_usd_per_hour: price
        });
      }
    }
    return prices.sort((left, right) => left.instance_type.localeCompare(right.instance_type));
  });
  return new Map((Array.isArray(rows) ? rows : []).map((row) => [row.instance_type, row]));
}

export async function get_spot_prices(region, instanceTypes, env = process.env, options = {}) {
  const types = normalizedList(instanceTypes);
  const cacheKey = `spot/${region}/${cacheKeyForList(types)}`;
  const rows = await cachedAwsStage(env, cacheKey, AWS_STAGE_TTLS_MS.spotPricing, options, async () => {
    const client = options.ec2Client || createEc2Client(region, env);
    const startTime = new Date((options.now ? new Date(options.now) : new Date()).getTime() - 2 * 60 * 60 * 1000);
    const latest = new Map();
    for (const batch of chunk(types, 100)) {
      const pageRows = await paginateEc2(client, DescribeSpotPriceHistoryCommand, {
        InstanceTypes: batch,
        ProductDescriptions: ["Linux/UNIX"],
        StartTime: startTime,
        MaxResults: 1000
      }, "SpotPriceHistory", env);
      for (const [key, row] of parseSpotPriceHistory({ SpotPriceHistory: pageRows })) {
        latest.set(key, {
          region,
          availability_zone: row.availability_zone,
          instance_type: row.instance_type,
          spot_price_usd_per_hour: row.spot_price_usd_per_hour,
          spot_price_timestamp: row.spot_price_timestamp
        });
      }
    }
    return [...latest.values()].sort(compareOfferings);
  });
  return new Map((Array.isArray(rows) ? rows : []).map((row) => [spotKey(row.availability_zone, row.instance_type), row]));
}

export async function crawl(env = process.env, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const selectedRegions = normalizedList(options.regions).length
    ? normalizedList(options.regions)
    : parseEnvList(env.AWS_GPU_REGIONS);
  const regions = selectedRegions.length ? selectedRegions : await get_regions(env, options);
  const rows = [];

  for (const region of regions) {
    const selectedInstanceTypes = normalizedList(options.instanceTypes).length
      ? normalizedList(options.instanceTypes)
      : parseEnvList(env.AWS_GPU_INSTANCE_TYPES);
    const specs = await get_instance_types(region, env, {
      ...options,
      instanceTypes: selectedInstanceTypes.length ? selectedInstanceTypes : options.instanceTypes
    });
    const filteredSpecs = filterSelectedInstanceTypes(specs, selectedInstanceTypes);
    if (!filteredSpecs.length) continue;
    const instanceTypes = filteredSpecs.map((spec) => spec.instance_type);
    const offerings = await get_offerings(region, instanceTypes, env, options);
    const onDemandPrices = await get_on_demand_prices(region, instanceTypes, env, options);
    const spotPrices = await get_spot_prices(region, instanceTypes, env, options);

    const specsByType = new Map(filteredSpecs.map((spec) => [spec.instance_type, spec]));
    for (const offering of offerings) {
      const spec = specsByType.get(offering.instance_type);
      if (!spec) continue;
      const onDemand = onDemandPrices.get(offering.instance_type);
      const spot = spotPrices.get(spotKey(offering.availability_zone, offering.instance_type));
      rows.push({
        provider: AWS_PROVIDER_ID,
        region,
        availability_zone: offering.availability_zone,
        instance_type: offering.instance_type,
        gpu_model: spec.gpu_model,
        gpu_count: spec.gpu_count,
        gpu_memory_gb: spec.gpu_memory_gb,
        vcpu: spec.vcpu,
        ram_gb: spec.ram_gb,
        network_performance: spec.network_performance,
        efa_supported: spec.efa_supported,
        local_storage: spec.local_storage,
        bare_metal: spec.bare_metal,
        offered: true,
        on_demand_price_usd_per_hour: onDemand?.on_demand_price_usd_per_hour ?? null,
        spot_price_usd_per_hour: spot?.spot_price_usd_per_hour ?? null,
        spot_price_timestamp: spot?.spot_price_timestamp ?? null,
        last_seen: now.toISOString(),
        metadata: {
          rawInstanceType: spec.rawInstanceType,
          onDemandPrice: onDemand || null,
          spotPrice: spot || null
        }
      });
    }
  }

  return rows.sort((left, right) => (
    left.region.localeCompare(right.region)
    || left.availability_zone.localeCompare(right.availability_zone)
    || left.instance_type.localeCompare(right.instance_type)
  ));
}

export function awsInventoryRowToInventoryItem(row, env = process.env) {
  const primaryPrice = row.on_demand_price_usd_per_hour ?? row.spot_price_usd_per_hour ?? null;
  const priceScope = row.on_demand_price_usd_per_hour != null
    ? "node_total"
    : row.spot_price_usd_per_hour != null
      ? "spot"
      : "unpriced_capacity";
  return createInventoryItem({
    provider: "AWS",
    providerId: AWS_PROVIDER_ID,
    rawOfferId: `${row.region}:${row.availability_zone}:${row.instance_type}`,
    gpuLabel: awsGpuLabel(row),
    gpuCount: row.gpu_count,
    vramGbEach: row.gpu_memory_gb,
    pricePerGpuHour: primaryPrice && row.gpu_count ? primaryPrice / row.gpu_count : null,
    totalHourlyPrice: primaryPrice,
    region: row.region,
    formFactor: row.bare_metal ? "bare_metal" : "vm",
    interconnect: awsInterconnect(row),
    cpu: row.vcpu ? `${row.vcpu} vCPU` : "",
    ramGb: row.ram_gb,
    storage: row.local_storage,
    networkBandwidth: row.network_performance,
    networkFabric: row.efa_supported ? "EFA" : "Not exposed",
    availability: row.offered ? "available" : "unavailable",
    availabilityCount: null,
    currency: "USD",
    checkoutUrl: buildAwsLaunchUrl(row.region, row.instance_type, env),
    sourceMode: "live",
    listingType: "ec2_instance_type_offering",
    priceScope,
    dataNotes: [
      "AWS EC2 official APIs",
      "Offered location, not capacity checked",
      row.efa_supported ? "EFA supported" : "Fabric not exposed as EFA",
      row.on_demand_price_usd_per_hour == null ? "On-demand price unavailable from Price List" : "",
      row.spot_price_usd_per_hour != null ? `Latest spot: $${row.spot_price_usd_per_hour}/hr` : ""
    ].filter(Boolean),
    metadata: {
      table: "aws_inventory",
      region: row.region,
      availabilityZone: row.availability_zone,
      instanceType: row.instance_type,
      efaSupported: row.efa_supported,
      bareMetal: row.bare_metal,
      rawInstanceType: row.metadata?.rawInstanceType,
      onDemandPrice: row.metadata?.onDemandPrice,
      spotPriceUsdPerHour: row.spot_price_usd_per_hour,
      spotPrice: row.metadata?.spotPrice,
      spotPriceTimestamp: row.spot_price_timestamp,
      lastSeen: row.last_seen
    },
    lastSeenAt: row.last_seen,
    rawPayload: row
  });
}

export function parseInstanceTypeMetadata(raw) {
  const instanceType = raw.InstanceType || "";
  const accelerator = parseAccelerator(raw);
  if (!accelerator) return null;
  if (!raw.GpuInfo && !/^(?:p|g|trn|inf)/i.test(instanceType)) return null;

  return {
    instance_type: instanceType,
    gpu_model: accelerator.model,
    gpu_count: accelerator.count,
    gpu_memory_gb: accelerator.memoryGb,
    vcpu: raw.VCpuInfo?.DefaultVCpus ?? null,
    ram_gb: raw.MemoryInfo?.SizeInMiB ? round(raw.MemoryInfo.SizeInMiB / 1024, 2) : null,
    network_performance: raw.NetworkInfo?.NetworkPerformance || "",
    efa_supported: Boolean(raw.NetworkInfo?.EfaSupported),
    local_storage: formatInstanceStorage(raw),
    bare_metal: Boolean(raw.BareMetal || /\.metal$/i.test(instanceType)),
    rawInstanceType: raw
  };
}

export function parseOnDemandPriceFromGetProductsResponse(response) {
  const prices = [];
  for (const item of response.PriceList || []) {
    const product = parsePricingProduct(item);
    if (!product) continue;
    for (const term of Object.values(product.terms?.OnDemand || {})) {
      for (const dimension of Object.values(term.priceDimensions || {})) {
        const price = Number(dimension.pricePerUnit?.USD);
        if (dimension.unit === "Hrs" && Number.isFinite(price) && price > 0) prices.push(price);
      }
    }
  }
  return prices.length ? Math.min(...prices) : null;
}

function parsePricingProduct(item) {
  if (!item) return null;
  if (typeof item === "string") return JSON.parse(item);
  if (typeof item === "object" && item.terms) return item;
  try {
    return JSON.parse(String(item));
  } catch {
    return null;
  }
}

export function parseSpotPriceHistory(response) {
  const latest = new Map();
  for (const row of response.SpotPriceHistory || []) {
    if (!row.Timestamp) continue;
    const normalized = {
      availability_zone: row.AvailabilityZone,
      instance_type: row.InstanceType,
      spot_price_usd_per_hour: numberOrNull(row.SpotPrice),
      spot_price_timestamp: row.Timestamp instanceof Date ? row.Timestamp.toISOString() : new Date(row.Timestamp).toISOString()
    };
    if (!normalized.availability_zone || !normalized.instance_type || normalized.spot_price_usd_per_hour == null) continue;
    const key = spotKey(normalized.availability_zone, normalized.instance_type);
    const existing = latest.get(key);
    if (!existing || new Date(normalized.spot_price_timestamp) > new Date(existing.spot_price_timestamp)) {
      latest.set(key, normalized);
    }
  }
  return latest;
}

export function pricingLocationForRegion(region, env = process.env) {
  const overrides = parseJsonObject(env.AWS_PRICING_LOCATION_OVERRIDES);
  return overrides[region] || AWS_PRICING_LOCATION_BY_REGION[region] || "";
}

function createEc2Client(region, env) {
  return new EC2Client(awsClientConfig(region, env));
}

function createPricingClient(env) {
  return new PricingClient(awsClientConfig(env.AWS_PRICING_REGION || "us-east-1", env));
}

function awsClientConfig(region, env) {
  syncAwsSdkEnv(env);
  const config = {
    region,
    maxAttempts: Number(env.AWS_MAX_ATTEMPTS || 3)
  };
  if (hasEnvValue(env.AWS_PROFILE)) config.profile = env.AWS_PROFILE;
  const credentials = credentialsFromEnv(env);
  if (credentials) config.credentials = credentials;
  return config;
}

function credentialsFromEnv(env) {
  if (!hasEnvValue(env.AWS_ACCESS_KEY_ID) || !hasEnvValue(env.AWS_SECRET_ACCESS_KEY)) return null;
  return {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    sessionToken: hasEnvValue(env.AWS_SESSION_TOKEN) ? env.AWS_SESSION_TOKEN : undefined
  };
}

async function describeSpecificInstanceTypes(client, instanceTypes, env = process.env) {
  const rows = [];
  for (const batch of chunk(instanceTypes, 100)) {
    rows.push(...await paginateEc2(client, DescribeInstanceTypesCommand, {
      InstanceTypes: batch
    }, "InstanceTypes", env));
  }
  return rows;
}

async function paginateEc2(client, Command, params, resultKey, env = process.env) {
  const rows = [];
  let NextToken;
  do {
    const response = await sendAwsCommand(client, new Command({ ...params, NextToken }), env);
    rows.push(...(response[resultKey] || []));
    NextToken = response.NextToken;
  } while (NextToken);
  return rows;
}

async function fetchOnDemandPrice(client, instanceType, location, env = process.env) {
  const filters = [
    { Type: "TERM_MATCH", Field: "instanceType", Value: instanceType },
    { Type: "TERM_MATCH", Field: "location", Value: location },
    { Type: "TERM_MATCH", Field: "operatingSystem", Value: "Linux" },
    { Type: "TERM_MATCH", Field: "tenancy", Value: "Shared" },
    { Type: "TERM_MATCH", Field: "preInstalledSw", Value: "NA" },
    { Type: "TERM_MATCH", Field: "capacitystatus", Value: "Used" }
  ];
  const response = await collectPricingProducts(client, filters, env);
  return parseOnDemandPriceFromGetProductsResponse(response);
}

async function collectPricingProducts(client, filters, env = process.env) {
  const PriceList = [];
  let NextToken;
  do {
    const response = await sendAwsCommand(client, new GetProductsCommand({
      ServiceCode: "AmazonEC2",
      FormatVersion: "aws_v1",
      MaxResults: 100,
      Filters: filters,
      NextToken
    }), env);
    PriceList.push(...(response.PriceList || []));
    NextToken = response.NextToken;
  } while (NextToken);
  return { PriceList };
}

function parseAccelerator(raw) {
  const gpu = parseAcceleratorDevices(raw.GpuInfo?.Gpus);
  if (gpu) return gpu;
  const neuron = parseAcceleratorDevices(raw.NeuronInfo?.NeuronDevices);
  if (neuron) return neuron;
  return parseAcceleratorDevices(raw.InferenceAcceleratorInfo?.Accelerators);
}

function parseAcceleratorDevices(devices) {
  if (!Array.isArray(devices) || !devices.length) return null;
  const model = devices.map((device) => cleanAcceleratorName(device.Name || device.Manufacturer || "Accelerator")).filter(Boolean).join(" + ");
  const count = devices.reduce((sum, device) => sum + Number(device.Count || 0), 0);
  const firstMemoryMib = devices.find((device) => device.MemoryInfo?.SizeInMiB)?.MemoryInfo?.SizeInMiB;
  return {
    model,
    count: count || 1,
    memoryGb: firstMemoryMib ? round(firstMemoryMib / 1024, 2) : null
  };
}

function cleanAcceleratorName(value) {
  return String(value || "")
    .replace(/^nvidia\s+/i, "")
    .replace(/^aws\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function formatInstanceStorage(raw) {
  if (!raw.InstanceStorageSupported) return "";
  const disks = raw.InstanceStorageInfo?.Disks || [];
  if (!disks.length) return "instance storage";
  const totalGb = disks.reduce((sum, disk) => sum + Number(disk.Count || 0) * Number(disk.SizeInGB || 0), 0);
  const types = [...new Set(disks.map((disk) => disk.Type).filter(Boolean))].join("/");
  return [totalGb ? `${round(totalGb, 2)} GB` : "", types].filter(Boolean).join(" ");
}

function awsGpuLabel(row) {
  return [
    row.gpu_count ? `${row.gpu_count}x` : "",
    row.gpu_model || "AWS Accelerator",
    row.gpu_memory_gb ? `${Math.round(Number(row.gpu_memory_gb))}GB` : "",
    row.instance_type
  ].filter(Boolean).join(" ");
}

function awsInterconnect(row) {
  if (row.efa_supported) return "EFA";
  if (/^(?:p[456]|trn|inf)/i.test(row.instance_type) || Number(row.gpu_count) >= 4) return "NVLink";
  return "PCIe";
}

function buildAwsLaunchUrl(region, instanceType, env) {
  const params = new URLSearchParams();
  if (region) params.set("region", region);
  const projectUrl = env.AWS_CONSOLE_BASE_URL || "https://console.aws.amazon.com/ec2/home";
  return `${projectUrl}?${params.toString()}#LaunchInstances:instanceType=${encodeURIComponent(instanceType || "")}`;
}

function cachedAwsStage(env, key, ttlMs, options, loader) {
  return cachedApiStage({
    env, key, ttlMs, options, loader,
    disableKey: "AWS_GPU_DISABLE_CACHE",
    cacheDirKey: "AWS_GPU_CACHE_DIR",
    cacheDirDefault: ".cache/aws-api",
    allowStaleKey: "AWS_GPU_ALLOW_STALE_ON_ERROR"
  });
}

function filterSelectedInstanceTypes(specs, selected) {
  const types = new Set(normalizedList(selected));
  if (!types.size) return specs;
  return specs.filter((spec) => types.has(spec.instance_type));
}

function compareOfferings(left, right) {
  return left.region.localeCompare(right.region)
    || left.availability_zone.localeCompare(right.availability_zone)
    || left.instance_type.localeCompare(right.instance_type);
}

function spotKey(availabilityZone, instanceType) {
  return `${availabilityZone}|${instanceType}`;
}

async function sendAwsCommand(client, command, env = process.env) {
  const maxRetries = Math.max(0, Number(env.AWS_THROTTLE_RETRIES || 6));
  const baseDelayMs = Math.max(0, Number(env.AWS_THROTTLE_BASE_DELAY_MS || 500));
  let attempt = 0;
  while (true) {
    try {
      return await client.send(command);
    } catch (error) {
      if (!isAwsThrottleError(error) || attempt >= maxRetries) throw error;
      const waitMs = baseDelayMs * (2 ** attempt) + Math.floor(Math.random() * Math.max(25, baseDelayMs));
      await delay(waitMs);
      attempt += 1;
    }
  }
}

function isAwsThrottleError(error) {
  const name = String(error?.name || error?.Code || error?.code || "");
  const message = String(error?.message || "");
  const status = Number(error?.$metadata?.httpStatusCode || 0);
  return status === 429
    || status === 503
    || /throttl|too.?many.?requests|rate.?exceeded|request.?limit.?exceeded/i.test(`${name} ${message}`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function logMissingPricingLocation(region, logger) {
  const message = `aws: missing pricing location mapping for ${region}; skipping on-demand pricing for that region`;
  if (logger?.warn) logger.warn(message);
  else console.warn(message);
}

function parseJsonObject(value) {
  if (!hasEnvValue(value)) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function chunk(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
}

function syncAwsSdkEnv(env) {
  const keys = [
    "AWS_PROFILE",
    "AWS_REGION",
    "AWS_DEFAULT_REGION",
    "AWS_WEB_IDENTITY_TOKEN_FILE",
    "AWS_ROLE_ARN",
    "AWS_ROLE_SESSION_NAME",
    "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
    "AWS_CONTAINER_CREDENTIALS_FULL_URI",
    "AWS_EC2_METADATA_DISABLED"
  ];
  for (const key of keys) {
    if (hasEnvValue(env[key]) && !hasEnvValue(process.env[key])) process.env[key] = env[key];
  }
  if (hasEnvValue(env.AWS_PROFILE) && !hasEnvValue(process.env.AWS_SDK_LOAD_CONFIG)) {
    process.env.AWS_SDK_LOAD_CONFIG = "1";
  }
}

