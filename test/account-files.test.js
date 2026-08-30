"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createAccountLogWriter, readLiveAccountLog } = require("../src/shared/account-log");
const { cacheFilename, parseCacheFile, profileFile, writeCacheFile } = require("../src/api/account/files");

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

test("keeps recent hourly logs live and compacts older logs into the archive", () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "account-log-"));
  let hour = 0;
  const write = createAccountLogWriter(folder, {
    now: () => new Date(Date.UTC(2026, 7, 30, hour++)), retainHours: 2
  });
  write("first\n");
  write("second\n");
  write("third\n");
  assert.equal(readLiveAccountLog(folder), "second\nthird\n");
  assert.equal(fs.readFileSync(path.join(folder, "account.log"), "utf8"), "first\n");
});
