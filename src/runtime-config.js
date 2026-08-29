"use strict";

function normalizeRuntimeConfig(input, fallback = {}) {
  const raw = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const interval = Number(raw.scanIntervalSeconds ?? fallback.scanIntervalSeconds ?? 300);
  const settle = Number(raw.scanSettleMs ?? fallback.scanSettleMs ?? 1200);
  const delay = Number(raw.scanDelayMs ?? fallback.scanDelayMs ?? 2000);
  const marketPriceFloorRatio = Number(raw.marketPriceFloorRatio ?? fallback.marketPriceFloorRatio ?? 0.8);
  if (!Number.isInteger(interval) || interval < 10 || interval > 86400)
    throw Object.assign(new Error("scanIntervalSeconds must be an integer from 10 to 86400"), { statusCode: 400 });
  if (!Number.isInteger(settle) || settle < 0 || settle > 10000)
    throw Object.assign(new Error("scanSettleMs must be an integer from 0 to 10000"), { statusCode: 400 });
  if (!Number.isInteger(delay) || delay < 0 || delay > 60000)
    throw Object.assign(new Error("scanDelayMs must be an integer from 0 to 60000"), { statusCode: 400 });
  if (!Number.isFinite(marketPriceFloorRatio) || marketPriceFloorRatio <= 0 || marketPriceFloorRatio > 1)
    throw Object.assign(new Error("marketPriceFloorRatio must be greater than 0 and at most 1"), { statusCode: 400 });
  const scanEnabled = raw.scanEnabled ?? fallback.scanEnabled ?? true;
  if (typeof scanEnabled !== "boolean")
    throw Object.assign(new Error("scanEnabled must be boolean"), { statusCode: 400 });

  const sourceItems = raw.items ?? fallback.items ?? [];
  if (!Array.isArray(sourceItems) || sourceItems.length > 200)
    throw Object.assign(new Error("items must be an array with at most 200 entries"), { statusCode: 400 });
  const seen = new Set();
  const items = sourceItems.map((item, index) => {
    const id = String(item?.id || "").trim();
    const query = String(item?.query || "").trim();
    if (!/^minecraft:[a-z0-9_.-]+$/.test(id) || !query || query.length > 100 || seen.has(id))
      throw Object.assign(new Error(`invalid or duplicate item at index ${index}`), { statusCode: 400 });
    seen.add(id);
    return { id, query, enabled: item.enabled !== false };
  });
  return {
    scanEnabled,
    scanIntervalSeconds: interval,
    scanSettleMs: settle,
    scanDelayMs: delay,
    marketPriceFloorRatio,
    items
  };
}

module.exports = { normalizeRuntimeConfig };
