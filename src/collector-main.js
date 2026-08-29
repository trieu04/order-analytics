"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { loadConfig } = require("./config");
const { createDatabase } = require("./database");
const { createCollector } = require("./collector");
const { createObservationClient } = require("./observation-client");

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const config = loadConfig();
  const database = createDatabase(config.databaseUrl);
  await database.initialize();
  await database.seedLegacyAccount(config.legacyAccount);
  await database.recoverCollectorWork();
  const observationClient = createObservationClient(config.internalApiUrl);
  const workers = new Map();
  let stopping = false;
  let nextScheduledAt = 0;
  let nextHeartbeatAt = 0;

  async function start(account) {
    if (workers.has(account.id) || !account.enabled) return;
    const profilesFolder = path.join(config.minecraft.profilesFolder, String(account.profileKey));
    const worker = createCollector({ accountId: account.id, observationClient, scanSettleMs: config.scanSettleMs,
      minecraft: { ...config.minecraft, username: account.username, auth: account.authType, profilesFolder },
      onState: (state, details) => database.putAccountStatus(account.id, state, details)
        .catch(error => console.error(`[minecraft] ${error.message}`)),
      onAuthCode: data => database.putLoginChallenge(account.id, data)
        .catch(error => console.error(`[minecraft] ${error.message}`)) });
    workers.set(account.id, { worker, busy: false, currentItemId: null });
    worker.connect();
  }

  async function stop(accountId) {
    const entry = workers.get(accountId);
    if (entry) entry.worker.stop();
    workers.delete(accountId);
    await database.clearLoginChallenge(accountId);
    await database.putAccountStatus(accountId, "disconnected");
  }

  async function processCommands() {
    for (const command of await database.claimAccountCommands()) {
      try {
        const account = await database.account(command.accountId);
        if (!account) throw new Error("account not found");
        if (command.command === "connect") await start(account);
        else if (command.command === "disconnect") await stop(account.id);
        else {
          await stop(account.id);
          fs.rmSync(path.join(config.minecraft.profilesFolder, String(account.profileKey)), { recursive: true, force: true });
        }
        await database.finishAccountCommand(command.id);
      } catch (error) { await database.finishAccountCommand(command.id, error.message); }
    }
  }

  async function schedule() {
    const runtime = await database.getConfig();
    if (!runtime?.scanEnabled || Date.now() < nextScheduledAt) return;
    nextScheduledAt = Date.now() + runtime.scanIntervalSeconds * 1000;
    for (const item of runtime.items.filter(item => item.enabled))
      await database.enqueueScan({ itemId: item.id, query: item.query, source: "scheduled" });
    for (const entry of workers.values()) entry.worker.setScanSettleMs(runtime.scanSettleMs);
  }

  async function dispatch() {
    for (const [accountId, entry] of workers) {
      if (entry.busy || !entry.worker.status().connected) continue;
      const job = await database.claimScan(accountId);
      if (!job) continue;
      entry.busy = true;
      entry.currentItemId = job.itemId;
      database.putAccountStatus(accountId, "scanning", { currentItemId: job.itemId }).catch(() => {});
      entry.worker.enqueue({ id: job.itemId, query: job.query }).then(async result => {
        await database.finishScan(job.id, result.snapshotId);
        await database.putAccountStatus(accountId, "connected", { lastScanAt: new Date() });
      }).catch(async error => {
        await database.finishScan(job.id, null, error.message);
        await database.putAccountStatus(accountId, entry.worker.status().connected ? "connected" : "reconnecting",
          { lastError: error.message });
      }).finally(() => { entry.busy = false; entry.currentItemId = null; });
    }
  }

  async function heartbeat() {
    if (Date.now() < nextHeartbeatAt) return;
    nextHeartbeatAt = Date.now() + 10_000;
    for (const [accountId, entry] of workers) {
      const status = entry.worker.status();
      await database.putAccountStatus(accountId, entry.busy ? "scanning" : status.connected ? "connected" : "reconnecting",
        { currentItemId: entry.currentItemId });
    }
  }

  function shutdown() { stopping = true; }
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  for (const summary of await database.accounts()) {
    const account = await database.account(summary.id);
    if (account?.enabled) await start(account);
  }
  while (!stopping) {
    try { await processCommands(); await schedule(); await dispatch(); await heartbeat(); }
    catch (error) { console.error(`[scheduler] ${error.message}`); }
    await wait(1000);
  }
  for (const accountId of [...workers.keys()]) await stop(accountId);
  await database.close();
}

if (require.main === module) main().catch(error => { console.error(`[minecraft] ${error.stack || error}`); process.exit(1); });
module.exports = { main };
