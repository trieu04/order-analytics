"use strict";

const { sql } = require("drizzle-orm");
const { bigint, bigserial, boolean, doublePrecision, index, integer, jsonb, numeric,
  pgTable, smallint, text, timestamp, uniqueIndex, uuid } = require("drizzle-orm/pg-core");

const appConfig = pgTable("app_config", {
  id: smallint("id").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

const orderSnapshots = pgTable("order_snapshots", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  botId: text("bot_id").notNull(),
  itemId: text("item_id").notNull(),
  query: text("search_query").notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  bestPrice: numeric("best_price", { mode: "number" }),
  bestPriceVolume: bigint("best_price_volume", { mode: "number" }).notNull(),
  totalVolume: bigint("total_volume", { mode: "number" }).notNull(),
  weightedPrice: doublePrecision("weighted_price"),
  fillRatio: doublePrecision("fill_ratio"),
  orderCount: integer("order_count").notNull(),
  marketMinPrice: numeric("market_min_price", { mode: "number" }),
  marketMinPriceQueue: bigint("market_min_price_queue", { mode: "number" }).notNull().default(0),
  marketAveragePrice: doublePrecision("market_average_price"),
  higherThanAverageQueue: bigint("higher_than_average_queue", { mode: "number" }).notNull().default(0),
  marketMaxPrice: numeric("market_max_price", { mode: "number" }),
  marketMaxPriceQueue: bigint("market_max_price_queue", { mode: "number" }).notNull().default(0),
  marketSampleOrderCount: integer("market_sample_order_count").notNull().default(0),
  marketSampleDelivered: bigint("market_sample_delivered", { mode: "number" }).notNull().default(0),
  marketPriceFloorRatio: doublePrecision("market_price_floor_ratio").notNull().default(0.8),
  calculationVersion: smallint("calculation_version").notNull().default(1),
  marketSampleVolume: bigint("market_sample_volume", { mode: "number" }).notNull().default(0),
  higherThanAverageDelivered: bigint("higher_than_average_delivered", { mode: "number" }).notNull().default(0),
  higherThanAverageVolume: bigint("higher_than_average_volume", { mode: "number" }).notNull().default(0),
  marketMaxPriceDelivered: bigint("market_max_price_delivered", { mode: "number" }).notNull().default(0),
  marketMaxPriceVolume: bigint("market_max_price_volume", { mode: "number" }).notNull().default(0)
}, table => [index("order_snapshots_item_time_idx").on(table.itemId, table.observedAt.desc())]);

const minecraftAccounts = pgTable("minecraft_accounts", {
  id: uuid("id").primaryKey(),
  label: text("label").notNull(),
  username: text("username").notNull().unique(),
  authType: text("auth_type").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  profileKey: uuid("profile_key").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

const minecraftAccountStatus = pgTable("minecraft_account_status", {
  accountId: uuid("account_id").primaryKey().references(() => minecraftAccounts.id, { onDelete: "cascade" }),
  state: text("state").notNull(),
  minecraftUsername: text("minecraft_username"),
  heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }).notNull().defaultNow(),
  connectedAt: timestamp("connected_at", { withTimezone: true }),
  lastScanAt: timestamp("last_scan_at", { withTimezone: true }),
  currentItemId: text("current_item_id"),
  lastError: text("last_error")
});

const minecraftLoginChallenges = pgTable("minecraft_login_challenges", {
  accountId: uuid("account_id").primaryKey().references(() => minecraftAccounts.id, { onDelete: "cascade" }),
  verificationUri: text("verification_uri").notNull(),
  userCode: text("user_code").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

const minecraftAccountCommands = pgTable("minecraft_account_commands", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  accountId: uuid("account_id").notNull().references(() => minecraftAccounts.id, { onDelete: "cascade" }),
  command: text("command").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  error: text("error")
});

const scanJobs = pgTable("scan_jobs", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  itemId: text("item_id").notNull(),
  query: text("search_query").notNull(),
  source: text("source").notNull(),
  status: text("status").notNull().default("pending"),
  claimedBy: uuid("claimed_by").references(() => minecraftAccounts.id, { onDelete: "set null" }),
  availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  attempts: integer("attempts").notNull().default(0),
  snapshotId: bigint("snapshot_id", { mode: "number" }).references(() => orderSnapshots.id, { onDelete: "set null" }),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, table => [uniqueIndex("scan_jobs_active_item_idx").on(table.itemId)
  .where(sql`${table.status} IN ('pending', 'running')`)]);

const orderEntries = pgTable("order_entries", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  snapshotId: bigint("snapshot_id", { mode: "number" }).notNull().references(() => orderSnapshots.id, { onDelete: "cascade" }),
  slot: smallint("slot").notNull(),
  price: numeric("price", { mode: "number" }).notNull(),
  delivered: bigint("delivered", { mode: "number" }).notNull(),
  total: bigint("total", { mode: "number" }).notNull(),
  remaining: bigint("remaining", { mode: "number" }).notNull()
}, table => [uniqueIndex("order_entries_snapshot_slot_idx").on(table.snapshotId, table.slot)]);

module.exports = { appConfig, minecraftAccountCommands, minecraftAccounts, minecraftAccountStatus,
  minecraftLoginChallenges, orderEntries, orderSnapshots, scanJobs };
