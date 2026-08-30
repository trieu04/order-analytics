"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeSetting } = require("../src/api/setting/setting");

test("normalizes dynamic scheduler and item setting", () => {
  assert.deepEqual(normalizeSetting({
    scanEnabled: false, scanIntervalSeconds: 60, scanSettleMs: 800, scanDelayMs: 2400, marketPriceFloorRatio: 0.85,
    items: [{ id: "minecraft:redstone_block", query: " redstone block ", enabled: false }]
  }), {
    scanEnabled: false, scanIntervalSeconds: 60, scanSettleMs: 800, scanDelayMs: 2400, marketPriceFloorRatio: 0.85,
    items: [{ id: "minecraft:redstone_block", query: "redstone block", enabled: false }]
  });
});

test("rejects unsafe interval and duplicate items", () => {
  assert.throws(() => normalizeSetting({ scanIntervalSeconds: 2, items: [] }), /scanIntervalSeconds/);
  assert.throws(() => normalizeSetting({ scanDelayMs: 60001, items: [] }), /scanDelayMs/);
  assert.throws(() => normalizeSetting({ marketPriceFloorRatio: 1.1, items: [] }), /marketPriceFloorRatio/);
  assert.throws(() => normalizeSetting({ items: [
    { id: "minecraft:stone", query: "stone" }, { id: "minecraft:stone", query: "stone 2" }
  ] }), /duplicate/);
});
