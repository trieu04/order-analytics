"use strict";

require("./api").main().catch(error => {
  console.error(`[api] ${error.stack || error}`);
  process.exit(1);
});
