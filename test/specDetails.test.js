import assert from "node:assert/strict";
import test from "node:test";
import { parseMemoryGb } from "../src/connectors/live.js";

test("shared memory parser handles TB/TiB API strings", () => {
  assert.equal(parseMemoryGb("2TB RAM"), 2048);
  assert.equal(parseMemoryGb("1.5 TiB"), 1536);
  assert.equal(parseMemoryGb("2048 GB"), 2048);
});
