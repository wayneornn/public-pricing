import assert from "node:assert/strict";
import test from "node:test";
import {
  get_plans,
  get_regions,
  latitudeHourlyPrice,
  latitudePlanToItems,
  latitudeRegionsToMap,
  parseLatitudePlanMetadata
} from "../src/providers/latitude.js";

const h100Plan = {
  id: "plan_gpu_h100_4x",
  type: "plans",
  attributes: {
    slug: "gpu-h100-4x",
    name: "gpu.h100.4x",
    features: ["raid"],
    specs: {
      cpu: {
        type: "EPYC 9354",
        cores: 32,
        count: 2,
        clock: 3.25
      },
      memory: {
        total: 1024
      },
      drives: [
        {
          count: 2,
          size: "7.68TB",
          type: "NVMe"
        }
      ],
      nics: [
        {
          count: 2,
          type: "100 Gbps"
        }
      ],
      gpu: {
        count: 4,
        type: "NVIDIA H100",
        vram_per_gpu: 80,
        interconnect: "NVLink"
      }
    },
    regions: [
      {
        name: "Brazil",
        deploys_instantly: ["SAO"],
        locations: {
          available: ["SAO"],
          in_stock: ["SAO"]
        },
        stock_level: "medium",
        pricing: {
          USD: {
            hour: 10,
            month: 5000
          }
        }
      }
    ]
  }
};

test("Latitude plan parser extracts GPU and machine metadata", () => {
  const parsed = parseLatitudePlanMetadata(h100Plan);

  assert.equal(parsed.slug, "gpu-h100-4x");
  assert.equal(parsed.gpu_model, "NVIDIA H100");
  assert.equal(parsed.gpu_count, 4);
  assert.equal(parsed.gpu_memory_gb, 80);
  assert.equal(parsed.gpu_interconnect, "NVLink");
  assert.equal(parsed.ram_gb, 1024);
  assert.equal(parsed.drives[0].size, "7.68TB");
  assert.equal(parsed.nics[0].type, "100 Gbps");
});

test("Latitude pricing parser prefers hourly and can derive monthly pricing", () => {
  assert.equal(latitudeHourlyPrice(h100Plan.attributes.regions[0]), 10);
  assert.equal(latitudeHourlyPrice({
    pricing: {
      USD: {
        month: 7300
      }
    }
  }), 10);
});

test("Latitude region map normalizes location metadata", () => {
  const map = latitudeRegionsToMap([
    {
      id: "loc_sao",
      attributes: {
        name: "Sao Paulo",
        slug: "SAO",
        facility: "SAO1",
        country: {
          name: "Brazil"
        },
        type: "core"
      }
    }
  ]);

  assert.equal(map.get("SAO").name, "Sao Paulo");
  assert.equal(map.get("SAO1").country, "Brazil");
});

test("Latitude plan to inventory item expands available locations", () => {
  const regionMap = latitudeRegionsToMap([
    {
      id: "loc_sao",
      attributes: {
        name: "Sao Paulo",
        slug: "SAO",
        country: {
          name: "Brazil"
        }
      }
    }
  ]);
  const rows = latitudePlanToItems(h100Plan, regionMap);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].providerId, "latitude");
  assert.equal(rows[0].gpuModel, "H100");
  assert.equal(rows[0].gpuCount, 4);
  assert.equal(rows[0].pricePerGpuHour, 2.5);
  assert.equal(rows[0].totalHourlyPrice, 10);
  assert.equal(rows[0].formFactor, "bare_metal");
  assert.equal(rows[0].networkBandwidth, "2x 100 Gbps");
  assert.equal(rows[0].networkFabric, "Not exposed");
  assert.match(rows[0].checkoutUrl, /metal\.new/);
});

test("Latitude API helpers support paginated JSON:API responses", async () => {
  const urls = [];
  const fetcher = async (url) => {
    urls.push(url);
    return {
      data: urls.length === 1 ? [h100Plan] : [],
      meta: {
        total_pages: 1
      }
    };
  };

  const plans = await get_plans({ LATITUDE_API_KEY: "test" }, { fetcher, pageSize: 100 });
  assert.equal(plans.length, 1);
  assert.match(urls[0], /filter%5Bgpu%5D=true/);

  const regions = await get_regions({ LATITUDE_API_KEY: "test" }, {
    fetcher: async () => ({
      data: [
        {
          id: "loc_sao",
          attributes: {
            name: "Sao Paulo",
            slug: "SAO"
          }
        }
      ],
      meta: {
        total_pages: 1
      }
    })
  });
  assert.equal(regions[0].attributes.slug, "SAO");
});
