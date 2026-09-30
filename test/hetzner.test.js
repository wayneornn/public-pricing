import assert from "node:assert/strict";
import test from "node:test";
import { hetznerConfigurationsToItems } from "../src/connectors/live/providers/hetzner.js";

const PAYLOAD = [
  {
    configuration: [
      { type: "server", name_en: "GEX131" },
      { type: "cpu", cores: 24, threads: 48, name_en: "Intel Xeon Gold 5412U" },
      { type: "ram", size: 256, unit: "GB", name_en: "DDR5 RAM" },
      { type: "ssd", size: 960, unit: "GB", name_en: "960 GB NVMe SSD Datacenter Edition" },
      { type: "ssd", size: 960, unit: "GB", name_en: "960 GB NVMe SSD Datacenter Edition" }
    ],
    availabilities: {
      HEL1: { quantity: 1, price: { monthly: "896.3000", hourly: "1.4364", setup: "2912.0000" } },
      FSN1: { quantity: 0, price: { monthly: "906.3000", hourly: "1.4524", setup: "2912.0000" } }
    },
    product_name: "GEX131",
    configuration_id: "1666-1667-1670"
  },
  {
    configuration: [{ type: "server", name_en: "EX44" }],
    availabilities: { HEL1: { quantity: 1, price: { hourly: "0.0902" } } },
    product_name: "EX44",
    configuration_id: "1399-1433"
  }
];

test("Hetzner maps public GEX availability into non-orderable GPU capacity rows", () => {
  const rows = hetznerConfigurationsToItems(PAYLOAD);
  assert.equal(rows.length, 2);

  const row = rows[0];
  assert.equal(row.providerId, "hetzner");
  assert.equal(row.rawOfferId, "1666-1667-1670:HEL1");
  assert.equal(row.gpuLabel, "1x RTX PRO 6000 Blackwell Max Q 96GB");
  assert.equal(row.gpuCount, 1);
  assert.equal(row.vramGbEach, 96);
  assert.equal(row.pricePerGpuHour, 1.5513);
  assert.equal(row.totalHourlyPrice, 1.5513);
  assert.equal(row.cpu, "Intel Xeon Gold 5412U (24 cores / 48 threads)");
  assert.equal(row.ramGb, 256);
  assert.equal(row.storage, "2x 960 GB NVMe SSD Datacenter Edition");
  assert.equal(row.availability, "available");
  assert.equal(row.availabilityCount, 1);
  assert.equal(row.orderable, false);
  assert.equal(row.checkoutSemantics, "provider_console");

  assert.equal(rows[1].availability, "unavailable");
  assert.equal(rows[1].availabilityCount, 0);
});
