"use strict";

const crypto = require("node:crypto");
const express = require("express");
const path = require("node:path");

function accountInput(body) {
  const label = String(body?.label || "").trim();
  const username = String(body?.username || "").trim();
  const authType = String(body?.authType || "microsoft").toLowerCase();
  if (!label || label.length > 60) throw Object.assign(new Error("label is required and must be at most 60 characters"), { statusCode: 400 });
  if (!username || username.length > 254) throw Object.assign(new Error("username is required"), { statusCode: 400 });
  if (!["microsoft", "offline"].includes(authType)) throw Object.assign(new Error("authType must be microsoft or offline"), { statusCode: 400 });
  return { label, username, authType, enabled: body?.enabled !== false };
}

function createAccountRouter(database) {
  const router = express.Router();
  router.get("/", async (_req, res) => res.json(await database.accounts()));
  router.post("/", async (req, res) => {
    const input = accountInput(req.body);
    res.status(201).json(await database.createAccount({ ...input, id: crypto.randomUUID(), profileKey: crypto.randomUUID() }));
  });
  router.put("/:id", async (req, res) => {
    if (!await database.account(req.params.id)) return res.status(404).json({ error: "account not found" });
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
  return router;
}

function accountPage(_req, res) {
  res.sendFile(path.join(__dirname, "accounts.html"));
}

module.exports = { accountInput, accountPage, createAccountRouter };
