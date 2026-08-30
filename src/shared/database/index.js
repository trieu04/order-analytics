"use strict";

const { drizzle } = require("drizzle-orm/node-postgres");
const { Pool } = require("pg");
const schema = require("./schema");
const { createQuery } = require("./query");
const { createRepository } = require("./repository");

function createDatabase(connectionString) {
  const pool = new Pool({ connectionString, max: 10 });
  const db = drizzle({ client: pool, schema });
  const query = createQuery(db, pool);
  return { ...createRepository(db, query), close: () => pool.end() };
}

module.exports = { createDatabase };
