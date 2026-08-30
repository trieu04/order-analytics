"use strict";

require("dotenv").config();

function number(name, fallback, minimum = 0) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value < minimum) throw new Error(`${name} must be >= ${minimum}`);
  return value;
}

function loadConfig() {
  let items;
  try { items = JSON.parse(process.env.ITEMS || "[]"); } catch { throw new Error("ITEMS must be valid JSON"); }
  if (!Array.isArray(items)) throw new Error("ITEMS must be an array");
  items = items.map(item => ({
    id: String(item?.id || "").trim(), query: String(item?.query || "").trim()
  }));
  if (items.some(item => !item.id || !item.query)) throw new Error("Every ITEMS entry needs id and query");

  const auth = String(process.env.MC_AUTH || "microsoft").toLowerCase();
  if (!["microsoft", "offline"].includes(auth)) throw new Error("MC_AUTH must be microsoft or offline");
  const username = String(process.env.MC_USERNAME || "").trim();
  const rawVersion = String(process.env.MC_VERSION || "false").trim();

  const apiPort = number("API_PORT", 6600, 1);
  return {
    minecraft: {
      host: String(process.env.MC_HOST || "localhost"),
      port: number("MC_PORT", 25565, 1),
      version: rawVersion === "false" || rawVersion === "auto" ? false : rawVersion,
      profilesFolder: process.env.MC_PROFILES_FOLDER || "./profiles"
    },
    legacyAccount: username ? { username, auth } : null,
    databaseUrl: process.env.DATABASE_URL ||
      "postgres://order_analytics:order_analytics@127.0.0.1:6610/order_analytics",
    apiPort,
    internalApiUrl: process.env.INTERNAL_API_URL || `http://127.0.0.1:${apiPort}`,
    scanIntervalMs: number("SCAN_INTERVAL_SECONDS", 300, 10) * 1000,
    scanSettleMs: number("SCAN_SETTLE_MS", 1200, 0),
    scanDelayMs: number("SCAN_DELAY_MS", 2000, 0),
    items
  };
}

module.exports = { loadConfig };
