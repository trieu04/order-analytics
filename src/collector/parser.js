"use strict";

function simplifyNbt(tag) {
  if (!tag || typeof tag !== "object" || typeof tag.type !== "string" || !("value" in tag)) return tag;
  if (tag.type === "compound") {
    return Object.fromEntries(Object.entries(tag.value || {}).map(([key, value]) => [key, simplifyNbt(value)]));
  }
  if (tag.type === "list") {
    const list = tag.value;
    if (!list || !Array.isArray(list.value)) return [];
    return list.value.map(value => simplifyNbt({ type: list.type, value }));
  }
  return tag.value;
}

function componentText(value) {
  if (value == null) return "";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try { return componentText(JSON.parse(trimmed)); } catch { /* plain text */ }
    }
    return value.replace(/§./g, "");
  }
  if (Array.isArray(value)) return value.map(componentText).join("");
  if (typeof value !== "object") return String(value);
  if (typeof value.type === "string" && "value" in value) return componentText(simplifyNbt(value));
  let result = typeof value.text === "string" ? value.text : "";
  if (!result && typeof value.fallback === "string") result = value.fallback;
  if (!result && typeof value.translate === "string") result = value.translate;
  if (Array.isArray(value.extra)) result += value.extra.map(componentText).join("");
  if (!result && typeof value.toString === "function" && value.toString !== Object.prototype.toString) {
    const rendered = String(value);
    if (rendered !== "[object Object]") return rendered.replace(/§./g, "");
  }
  return result;
}

function compactNumber(value) {
  const match = String(value).match(/([\d][\d,._ ]*)([KMB])?/i);
  if (!match) return null;
  const suffix = (match[2] || "").toUpperCase();
  let raw = match[1].replace(/[ _]/g, "");
  if (/^\d{1,3}(?:[,.]\d{3})+$/.test(raw)) {
    raw = raw.replace(/[,.]/g, "");
  } else if (/^\d+[,.]\d{1,2}$/.test(raw)) {
    raw = raw.replace(",", ".");
  } else if (/^\d{1,3}(?:,\d{3})+\.\d{1,2}$/.test(raw)) {
    raw = raw.replace(/,/g, "");
  } else if (/^\d{1,3}(?:\.\d{3})+,\d{1,2}$/.test(raw)) {
    raw = raw.replace(/\./g, "").replace(",", ".");
  } else if (!/^\d+$/.test(raw)) {
    return null;
  }
  const scale = { K: 1_000, M: 1_000_000, B: 1_000_000_000 }[suffix] || 1;
  const parsed = Number(raw) * scale;
  const valid = suffix
    ? Number.isSafeInteger(parsed)
    : Number.isFinite(parsed) && parsed <= Number.MAX_SAFE_INTEGER;
  return valid ? parsed : null;
}

function itemLore(item) {
  const lore = item?.customLore;
  const values = Array.isArray(lore) ? lore : lore == null ? [] : [lore];
  return values.map(componentText).map(line => line.trim()).filter(Boolean);
}

function parseOrderLore(lines) {
  const clean = (lines || []).map(componentText).map(line => line.trim()).filter(Boolean);
  let price = null;
  let delivered = null;
  let total = null;
  for (const line of clean) {
    if (/\$\s*[\d]/.test(line) && /\beach\b/i.test(line)) price = compactNumber(line);
    const progress = line.match(/([\d][\d,._ ]*[KMB]?)\s*\/\s*([\d][\d,._ ]*[KMB]?)\s+Delivered\b/i);
    if (progress) {
      delivered = compactNumber(progress[1]);
      total = compactNumber(progress[2]);
    }
  }
  if (!Number.isFinite(price) || price <= 0 || !Number.isSafeInteger(delivered) ||
      delivered < 0 || !Number.isSafeInteger(total) || total <= 0 || delivered > total) return null;
  return { price, delivered, total, remaining: total - delivered };
}

function summarize(orders, marketPriceFloorRatio = 0.8) {
  const open = orders.filter(order => order.remaining > 0);
  const bestPrice = open.length ? Math.max(...open.map(order => order.price)) : null;
  const totalVolume = open.reduce((sum, order) => sum + order.remaining, 0);
  const bestPriceVolume = open.filter(order => order.price === bestPrice)
    .reduce((sum, order) => sum + order.remaining, 0);
  const total = orders.reduce((sum, order) => sum + order.total, 0);
  const delivered = orders.reduce((sum, order) => sum + order.delivered, 0);
  const priced = orders.filter(order => order.delivered > 0);
  const preliminaryAveragePrice = delivered
    ? priced.reduce((sum, order) => sum + order.price * order.delivered, 0) / delivered : null;
  const marketOrders = preliminaryAveragePrice == null ? []
    : orders.filter(order => order.price >= preliminaryAveragePrice * marketPriceFloorRatio);
  const marketDelivered = marketOrders.reduce((sum, order) => sum + order.delivered, 0);
  const marketSampleOrderCount = marketOrders.length;
  const marketSampleVolume = marketOrders.reduce((sum, order) => sum + order.total, 0);
  const marketAveragePrice = marketDelivered
    ? marketOrders.reduce((sum, order) => sum + order.price * order.delivered, 0) / marketDelivered : null;
  const openMarketOrders = marketOrders.filter(order => order.remaining > 0);
  const marketMaxPrice = openMarketOrders.length ? Math.max(...openMarketOrders.map(order => order.price)) : null;
  const marketMaxPriceOrders = marketOrders.filter(order => order.price === marketMaxPrice);
  const higherThanAverageOrders = marketAveragePrice == null ? []
    : marketOrders.filter(order => order.price > marketAveragePrice);
  return {
    bestPrice,
    bestPriceVolume,
    totalVolume,
    weightedPrice: totalVolume
      ? open.reduce((sum, order) => sum + order.price * order.remaining, 0) / totalVolume : null,
    fillRatio: total ? delivered / total : null,
    marketMaxPrice,
    marketMaxPriceQueue: openMarketOrders.filter(order => order.price === marketMaxPrice)
      .reduce((sum, order) => sum + order.remaining, 0),
    marketMaxPriceDelivered: marketMaxPriceOrders.reduce((sum, order) => sum + order.delivered, 0),
    marketMaxPriceVolume: marketMaxPriceOrders.reduce((sum, order) => sum + order.total, 0),
    marketAveragePrice,
    marketSampleOrderCount,
    marketSampleDelivered: marketDelivered,
    marketSampleVolume,
    higherThanAverageQueue: higherThanAverageOrders.reduce((sum, order) => sum + order.remaining, 0),
    higherThanAverageDelivered: higherThanAverageOrders.reduce((sum, order) => sum + order.delivered, 0),
    higherThanAverageVolume: higherThanAverageOrders.reduce((sum, order) => sum + order.total, 0),
    orderCount: orders.length
  };
}

module.exports = { componentText, compactNumber, itemLore, parseOrderLore, summarize };
