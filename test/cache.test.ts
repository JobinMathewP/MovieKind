import assert from "node:assert/strict";
import test from "node:test";
import { createTtlCache } from "../src/cache.js";

test("ttl cache returns a fresh value, expires it, and drops the oldest entry", () => {
  let now = 1_000;
  const cache = createTtlCache<string>({ ttlMs: 500, max: 2, now: () => now });

  cache.set("a", "alpha");
  assert.equal(cache.get("a"), "alpha");

  now = 1_500;
  assert.equal(cache.get("a"), undefined);

  cache.set("b", "beta");
  cache.set("c", "gamma");
  cache.set("d", "delta");
  assert.equal(cache.get("b"), undefined);
  assert.equal(cache.get("c"), "gamma");
  assert.equal(cache.get("d"), "delta");
});
