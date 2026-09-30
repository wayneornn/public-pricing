import { test } from "node:test";
import assert from "node:assert/strict";
import { cudoVmMachineTypesToItems } from "../src/connectors/live.js";

test("CUDO VM renders one priced GPU per offering, not the free pool as a node", () => {
  const items = cudoVmMachineTypesToItems([
    {
      machineType: "h100-sxm",
      dataCenterId: "no-luster-1",
      gpuModel: "NVIDIA H100 SXM",
      gpuModelId: "h100-sxm",
      gpuPriceHr: { value: "2.45" },
      maxGpuFree: 8,
      maxVcpuFree: 192,
      maxMemoryGibFree: 1536
    }
  ]);

  assert.equal(items.length, 1);
  const [item] = items;

  // The rentable/priced unit is a single GPU, not the free pool.
  assert.equal(item.gpuCount, 1, "GPU count must be the single rentable unit, not maxGpuFree");
  assert.equal(item.pricePerGpuHour, 2.45);
  assert.equal(item.totalHourlyPrice, 2.45, "total price must be for one GPU, not the whole pool");

  // The free pool size is preserved as an availability count, not a node size.
  assert.equal(item.availabilityCount, 8);
  assert.ok(!/\b8x\b/.test(item.gpuLabel || ""), "label must not claim an 8x node");
  assert.ok(
    (item.dataNotes || []).some((note) => /up to 8 gpus/i.test(note)),
    "should disclose the free pool size as a data note"
  );
});

test("CUDO VM offering with a single free GPU has no pool note", () => {
  const [item] = cudoVmMachineTypesToItems([
    {
      machineType: "a40",
      dataCenterId: "no-luster-2",
      gpuModel: "NVIDIA A40",
      gpuModelId: "a40",
      gpuPriceHr: { value: "0.79" },
      maxGpuFree: 1
    }
  ]);

  assert.equal(item.gpuCount, 1);
  assert.equal(item.availabilityCount, 1);
  assert.ok(!(item.dataNotes || []).some((note) => /up to/i.test(note)));
});
