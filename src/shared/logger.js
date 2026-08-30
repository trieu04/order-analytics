"use strict";

function format(value) {
  if (value instanceof Error) return value.stack || value.message;
  return String(value);
}

function createLogger(scope, output = {}) {
  const prefix = `[${String(scope).trim()}]`;
  const stdout = output.stdout || process.stdout;
  const stderr = output.stderr || process.stderr;
  const write = (stream, value) => stream.write(`${prefix} ${format(value)}\n`);

  return {
    info: value => write(stdout, value),
    error: value => write(stderr, value)
  };
}

module.exports = { createLogger };
