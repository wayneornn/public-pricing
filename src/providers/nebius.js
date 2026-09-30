import { execFile } from "node:child_process";
import fs from "node:fs";
import { promisify } from "node:util";
import { createInventoryItem } from "../core/inventory.js";
import { truthyEnv } from "../core/env.js";
import { numberOrNull } from "../core/num.js";
import { parseEnvList, pickArray } from "../core/format.js";

const execFileAsync = promisify(execFile);

export const NEBIUS_PROVIDER_ID = "nebius";
const DEFAULT_NEBIUS_CLI_PATH = `${process.env.HOME || ""}/.nebius/bin/nebius`;
const DEFAULT_NEBIUS_CONSOLE_URL = "https://console.nebius.com";

export function hasNebiusConfiguration(env = process.env) {
  return truthyEnv(env.NEBIUS_ENABLED)
    || truthyEnv(env.NEBIUS_TENANT_ID)
    || truthyEnv(env.NEBIUS_PROJECT_ID)
    || truthyEnv(env.NEBIUS_PROJECT_IDS);
}

export async function get_projects(env = process.env, options = {}) {
  const configuredProjects = parseConfiguredProjects(env);
  if (!truthyEnv(env.NEBIUS_PROJECT_DISCOVERY === "all" ? "1" : env.NEBIUS_DISCOVER_PROJECTS) || !truthyEnv(env.NEBIUS_TENANT_ID)) {
    return configuredProjects;
  }

  try {
    const data = await nebiusJson(["iam", "v2", "project", "list", "--parent-id", env.NEBIUS_TENANT_ID, "--all"], env, options);
    const projects = pickArray(data, ["items", "data"])
      .map(parseNebiusProject)
      .filter(Boolean);
    return projects.length ? projects : configuredProjects;
  } catch (error) {
    if (options.logger?.warn) options.logger.warn(`Nebius project discovery failed: ${error.message}`);
    return configuredProjects;
  }
}

export async function get_platforms(project, env = process.env, options = {}) {
  if (!project?.id) return [];
  const data = await nebiusJson(["compute", "platform", "list", "--parent-id", project.id, "--all"], env, options);
  return pickArray(data, ["items", "data"])
    .map((platform) => parseNebiusPlatform(platform, project))
    .filter(Boolean);
}

export async function get_instances(project, env = process.env, options = {}) {
  if (!project?.id) return [];
  const data = await nebiusJson(["compute", "instance", "list", "--parent-id", project.id, "--all"], env, options);
  return pickArray(data, ["items", "data"]);
}

export async function get_gpu_clusters(project, env = process.env, options = {}) {
  if (!project?.id) return [];
  const data = await nebiusJson(["compute", "gpu-cluster", "list", "--parent-id", project.id, "--all"], env, options);
  return pickArray(data, ["items", "data"]);
}

export async function crawl(env = process.env, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const projects = await get_projects(env, options);
  const rows = [];
  for (const project of projects) {
    const platforms = await get_platforms(project, env, options);
    for (const platform of platforms) {
      for (const preset of platform.presets) {
        if (!preset.gpu_count) continue;
        rows.push({
          provider: NEBIUS_PROVIDER_ID,
          project_id: project.id,
          project_name: project.name,
          region: project.region,
          platform_id: platform.id,
          platform_name: platform.name,
          platform_human_name: platform.human_name,
          preset_name: preset.name,
          gpu_model: platform.gpu_model,
          gpu_count: preset.gpu_count,
          gpu_memory_gb: platform.gpu_memory_gb,
          vcpu: preset.vcpu,
          ram_gb: preset.ram_gb,
          interconnect: platform.interconnect,
          network_fabric: platform.network_fabric,
          allow_gpu_clustering: preset.allow_gpu_clustering,
          preemptible_supported: platform.preemptible_supported,
          offered: true,
          orderable: false,
          orderability_reason: "Nebius compute platform API exposes catalog/offering data, not checkout-grade available capacity.",
          on_demand_price_usd_per_hour: null,
          preemptible_price_usd_per_hour: null,
          last_seen: now.toISOString(),
          rawPlatform: platform.rawPlatform,
          rawPreset: preset.rawPreset,
          rawProject: project.rawProject
        });
      }
    }
  }

  return rows.sort((left, right) => (
    String(left.region).localeCompare(String(right.region))
    || String(left.platform_name).localeCompare(String(right.platform_name))
    || Number(left.gpu_count) - Number(right.gpu_count)
    || String(left.preset_name).localeCompare(String(right.preset_name))
  ));
}

