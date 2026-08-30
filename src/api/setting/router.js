"use strict";

const express = require("express");
const path = require("node:path");
const { normalizeSetting } = require("./setting");

function createSettingRouter(database, initialSetting, itemCatalog) {
  const router = express.Router();
  let setting = initialSetting;
  router.get("/", (_req, res) => res.json(setting));
  router.get("/items", (req, res) => {
    const ids = String(req.query.ids || "").split(",").map(value => value.trim()).filter(Boolean);
    if (ids.length > 200) throw Object.assign(new Error("ids must contain at most 200 entries"), { statusCode: 400 });
    res.json(ids.length ? itemCatalog.find(ids) : itemCatalog.search(req.query.q));
  });
  router.put("/", async (req, res) => {
    const next = normalizeSetting(req.body, setting);
    const saved = await database.putConfig(next);
    setting = next;
    res.json(saved);
  });
  return { router, getSetting: () => setting };
}

function settingPage(_req, res) {
  res.sendFile(path.join(__dirname, "settings.html"));
}

module.exports = { createSettingRouter, settingPage };
