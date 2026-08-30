"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createItemCatalog } = require("../src/api/setting/item-catalog");

test("searches Minecraft item metadata and images", () => {
  const catalog = createItemCatalog("1.21.4");
  const [item] = catalog.search("redstone block");
  assert.equal(item.id, "minecraft:redstone_block");
  assert.equal(item.name, "Block of Redstone");
  assert.equal(item.query, "redstone block");
  assert.match(item.image, /^data:image\/png;base64,/);
});

test("finds configured items by namespaced id", () => {
  const catalog = createItemCatalog("1.21.4");
  assert.deepEqual(catalog.find(["minecraft:stone", "custom:missing"]).map(item => item.id), ["minecraft:stone"]);
});
