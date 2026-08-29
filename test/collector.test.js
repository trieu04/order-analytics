"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createCollector, randomizedPreScanDelayMs, stackMatchesItemId } = require("../src/collector");

function fakeBot() {
  const bot = new EventEmitter();
  bot.username = "collector";
  bot.currentWindow = null;
  bot.chat = command => {
    bot.lastCommand = command;
    const window = {
      id: 3,
      title: { type: "compound", value: {
        text: { type: "string", value: "Orders (Page 1)" }
      } },
      inventoryStart: 0,
      slots: []
    };
    setTimeout(() => { bot.currentWindow = window; bot.emit("windowOpen", window); }, 10);
  };
  bot.closeWindow = window => {
    bot.closedWindow = window;
    bot.currentWindow = null;
  };
  bot.quit = reason => { bot.quitReason = reason; };
  return bot;
}

test("registers and removes windowOpen listener around the order command", async () => {
  const bot = fakeBot();
  const collector = createCollector({
    minecraft: { host: "localhost", port: 25565 },
    scanSettleMs: 0,
    observationClient: { submit: async () => ({}) },
    logger: { log() {}, error() {} },
    createBot: () => bot
  });

  collector.connect();
  bot.emit("spawn");
  await assert.rejects(collector.enqueue({ id: "minecraft:stone", query: "stone" }), /No order rows/);

  assert.equal(bot.lastCommand, "/order stone");
  assert.equal(bot.listenerCount("windowOpen"), 0);
  assert.equal(bot.closedWindow.id, 3);
});

test("matches Mineflayer stack names against namespaced item ids", () => {
  assert.equal(stackMatchesItemId({ name: "redstone_block" }, "minecraft:redstone_block"), true);
  assert.equal(stackMatchesItemId({ identifier: "minecraft:redstone_block" }, "minecraft:redstone_block"), true);
  assert.equal(stackMatchesItemId({ name: "redstone" }, "minecraft:redstone_block"), false);
  assert.equal(stackMatchesItemId(null, "minecraft:redstone_block"), false);
});

test("adds bounded jitter before starting a scan", () => {
  assert.equal(randomizedPreScanDelayMs(() => 0), 0);
  assert.equal(randomizedPreScanDelayMs(() => 0.999999), 350);
});

test("only stores order rows whose stack id matches the requested item", async () => {
  const bot = fakeBot();
  let stored;
  bot.chat = command => {
    bot.lastCommand = command;
    setTimeout(() => { const window = {
      id: 4,
      title: "Orders (Page 1)",
      inventoryStart: 2,
      slots: [
        { name: "stone", customLore: ["$ 2K each", "0/10 Delivered"] },
        { name: "dirt", customLore: ["$ 9K each", "0/99 Delivered"] }
      ]
    }; bot.currentWindow = window; bot.emit("windowOpen", window); }, 10);
  };
  const collector = createCollector({
    minecraft: { host: "localhost", port: 25565 },
    scanSettleMs: 0,
    observationClient: { submit: async snapshot => { stored = snapshot; return { bestPrice: 2000, totalVolume: 10 }; } },
    logger: { log() {}, error() {} },
    createBot: () => bot
  });

  collector.connect();
  bot.emit("spawn");
  await collector.enqueue({ id: "minecraft:stone", query: "stone" });

  assert.equal(stored.windowTitle, "Orders (Page 1)");
  assert.deepEqual(stored.orders, [
    { slot: 0, price: 2000, delivered: 0, total: 10, remaining: 10 }
  ]);
  assert.equal(bot.closedWindow.id, 4);
});
