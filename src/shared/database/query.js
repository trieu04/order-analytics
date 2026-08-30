"use strict";

const { asc, eq, sql } = require("drizzle-orm");
const { minecraftAccounts, minecraftAccountStatus } = require("./schema");

function createQuery(db, pool) {
  async function accounts() {
    return db.select({ id: minecraftAccounts.id, label: minecraftAccounts.label, username: minecraftAccounts.username,
      authType: minecraftAccounts.authType, enabled: minecraftAccounts.enabled,
      state: sql`COALESCE(CASE WHEN ${minecraftAccountStatus.heartbeatAt} < now() - interval '30 seconds'
        THEN 'collector_offline' ELSE ${minecraftAccountStatus.state} END, 'disconnected')`,
      minecraftUsername: minecraftAccountStatus.minecraftUsername, heartbeatAt: minecraftAccountStatus.heartbeatAt,
      connectedAt: minecraftAccountStatus.connectedAt, lastScanAt: minecraftAccountStatus.lastScanAt,
      currentItemId: minecraftAccountStatus.currentItemId, lastError: minecraftAccountStatus.lastError })
      .from(minecraftAccounts).leftJoin(minecraftAccountStatus,
        eq(minecraftAccountStatus.accountId, minecraftAccounts.id)).orderBy(asc(minecraftAccounts.createdAt));
  }

  async function putAccountStatus(accountId, state, details = {}) {
    const now = new Date();
    const minecraftUsername = details.minecraftUsername || null;
    const lastScanAt = details.lastScanAt || null;
    await db.insert(minecraftAccountStatus).values({ accountId, state, minecraftUsername, heartbeatAt: now,
      connectedAt: state === "connected" ? now : null, lastScanAt, currentItemId: details.currentItemId || null,
      lastError: details.lastError || null }).onConflictDoUpdate({ target: minecraftAccountStatus.accountId, set: {
        state, minecraftUsername: sql`COALESCE(${minecraftUsername}, ${minecraftAccountStatus.minecraftUsername})`,
        heartbeatAt: now,
        connectedAt: state === "connected" ? sql`COALESCE(${minecraftAccountStatus.connectedAt}, ${now})` : sql`${minecraftAccountStatus.connectedAt}`,
        lastScanAt: sql`COALESCE(${lastScanAt}, ${minecraftAccountStatus.lastScanAt})`,
        currentItemId: details.currentItemId || null, lastError: details.lastError || null
      } });
  }

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

  async function claimAccountCommands() {
    const result = await db.execute(sql`UPDATE minecraft_account_commands SET status='running', claimed_at=now()
      WHERE id IN (SELECT id FROM minecraft_account_commands WHERE status='pending' ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 10)
      RETURNING id, account_id AS "accountId", command`);
    return result.rows;
  }

  async function enqueueScan({ itemId, query: searchQuery, source }) {
    const result = await db.execute(sql`INSERT INTO scan_jobs (item_id,search_query,source)
      VALUES (${itemId},${searchQuery},${source})
      ON CONFLICT (item_id) WHERE status IN ('pending','running') DO UPDATE SET item_id=EXCLUDED.item_id
      RETURNING id, item_id AS "itemId", source, status`);
    return result.rows[0];
  }

  async function claimScan(accountId) {
    const result = await db.execute(sql`UPDATE scan_jobs SET status='running',claimed_by=${accountId},claimed_at=now(),attempts=attempts+1
      WHERE id=(SELECT id FROM scan_jobs WHERE status='pending' AND available_at<=now() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING id,item_id AS "itemId",search_query AS query`);
    return result.rows[0] || null;
  }

  async function recoverCollectorWork() {
    await db.execute(sql`UPDATE scan_jobs SET status='pending',claimed_by=NULL,claimed_at=NULL,error=NULL
      WHERE status='running';
      UPDATE minecraft_account_commands SET status='pending',claimed_at=NULL,error=NULL
      WHERE status='running';`);
  }

  async function snapshots(itemId, limit, { from = null, to = null } = {}) {
    const result = await db.execute(sql`
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
      WHERE (${itemId || null}::text IS NULL OR snapshot.item_id = ${itemId || null})
        AND (${from}::timestamptz IS NULL OR snapshot.observed_at >= ${from})
        AND (${to}::timestamptz IS NULL OR snapshot.observed_at <= ${to})
      ORDER BY snapshot.observed_at DESC LIMIT ${limit}
    `);
    return result.rows;
  }

  async function opportunities(itemId) {
    const result = await db.execute(sql`
      SELECT price, remaining_volume AS "remainingVolume", fill_ratio AS "fillRatio",
             higher_price_queue AS "higherPriceQueue",
             fill_velocity_per_minute AS "fillVelocityPerMinute", observed_at AS "observedAt"
      FROM order_price_opportunities
      WHERE item_id = ${itemId} AND snapshot_id = (
        SELECT id FROM order_snapshots WHERE item_id = ${itemId} ORDER BY observed_at DESC LIMIT 1
      ) ORDER BY price DESC
    `);
    return result.rows;
  }

  return { accounts, initialize, claimAccountCommands, enqueueScan, claimScan, putAccountStatus,
    recoverCollectorWork, snapshots, opportunities };
}

module.exports = { createQuery };