export function nebiusInventoryRowToInventoryItem(row, env = process.env) {
  return createInventoryItem({
    provider: "Nebius",
    providerId: NEBIUS_PROVIDER_ID,
    rawOfferId: `${row.project_id}:${row.platform_name}:${row.preset_name}`,
    gpuLabel: [
      row.gpu_count ? `${row.gpu_count}x` : "",
      row.gpu_model || row.platform_human_name || row.platform_name,
      row.gpu_memory_gb ? `${row.gpu_memory_gb}GB` : "",
      row.interconnect || ""
    ].filter(Boolean).join(" "),
    gpuCount: row.gpu_count,
    vramGbEach: row.gpu_memory_gb,
    pricePerGpuHour: null,
    totalHourlyPrice: null,
    region: [row.region, row.project_name].filter(Boolean).join(" / "),
    formFactor: "vm",
    interconnect: row.interconnect,
    cpu: row.vcpu ? `${row.vcpu} vCPU` : "",
    ramGb: row.ram_gb,
    storage: "Not exposed",
    networkFabric: row.network_fabric,
    availability: "unknown",
    availabilitySemantics: "region_offering",
    priceSemantics: "unpriced",
    marketType: "catalog",
    checkoutUrl: env.NEBIUS_CONSOLE_URL || DEFAULT_NEBIUS_CONSOLE_URL,
    checkoutSemantics: "provider_console",
    sourceMode: "live",
    listingType: "compute_platform_preset",
    priceScope: "unpriced",
    orderable: false,
    dataNotes: [
      "Catalog/offering only; Nebius did not expose checkout-grade available capacity.",
      "Network fabric is not exposed by the platform API.",
      row.preemptible_supported ? "Preemptible supported by platform" : "",
      row.allow_gpu_clustering ? "GPU clustering allowed by preset" : ""
    ].filter(Boolean),
    metadata: {
      table: "nebius_inventory",
      projectId: row.project_id,
      projectName: row.project_name,
      platformId: row.platform_id,
      platformName: row.platform_name,
      platformHumanName: row.platform_human_name,
      presetName: row.preset_name,
      preemptibleSupported: row.preemptible_supported,
      allowGpuClustering: row.allow_gpu_clustering,
      orderabilityReason: row.orderability_reason
    },
    specs: {
      provider: {
        rawProject: row.rawProject,
        rawPlatform: row.rawPlatform,
        rawPreset: row.rawPreset
      },
      network: {
        fabric: row.network_fabric,
        apiExposure: "not_exposed"
      }
    },
    rawPayload: {
      project: row.rawProject,
      platform: row.rawPlatform,
      preset: row.rawPreset
    }
  });
}

export function parseNebiusProject(raw) {
  const metadata = raw?.metadata || {};
  const id = metadata.id || raw?.id;
  if (!id) return null;
  return {
    id,
    name: metadata.name || raw?.name || id,
    tenant_id: metadata.parent_id || raw?.parent_id || "",
    region: raw?.spec?.region || raw?.region || "",
    state: raw?.status?.project_state || raw?.status?.state || "",
    rawProject: raw
  };
}

