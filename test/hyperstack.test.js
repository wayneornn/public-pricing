import assert from "node:assert/strict";
import test from "node:test";
import { hyperstackFlavorToItem } from "../src/connectors/live.js";

test("Hyperstack parser does not treat network_optimised as a fabric claim", () => {
  const item = hyperstackFlavorToItem({
    id: "flavor-h100-8x",
    name: "n3-H100x8",
    display_name: "8x H100",
    gpu: "H100",
    gpu_count: 8,
    cpu: 208,
    ram: 1800,
    price_per_hour: 24,
    region_name: "us-east",
    stock_available: true,
    features: {
      network_optimised: true
    }
  }, new Map());

  assert.equal(item.networkFabric, "Not exposed");
  assert.match(item.dataNotes.join(" "), /network-optimized; fabric not implied/);
  assert.equal(item.orderable, true);
});
