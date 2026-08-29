"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { componentText, itemLore, parseOrderLore, summarize } = require("../src/parser");

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

test("rejects malformed or over-delivered order", () => {
  assert.equal(parseOrderLore(["$ 1K each", "2k/1k Delivered"]), null);
  assert.equal(parseOrderLore(["$ 1K each"]), null);
  assert.equal(parseOrderLore(["$ 1.2.3 each", "0/10 Delivered"]), null);
});
