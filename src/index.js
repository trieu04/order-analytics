"use strict";

const express = require("express");
const { loadConfig } = require("./config");
const { createDatabase } = require("./database");
const { createCollector } = require("./collector");
const { normalizeRuntimeConfig } = require("./runtime-config");
const path = require("node:path");

async function main() {
  const config = loadConfig();
  const database = createDatabase(config.databaseUrl);
  await database.initialize();
  const envDefaults = normalizeRuntimeConfig({
    scanEnabled: true,
    scanIntervalSeconds: config.scanIntervalMs / 1000,
    scanSettleMs: config.scanSettleMs,
    items: config.items
  });
  const savedConfig = await database.getConfig();
  let runtimeConfig = normalizeRuntimeConfig(savedConfig || envDefaults, envDefaults);
  if (!savedConfig) await database.putConfig(runtimeConfig);
  const collector = createCollector({
    minecraft: config.minecraft, scanSettleMs: runtimeConfig.scanSettleMs, database
  });
  collector.connect();

  const app = express();
  app.use(express.json({ limit: "64kb" }));
  app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "ui.html")));
  app.get("/health", (_req, res) => res.json({ ok: true, ...collector.status() }));
  app.get("/config", (_req, res) => res.json(runtimeConfig));
  app.put("/config", async (req, res) => {
    const nextConfig = normalizeRuntimeConfig(req.body, runtimeConfig);
    const saved = await database.putConfig(nextConfig);
    runtimeConfig = nextConfig;
    collector.setScanSettleMs(runtimeConfig.scanSettleMs);
    resetSchedule();
    res.json(saved);
  });
  app.get("/snapshots", async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    res.json(await database.snapshots(req.query.itemId ? String(req.query.itemId) : null, limit));
  });
  app.get("/opportunities/:itemId", async (req, res) => {
    res.json(await database.opportunities(String(req.params.itemId)));
  });
  app.post("/scan", async (req, res) => {
    const item = {
      id: String(req.body?.id || "").trim(), query: String(req.body?.query || "").trim()
    };
    res.status(201).json(await collector.enqueue(item));
  });
  app.post("/scan/:itemId", async (req, res) => {
    const item = runtimeConfig.items.find(entry => entry.id === String(req.params.itemId));
    if (!item) return res.status(404).json({ error: "configured item not found" });
    res.status(201).json(await collector.enqueue(item));
  });
  app.use((error, _req, res, _next) => {
    console.error(error);
    res.status(error.statusCode || 500).json({ error: error.message || "internal error" });
  });

  const server = app.listen(config.apiPort, "0.0.0.0", () =>
    console.log(`[api] http://0.0.0.0:${config.apiPort}`));
  let scheduled = false;
  let initialTimer = null;
  let interval = null;
  async function scheduledScan() {
    const items = runtimeConfig.items.filter(item => item.enabled);
    if (scheduled || !runtimeConfig.scanEnabled || !collector.status().connected || !items.length) return;
    scheduled = true;
    try {
      for (const item of items) await collector.enqueue(item);
    } catch (error) {
      console.error(`[scheduler] ${error.message}`);
    } finally { scheduled = false; }
  }
  function resetSchedule() {
    clearTimeout(initialTimer);
    clearInterval(interval);
    initialTimer = setTimeout(scheduledScan, 5_000);
    interval = setInterval(scheduledScan, runtimeConfig.scanIntervalSeconds * 1000);
  }
  resetSchedule();

  async function shutdown() {
    clearTimeout(initialTimer);
    clearInterval(interval);
    collector.stop();
    server.close(async () => {
      await database.close();
      process.exit(0);
    });
  }
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
