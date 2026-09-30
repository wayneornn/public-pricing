import assert from "node:assert/strict";
import test from "node:test";
import {
  get_availability_domains,
  get_regions,
  get_shapes,
  mapOciGpuShape,
  normalizeOciPrice,
  normalizeOciPrices,
  ociShapeToOffering,
  parseOciShapeMetadata
} from "../src/providers/oci.js";

const h100Shape = {
  shape: "BM.GPU.H100.8",
  gpus: 8,
  gpuDescription: "NVIDIA H100 Tensor Core GPU",
  ocpus: 112,
  memoryInGBs: 2048,
  networkingBandwidthInGbps: 3200,
  localDisks: 8,
  localDisksTotalSizeInGBs: 61440,
  localDiskDescription: "NVMe SSD"
};

test("OCI shape parser extracts GPU and machine metadata", () => {
  const parsed = parseOciShapeMetadata(h100Shape);

  assert.equal(parsed.shape, "BM.GPU.H100.8");
  assert.equal(parsed.gpu_model, "H100");
  assert.equal(parsed.gpu_count, 8);
  assert.equal(parsed.gpu_memory_gb, 80);
  assert.equal(parsed.ocpus, 112);
  assert.equal(parsed.vcpu_equivalent, 224);
  assert.equal(parsed.ram_gb, 2048);
  assert.equal(parsed.network_gbps, 3200);
  assert.equal(parsed.local_storage, "8 disks 61440 GB NVMe SSD");
  assert.equal(parsed.bare_metal, true);
});

test("OCI GPU mapping covers requested shape families", () => {
  assert.deepEqual(mapOciGpuShape("BM.GPU.H100.8", { gpus: 8 }), {
    gpu_model: "H100",
    gpu_count: 8,
    gpu_memory_gb: 80
  });
  assert.deepEqual(mapOciGpuShape("BM.GPU.A100-v2.8", { gpus: 8 }), {
    gpu_model: "A100",
    gpu_count: 8,
    gpu_memory_gb: 80
  });
  assert.equal(mapOciGpuShape("BM.GPU4.8", { gpus: 8 }).gpu_model, "A100");
  assert.equal(mapOciGpuShape("BM.GPU3.8", { gpus: 8 }).gpu_model, "V100");
  assert.equal(mapOciGpuShape("BM.GPU2.2", { gpus: 2 }).gpu_model, "P100");
  assert.equal(mapOciGpuShape("VM.GPU.A10.2", { gpus: 2 }).gpu_model, "A10");
  assert.equal(mapOciGpuShape("VM.GPU.A100.1", { gpus: 1 }).gpu_model, "A100");
});

test("OCI offering extraction preserves region, availability domain, and raw shape name", () => {
  const row = ociShapeToOffering("us-ashburn-1", "Focm:US-ASHBURN-AD-1", h100Shape);

  assert.equal(row.provider, "oci");
  assert.equal(row.region, "us-ashburn-1");
  assert.equal(row.availability_domain, "Focm:US-ASHBURN-AD-1");
  assert.equal(row.shape, "BM.GPU.H100.8");
  assert.equal(row.offered, true);
});

test("OCI pricing normalization handles node, OCPU, GPU, and preemptible rates", () => {
  const shape = parseOciShapeMetadata(h100Shape);

  assert.equal(normalizeOciPrice({
    product: { name: "BM.GPU.H100.8 OCPU Hour", unitOfMeasure: "OCPU Hour" },
    overagePrice: "0.1"
  }, shape), 11.2);

  assert.equal(normalizeOciPrice({
    product: { name: "BM.GPU.H100.8 GPU Hour", unitOfMeasure: "GPU Hour" },
    overagePrice: "2"
  }, shape), 16);

  assert.equal(normalizeOciPrice({
    product: { name: "BM.GPU.H100.8 Node Hour", unitOfMeasure: "Node Hour" },
    overagePrice: "64"
  }, shape), 64);

  const rows = normalizeOciPrices([
    {
      product: { name: "BM.GPU.H100.8 Node Hour", unitOfMeasure: "Node Hour" },
      overagePrice: "64",
      currency: { code: "USD" }
    },
    {
      product: { name: "BM.GPU.H100.8 Preemptible Node Hour", unitOfMeasure: "Node Hour" },
      overagePrice: "32",
      currency: { code: "USD" }
    }
  ], [shape], { region: "us-ashburn-1" });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].on_demand_price_usd_per_hour, 64);
  assert.equal(rows[0].preemptible_price_usd_per_hour, 32);
});

test("OCI region discovery uses region subscriptions", async () => {
  const regions = await get_regions({ OCI_TENANCY_OCID: "ocid1.tenancy.oc1..test" }, {
    cache: false,
    identityClient: {
      async listRegionSubscriptions(request) {
        assert.equal(request.tenancyId, "ocid1.tenancy.oc1..test");
        return {
          items: [
            { regionName: "us-phoenix-1", status: "READY" },
            { regionName: "us-ashburn-1", status: "READY" },
            { regionName: "eu-frankfurt-1", status: "IN_PROGRESS" }
          ]
        };
      }
    }
  });

  assert.deepEqual(regions, ["us-ashburn-1", "us-phoenix-1"]);
});

test("OCI availability-domain extraction uses the selected compartment", async () => {
  const domains = await get_availability_domains("us-ashburn-1", { OCI_TENANCY_OCID: "ocid1.tenancy.oc1..test" }, {
    cache: false,
    compartmentId: "ocid1.compartment.oc1..gpu",
    identityClient: {
      async listAvailabilityDomains(request) {
        assert.equal(request.compartmentId, "ocid1.compartment.oc1..gpu");
        return {
          items: [
            { name: "Focm:US-ASHBURN-AD-2" },
            { name: "Focm:US-ASHBURN-AD-1" }
          ]
        };
      }
    }
  });

  assert.deepEqual(domains, ["Focm:US-ASHBURN-AD-1", "Focm:US-ASHBURN-AD-2"]);
});

test("OCI shape crawl filters GPU-capable shapes from Compute ListShapes", async () => {
  const shapes = await get_shapes("us-ashburn-1", "Focm:US-ASHBURN-AD-1", { OCI_TENANCY_OCID: "ocid1.tenancy.oc1..test" }, {
    cache: false,
    compartmentId: "ocid1.compartment.oc1..gpu",
    computeClient: {
      async listAllShapes(request) {
        assert.equal(request.availabilityDomain, "Focm:US-ASHBURN-AD-1");
        return {
          items: [
            h100Shape,
            { shape: "VM.Standard.E5.Flex", ocpus: 8 },
            { shape: "VM.GPU.A10.2", gpus: 2, gpuDescription: "NVIDIA A10" }
          ]
        };
      }
    }
  });

  assert.deepEqual(shapes.map((shape) => shape.shape), ["BM.GPU.H100.8", "VM.GPU.A10.2"]);
});
