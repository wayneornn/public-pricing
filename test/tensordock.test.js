import { test } from "node:test";
import assert from "node:assert/strict";
import { tensordockLocationsToItems } from "../src/connectors/live.js";

test("TensorDock renders one priced GPU per offering, not the available pool as a node", () => {
  const items = tensordockLocationsToItems([
    {
      id: "loc-1",
      city: "Chubbuck",
      country: "United States",
      gpus: [
        { v0Name: "h100-sxm5-80gb", displayName: "NVIDIA H100 SXM 80GB", max_count: 8, price_per_hr: 2.2 }
      ]
    }
  ]);

  assert.equal(items.length, 1);
  const [item] = items;

  // The rentable/priced unit is a single GPU.
  assert.equal(item.gpuCount, 1, "GPU count must be the single rentable unit, not max_count");
  assert.equal(item.pricePerGpuHour, 2.2);
  assert.equal(item.totalHourlyPrice, 2.2, "total price must be for one GPU, not the whole pool");

  // The available pool size is preserved as an availability count, not a node size.
  assert.equal(item.availabilityCount, 8);
  assert.ok(!/\b8x\b/.test(item.gpuLabel || ""), "label must not claim an 8x node");

  // It stays truthfully orderable (live, available, priced, manual checkout).
  assert.equal(item.orderable, true);
  assert.ok(
    (item.dataNotes || []).some((note) => /up to 8 gpus/i.test(note)),
    "should disclose the available pool size as a data note"
  );
});

test("TensorDock offering with a single available GPU has no pool note", () => {
  const [item] = tensordockLocationsToItems([
    {
      id: "loc-2",
      city: "Dallas",
      country: "United States",
      gpus: [{ v0Name: "rtx-a6000", displayName: "NVIDIA RTX A6000 48GB", max_count: 1, price_per_hr: 0.45 }]
    }
  ]);

  assert.equal(item.gpuCount, 1);
  assert.equal(item.availabilityCount, 1);
  assert.ok(!(item.dataNotes || []).some((note) => /up to/i.test(note)));
});
