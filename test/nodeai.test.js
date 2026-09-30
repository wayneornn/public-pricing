import assert from "node:assert/strict";
import test from "node:test";
import { nodeaiToItems } from "../src/connectors/live/providers/nodeai.js";

const PAYLOAD = {
  pageProps: {
    content: {
      options: [
        { _key: "a100", model: "A100", pricePerHour: 0.85, productType: "Graphics Card", supply: 420 },
        { _key: "a6000-a40", model: "A6000 / A40", pricePerHour: 0.44, productType: "Graphics Card", supply: 690 }
      ]
    }
  }
};

test("NodeAI parses public Next pricing JSON", () => {
  const items = nodeaiToItems(PAYLOAD);
  assert.equal(items.length, 2);
  assert.equal(items[0].rawOfferId, "a100");
  assert.equal(items[0].pricePerGpuHour, 0.85);
  assert.equal(items[0].availabilityCount, 420);
});

test("NodeAI rows are non-orderable USD capacity catalog", () => {
  const items = nodeaiToItems(PAYLOAD);
  for (const item of items) {
    assert.equal(item.providerId, "nodeai");
    assert.equal(item.currency, "USD");
    assert.equal(item.checkoutSemantics, "provider_console");
    assert.equal(item.orderable, false);
  }
});
