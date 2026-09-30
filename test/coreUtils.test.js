import assert from "node:assert/strict";
import test from "node:test";
import { numberOrNull, parseMemoryGb, round } from "../src/core/num.js";
import { compactMetadata, inferGpuCount, normalizedList, parseEnvList, pickArray, truncate } from "../src/core/format.js";
import { cacheKeyForList, safeCacheKey } from "../src/core/apiCache.js";

test("numberOrNull strips currency, rejects empty/non-positive/non-numeric", () => {
  assert.equal(numberOrNull("$1,234.50"), 1234.5);
  assert.equal(numberOrNull("  2.5 "), 2.5);
  assert.equal(numberOrNull(3), 3);
  assert.equal(numberOrNull(""), null);
  assert.equal(numberOrNull("   "), null);
  assert.equal(numberOrNull(0), null);
  assert.equal(numberOrNull(-4), null);
  assert.equal(numberOrNull("abc"), null);
  assert.equal(numberOrNull(null), null);
  assert.equal(numberOrNull(undefined), null);
});

test("parseMemoryGb handles numbers, units, objects, and mixed text", () => {
  assert.equal(parseMemoryGb(80), 80);
  assert.equal(parseMemoryGb("80"), 80);
  assert.equal(parseMemoryGb("80 GiB"), 80);
  assert.equal(parseMemoryGb("512 MB"), 0.5);
  assert.equal(parseMemoryGb("1 TB"), 1024);
  assert.equal(parseMemoryGb({ amount: 40 }), 40);
  assert.equal(parseMemoryGb({ size: 24 }), 24);
  // unit-qualified amount wins over a leading count
  assert.equal(parseMemoryGb("2x V100 32GB"), 32);
  // a unitless flavor name yields null so callers can fall back to a model lookup
  assert.equal(parseMemoryGb("t2-90"), null);
  assert.equal(parseMemoryGb(""), null);
});

test("round honors the digits argument", () => {
  assert.equal(round(1.23456), 1.2346);
  assert.equal(round(1.23456, 2), 1.23);
  assert.equal(round(1.5, 0), 2);
});

test("compactMetadata recursively drops null/undefined/empty", () => {
  assert.deepEqual(
    compactMetadata({ a: 1, b: null, c: "", d: { e: "", f: 2 }, g: { h: "" }, i: [null, 3] }),
    { a: 1, d: { f: 2 }, i: [3] }
  );
  assert.deepEqual(compactMetadata(null), {});
  assert.deepEqual(compactMetadata([1, 2]), {});
});

test("pickArray finds arrays at the value or a dotted path", () => {
  assert.deepEqual(pickArray([1, 2], ["x"]), [1, 2]);
  assert.deepEqual(pickArray({ data: { items: [3] } }, ["data.items"]), [3]);
  assert.deepEqual(pickArray({ a: 1 }, ["missing"]), []);
});

test("inferGpuCount pulls a count from free text", () => {
  assert.equal(inferGpuCount("8x H100"), 8);
  assert.equal(inferGpuCount("H100 x4"), 4);
  assert.equal(inferGpuCount("H100"), null);
});

test("normalizedList / parseEnvList trim comma lists and arrays", () => {
  assert.deepEqual(parseEnvList("a, b ,,c"), ["a", "b", "c"]);
  assert.deepEqual(normalizedList(["x ", "", " y"]), ["x", "y"]);
  assert.deepEqual(parseEnvList(""), []);
});

test("cache key helpers are stable and filesystem-safe", () => {
  assert.equal(cacheKeyForList([]), "all");
  assert.equal(cacheKeyForList(["b", "a"]), cacheKeyForList(["a", "b"]));
  assert.equal(safeCacheKey("us-east 1/x*y"), "us-east_1/x_y");
  assert.equal(truncate("x".repeat(600)).length, 500);
});
