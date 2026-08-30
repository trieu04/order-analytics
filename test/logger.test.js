"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createLogger } = require("../src/shared/logger");

test("writes scoped info and error messages to the configured streams", () => {
  let stdout = "";
  let stderr = "";
  const logger = createLogger("scan", {
    stdout: { write: value => { stdout += value; } },
    stderr: { write: value => { stderr += value; } }
  });

  logger.info("scan complete");
  logger.error("scan failed");

  assert.equal(stdout, "[scan] scan complete\n");
  assert.equal(stderr, "[scan] scan failed\n");
});
