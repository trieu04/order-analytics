"use strict";

const crypto = require("node:crypto");
const express = require("express");
const fs = require("node:fs");
const path = require("node:path");
const { CACHE_FILES, LOG_FILE, cacheFilename, profileFile, tailLog, writeCacheFile } = require("./files");

function accountInput(body) {
  const label = String(body?.label || "").trim();
  const username = String(body?.username || "").trim();
  const authType = String(body?.authType || "microsoft").toLowerCase();
  if (!label || label.length > 60) throw Object.assign(new Error("label is required and must be at most 60 characters"), { statusCode: 400 });
  if (!username || username.length > 254) throw Object.assign(new Error("username is required"), { statusCode: 400 });
  if (!["microsoft", "offline"].includes(authType)) throw Object.assign(new Error("authType must be microsoft or offline"), { statusCode: 400 });
  return { label, username, authType, enabled: body?.enabled !== false };
}

function createAccountRouter(database, options = {}) {
  const router = express.Router();
  const profilesFolder = options.profilesFolder || "./profiles";
  const findAccount = async id => {
    const account = await database.account(id);
    if (!account) throw Object.assign(new Error("account not found"), { statusCode: 404 });
    return account;
  };
  router.get("/", async (_req, res) => res.json(await database.accounts()));
  router.post("/", async (req, res) => {
    const input = accountInput(req.body);
    res.status(201).json(await database.createAccount({ ...input, id: crypto.randomUUID(), profileKey: crypto.randomUUID() }));
  });
  router.put("/:id", async (req, res) => {
    const current = (await database.accounts()).find(account => account.id === req.params.id);
    if (!current) return res.status(404).json({ error: "account not found" });
    if (!["disconnected", "collector_offline", "error"].includes(current.state))
      return res.status(409).json({ error: "disconnect account before editing it" });
    res.json(await database.updateAccount(req.params.id, accountInput(req.body)));
  });
  router.delete("/:id", async (req, res) => {
    const current = (await database.accounts()).find(account => account.id === req.params.id);
    if (!current) return res.status(404).json({ error: "account not found" });
    if (!["disconnected", "collector_offline", "error"].includes(current.state))
      return res.status(409).json({ error: "disconnect account before deleting it" });
    await database.deleteAccount(req.params.id);
    res.status(204).end();
  });
  for (const command of ["login", "disconnect", "clear-session"]) {
    router.post(`/:id/${command}`, async (req, res) => {
      if (!await database.account(req.params.id)) return res.status(404).json({ error: "account not found" });
      res.status(202).json(await database.addAccountCommand(req.params.id,
        command === "login" ? "connect" : command.replace("-", "_")));
    });
  }
  router.get("/:id/login-challenge", async (req, res) =>
    res.json(await database.loginChallenge(req.params.id) || {}));
  router.get("/:id/files/:name", async (req, res) => {
    const account = await findAccount(req.params.id);
    if (!CACHE_FILES.has(req.params.name)) return res.status(400).json({ error: "unsupported cache file" });
    const downloadName = cacheFilename(account.username, req.params.name);
    const filename = profileFile(profilesFolder, account.profileKey, downloadName);
    if (!fs.existsSync(filename)) return res.status(404).json({ error: "cache file not found" });
    res.download(filename, downloadName);
  });
  router.put("/:id/files/:name", express.raw({ type: "application/octet-stream", limit: "5mb" }), async (req, res) => {
    const account = await findAccount(req.params.id);
    if (!CACHE_FILES.has(req.params.name)) return res.status(400).json({ error: "unsupported cache file" });
    const summary = (await database.accounts()).find(item => item.id === account.id);
    if (!summary || !["disconnected", "collector_offline", "error"].includes(summary.state))
      return res.status(409).json({ error: "disconnect account before importing cache" });
    writeCacheFile(profileFile(profilesFolder, account.profileKey,
      cacheFilename(account.username, req.params.name)), req.body);
    res.status(204).end();
  });
  router.get("/:id/log", async (req, res) => {
    const account = await findAccount(req.params.id);
    res.type("text/plain").send(tailLog(profileFile(profilesFolder, account.profileKey, LOG_FILE)));
  });
  router.get("/:id/log/download", async (req, res) => {
    const account = await findAccount(req.params.id);
    const filename = profileFile(profilesFolder, account.profileKey, LOG_FILE);
    if (!fs.existsSync(filename)) return res.status(404).json({ error: "account log not found" });
    res.download(filename, `${account.label.replace(/[^a-z0-9_-]+/gi, "-") || "account"}.log`);
  });
  return router;
}

function accountPage(_req, res) {
  res.sendFile(path.join(__dirname, "accounts.html"));
}

module.exports = { accountInput, accountPage, createAccountRouter };
