import { drizzle } from "drizzle-orm/d1";

import { sermons, siteState } from "./schema";

function buildDatabase(database: D1Database) {
  // Only these two tables use Drizzle's relational query API. Ordinary typed
  // select/insert/update statements import their tables directly; registering
  // every generation table here rebuilds unused relation metadata per request.
  return drizzle(database, { schema: { sermons, siteState } });
}

// Reuse only the query builder/schema metadata for the same D1 binding. No rows
// or prepared results are cached; authority reads still execute against D1.
const clients = new WeakMap<D1Database, ReturnType<typeof buildDatabase>>();
export function createDatabase(database: D1Database) {
  let client = clients.get(database);
  if (!client) { client = buildDatabase(database); clients.set(database, client); }
  return client;
}

export type Database = ReturnType<typeof createDatabase>;
