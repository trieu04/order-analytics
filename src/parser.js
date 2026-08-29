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
  if (suffix && /[.,]\d{1,2}$/.test(raw)) raw = raw.replace(",", ".");
  else raw = raw.replace(/[,.]/g, "");
  const scale = { K: 1_000, M: 1_000_000, B: 1_000_000_000 }[suffix] || 1;
  const parsed = Math.round(Number(raw) * scale);
  return Number.isSafeInteger(parsed) ? parsed : null;
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
  if (!Number.isSafeInteger(price) || price <= 0 || !Number.isSafeInteger(delivered) ||
      delivered < 0 || !Number.isSafeInteger(total) || total <= 0 || delivered > total) return null;
  return { price, delivered, total, remaining: total - delivered };
}

function summarize(orders) {
  const open = orders.filter(order => order.remaining > 0);
  const bestPrice = open.length ? Math.max(...open.map(order => order.price)) : null;
  const totalVolume = open.reduce((sum, order) => sum + order.remaining, 0);
  const bestPriceVolume = open.filter(order => order.price === bestPrice)
    .reduce((sum, order) => sum + order.remaining, 0);
  const total = orders.reduce((sum, order) => sum + order.total, 0);
  const delivered = orders.reduce((sum, order) => sum + order.delivered, 0);
  return {
    bestPrice,
    bestPriceVolume,
    totalVolume,
    weightedPrice: totalVolume
      ? open.reduce((sum, order) => sum + order.price * order.remaining, 0) / totalVolume : null,
    fillRatio: total ? delivered / total : null,
    orderCount: orders.length
  };
}

module.exports = { componentText, compactNumber, itemLore, parseOrderLore, summarize };
