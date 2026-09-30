import assert from "node:assert/strict";
import test from "node:test";
import {
  awsInventoryRowToInventoryItem,
  crawl,
  get_on_demand_prices,
  parseInstanceTypeMetadata,
  parseOnDemandPriceFromGetProductsResponse,
  parseSpotPriceHistory,
  pricingLocationForRegion
} from "../src/providers/aws.js";

test("AWS pricing parser extracts USD hourly price from GetProducts response", () => {
  const product = {
    terms: {
      OnDemand: {
        "ABC.DEF": {
          priceDimensions: {
            "ABC.DEF.GHI": {
              unit: "Hrs",
              pricePerUnit: { USD: "55.0400000000" }
            }
          }
        }
      }
    }
  };
  const price = parseOnDemandPriceFromGetProductsResponse({
    PriceList: [JSON.stringify(product)]
  });

  assert.equal(price, 55.04);

  const stringLikePrice = parseOnDemandPriceFromGetProductsResponse({
    PriceList: [new String(JSON.stringify(product))]
  });

  assert.equal(stringLikePrice, 55.04);
});

test("AWS on-demand pricing retries throttled GetProducts responses", async () => {
  let calls = 0;
  const product = {
    terms: {
      OnDemand: {
        "SKU.TERM": {
          priceDimensions: {
            "SKU.TERM.RATE": {
              unit: "Hrs",
              pricePerUnit: { USD: "0.8048000000" }
            }
          }
        }
      }
    }
  };
  const pricingClient = {
    async send() {
      calls += 1;
      if (calls === 1) {
        const error = new Error("Rate exceeded");
        error.name = "ThrottlingException";
        throw error;
      }
      return { PriceList: [JSON.stringify(product)] };
    }
  };

  const prices = await get_on_demand_prices("us-east-1", ["g6.xlarge"], {
    AWS_THROTTLE_RETRIES: "2",
    AWS_THROTTLE_BASE_DELAY_MS: "0"
  }, {
    cache: false,
    pricingClient
  });

  assert.equal(prices.get("g6.xlarge").on_demand_price_usd_per_hour, 0.8048);
  assert.equal(calls, 2);
});

test("AWS spot parser chooses latest price per AZ and instance type", () => {
  const latest = parseSpotPriceHistory({
    SpotPriceHistory: [
      {
        AvailabilityZone: "us-east-1a",
        InstanceType: "p5.48xlarge",
        SpotPrice: "18.50",
        Timestamp: new Date("2026-06-04T10:00:00Z")
      },
      {
        AvailabilityZone: "us-east-1a",
        InstanceType: "p5.48xlarge",
        SpotPrice: "19.25",
        Timestamp: new Date("2026-06-04T10:30:00Z")
      },
      {
        AvailabilityZone: "us-east-1b",
        InstanceType: "p5.48xlarge",
        SpotPrice: "20.00",
        Timestamp: new Date("2026-06-04T10:15:00Z")
      }
    ]
  });

  assert.equal(latest.get("us-east-1a|p5.48xlarge").spot_price_usd_per_hour, 19.25);
  assert.equal(latest.get("us-east-1b|p5.48xlarge").spot_price_usd_per_hour, 20);
});

test("AWS inventory item uses spot semantics when on-demand price is unavailable", () => {
  const item = awsInventoryRowToInventoryItem({
    provider: "aws",
    region: "us-east-1",
    availability_zone: "us-east-1a",
    instance_type: "trn2.48xlarge",
    gpu_model: "Trainium2",
    gpu_count: 16,
    gpu_memory_gb: null,
    vcpu: 192,
    ram_gb: 2048,
    network_performance: "3200 Gigabit",
    efa_supported: true,
    local_storage: "instance storage",
    bare_metal: false,
    offered: true,
    on_demand_price_usd_per_hour: null,
    spot_price_usd_per_hour: 12.8,
    spot_price_timestamp: "2026-06-04T10:00:00.000Z",
    last_seen: "2026-06-04T10:00:00.000Z"
  });

  assert.equal(item.totalHourlyPrice, 12.8);
  assert.equal(item.priceScope, "spot");
  assert.equal(item.priceSemantics, "spot");
  assert.equal(item.marketType, "spot");
});

