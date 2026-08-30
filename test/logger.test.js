"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createLogger } = require("../src/shared/logger");

test("writes scoped info and error messages to the configured streams", () => {
  let stdout = "";
  let stderr = "";
  const logger = createLogger("scan", {
    stdout: { write: value => { stdout += value; } },
    stderr: { write: value => { stderr += value; } },
    level: "debug",
    now: () => new Date("2026-08-31T01:02:03.000Z")
  });

  logger.debug("window opened");
  logger.info("scan complete");
  logger.error("scan failed");

  assert.equal(stdout, "2026-08-31T01:02:03.000Z [scan] [debug] window opened\n" +
    "2026-08-31T01:02:03.000Z [scan] [info] scan complete\n");
  assert.equal(stderr, "2026-08-31T01:02:03.000Z [scan] [error] scan failed\n");
});

test("suppresses debug messages at info level", () => {
  let stdout = "";
  const logger = createLogger("api", {
    stdout: { write: value => { stdout += value; } }, level: "info",
    now: () => new Date("2026-08-31T01:02:03.000Z")
  });
  logger.debug("details");
  logger.info("ready");
  assert.equal(stdout, "2026-08-31T01:02:03.000Z [api] [info] ready\n");
});
