"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { componentText, itemLore, parseOrderLore, summarize } = require("../src/collector/parser");

test("renders modern JSON chat components", () => {
  assert.equal(componentText('{"text":"$ ","extra":[{"text":"1.8K "},{"text":"each"}]}'), "$ 1.8K each");
});

test("renders NBT chat components used by modern window titles", () => {
  assert.equal(componentText({
    type: "compound",
    value: {
      text: { type: "string", value: "Orders " },
      extra: { type: "list", value: {
        type: "compound",
        value: [{ text: { type: "string", value: "(Page 1)" } }]
      } }
    }
  }), "Orders (Page 1)");
});

test("reads prismarine Item customLore and parses order progress", () => {
  const item = { customLore: [
    '""',
    '{"extra":[{"text":"$ "},{"text":"1.8K "},{"text":"each"}],"text":""}',
    '{"extra":[{"text":"451/2k Delivered"}],"text":""}'
  ] };
  assert.deepEqual(parseOrderLore(itemLore(item)), {
    price: 1800, delivered: 451, total: 2000, remaining: 1549
  });
});

test("preserves decimal prices from order lore", () => {
  assert.deepEqual(parseOrderLore(["$ 12.5 each", "2/10 Delivered"]), {
    price: 12.5, delivered: 2, total: 10, remaining: 8
  });
  assert.deepEqual(parseOrderLore(["$ 1,234.5 each", "0/10 Delivered"]), {
    price: 1234.5, delivered: 0, total: 10, remaining: 10
  });
});

test("summarizes best price and remaining market volume", () => {
  const result = summarize([
    { price: 1800, delivered: 451, total: 2000, remaining: 1549 },
    { price: 1700, delivered: 42700, total: 1000000, remaining: 957300 }
  ]);
  assert.equal(result.bestPrice, 1800);
  assert.equal(result.bestPriceVolume, 1549);
  assert.equal(result.totalVolume, 958849);
  assert.ok(result.weightedPrice > 1700 && result.weightedPrice < 1800);
});

test("filters low price noise and calculates delivered-weighted market price", () => {
  const result = summarize([
    { price: 10, delivered: 1, total: 101, remaining: 100 },
    { price: 100, delivered: 10, total: 60, remaining: 50 },
    { price: 110, delivered: 10, total: 40, remaining: 30 },
    { price: 120, delivered: 0, total: 20, remaining: 20 }
  ], 0.8);
  assert.equal(result.marketMaxPrice, 120);
  assert.equal(result.marketMaxPriceQueue, 20);
  assert.equal(result.marketMaxPriceDelivered, 0);
  assert.equal(result.marketMaxPriceVolume, 20);
  assert.equal(result.marketAveragePrice, 105);
  assert.equal(result.marketSampleOrderCount, 3);
  assert.equal(result.marketSampleDelivered, 20);
  assert.equal(result.marketSampleVolume, 120);
  assert.equal(result.higherThanAverageQueue, 50);
  assert.equal(result.higherThanAverageDelivered, 10);
  assert.equal(result.higherThanAverageVolume, 60);
});

test("returns no market price when no order has delivered items", () => {
  const result = summarize([{ price: 100, delivered: 0, total: 10, remaining: 10 }]);
  assert.equal(result.marketMaxPrice, null);
  assert.equal(result.marketAveragePrice, null);
  assert.equal(result.marketSampleOrderCount, 0);
  assert.equal(result.marketSampleDelivered, 0);
  assert.equal(result.marketSampleVolume, 0);
  assert.equal(result.marketMaxPriceQueue, 0);
  assert.equal(result.marketMaxPriceDelivered, 0);
  assert.equal(result.marketMaxPriceVolume, 0);
  assert.equal(result.higherThanAverageQueue, 0);
  assert.equal(result.higherThanAverageDelivered, 0);
  assert.equal(result.higherThanAverageVolume, 0);
});

test("rejects malformed or over-delivered order", () => {
  assert.equal(parseOrderLore(["$ 1K each", "2k/1k Delivered"]), null);
  assert.equal(parseOrderLore(["$ 1K each"]), null);
  assert.equal(parseOrderLore(["$ 1.2.3 each", "0/10 Delivered"]), null);
});
