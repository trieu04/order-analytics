"use strict";

const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");

const CACHE_FILES = new Set(["live-cache.json", "mca-cache.json", "xbl-cache.json"]);
const LOG_FILE = "account.log";

function cacheFilename(username, filename) {
  if (!CACHE_FILES.has(filename))
    throw Object.assign(new Error("unsupported account file"), { statusCode: 400 });
  const hash = crypto.createHash("sha1").update(String(username || ""), "binary").digest("hex").slice(0, 6);
  return `${hash}_${filename}`;
}

function profileFile(profilesFolder, profileKey, filename) {
  if (!CACHE_FILES.has(filename) && !/^[a-f0-9]{6}_(?:live|mca|xbl)-cache\.json$/.test(filename) && filename !== LOG_FILE)
    throw Object.assign(new Error("unsupported account file"), { statusCode: 400 });
  return path.join(profilesFolder, String(profileKey), filename);
}

function parseCacheFile(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value || "");
  if (!buffer.length) throw Object.assign(new Error("cache file is empty"), { statusCode: 400 });
  try { JSON.parse(buffer.toString("utf8")); }
  catch { throw Object.assign(new Error("cache file must contain valid JSON"), { statusCode: 400 }); }
  return buffer;
}

function writeCacheFile(filename, value) {
  const buffer = parseCacheFile(value);
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const temporary = `${filename}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, buffer, { mode: 0o600 });
  fs.renameSync(temporary, filename);
}

module.exports = { CACHE_FILES, LOG_FILE, cacheFilename, parseCacheFile, profileFile, writeCacheFile };
