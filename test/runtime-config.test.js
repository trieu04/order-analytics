"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeRuntimeConfig } = require("../src/runtime-config");

test("normalizes dynamic scheduler and item configuration", () => {
  assert.deepEqual(normalizeRuntimeConfig({
    scanEnabled: false, scanIntervalSeconds: 60, scanSettleMs: 800, marketPriceFloorRatio: 0.85,
    items: [{ id: "minecraft:redstone_block", query: " redstone block ", enabled: false }]
  }), {
    scanEnabled: false, scanIntervalSeconds: 60, scanSettleMs: 800, marketPriceFloorRatio: 0.85,
    items: [{ id: "minecraft:redstone_block", query: "redstone block", enabled: false }]
  });
});

test("rejects unsafe interval and duplicate items", () => {
  assert.throws(() => normalizeRuntimeConfig({ scanIntervalSeconds: 2, items: [] }), /scanIntervalSeconds/);
  assert.throws(() => normalizeRuntimeConfig({ marketPriceFloorRatio: 1.1, items: [] }), /marketPriceFloorRatio/);
  assert.throws(() => normalizeRuntimeConfig({ items: [
    { id: "minecraft:stone", query: "stone" }, { id: "minecraft:stone", query: "stone 2" }
  ] }), /duplicate/);
});
