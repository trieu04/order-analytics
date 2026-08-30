"use strict";

const express = require("express");
const path = require("node:path");

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

function createAnalyticRouter(database, getSetting) {
  const router = express.Router();
  router.post("/observations", async (req, res) =>
    res.status(201).json(await database.addSnapshot(observationInput(req.body))));
  router.get("/snapshots", async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 5000);
    const parseDate = (value, name) => {
      if (value == null || value === "") return null;
      const date = new Date(String(value));
      if (Number.isNaN(date.getTime()))
        throw Object.assign(new Error(`${name} must be a valid date`), { statusCode: 400 });
      return date;
    };
    const from = parseDate(req.query.from, "from");
    const to = parseDate(req.query.to, "to");
    if (from && to && from > to)
      throw Object.assign(new Error("from must not be after to"), { statusCode: 400 });
    res.json(await database.snapshots(req.query.itemId ? String(req.query.itemId) : null, limit, { from, to }));
  });
  router.get("/opportunities/:itemId", async (req, res) =>
    res.json(await database.opportunities(String(req.params.itemId))));
  router.post("/scans", async (req, res) => {
    const item = { id: String(req.body?.id || "").trim(), query: String(req.body?.query || "").trim() };
    if (!item.id || !item.query) throw Object.assign(new Error("item id and query are required"), { statusCode: 400 });
    res.status(202).json(await database.enqueueScan({ itemId: item.id, query: item.query, source: "manual" }));
  });
  router.post("/scans/:itemId", async (req, res) => {
    const item = getSetting().items.find(entry => entry.id === String(req.params.itemId));
    if (!item) return res.status(404).json({ error: "configured item not found" });
    res.status(202).json(await database.enqueueScan({ itemId: item.id, query: item.query, source: "manual" }));
  });
  router.get("/scan-jobs/:id", async (req, res) => {
    const job = await database.scanJob(req.params.id);
    if (!job) return res.status(404).json({ error: "scan job not found" });
    res.json(job);
  });
  return router;
}

function dashboardPage(_req, res) {
  res.sendFile(path.join(__dirname, "dashboard.html"));
}

module.exports = { createAnalyticRouter, dashboardPage, observationInput };
