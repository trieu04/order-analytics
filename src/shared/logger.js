"use strict";

function format(value) {
  if (value instanceof Error) return value.stack || value.message;
  return String(value);
}

function createLogger(scope, output = {}) {
  const levels = { debug: 10, info: 20, error: 30 };
  const configuredLevel = String(output.level || process.env.LOG_LEVEL ||
    (process.env.NODE_ENV === "production" ? "info" : "debug")).toLowerCase();
  if (!Object.hasOwn(levels, configuredLevel))
    throw new Error("LOG_LEVEL must be debug, info or error");
  const prefix = `[${String(scope).trim()}]`;
  const stdout = output.stdout || process.stdout;
  const stderr = output.stderr || process.stderr;
  const now = output.now || (() => new Date());
  const write = (stream, level, value) => {
    if (levels[level] < levels[configuredLevel]) return;
    stream.write(`${now().toISOString()} ${prefix} [${level}] ${format(value)}\n`);
  };

  return {
    debug: value => write(stdout, "debug", value),
    info: value => write(stdout, "info", value),
    error: value => write(stderr, "error", value)
  };
}

module.exports = { createLogger };
