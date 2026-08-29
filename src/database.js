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
        best_price BIGINT,
        best_price_volume BIGINT NOT NULL,
        total_volume BIGINT NOT NULL,
        weighted_price DOUBLE PRECISION,
        fill_ratio DOUBLE PRECISION,
        order_count INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS order_snapshots_item_time_idx
        ON order_snapshots (item_id, observed_at DESC);

      CREATE TABLE IF NOT EXISTS order_entries (
        id BIGSERIAL PRIMARY KEY,
        snapshot_id BIGINT NOT NULL REFERENCES order_snapshots(id) ON DELETE CASCADE,
        slot SMALLINT NOT NULL,
        price BIGINT NOT NULL CHECK (price > 0),
        delivered BIGINT NOT NULL CHECK (delivered >= 0),
        total BIGINT NOT NULL CHECK (total > 0),
        remaining BIGINT NOT NULL CHECK (remaining = total - delivered AND remaining >= 0),
        UNIQUE (snapshot_id, slot)
      );

      CREATE OR REPLACE VIEW order_price_levels AS
      SELECT s.id AS snapshot_id, s.bot_id, s.item_id, s.observed_at, e.price,
             SUM(e.remaining)::bigint AS remaining_volume,
             SUM(e.delivered)::bigint AS delivered,
             SUM(e.total)::bigint AS total,
             SUM(e.delivered)::double precision / NULLIF(SUM(e.total), 0) AS fill_ratio,
             COUNT(*)::integer AS order_count
      FROM order_snapshots s JOIN order_entries e ON e.snapshot_id = s.id
      GROUP BY s.id, s.bot_id, s.item_id, s.observed_at, e.price;

      CREATE OR REPLACE VIEW order_price_opportunities AS
      WITH compared AS (
        SELECT level.*,
          LAG(observed_at) OVER history AS previous_observed_at,
          LAG(delivered) OVER history AS previous_delivered,
          LAG(total) OVER history AS previous_total
        FROM order_price_levels level
        WINDOW history AS (PARTITION BY bot_id, item_id, price ORDER BY observed_at)
      )
      SELECT compared.*,
        COALESCE(SUM(remaining_volume) OVER (
          PARTITION BY snapshot_id ORDER BY price DESC
          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ), 0)::bigint AS higher_price_queue,
        CASE WHEN total = previous_total AND delivered >= previous_delivered
                    AND observed_at > previous_observed_at
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

  async function addSnapshot({ botId, itemId, query, observedAt, orders }) {
    const summary = summarize(orders);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const snapshot = await client.query(`
        INSERT INTO order_snapshots
          (bot_id, item_id, search_query, observed_at, best_price, best_price_volume,
           total_volume, weighted_price, fill_ratio, order_count)
        VALUES ($1, $2, $3, to_timestamp($4 / 1000.0), $5, $6, $7, $8, $9, $10)
        RETURNING id, observed_at
      `, [botId, itemId, query, observedAt, summary.bestPrice, summary.bestPriceVolume,
        summary.totalVolume, summary.weightedPrice, summary.fillRatio, summary.orderCount]);
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
      SELECT id, bot_id AS "botId", item_id AS "itemId", search_query AS query,
             observed_at AS "observedAt", best_price AS "bestPrice",
             best_price_volume AS "bestPriceVolume", total_volume AS "totalVolume",
             weighted_price AS "weightedPrice", fill_ratio AS "fillRatio", order_count AS "orderCount"
      FROM order_snapshots WHERE ($1::text IS NULL OR item_id = $1)
      ORDER BY observed_at DESC LIMIT $2
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

  return { initialize, getConfig, putConfig, addSnapshot, snapshots, opportunities, close: () => pool.end() };
}

module.exports = { createDatabase };