export function parseNebiusPlatform(raw, project = {}) {
  const metadata = raw?.metadata || {};
  const spec = raw?.spec || {};
  const id = metadata.id || raw?.id;
  const name = metadata.name || raw?.name;
  const presets = Array.isArray(spec.presets) ? spec.presets.map(parseNebiusPreset).filter(Boolean) : [];
  const gpuMemoryGb = numberOrNull(spec.gpu_memory_gigabytes);
  const humanName = spec.human_readable_name || spec.short_human_readable_name || name || "";
  const gpuModel = inferNebiusGpuModel(name, humanName, spec.gpu_count_quota_type);
  if (!id || !name || !gpuModel || !presets.some((preset) => preset.gpu_count > 0)) return null;

  return {
    id,
    parent_id: metadata.parent_id || "",
    name,
    human_name: humanName,
    short_human_name: spec.short_human_readable_name || "",
    project_id: project.id || "",
    region: project.region || "",
    gpu_model: gpuModel,
    gpu_memory_gb: gpuMemoryGb,
    interconnect: inferNebiusInterconnect(name, humanName),
    network_fabric: "Not exposed",
    gpu_count_quota_type: spec.gpu_count_quota_type || "",
    preemptible_supported: Boolean(raw?.status?.allowed_for_preemptibles),
    presets,
    rawPlatform: raw
  };
}

export function parseNebiusPreset(raw) {
  const resources = raw?.resources || {};
  const gpuCount = numberOrNull(resources.gpu_count);
  return {
    name: raw?.name || "",
    gpu_count: gpuCount,
    vcpu: numberOrNull(resources.vcpu_count),
    ram_gb: numberOrNull(resources.memory_gibibytes),
    allow_gpu_clustering: Boolean(raw?.allow_gpu_clustering),
    rawPreset: raw
  };
}

async function nebiusJson(args, env, options = {}) {
  if (options.executor) return options.executor(args, env);
  const fullArgs = [
    ...args,
    "--format",
    "json",
    "--no-progress"
  ];
  if (truthyEnv(env.NEBIUS_PROFILE)) fullArgs.push("--profile", env.NEBIUS_PROFILE);
  const { stdout } = await execFileAsync(nebiusCliPath(env), fullArgs, {
    timeout: Number(env.NEBIUS_CLI_TIMEOUT_MS || 30_000),
    maxBuffer: Number(env.NEBIUS_CLI_MAX_BUFFER || 10 * 1024 * 1024)
  });
  return stdout.trim() ? JSON.parse(stdout) : {};
}

function nebiusCliPath(env) {
  const configuredPath = env.NEBIUS_CLI_PATH || DEFAULT_NEBIUS_CLI_PATH;
  if (configuredPath && fs.existsSync(configuredPath)) return configuredPath;
  return "nebius";
}

function parseConfiguredProjects(env) {
  const ids = parseEnvList(env.NEBIUS_PROJECT_IDS || env.NEBIUS_PROJECT_ID);
  return ids.map((id) => ({
    id,
    name: id,
    tenant_id: env.NEBIUS_TENANT_ID || "",
    region: "",
    state: "",
    rawProject: {
      metadata: {
        id,
        parent_id: env.NEBIUS_TENANT_ID || "",
        name: id
      }
    }
  }));
}

function inferNebiusGpuModel(...values) {
  const text = values.filter(Boolean).join(" ");
  if (/b300/i.test(text)) return "B300";
  if (/b200/i.test(text)) return "B200";
  if (/h200/i.test(text)) return "H200";
  if (/h100/i.test(text)) return "H100";
  if (/l40s/i.test(text)) return "L40S";
  if (/rtx.*6000|6000.*blackwell/i.test(text)) return "RTX PRO 6000";
  return "";
}

function inferNebiusInterconnect(...values) {
  const text = values.filter(Boolean).join(" ");
  if (/nvlink/i.test(text)) return "NVLink";
  if (/sxm|hgx|b200|b300|h100|h200/i.test(text)) return "NVLink";
  if (/pcie|l40s|rtx/i.test(text)) return "PCIe";
  return "Unknown";
}

