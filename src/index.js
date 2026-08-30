"use strict";

const { createLogger } = require("./shared/logger");

const logger = createLogger("api");

require("./api").main().catch(error => {
  logger.error(error);
  process.exit(1);
});
