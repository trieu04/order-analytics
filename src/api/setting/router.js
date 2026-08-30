"use strict";

const express = require("express");
const path = require("node:path");
const { normalizeSetting } = require("./setting");

function createSettingRouter(database, initialSetting) {
  const router = express.Router();
  let setting = initialSetting;
  router.get("/", (_req, res) => res.json(setting));
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
