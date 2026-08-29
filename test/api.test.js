"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { accountInput, observationInput } = require("../src/api");

test("normalizes UI-managed Minecraft account input", () => {
  assert.deepEqual(accountInput({ label: " Bot A ", username: " user@example.com ", authType: "MICROSOFT" }), {
    label: "Bot A", username: "user@example.com", authType: "microsoft", enabled: true
  });
});

test("rejects invalid account input", () => {
  assert.throws(() => accountInput({ username: "user", authType: "microsoft" }), /label/);
  assert.throws(() => accountInput({ label: "Bot", username: "user", authType: "password" }), /authType/);
});

test("validates normalized collector observations", () => {
  assert.deepEqual(observationInput({
    botId: "collector-1", itemId: "minecraft:stone", query: "stone",
    windowTitle: "Orders (Page 1)", observedAt: 1_700_000_000_000,
    orders: [{ slot: 2, price: 100, delivered: 4, total: 10, remaining: 6 }]
  }), {
    botId: "collector-1", itemId: "minecraft:stone", query: "stone", observedAt: 1_700_000_000_000,
    orders: [{ slot: 2, price: 100, delivered: 4, total: 10, remaining: 6 }]
  });
});

test("rejects observations with an unsafe title or remaining quantity", () => {
  const valid = {
    botId: "collector-1", itemId: "minecraft:stone", query: "stone",
    windowTitle: "Orders (Page 1)", observedAt: 1_700_000_000_000,
    orders: [{ slot: 2, price: 100, delivered: 4, total: 10, remaining: 6 }]
  };
  assert.throws(() => observationInput({ ...valid, windowTitle: "Orders (Page 2)" }), /windowTitle/);
  assert.throws(() => observationInput({ ...valid, orders: [{ ...valid.orders[0], remaining: 5 }] }), /quantities/);
});
