"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ARCHIVE_LOG_FILE = "account.log";
const LIVE_LOG_HOURS = 24;
const LIVE_LOG_PATTERN = /^account-(\d{4}-\d{2}-\d{2}T\d{2})\.log$/;
const liveLogCache = new Map();

function liveLogFilename(date) {
  return `account-${date.toISOString().slice(0, 13)}.log`;
}

function liveLogFiles(folder) {
  try { return fs.readdirSync(folder).filter(name => LIVE_LOG_PATTERN.test(name)).sort(); }
  catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function compactAccountLogs(folder, retainHours = LIVE_LOG_HOURS) {
  const expired = liveLogFiles(folder).slice(0, -retainHours);
  if (!expired.length) return;
  const archive = path.join(folder, ARCHIVE_LOG_FILE);
  for (const name of expired) {
    const filename = path.join(folder, name);
    fs.appendFileSync(archive, fs.readFileSync(filename), { mode: 0o600 });
    fs.unlinkSync(filename);
  }
}

function createAccountLogWriter(folder, options = {}) {
  const now = options.now || (() => new Date());
  const retainHours = options.retainHours || LIVE_LOG_HOURS;
  let activeFilename = "";
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
  return value => {
    const filename = liveLogFilename(now());
    const changedHour = filename !== activeFilename;
    activeFilename = filename;
    fs.appendFileSync(path.join(folder, filename), value, { mode: 0o600 });
    if (changedHour) compactAccountLogs(folder, retainHours);
  };
}

function readLiveAccountLog(folder) {
  const names = liveLogFiles(folder);
  const cachedFiles = liveLogCache.get(folder) || new Map();
  const activeNames = new Set(names);
  for (const name of cachedFiles.keys()) {
    if (!activeNames.has(name)) cachedFiles.delete(name);
  }
  const values = names.map(name => {
    const filename = path.join(folder, name);
    let stat;
    try { stat = fs.statSync(filename); }
    catch (error) {
      if (error.code === "ENOENT") { cachedFiles.delete(name); return ""; }
      throw error;
    }
    let cached = cachedFiles.get(name);
    if (!cached || cached.size !== stat.size || cached.mtimeMs !== stat.mtimeMs) {
      cached = { size: stat.size, mtimeMs: stat.mtimeMs, value: fs.readFileSync(filename, "utf8") };
      cachedFiles.set(name, cached);
    }
    return cached.value;
  });
  liveLogCache.set(folder, cachedFiles);
  return values.join("");
}

module.exports = { ARCHIVE_LOG_FILE, LIVE_LOG_HOURS, compactAccountLogs, createAccountLogWriter,
  liveLogFilename, readLiveAccountLog };
