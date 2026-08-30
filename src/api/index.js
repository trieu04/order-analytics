"use strict";

const express = require("express");
const { createDatabase } = require("../shared/database");
const { loadConfig } = require("../shared/config");
const { createLogger } = require("../shared/logger");
const { createAccountRouter, accountInput, accountPage } = require("./account/router");
const { createAnalyticRouter, dashboardPage, observationInput } = require("./analytic/router");
const { createSettingRouter, settingPage } = require("./setting/router");
const { normalizeSetting } = require("./setting/setting");

const logger = createLogger("api");

async function main() {
  const config = loadConfig();
  const database = createDatabase(config.databaseUrl);
  await database.initialize();
  await database.seedLegacyAccount(config.legacyAccount);
  const defaults = normalizeSetting({
    scanEnabled: true, scanIntervalSeconds: config.scanIntervalMs / 1000,
    scanSettleMs: config.scanSettleMs, scanDelayMs: config.scanDelayMs, items: config.items
  });
  const stored = await database.getConfig();
  const initialSetting = normalizeSetting(stored || defaults, defaults);
  if (!stored) await database.putConfig(initialSetting);

  const app = express();
  app.use(express.json({ limit: "64kb" }));
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  const settingModule = createSettingRouter(database, initialSetting);
  app.get("/", dashboardPage);
  app.get("/accounts", accountPage);
  app.get("/settings", settingPage);
  app.use("/api/settings", settingModule.router);
  app.use("/api/accounts", createAccountRouter(database, { profilesFolder: config.minecraft.profilesFolder }));
  app.use("/api/analytics", createAnalyticRouter(database, settingModule.getSetting));
  app.use((error, _req, res, _next) => {
    logger.error(error.message);
    res.status(error.statusCode || (error.code === "23505" ? 409 : 500))
      .json({ error: error.message || "internal error" });
  });

  const server = app.listen(config.apiPort, "0.0.0.0", () => logger.info(`http://0.0.0.0:${config.apiPort}`));
  const shutdown = () => server.close(async () => {
    logger.info("Shutting down...");
    await database.close();
    process.exit(0);
  });
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (require.main === module) main().catch(error => { logger.error(error); process.exit(1); });
module.exports = { accountInput, observationInput, main };