test("AWS instance metadata parser extracts GPU model, count, memory, and machine specs", () => {
  const parsed = parseInstanceTypeMetadata({
    InstanceType: "p5.48xlarge",
    VCpuInfo: { DefaultVCpus: 192 },
    MemoryInfo: { SizeInMiB: 2097152 },
    NetworkInfo: {
      NetworkPerformance: "3200 Gigabit",
      EfaSupported: true
    },
    InstanceStorageSupported: true,
    InstanceStorageInfo: {
      Disks: [
        { Count: 8, SizeInGB: 3840, Type: "ssd" }
      ]
    },
    GpuInfo: {
      Gpus: [
        {
          Name: "NVIDIA H100",
          Count: 8,
          MemoryInfo: { SizeInMiB: 81920 }
        }
      ]
    }
  });

  assert.equal(parsed.rawInstanceType.InstanceType, "p5.48xlarge");
  const { rawInstanceType, ...parsedWithoutRaw } = parsed;
  assert.deepEqual(parsedWithoutRaw, {
    instance_type: "p5.48xlarge",
    gpu_model: "H100",
    gpu_count: 8,
    gpu_memory_gb: 80,
    vcpu: 192,
    ram_gb: 2048,
    network_performance: "3200 Gigabit",
    efa_supported: true,
    local_storage: "30720 GB ssd",
    bare_metal: false
  });
});

test("AWS pricing location mapping works for common regions", () => {
  assert.equal(pricingLocationForRegion("us-east-1"), "US East (N. Virginia)");
  assert.equal(pricingLocationForRegion("us-east-2"), "US East (Ohio)");
  assert.equal(pricingLocationForRegion("us-west-2"), "US West (Oregon)");
  assert.equal(pricingLocationForRegion("eu-west-1"), "EU (Ireland)");
  assert.equal(pricingLocationForRegion("eu-central-1"), "EU (Frankfurt)");
  assert.equal(pricingLocationForRegion("ap-south-1"), "Asia Pacific (Mumbai)");
  assert.equal(pricingLocationForRegion("ap-northeast-1"), "Asia Pacific (Tokyo)");
  assert.equal(pricingLocationForRegion("ap-southeast-1"), "Asia Pacific (Singapore)");
});

const hasAwsIntegrationCredentials = Boolean(
  process.env.RUN_AWS_INTEGRATION === "1"
  && (
    (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY)
    || process.env.AWS_PROFILE
    || process.env.AWS_WEB_IDENTITY_TOKEN_FILE
    || process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI
    || process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI
  )
);

test("AWS integration crawl produces a normalized aws_inventory row", {
  skip: hasAwsIntegrationCredentials ? false : "Set RUN_AWS_INTEGRATION=1 and AWS credentials/profile to run"
}, async () => {
  const instanceType = process.env.AWS_INTEGRATION_INSTANCE_TYPE || "g6.xlarge";
  const rows = await crawl({
    ...process.env,
    AWS_GPU_CACHE_DIR: ".cache/test-aws-api"
  }, {
    regions: ["us-east-1"],
    instanceTypes: [instanceType],
    cache: false
  });

  const row = rows.find((candidate) => candidate.region === "us-east-1" && candidate.instance_type === instanceType);
  assert.ok(row);
  assert.equal(row.provider, "aws");
  assert.ok(row.availability_zone);
  assert.ok(row.gpu_model);
  assert.ok(row.gpu_count > 0);
  assert.ok(row.vcpu > 0);
  assert.ok(row.ram_gb > 0);
  assert.equal(row.offered, true);
  assert.ok(row.on_demand_price_usd_per_hour > 0);
  assert.ok(row.last_seen);
});
