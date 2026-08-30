"use strict";

const crypto = require("node:crypto");
const { and, eq, gt } = require("drizzle-orm");
const { summarize } = require("../../collector/parser");
const schema = require("./schema");

const { appConfig, minecraftAccountCommands, minecraftAccounts,
  minecraftLoginChallenges, orderEntries, orderSnapshots, scanJobs } = schema;

function createRepository(db, query) {

  const initialize = (...args) => query.initialize(...args);

  async function getConfig() {
    const [row] = await db.select().from(appConfig).where(eq(appConfig.id, 1)).limit(1);
    return row ? { ...row.value, updatedAt: row.updatedAt } : null;
  }

  async function putConfig(value) {
    const [row] = await db.insert(appConfig).values({ id: 1, value, updatedAt: new Date() })
      .onConflictDoUpdate({ target: appConfig.id, set: { value, updatedAt: new Date() } }).returning();
    return { ...row.value, updatedAt: row.updatedAt };
  }

  async function seedLegacyAccount(account) {
    if (!account) return;
    const [existing] = await db.select({ id: minecraftAccounts.id }).from(minecraftAccounts).limit(1);
    if (existing) return;
    await db.insert(minecraftAccounts).values({ id: crypto.randomUUID(), label: "Collector 1",
      username: account.username, authType: account.auth, profileKey: crypto.randomUUID() }).onConflictDoNothing();
  }

  const accounts = (...args) => query.accounts(...args);

  async function account(id) {
    const [row] = await db.select({ id: minecraftAccounts.id, label: minecraftAccounts.label,
      username: minecraftAccounts.username, authType: minecraftAccounts.authType,
      enabled: minecraftAccounts.enabled, profileKey: minecraftAccounts.profileKey })
      .from(minecraftAccounts).where(eq(minecraftAccounts.id, id)).limit(1);
    return row || null;
  }

  async function createAccount({ id, label, username, authType, profileKey }) {
    const [row] = await db.insert(minecraftAccounts).values({ id, label, username, authType, profileKey })
      .returning({ id: minecraftAccounts.id, label: minecraftAccounts.label, username: minecraftAccounts.username,
        authType: minecraftAccounts.authType, enabled: minecraftAccounts.enabled });
    return row;
  }

  async function updateAccount(id, { label, username, authType, enabled }) {
    const [row] = await db.update(minecraftAccounts).set({ label, username, authType, enabled, updatedAt: new Date() })
      .where(eq(minecraftAccounts.id, id)).returning({ id: minecraftAccounts.id, label: minecraftAccounts.label,
        username: minecraftAccounts.username, authType: minecraftAccounts.authType, enabled: minecraftAccounts.enabled });
    return row || null;
  }

  async function deleteAccount(id) {
    return (await db.delete(minecraftAccounts).where(eq(minecraftAccounts.id, id)).returning({ id: minecraftAccounts.id })).length > 0;
  }

  async function addAccountCommand(accountId, command) {
    const [row] = await db.insert(minecraftAccountCommands).values({ accountId, command })
      .returning({ id: minecraftAccountCommands.id, status: minecraftAccountCommands.status });
    return row;
  }

  const claimAccountCommands = (...args) => query.claimAccountCommands(...args);

  async function finishAccountCommand(id, error = null) {
    await db.update(minecraftAccountCommands).set({ status: error ? "failed" : "succeeded", error,
      finishedAt: new Date() }).where(eq(minecraftAccountCommands.id, id));
  }

  const putAccountStatus = (...args) => query.putAccountStatus(...args);

  async function putLoginChallenge(accountId, data) {
    const expires = new Date(Date.now() + Number(data.expires_in || 900) * 1000);
    const values = { accountId, verificationUri: data.verification_uri, userCode: data.user_code,
      expiresAt: expires, updatedAt: new Date() };
    await db.insert(minecraftLoginChallenges).values(values).onConflictDoUpdate({
      target: minecraftLoginChallenges.accountId, set: values
    });
  }

  async function loginChallenge(accountId) {
    const [row] = await db.select({ verificationUri: minecraftLoginChallenges.verificationUri,
      userCode: minecraftLoginChallenges.userCode, expiresAt: minecraftLoginChallenges.expiresAt })
      .from(minecraftLoginChallenges).where(and(eq(minecraftLoginChallenges.accountId, accountId),
        gt(minecraftLoginChallenges.expiresAt, new Date()))).limit(1);
    return row || null;
  }

  async function clearLoginChallenge(accountId) {
    await db.delete(minecraftLoginChallenges).where(eq(minecraftLoginChallenges.accountId, accountId));
  }

  const enqueueScan = (...args) => query.enqueueScan(...args);

  const claimScan = (...args) => query.claimScan(...args);

  async function finishScan(id, snapshotId, error = null) {
    await db.update(scanJobs).set({ status: error ? "failed" : "succeeded", snapshotId, error,
      finishedAt: new Date() }).where(eq(scanJobs.id, id));
  }

  async function scanJob(id) {
    const [row] = await db.select({ id: scanJobs.id, itemId: scanJobs.itemId, source: scanJobs.source,
      status: scanJobs.status, claimedBy: scanJobs.claimedBy, snapshotId: scanJobs.snapshotId,
      error: scanJobs.error, createdAt: scanJobs.createdAt, finishedAt: scanJobs.finishedAt })
      .from(scanJobs).where(eq(scanJobs.id, id)).limit(1);
    return row || null;
  }

  const recoverCollectorWork = (...args) => query.recoverCollectorWork(...args);

  async function addSnapshot({ botId, itemId, query, observedAt, orders }) {
    return db.transaction(async tx => {
      const [configured] = await tx.select({ value: appConfig.value }).from(appConfig)
        .where(eq(appConfig.id, 1)).limit(1);
      const marketPriceFloorRatio = Number(configured?.value?.marketPriceFloorRatio ?? 0.8);
      const summary = summarize(orders, marketPriceFloorRatio);
      const [snapshot] = await tx.insert(orderSnapshots).values({ botId, itemId, query,
        observedAt: new Date(observedAt), bestPrice: summary.bestPrice,
        bestPriceVolume: summary.bestPriceVolume, totalVolume: summary.totalVolume,
        weightedPrice: summary.weightedPrice, fillRatio: summary.fillRatio, orderCount: summary.orderCount,
        marketMaxPrice: summary.marketMaxPrice, marketMaxPriceQueue: summary.marketMaxPriceQueue,
        marketAveragePrice: summary.marketAveragePrice, higherThanAverageQueue: summary.higherThanAverageQueue,
        marketSampleOrderCount: summary.marketSampleOrderCount, marketSampleDelivered: summary.marketSampleDelivered,
        marketPriceFloorRatio, calculationVersion: 4, marketSampleVolume: summary.marketSampleVolume,
        higherThanAverageDelivered: summary.higherThanAverageDelivered,
        higherThanAverageVolume: summary.higherThanAverageVolume,
        marketMaxPriceDelivered: summary.marketMaxPriceDelivered,
        marketMaxPriceVolume: summary.marketMaxPriceVolume }).returning({
        id: orderSnapshots.id, observedAt: orderSnapshots.observedAt
      });
      await tx.insert(orderEntries).values(orders.map(order => ({ snapshotId: snapshot.id, slot: order.slot,
        price: order.price, delivered: order.delivered, total: order.total, remaining: order.remaining })));
      return { snapshotId: snapshot.id, observedAt: snapshot.observedAt, ...summary };
    });
  }

  const snapshots = (...args) => query.snapshots(...args);

  const opportunities = (...args) => query.opportunities(...args);

  return { initialize, getConfig, putConfig, seedLegacyAccount, accounts, account, createAccount, updateAccount,
    deleteAccount, addAccountCommand, claimAccountCommands, finishAccountCommand, putAccountStatus,
    putLoginChallenge, loginChallenge, clearLoginChallenge, enqueueScan, claimScan, finishScan, scanJob, recoverCollectorWork,
    addSnapshot, snapshots, opportunities };
}

module.exports = { createRepository };
