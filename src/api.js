"use strict";

const crypto = require("node:crypto");
const express = require("express");
const path = require("node:path");
const { loadConfig } = require("./config");
const { createDatabase } = require("./database");
const { normalizeRuntimeConfig } = require("./runtime-config");

function accountInput(body) {
  const label = String(body?.label || "").trim();
  const username = String(body?.username || "").trim();
  const authType = String(body?.authType || "microsoft").toLowerCase();
  if (!label || label.length > 60) throw Object.assign(new Error("label is required and must be at most 60 characters"), { statusCode: 400 });
  if (!username || username.length > 254) throw Object.assign(new Error("username is required"), { statusCode: 400 });
  if (!["microsoft", "offline"].includes(authType)) throw Object.assign(new Error("authType must be microsoft or offline"), { statusCode: 400 });
  return { label, username, authType, enabled: body?.enabled !== false };
}

function observationInput(body) {
  const fail = message => { throw Object.assign(new Error(message), { statusCode: 400 }); };
  const botId = String(body?.botId || "").trim();
  const itemId = String(body?.itemId || "").trim();
  const query = String(body?.query || "").trim();
  const observedAt = Number(body?.observedAt);
  if (!botId || botId.length > 100) fail("botId is required and must be at most 100 characters");
  if (!/^minecraft:[a-z0-9_.-]+$/.test(itemId)) fail("invalid itemId");
  if (!query || query.length > 100) fail("query is required and must be at most 100 characters");
  if (body?.windowTitle !== "Orders (Page 1)") fail("windowTitle must be Orders (Page 1)");
  if (!Number.isSafeInteger(observedAt) || observedAt <= 0) fail("observedAt must be a positive epoch millisecond integer");
  if (!Array.isArray(body?.orders) || body.orders.length < 1 || body.orders.length > 200)
    fail("orders must contain from 1 to 200 entries");
  const slots = new Set();
  const orders = body.orders.map((order, index) => {
    const slot = Number(order?.slot);
    const price = Number(order?.price);
    const delivered = Number(order?.delivered);
    const total = Number(order?.total);
    const remaining = Number(order?.remaining);
    if (!Number.isInteger(slot) || slot < 0 || slot > 255 || slots.has(slot)) fail(`invalid or duplicate slot at index ${index}`);
    if (!Number.isFinite(price) || price <= 0) fail(`invalid price at index ${index}`);
    if (!Number.isSafeInteger(delivered) || delivered < 0 || !Number.isSafeInteger(total) || total <= 0 ||
        !Number.isSafeInteger(remaining) || remaining !== total - delivered || remaining < 0)
      fail(`invalid quantities at index ${index}`);
    slots.add(slot);
    return { slot, price, delivered, total, remaining };
  });
  return { botId, itemId, query, observedAt, orders };
}

async function main() {
  const config = loadConfig();
  const database = createDatabase(config.databaseUrl);
  await database.initialize();
  await database.seedLegacyAccount(config.legacyAccount);
  const defaults = normalizeRuntimeConfig({ scanEnabled: true, scanIntervalSeconds: config.scanIntervalMs / 1000,
    scanSettleMs: config.scanSettleMs, items: config.items });
  const stored = await database.getConfig();
  let runtimeConfig = normalizeRuntimeConfig(stored || defaults, defaults);
  if (!stored) await database.putConfig(runtimeConfig);
  const app = express();
  app.use(express.json({ limit: "64kb" }));
  app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "ui.html")));
  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.get("/config", (_req, res) => res.json(runtimeConfig));
  app.put("/config", async (req, res) => {
    const next = normalizeRuntimeConfig(req.body, runtimeConfig);
    const saved = await database.putConfig(next);
    runtimeConfig = next;
    res.json(saved);
  });
  app.get("/minecraft/accounts", async (_req, res) => res.json(await database.accounts()));
  app.post("/minecraft/accounts", async (req, res) => {
    const input = accountInput(req.body);
    res.status(201).json(await database.createAccount({ ...input, id: crypto.randomUUID(), profileKey: crypto.randomUUID() }));
  });
  app.put("/minecraft/accounts/:id", async (req, res) => {
    if (!await database.account(req.params.id)) return res.status(404).json({ error: "account not found" });
    res.json(await database.updateAccount(req.params.id, accountInput(req.body)));
  });
  app.delete("/minecraft/accounts/:id", async (req, res) => {
    const current = (await database.accounts()).find(account => account.id === req.params.id);
    if (!current) return res.status(404).json({ error: "account not found" });
    if (!["disconnected", "collector_offline", "error"].includes(current.state))
      return res.status(409).json({ error: "disconnect account before deleting it" });
    await database.deleteAccount(req.params.id);
    res.status(204).end();
  });
  for (const command of ["login", "disconnect", "clear-session"]) {
    app.post(`/minecraft/accounts/:id/${command}`, async (req, res) => {
      if (!await database.account(req.params.id)) return res.status(404).json({ error: "account not found" });
      res.status(202).json(await database.addAccountCommand(req.params.id,
        command === "login" ? "connect" : command.replace("-", "_")));
    });
  }
  app.get("/minecraft/accounts/:id/login-challenge", async (req, res) =>
    res.json(await database.loginChallenge(req.params.id) || {}));
  app.post("/internal/observations", async (req, res) =>
    res.status(201).json(await database.addSnapshot(observationInput(req.body))));
  app.get("/snapshots", async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    res.json(await database.snapshots(req.query.itemId ? String(req.query.itemId) : null, limit));
  });
  app.get("/opportunities/:itemId", async (req, res) => res.json(await database.opportunities(String(req.params.itemId))));
  app.post("/scan", async (req, res) => {
    const item = { id: String(req.body?.id || "").trim(), query: String(req.body?.query || "").trim() };
    if (!item.id || !item.query) throw Object.assign(new Error("item id and query are required"), { statusCode: 400 });
    res.status(202).json(await database.enqueueScan({ itemId: item.id, query: item.query, source: "manual" }));
  });
  app.post("/scan/:itemId", async (req, res) => {
    const item = runtimeConfig.items.find(entry => entry.id === String(req.params.itemId));
    if (!item) return res.status(404).json({ error: "configured item not found" });
    res.status(202).json(await database.enqueueScan({ itemId: item.id, query: item.query, source: "manual" }));
  });
  app.get("/scan-jobs/:id", async (req, res) => {
    const job = await database.scanJob(req.params.id);
    if (!job) return res.status(404).json({ error: "scan job not found" });
    res.json(job);
  });
  app.use((error, _req, res, _next) => {
    console.error(`[api] ${error.message}`);
    res.status(error.statusCode || (error.code === "23505" ? 409 : 500)).json({ error: error.message || "internal error" });
  });
  const server = app.listen(config.apiPort, "0.0.0.0", () => console.log(`[api] http://0.0.0.0:${config.apiPort}`));
  const shutdown = () => server.close(async () => { await database.close(); process.exit(0); });
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (require.main === module) main().catch(error => { console.error(`[api] ${error.stack || error}`); process.exit(1); });
module.exports = { accountInput, observationInput, main };
