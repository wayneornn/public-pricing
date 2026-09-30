import assert from "node:assert/strict";
import test from "node:test";
import {
  crawl,
  get_projects,
  nebiusInventoryRowToInventoryItem,
  parseNebiusPlatform,
  parseNebiusPreset,
  parseNebiusProject
} from "../src/providers/nebius.js";

const projectEuNorth = {
  metadata: {
    id: "project-eu-north",
    parent_id: "tenant-1",
    name: "default-project-eu-north1"
  },
  spec: {
    region: "eu-north1"
  },
  status: {
    project_state: "ACTIVE"
  }
};

const h100Platform = {
  metadata: {
    id: "computeplatform-h100",
    parent_id: "project-public",
    name: "gpu-h100-sxm"
  },
  spec: {
    presets: [
      {
        name: "1gpu-16vcpu-200gb",
        resources: {
          vcpu_count: 16,
          memory_gibibytes: 200,
          gpu_count: 1
        }
      },
      {
        name: "8gpu-128vcpu-1600gb",
        resources: {
          vcpu_count: 128,
          memory_gibibytes: 1600,
          gpu_count: 8
        },
        allow_gpu_clustering: true
      }
    ],
    gpu_count_quota_type: "compute.instance.gpu.h100",
    human_readable_name: "NVIDIA H100 NVLink with Intel Sapphire Rapids",
    short_human_readable_name: "NVIDIA H100 NVLink",
    gpu_memory_gigabytes: 80
  },
  status: {
    allowed_for_preemptibles: true
  }
};

test("Nebius project parser extracts tenant, project, and region", () => {
  const project = parseNebiusProject(projectEuNorth);

  assert.equal(project.id, "project-eu-north");
  assert.equal(project.tenant_id, "tenant-1");
  assert.equal(project.name, "default-project-eu-north1");
  assert.equal(project.region, "eu-north1");
  assert.equal(project.state, "ACTIVE");
});

test("Nebius platform parser extracts GPU presets and explicit topology fields", () => {
  const platform = parseNebiusPlatform(h100Platform, parseNebiusProject(projectEuNorth));

  assert.equal(platform.name, "gpu-h100-sxm");
  assert.equal(platform.gpu_model, "H100");
  assert.equal(platform.gpu_memory_gb, 80);
  assert.equal(platform.interconnect, "NVLink");
  assert.equal(platform.network_fabric, "Not exposed");
  assert.equal(platform.preemptible_supported, true);
  assert.equal(platform.presets.length, 2);
  assert.equal(platform.presets[1].gpu_count, 8);
  assert.equal(platform.presets[1].vcpu, 128);
  assert.equal(platform.presets[1].ram_gb, 1600);
  assert.equal(platform.presets[1].allow_gpu_clustering, true);
});

test("Nebius preset parser preserves raw machine resources", () => {
  const preset = parseNebiusPreset(h100Platform.spec.presets[0]);

  assert.equal(preset.name, "1gpu-16vcpu-200gb");
  assert.equal(preset.gpu_count, 1);
  assert.equal(preset.vcpu, 16);
  assert.equal(preset.ram_gb, 200);
});

test("Nebius crawl discovers all tenant projects and emits non-orderable catalog rows", async () => {
  const calls = [];
  const executor = async (args) => {
    calls.push(args);
    if (args[0] === "iam") {
      return {
        items: [
          projectEuNorth,
          {
            metadata: {
              id: "project-us",
              parent_id: "tenant-1",
              name: "default-project-us-central1"
            },
            spec: {
              region: "us-central1"
            },
            status: {
              project_state: "ACTIVE"
            }
          }
        ]
      };
    }
    return {
      items: [h100Platform]
    };
  };

  const rows = await crawl({
    NEBIUS_ENABLED: "1",
    NEBIUS_TENANT_ID: "tenant-1",
    NEBIUS_PROJECT_DISCOVERY: "all"
  }, {
    executor,
    now: "2026-06-08T18:00:00.000Z"
  });

  assert.equal(calls.filter((args) => args[0] === "compute").length, 2);
  assert.equal(rows.length, 4);
  assert.equal(rows[0].provider, "nebius");
  assert.equal(rows[0].orderable, false);
  assert.equal(rows[0].on_demand_price_usd_per_hour, null);
});

test("Nebius inventory item stays out of orderable checkout results", () => {
  const item = nebiusInventoryRowToInventoryItem({
    provider: "nebius",
    project_id: "project-eu-north",
    project_name: "default-project-eu-north1",
    region: "eu-north1",
    platform_id: "computeplatform-h100",
    platform_name: "gpu-h100-sxm",
    platform_human_name: "NVIDIA H100 NVLink with Intel Sapphire Rapids",
    preset_name: "8gpu-128vcpu-1600gb",
    gpu_model: "H100",
    gpu_count: 8,
    gpu_memory_gb: 80,
    vcpu: 128,
    ram_gb: 1600,
    interconnect: "NVLink",
    network_fabric: "Not exposed",
    allow_gpu_clustering: true,
    preemptible_supported: true,
    orderability_reason: "catalog",
    rawProject: projectEuNorth,
    rawPlatform: h100Platform,
    rawPreset: h100Platform.spec.presets[1]
  });

  assert.equal(item.providerId, "nebius");
  assert.equal(item.gpuModel, "H100");
  assert.equal(item.gpuCount, 8);
  assert.equal(item.orderable, false);
  assert.equal(item.availabilitySemantics, "region_offering");
  assert.equal(item.checkoutSemantics, "provider_console");
  assert.equal(item.orderabilityReason, "Provider adapter marked this row non-orderable");
});

test("Nebius project discovery falls back to configured project IDs", async () => {
  const projects = await get_projects({
    NEBIUS_PROJECT_IDS: "project-a,project-b"
  }, {
    executor: async () => {
      throw new Error("should not be called");
    }
  });

  assert.deepEqual(projects.map((project) => project.id), ["project-a", "project-b"]);
});
