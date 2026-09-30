import assert from "node:assert/strict";
import test from "node:test";
import { gmiProductsToItems } from "../src/connectors/live.js";

test("GMI parser keeps invalid bare-metal products non-orderable", () => {
  const rows = gmiProductsToItems({
    idcs: [
      {
        idcId: "asia-east-hanoi",
        name: "Hanoi IDC",
        country: "VN",
        countrySubdivision: "VN-HN",
        status: "available"
      }
    ],
    bareMetalProducts: [
      {
        gpuModel: "H100",
        idc: "asia-east-hanoi",
        name: "gmi.bm.nh1.normal",
        price: 23200000,
        productLine: "BareMetal",
        spec: {
          basic: [
            { name: "CPU", value: "Intel Xeon Platium 8462Y+ x 2" },
            { name: "GPU", value: "Nvidia H100 SXM5 80GB x 8" },
            { name: "Memory", value: "DDR5 4800MHz 64GB x 32" },
            { name: "Server Storage", value: "3.84TB NVMe SSD x 8" }
          ],
          extra: [
            { name: "Common Network Adapters", value: "NVIDIA BF-3 ConnectX-7 200G x 2" },
            { name: "Compute Network Adapters", value: "NVIDIA ConnectX-7 NDR IB 400G x 8" }
          ],
          name: "H100(80G)"
        },
        type: "BareMetal",
        valid: false
      }
    ]
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].providerId, "gmi");
  assert.equal(rows[0].gpuModel, "H100");
  assert.equal(rows[0].gpuVariant, "SXM");
  assert.equal(rows[0].gpuCount, 8);
  assert.equal(rows[0].vramGbEach, 80);
  assert.equal(rows[0].formFactor, "bare_metal");
  assert.equal(rows[0].ramGb, 2048);
  assert.equal(rows[0].interconnect, "NVLink");
  assert.equal(rows[0].networkFabric, "InfiniBand");
  assert.match(rows[0].networkBandwidth, /NDR IB 400G x 8/);
  assert.equal(rows[0].specs.network.fabric, "InfiniBand");
  assert.equal(rows[0].totalHourlyPrice, 23.2);
  assert.equal(rows[0].pricePerGpuHour, 2.9);
  assert.equal(rows[0].availability, "unavailable");
  assert.equal(rows[0].availabilityCount, 0);
  assert.equal(rows[0].orderable, false);
  assert.match(rows[0].orderabilityReason, /Availability is unavailable/);
});
