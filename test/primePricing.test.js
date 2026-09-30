import assert from "node:assert/strict";
import test from "node:test";
import { primeDefaultResourceHourlyPrice } from "../src/connectors/live.js";

test("Prime deploy pricing includes default disk when it is not included in base price", () => {
  const addOns = primeDefaultResourceHourlyPrice({
    vcpu: {
      defaultCount: 32,
      pricePerUnit: null,
      defaultIncludedInPrice: null
    },
    memory: {
      defaultCount: 185,
      pricePerUnit: null,
      defaultIncludedInPrice: null
    },
    disk: {
      defaultCount: 500,
      pricePerUnit: 0.000274,
      defaultIncludedInPrice: false
    }
  });

  assert.equal(addOns, 0.137);
});
