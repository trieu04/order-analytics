"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { accountInput } = require("../src/api");

test("normalizes UI-managed Minecraft account input", () => {
  assert.deepEqual(accountInput({ label: " Bot A ", username: " user@example.com ", authType: "MICROSOFT" }), {
    label: "Bot A", username: "user@example.com", authType: "microsoft", enabled: true
  });
});

test("rejects invalid account input", () => {
  assert.throws(() => accountInput({ username: "user", authType: "microsoft" }), /label/);
  assert.throws(() => accountInput({ label: "Bot", username: "user", authType: "password" }), /authType/);
});
