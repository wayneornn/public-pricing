import assert from "node:assert/strict";
import test from "node:test";
import { hotaisleToItems } from "../src/connectors/live/providers/hotaisle.js";

// Captured verbatim from the live Hot Aisle API on 2026-06-13 (team
// shivabhattacharjeepokecoms-team), matching the OpenAPI spec at
// admin.hotaisle.app/api/docs/swagger.json: AvailableVirtualMachineTypes /
// AvailableBareMetalTypes with OnDemandPrice in US cents (whole instance),
// Quantity as a creatable/reservable count, and Specs with byte-valued RAM/disk
// and a gpus[] array of { count, manufacturer, model }. Note `cpus` is an object
// for VMs and an array for bare metal — the connector reads cpu_cores, not cpus.
const VM_AVAILABLE = [
  {
    Quantity: 2,
    OnDemandPrice: 199, // $1.99/hr whole instance for a 1x MI300X VM
    MinimumReservationMinutes: 1,
    Specs: {
      cpu_cores: 8,
      ram_capacity: 240518168576, // 224 GiB
      disk_capacity: 13194139533312, // 12 TiB
      cpus: { count: 1, manufacturer: "Intel", model: "Xeon Platinum 8462Y+", cores: 8, frequency: 2800000000 },
      gpus: [{ count: 1, manufacturer: "AMD", model: "MI300X" }]
    }
  },
  {
    Quantity: 1,
    OnDemandPrice: 398, // $3.98/hr whole instance for a 2x MI300X VM ($1.99/GPU)
    MinimumReservationMinutes: 60,
    Specs: {
      cpu_cores: 26,
      ram_capacity: 481036337152, // 448 GiB
      disk_capacity: 13194139533312,
      cpus: { count: 1, manufacturer: "Intel", model: "Xeon Platinum 8470", cores: 26, frequency: 2000000000 },
      gpus: [{ count: 2, manufacturer: "AMD", model: "MI300X" }]
    }
  }
];

const BARE_METAL_AVAILABLE = [
  {
    Quantity: 1,
    OnDemandPrice: 1594, // $15.94/hr whole instance for an 8x MI300X bare metal node
    MinimumReservationMinutes: 480,
    Specs: {
      cpu_cores: 104,
      ram_capacity: 2199023255552, // 2 TiB
      disk_capacity: 123839994396672,
      cpus: [{ count: 2, manufacturer: "Intel", model: "Xeon Platinum 8470", cores: 52, frequency: 2000000000 }],
      memory_modules: [{ count: 32, manufacturer: "Dell", model: "64GB RDIMM, 4800MT/s Dual Rank", capacity: 68719476736 }],
      disks: [
        { count: 8, manufacturer: "Dell", model: "15.36TB Gen4 NVMe", type: "NVMe", capacity: 15359999475712 },
        { count: 2, manufacturer: "Dell", model: "M.2 480GB", type: "NVMe", capacity: 479999295488 }
      ],
      gpus: [{ count: 8, manufacturer: "AMD", model: "MI300X" }]
    }
  }
];

test("Hot Aisle maps available VM + bare metal types into priced capacity rows", () => {
  const items = hotaisleToItems({ virtualMachines: VM_AVAILABLE, bareMetal: BARE_METAL_AVAILABLE });
  assert.equal(items.length, 3);

  const vm1 = items[0];
  assert.equal(vm1.providerId, "hot-aisle");
  assert.equal(vm1.provider, "Hot Aisle");
  assert.equal(vm1.rawOfferId, "vm:1x-mi300x");
  assert.equal(vm1.gpuLabel, "1x MI300X");
  assert.equal(vm1.gpuModel, "MI300X");
  assert.equal(vm1.gpuCount, 1);
  assert.equal(vm1.formFactor, "vm");
  assert.equal(vm1.cpu, "8 vCPU");
  assert.equal(vm1.ramGb, 224);
  assert.equal(vm1.storage, "12288 GB");
  assert.equal(vm1.totalHourlyPrice, 1.99);
  assert.equal(vm1.pricePerGpuHour, 1.99);
  assert.equal(vm1.currency, "USD");
  assert.equal(vm1.availability, "available");
  assert.equal(vm1.availabilityCount, 2);
  assert.equal(vm1.minTerm, "1 min minimum");
  assert.equal(vm1.availabilitySemantics, "sku_capacity");
  assert.equal(vm1.priceScope, "node_total");
  assert.equal(vm1.priceSemantics, "node_total");
  assert.equal(vm1.checkoutSemantics, "provider_console");
  assert.equal(vm1.orderable, false);
  assert.equal(vm1.metadata.billingGranularity, "per-minute");
  assert.equal(vm1.metadata.onDemandPriceCents, 199);
});

test("Hot Aisle derives per-GPU price from the whole-instance rate (2x MI300X)", () => {
  const items = hotaisleToItems({ virtualMachines: VM_AVAILABLE, bareMetal: [] });
  const vm2 = items[1];
  assert.equal(vm2.rawOfferId, "vm:2x-mi300x");
  assert.equal(vm2.gpuCount, 2);
  assert.equal(vm2.ramGb, 448);
  assert.equal(vm2.totalHourlyPrice, 3.98);
  assert.equal(vm2.pricePerGpuHour, 1.99); // 3.98 / 2
  assert.equal(vm2.availability, "available");
  assert.equal(vm2.availabilityCount, 1);
  assert.equal(vm2.minTerm, "1 hr minimum");
  assert.equal(vm2.orderable, false);
});

test("Hot Aisle bare metal rows carry the reservation term and bare_metal form factor", () => {
  const items = hotaisleToItems({ virtualMachines: [], bareMetal: BARE_METAL_AVAILABLE });
  assert.equal(items.length, 1);
  const bm = items[0];
  assert.equal(bm.rawOfferId, "bare_metal:8x-mi300x");
  assert.equal(bm.formFactor, "bare_metal");
  assert.equal(bm.gpuCount, 8);
  assert.equal(bm.cpu, "104 cores");
  assert.equal(bm.ramGb, 2048);
  assert.equal(bm.totalHourlyPrice, 15.94);
  assert.equal(bm.pricePerGpuHour, 1.9925);
  assert.equal(bm.minTerm, "8 hr minimum");
  assert.equal(bm.availabilityCount, 1);
  assert.equal(bm.metadata.billingGranularity, "reservation");
  assert.equal(bm.orderable, false);
});

test("Hot Aisle flags zero stock as unavailable", () => {
  const items = hotaisleToItems({
    virtualMachines: [{ ...VM_AVAILABLE[0], Quantity: 0 }],
    bareMetal: []
  });
  assert.equal(items[0].availability, "unavailable");
  assert.equal(items[0].availabilityCount, 0);
  assert.equal(items[0].orderable, false);
});

test("Hot Aisle skips CPU-only types and unpriced types", () => {
  const items = hotaisleToItems({
    virtualMachines: [
      { OnDemandPrice: 50, Quantity: 5, Specs: { cpu_cores: 8, gpus: [] } }, // no GPU
      { OnDemandPrice: 0, Quantity: 5, Specs: { gpus: [{ count: 1, manufacturer: "AMD", model: "MI300X" }] } } // unpriced
    ],
    bareMetal: []
  });
  assert.equal(items.length, 0);
});

test("Hot Aisle accepts the paginated { items: [...] } envelope shape", () => {
  const items = hotaisleToItems({ virtualMachines: { items: VM_AVAILABLE }, bareMetal: { items: [] } });
  assert.equal(items.length, 2);
  assert.equal(items[0].gpuLabel, "1x MI300X");
});
