"use strict";

const mineflayer = require("mineflayer");
const { componentText, itemLore, parseOrderLore, summarize } = require("./parser");

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function logText(value) {
  return componentText(value).replace(/[\r\n\t]+/g, " ").trim();
}

function stackMatchesItemId(stack, expectedId) {
  const candidates = [stack?.identifier, stack?.name]
    .filter(value => typeof value === "string" && value.trim())
    .map(value => value.includes(":") ? value : `minecraft:${value}`);
  return candidates.includes(expectedId);
}

function createCollector({ minecraft, accountId, scanSettleMs, database, logger = console,
  createBot = mineflayer.createBot, onState = () => {}, onAuthCode = () => {} }) {
  let bot = null;
  let ready = false;
  let reconnectTimer = null;
  let queue = Promise.resolve();
  let lastScan = null;
  let settleMs = scanSettleMs;
  let stopped = false;

  function connect() {
    if (stopped) return;
    clearTimeout(reconnectTimer);
    ready = false;
    bot = createBot({
      ...minecraft,
      onMsaCode(data) {
        onState("awaiting_auth");
        onAuthCode(data);
        logger.log(`[minecraft] account=${accountId || "default"} authentication required`);
      }
    });
    onState("connecting");
    bot.once("spawn", () => {
      ready = true;
      onState("connected", { minecraftUsername: bot.username });
      logger.log(`[minecraft] Connected as ${bot.username} to ${minecraft.host}:${minecraft.port}`);
    });
    bot.on("kicked", reason => logger.error(`[minecraft] Kicked: ${componentText(reason)}`));
    bot.on("error", error => logger.error(`[minecraft] ${error.message}`));
    bot.on("message", message => {
      const text = logText(message);
      if (text) logger.log(`[minecraft] Server: ${text}`);
    });
    bot.once("end", reason => {
      ready = false;
      if (stopped) return;
      onState("reconnecting", { lastError: String(reason) });
      logger.error(`[minecraft] Disconnected: ${reason}; reconnecting in 10s`);
      reconnectTimer = setTimeout(connect, 10_000);
    });
  }

  async function waitForOrdersWindow(timeoutMs = 10_000) {
    return new Promise((resolve, reject) => {
      let timer;
      const cleanup = () => {
        clearTimeout(timer);
        bot?.removeListener("windowOpen", onWindow);
      };
      const onWindow = window => {
        if (!componentText(window?.title).trim().includes("Orders (Page 1)")) return;
        cleanup();
        resolve(window);
      };
      bot.on("windowOpen", onWindow);
      timer = setTimeout(() => {
        cleanup();
        reject(new Error("Timed out waiting for Orders (Page 1)"));
      }, timeoutMs);
    });
  }

  async function scanNow(item) {
    if (!ready || !bot) throw Object.assign(new Error("Minecraft bot is not connected"), { statusCode: 503 });
    if (!item?.id || !item?.query) throw Object.assign(new Error("item id and query are required"), { statusCode: 400 });
    if (bot.currentWindow) {
      logger.log(`[minecraft] Action: close window ${logText(bot.currentWindow.title) || bot.currentWindow.id}`);
      bot.closeWindow(bot.currentWindow);
    }

    logger.log(`[minecraft] Action: send /order ${item.query}`);
    const windowPromise = waitForOrdersWindow();
    bot.chat(`/order ${item.query}`);
    const window = await windowPromise;
    logger.log(`[minecraft] Action: opened ${logText(window.title)}`);
    try {
      await wait(settleMs);
      const orders = [];
      for (let slot = 0; slot < window.inventoryStart; slot++) {
        const stack = window.slots[slot];
        if (!stackMatchesItemId(stack, item.id)) continue;
        const parsed = parseOrderLore(itemLore(stack));
        if (parsed) orders.push({ slot, ...parsed });
      }
      if (!orders.length) throw new Error(`No order rows parsed for ${item.query}`);
      const observedAt = Date.now();
      const result = await database.addSnapshot({
        botId: accountId || bot.username, itemId: item.id, query: item.query, observedAt, orders
      });
      lastScan = { itemId: item.id, query: item.query, observedAt, ...summarize(orders) };
      logger.log(`[scan] ${item.id}: best=${result.bestPrice}, volume=${result.totalVolume}, orders=${orders.length}`);
      return result;
    } finally {
      if (bot.currentWindow?.id === window.id) {
        logger.log(`[minecraft] Action: close window ${logText(window.title) || window.id}`);
        bot.closeWindow(window);
      }
    }
  }

  function enqueue(item) {
    const task = queue.catch(() => {}).then(() => scanNow(item));
    queue = task;
    return task;
  }

  function stop() {
    stopped = true;
    clearTimeout(reconnectTimer);
    ready = false;
    onState("disconnected");
    if (bot) logger.log("[minecraft] Action: disconnect collector shutdown");
    if (typeof bot?.quit === "function") bot.quit("collector shutdown");
    else if (typeof bot?.end === "function") bot.end("collector shutdown");
    else if (typeof bot?._client?.end === "function") bot._client.end("collector shutdown");
  }

  return {
    connect, enqueue, stop,
    setScanSettleMs: value => { settleMs = value; },
    status: () => ({ connected: ready, username: bot?.username || null, lastScan })
  };
}

module.exports = { createCollector, stackMatchesItemId };
