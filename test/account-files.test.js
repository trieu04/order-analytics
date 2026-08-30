"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { cacheFilename, parseCacheFile, profileFile, tailLog, writeCacheFile } = require("../src/api/account/files");

test("only resolves supported account files", () => {
  assert.equal(profileFile("/profiles", "key", "live-cache.json"), "/profiles/key/live-cache.json");
  assert.equal(profileFile("/profiles", "key", "846142_live-cache.json"),
    "/profiles/key/846142_live-cache.json");
  assert.throws(() => profileFile("/profiles", "key", "../secret"), /unsupported/);
});

test("uses the prismarine-auth username hash for physical cache names", () => {
  assert.equal(cacheFilename("oioxkin2793r@outlook.com", "live-cache.json"), "846142_live-cache.json");
  assert.equal(cacheFilename("oioxkin2793r@outlook.com", "mca-cache.json"), "846142_mca-cache.json");
  assert.equal(cacheFilename("oioxkin2793r@outlook.com", "xbl-cache.json"), "846142_xbl-cache.json");
  assert.throws(() => cacheFilename("user", "other-cache.json"), /unsupported/);
});

test("validates and atomically stores cache JSON", () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "account-files-"));
  const filename = path.join(folder, "nested", "mca-cache.json");
  assert.throws(() => parseCacheFile(Buffer.from("not json")), /valid JSON/);
  writeCacheFile(filename, Buffer.from('{"token":"test"}'));
  assert.equal(fs.readFileSync(filename, "utf8"), '{"token":"test"}');
});

test("reads only the tail of an account log", () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "account-log-"));
  const filename = path.join(folder, "account.log");
  fs.writeFileSync(filename, "1234567890");
  assert.equal(tailLog(filename, 4), "7890");
  assert.equal(tailLog(path.join(folder, "missing.log")), "");
});
