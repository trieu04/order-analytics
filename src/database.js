"use strict";

const { Pool } = require("pg");
const { summarize } = require("./parser");

function createDatabase(connectionString) {
  const pool = new Pool({ connectionString, max: 10 });

  async function initialize() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_config (
        id SMALLINT PRIMARY KEY CHECK (id = 1),
        value JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS order_snapshots (
        id BIGSERIAL PRIMARY KEY,
        bot_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        search_query TEXT NOT NULL,
        observed_at TIMESTAMPTZ NOT NULL,
        received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        best_price NUMERIC,
        best_price_volume BIGINT NOT NULL,
        total_volume BIGINT NOT NULL,
        weighted_price DOUBLE PRECISION,
        fill_ratio DOUBLE PRECISION,
        order_count INTEGER NOT NULL
      );
      ALTER TABLE order_snapshots ADD COLUMN IF NOT EXISTS market_min_price NUMERIC;
      ALTER TABLE order_snapshots ADD COLUMN IF NOT EXISTS market_min_price_queue BIGINT NOT NULL DEFAULT 0;
      ALTER TABLE order_snapshots ADD COLUMN IF NOT EXISTS market_average_price DOUBLE PRECISION;
      ALTER TABLE order_snapshots ADD COLUMN IF NOT EXISTS higher_than_average_queue BIGINT NOT NULL DEFAULT 0;
      ALTER TABLE order_snapshots ADD COLUMN IF NOT EXISTS market_max_price NUMERIC;
      ALTER TABLE order_snapshots ADD COLUMN IF NOT EXISTS market_max_price_queue BIGINT NOT NULL DEFAULT 0;
      ALTER TABLE order_snapshots ADD COLUMN IF NOT EXISTS market_sample_order_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE order_snapshots ADD COLUMN IF NOT EXISTS market_sample_delivered BIGINT NOT NULL DEFAULT 0;
      ALTER TABLE order_snapshots ADD COLUMN IF NOT EXISTS market_price_floor_ratio DOUBLE PRECISION NOT NULL DEFAULT 0.8;
      ALTER TABLE order_snapshots ADD COLUMN IF NOT EXISTS calculation_version SMALLINT NOT NULL DEFAULT 1;
      ALTER TABLE order_snapshots ADD COLUMN IF NOT EXISTS market_sample_volume BIGINT NOT NULL DEFAULT 0;
      ALTER TABLE order_snapshots ADD COLUMN IF NOT EXISTS higher_than_average_delivered BIGINT NOT NULL DEFAULT 0;
      ALTER TABLE order_snapshots ADD COLUMN IF NOT EXISTS higher_than_average_volume BIGINT NOT NULL DEFAULT 0;
      ALTER TABLE order_snapshots ADD COLUMN IF NOT EXISTS market_max_price_delivered BIGINT NOT NULL DEFAULT 0;
      ALTER TABLE order_snapshots ADD COLUMN IF NOT EXISTS market_max_price_volume BIGINT NOT NULL DEFAULT 0;
      CREATE INDEX IF NOT EXISTS order_snapshots_item_time_idx
        ON order_snapshots (item_id, observed_at DESC);

      CREATE TABLE IF NOT EXISTS minecraft_accounts (
        id UUID PRIMARY KEY,
        label TEXT NOT NULL,
        username TEXT NOT NULL UNIQUE,
        auth_type TEXT NOT NULL CHECK (auth_type IN ('microsoft', 'offline')),
        enabled BOOLEAN NOT NULL DEFAULT true,
        profile_key UUID NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS minecraft_account_status (
        account_id UUID PRIMARY KEY REFERENCES minecraft_accounts(id) ON DELETE CASCADE,
        state TEXT NOT NULL,
        minecraft_username TEXT,
        heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        connected_at TIMESTAMPTZ,
        last_scan_at TIMESTAMPTZ,
        current_item_id TEXT,
        last_error TEXT
      );
      CREATE TABLE IF NOT EXISTS minecraft_login_challenges (
        account_id UUID PRIMARY KEY REFERENCES minecraft_accounts(id) ON DELETE CASCADE,
        verification_uri TEXT NOT NULL,
        user_code TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS minecraft_account_commands (
        id BIGSERIAL PRIMARY KEY,
        account_id UUID NOT NULL REFERENCES minecraft_accounts(id) ON DELETE CASCADE,
        command TEXT NOT NULL CHECK (command IN ('connect', 'disconnect', 'clear_session')),
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        claimed_at TIMESTAMPTZ,
        finished_at TIMESTAMPTZ,
        error TEXT
      );
      CREATE TABLE IF NOT EXISTS scan_jobs (
        id BIGSERIAL PRIMARY KEY,
        item_id TEXT NOT NULL,
        search_query TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('scheduled', 'manual')),
        status TEXT NOT NULL DEFAULT 'pending',
        claimed_by UUID REFERENCES minecraft_accounts(id) ON DELETE SET NULL,
        available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        claimed_at TIMESTAMPTZ,
        finished_at TIMESTAMPTZ,
        attempts INTEGER NOT NULL DEFAULT 0,
        snapshot_id BIGINT REFERENCES order_snapshots(id) ON DELETE SET NULL,
        error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS scan_jobs_active_item_idx ON scan_jobs (item_id)
        WHERE status IN ('pending', 'running');

      CREATE TABLE IF NOT EXISTS order_entries (
        id BIGSERIAL PRIMARY KEY,
        snapshot_id BIGINT NOT NULL REFERENCES order_snapshots(id) ON DELETE CASCADE,
        slot SMALLINT NOT NULL,
        price NUMERIC NOT NULL CHECK (price > 0),
        delivered BIGINT NOT NULL CHECK (delivered >= 0),
        total BIGINT NOT NULL CHECK (total > 0),
        remaining BIGINT NOT NULL CHECK (remaining = total - delivered AND remaining >= 0),
        UNIQUE (snapshot_id, slot)
      );

      WITH preliminary AS (
        SELECT s.id AS snapshot_id, s.market_price_floor_ratio,
               SUM(e.price::double precision * e.delivered) / NULLIF(SUM(e.delivered), 0) AS average_price
        FROM order_snapshots s JOIN order_entries e ON e.snapshot_id = s.id
        GROUP BY s.id
      ), samples AS (
        SELECT p.snapshot_id, COUNT(*)::integer AS order_count,
               SUM(e.delivered)::bigint AS delivered
        FROM preliminary p JOIN order_entries e ON e.snapshot_id = p.snapshot_id
        WHERE e.price >= p.average_price * p.market_price_floor_ratio
        GROUP BY p.snapshot_id
      )
      UPDATE order_snapshots s
      SET market_sample_order_count = sample.order_count,
          market_sample_delivered = sample.delivered,
          calculation_version = 2
      FROM samples sample
      WHERE s.id = sample.snapshot_id AND s.market_average_price IS NOT NULL
        AND s.calculation_version < 2;

      WITH preliminary AS (
        SELECT s.id AS snapshot_id,
               SUM(e.price::double precision * e.delivered) / NULLIF(SUM(e.delivered), 0) AS average_price
        FROM order_snapshots s JOIN order_entries e ON e.snapshot_id = s.id
        GROUP BY s.id
      ), aggregates AS (
        SELECT s.id AS snapshot_id,
               SUM(e.total) FILTER (WHERE e.price >= p.average_price * s.market_price_floor_ratio)::bigint AS sample_volume,
               SUM(e.delivered) FILTER (WHERE e.price > s.market_average_price)::bigint AS higher_delivered,
               SUM(e.total) FILTER (WHERE e.price > s.market_average_price)::bigint AS higher_volume
        FROM order_snapshots s JOIN preliminary p ON p.snapshot_id = s.id
          JOIN order_entries e ON e.snapshot_id = s.id
        GROUP BY s.id
      )
      UPDATE order_snapshots s
      SET market_sample_volume = COALESCE(a.sample_volume, 0),
          higher_than_average_delivered = COALESCE(a.higher_delivered, 0),
          higher_than_average_volume = COALESCE(a.higher_volume, 0),
          calculation_version = 3
      FROM aggregates a
      WHERE s.id = a.snapshot_id AND s.calculation_version < 3;

      WITH max_price AS (
        SELECT s.id AS snapshot_id, SUM(e.delivered)::bigint AS delivered, SUM(e.total)::bigint AS volume
        FROM order_snapshots s JOIN order_entries e
          ON e.snapshot_id = s.id AND e.price = s.market_max_price
        GROUP BY s.id
      )
      UPDATE order_snapshots s
      SET market_max_price_delivered = COALESCE(m.delivered, 0),
          market_max_price_volume = COALESCE(m.volume, 0),
          calculation_version = 4
      FROM max_price m
      WHERE s.id = m.snapshot_id AND s.calculation_version < 4;

      DROP VIEW IF EXISTS order_price_opportunities;
      DROP VIEW IF EXISTS order_price_levels;
      ALTER TABLE order_snapshots ALTER COLUMN best_price TYPE NUMERIC USING best_price::numeric;
      ALTER TABLE order_entries ALTER COLUMN price TYPE NUMERIC USING price::numeric;

      CREATE VIEW order_price_levels AS
      SELECT s.id AS snapshot_id, s.bot_id, s.item_id, s.observed_at, e.price,
             SUM(e.remaining)::bigint AS remaining_volume,
             SUM(e.delivered)::bigint AS delivered,
             SUM(e.total)::bigint AS total,
             SUM(e.delivered)::double precision / NULLIF(SUM(e.total), 0) AS fill_ratio,
             COUNT(*)::integer AS order_count
      FROM order_snapshots s JOIN order_entries e ON e.snapshot_id = s.id
      GROUP BY s.id, s.bot_id, s.item_id, s.observed_at, e.price;

      CREATE VIEW order_price_opportunities AS
      WITH compared AS (
        SELECT level.*,
          LAG(observed_at) OVER history AS previous_observed_at,
          LAG(delivered) OVER history AS previous_delivered,
          LAG(total) OVER history AS previous_total
        FROM order_price_levels level
        WINDOW history AS (PARTITION BY item_id, price ORDER BY observed_at, snapshot_id)
      )
      SELECT compared.*,
        COALESCE(SUM(remaining_volume) OVER (
          PARTITION BY snapshot_id ORDER BY price DESC
          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ), 0)::bigint AS higher_price_queue,
        CASE WHEN total = previous_total AND delivered >= previous_delivered
                    AND observed_at - previous_observed_at >= interval '1 second'
          THEN (delivered - previous_delivered)::double precision * 60.0 /
               EXTRACT(EPOCH FROM observed_at - previous_observed_at)
          ELSE NULL END AS fill_velocity_per_minute
      FROM compared;
    `);
  }

  async function getConfig() {
    const result = await pool.query("SELECT value, updated_at FROM app_config WHERE id = 1");
    return result.rows[0] ? { ...result.rows[0].value, updatedAt: result.rows[0].updated_at } : null;
  }

  async function putConfig(value) {
    const result = await pool.query(`
      INSERT INTO app_config (id, value, updated_at) VALUES (1, $1::jsonb, now())
      ON CONFLICT (id) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
      RETURNING value, updated_at
    `, [JSON.stringify(value)]);
    return { ...result.rows[0].value, updatedAt: result.rows[0].updated_at };
  }

  async function seedLegacyAccount(account) {
    if (!account) return;
    await pool.query(`
      INSERT INTO minecraft_accounts (id, label, username, auth_type, profile_key)
      SELECT gen_random_uuid(), 'Collector 1', $1, $2, gen_random_uuid()
      WHERE NOT EXISTS (SELECT 1 FROM minecraft_accounts)
      ON CONFLICT DO NOTHING
    `, [account.username, account.auth]);
  }

  async function accounts() {
    const result = await pool.query(`
      SELECT a.id, a.label, a.username, a.auth_type AS "authType", a.enabled,
             COALESCE(CASE WHEN s.heartbeat_at < now() - interval '30 seconds' THEN 'collector_offline' ELSE s.state END,
               'disconnected') AS state,
             s.minecraft_username AS "minecraftUsername", s.heartbeat_at AS "heartbeatAt",
             s.connected_at AS "connectedAt", s.last_scan_at AS "lastScanAt",
             s.current_item_id AS "currentItemId", s.last_error AS "lastError"
      FROM minecraft_accounts a LEFT JOIN minecraft_account_status s ON s.account_id = a.id
      ORDER BY a.created_at
    `);
    return result.rows;
  }

  async function account(id) {
    const result = await pool.query(`SELECT id, label, username, auth_type AS "authType", enabled,
      profile_key AS "profileKey" FROM minecraft_accounts WHERE id = $1`, [id]);
    return result.rows[0] || null;
  }

  async function createAccount({ id, label, username, authType, profileKey }) {
    const result = await pool.query(`INSERT INTO minecraft_accounts
      (id, label, username, auth_type, profile_key) VALUES ($1, $2, $3, $4, $5)
      RETURNING id, label, username, auth_type AS "authType", enabled`,
    [id, label, username, authType, profileKey]);
    return result.rows[0];
  }

  async function updateAccount(id, { label, username, authType, enabled }) {
    const result = await pool.query(`UPDATE minecraft_accounts SET label=$2, username=$3, auth_type=$4,
      enabled=$5, updated_at=now() WHERE id=$1 RETURNING id, label, username, auth_type AS "authType", enabled`,
    [id, label, username, authType, enabled]);
    return result.rows[0] || null;
  }

  async function deleteAccount(id) {
    return (await pool.query("DELETE FROM minecraft_accounts WHERE id=$1 RETURNING id", [id])).rowCount > 0;
  }

  async function addAccountCommand(accountId, command) {
    const result = await pool.query(`INSERT INTO minecraft_account_commands (account_id, command)
      VALUES ($1,$2) RETURNING id, status`, [accountId, command]);
    return result.rows[0];
  }

  async function claimAccountCommands() {
    const result = await pool.query(`UPDATE minecraft_account_commands SET status='running', claimed_at=now()
      WHERE id IN (SELECT id FROM minecraft_account_commands WHERE status='pending' ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 10)
      RETURNING id, account_id AS "accountId", command`);
    return result.rows;
  }

  async function finishAccountCommand(id, error = null) {
    await pool.query(`UPDATE minecraft_account_commands SET status=$2, error=$3, finished_at=now() WHERE id=$1`,
      [id, error ? "failed" : "succeeded", error]);
  }

  async function putAccountStatus(accountId, state, details = {}) {
    await pool.query(`INSERT INTO minecraft_account_status
      (account_id,state,minecraft_username,heartbeat_at,connected_at,last_scan_at,current_item_id,last_error)
      VALUES ($1,$2,$3,now(),CASE WHEN $2='connected' THEN now() END,$4,$5,$6)
      ON CONFLICT (account_id) DO UPDATE SET state=$2, minecraft_username=COALESCE($3,minecraft_account_status.minecraft_username),
      heartbeat_at=now(), connected_at=CASE WHEN $2='connected' THEN COALESCE(minecraft_account_status.connected_at,now()) ELSE minecraft_account_status.connected_at END,
      last_scan_at=COALESCE($4,minecraft_account_status.last_scan_at), current_item_id=$5, last_error=$6`,
    [accountId, state, details.minecraftUsername || null, details.lastScanAt || null,
      details.currentItemId || null, details.lastError || null]);
  }

  async function putLoginChallenge(accountId, data) {
    const expires = new Date(Date.now() + Number(data.expires_in || 900) * 1000);
    await pool.query(`INSERT INTO minecraft_login_challenges (account_id,verification_uri,user_code,expires_at)
      VALUES ($1,$2,$3,$4) ON CONFLICT (account_id) DO UPDATE SET verification_uri=$2,user_code=$3,expires_at=$4,updated_at=now()`,
    [accountId, data.verification_uri, data.user_code, expires]);
  }

  async function loginChallenge(accountId) {
    const result = await pool.query(`SELECT verification_uri AS "verificationUri", user_code AS "userCode",
      expires_at AS "expiresAt" FROM minecraft_login_challenges WHERE account_id=$1 AND expires_at>now()`, [accountId]);
    return result.rows[0] || null;
  }

  async function clearLoginChallenge(accountId) { await pool.query("DELETE FROM minecraft_login_challenges WHERE account_id=$1", [accountId]); }

  async function enqueueScan({ itemId, query, source }) {
    const result = await pool.query(`INSERT INTO scan_jobs (item_id,search_query,source) VALUES ($1,$2,$3)
      ON CONFLICT (item_id) WHERE status IN ('pending','running') DO UPDATE SET item_id=EXCLUDED.item_id
      RETURNING id, item_id AS "itemId", source, status`, [itemId, query, source]);
    return result.rows[0];
  }

  async function claimScan(accountId) {
    const result = await pool.query(`UPDATE scan_jobs SET status='running',claimed_by=$1,claimed_at=now(),attempts=attempts+1
      WHERE id=(SELECT id FROM scan_jobs WHERE status='pending' AND available_at<=now() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING id,item_id AS "itemId",search_query AS query`, [accountId]);
    return result.rows[0] || null;
  }

  async function finishScan(id, snapshotId, error = null) {
    await pool.query(`UPDATE scan_jobs SET status=$2,snapshot_id=$3,error=$4,finished_at=now() WHERE id=$1`,
      [id, error ? "failed" : "succeeded", snapshotId, error]);
  }

  async function scanJob(id) {
    const result = await pool.query(`SELECT id,item_id AS "itemId",source,status,claimed_by AS "claimedBy",
      snapshot_id AS "snapshotId",error,created_at AS "createdAt",finished_at AS "finishedAt" FROM scan_jobs WHERE id=$1`, [id]);
    return result.rows[0] || null;
  }

  async function recoverCollectorWork() {
    await pool.query(`UPDATE scan_jobs SET status='pending',claimed_by=NULL,claimed_at=NULL,error=NULL
      WHERE status='running';
      UPDATE minecraft_account_commands SET status='pending',claimed_at=NULL,error=NULL
      WHERE status='running';`);
  }

  async function addSnapshot({ botId, itemId, query, observedAt, orders }) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const configured = await client.query("SELECT value FROM app_config WHERE id = 1");
      const marketPriceFloorRatio = Number(configured.rows[0]?.value?.marketPriceFloorRatio ?? 0.8);
      const summary = summarize(orders, marketPriceFloorRatio);
      const snapshot = await client.query(`
        INSERT INTO order_snapshots
          (bot_id, item_id, search_query, observed_at, best_price, best_price_volume,
           total_volume, weighted_price, fill_ratio, order_count, market_max_price,
           market_max_price_queue, market_average_price, higher_than_average_queue,
           market_sample_order_count, market_sample_delivered, market_price_floor_ratio, calculation_version,
           market_sample_volume, higher_than_average_delivered, higher_than_average_volume,
           market_max_price_delivered, market_max_price_volume)
        VALUES ($1, $2, $3, to_timestamp($4 / 1000.0), $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 4, $18, $19, $20, $21, $22)
        RETURNING id, observed_at
      `, [botId, itemId, query, observedAt, summary.bestPrice, summary.bestPriceVolume,
        summary.totalVolume, summary.weightedPrice, summary.fillRatio, summary.orderCount,
        summary.marketMaxPrice, summary.marketMaxPriceQueue, summary.marketAveragePrice,
        summary.higherThanAverageQueue, summary.marketSampleOrderCount, summary.marketSampleDelivered,
        marketPriceFloorRatio, summary.marketSampleVolume, summary.higherThanAverageDelivered,
        summary.higherThanAverageVolume, summary.marketMaxPriceDelivered, summary.marketMaxPriceVolume]);
      for (const order of orders) {
        await client.query(`
          INSERT INTO order_entries (snapshot_id, slot, price, delivered, total, remaining)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [snapshot.rows[0].id, order.slot, order.price, order.delivered, order.total, order.remaining]);
      }
      await client.query("COMMIT");
      return { snapshotId: snapshot.rows[0].id, observedAt: snapshot.rows[0].observed_at, ...summary };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async function snapshots(itemId, limit) {
    const result = await pool.query(`
      SELECT snapshot.id, snapshot.bot_id AS "botId", snapshot.item_id AS "itemId",
             snapshot.search_query AS query, snapshot.observed_at AS "observedAt",
             snapshot.best_price AS "bestPrice",
             snapshot.best_price_volume AS "bestPriceVolume",
             snapshot.total_volume AS "totalVolume",
             snapshot.weighted_price AS "weightedPrice",
             snapshot.market_max_price AS "marketMaxPrice",
             snapshot.market_max_price_queue AS "marketMaxPriceQueue",
             snapshot.market_max_price_delivered AS "marketMaxPriceDelivered",
             snapshot.market_max_price_volume AS "marketMaxPriceVolume",
             snapshot.market_average_price AS "marketAveragePrice",
             snapshot.market_sample_order_count AS "marketSampleOrderCount",
             snapshot.market_sample_delivered AS "marketSampleDelivered",
             snapshot.market_sample_volume AS "marketSampleVolume",
             snapshot.market_price_floor_ratio AS "marketPriceFloorRatio",
             snapshot.calculation_version AS "calculationVersion",
             snapshot.higher_than_average_delivered AS "higherThanAverageDelivered",
             snapshot.higher_than_average_volume AS "higherThanAverageVolume",
             snapshot.higher_than_average_queue AS "higherThanAverageQueue",
             snapshot.fill_ratio AS "fillRatio",
             best.fill_ratio AS "bestPriceFillRatio",
             best.order_count AS "bestPriceOrderCount",
             active.average_fill_ratio AS "activeOrderFillRatio",
             active.order_count AS "activeOrderCount",
             snapshot.order_count AS "orderCount"
      FROM order_snapshots snapshot
      LEFT JOIN LATERAL (
        SELECT SUM(entry.delivered)::double precision / NULLIF(SUM(entry.total), 0) AS fill_ratio,
               COUNT(*)::integer AS order_count
        FROM order_entries entry
        WHERE entry.snapshot_id = snapshot.id AND entry.price = snapshot.best_price
      ) best ON true
      LEFT JOIN LATERAL (
        SELECT AVG(entry.delivered::double precision / entry.total) AS average_fill_ratio,
               COUNT(*)::integer AS order_count
        FROM order_entries entry
        WHERE entry.snapshot_id = snapshot.id AND entry.delivered > 0
      ) active ON true
      WHERE ($1::text IS NULL OR snapshot.item_id = $1)
      ORDER BY snapshot.observed_at DESC LIMIT $2
    `, [itemId || null, limit]);
    return result.rows;
  }

  async function opportunities(itemId) {
    const result = await pool.query(`
      SELECT price, remaining_volume AS "remainingVolume", fill_ratio AS "fillRatio",
             higher_price_queue AS "higherPriceQueue",
             fill_velocity_per_minute AS "fillVelocityPerMinute", observed_at AS "observedAt"
      FROM order_price_opportunities
      WHERE item_id = $1 AND snapshot_id = (
        SELECT id FROM order_snapshots WHERE item_id = $1 ORDER BY observed_at DESC LIMIT 1
      ) ORDER BY price DESC
    `, [itemId]);
    return result.rows;
  }

  return { initialize, getConfig, putConfig, seedLegacyAccount, accounts, account, createAccount, updateAccount,
    deleteAccount, addAccountCommand, claimAccountCommands, finishAccountCommand, putAccountStatus,
    putLoginChallenge, loginChallenge, clearLoginChallenge, enqueueScan, claimScan, finishScan, scanJob, recoverCollectorWork,
    addSnapshot, snapshots, opportunities, close: () => pool.end() };
}

module.exports = { createDatabase };
