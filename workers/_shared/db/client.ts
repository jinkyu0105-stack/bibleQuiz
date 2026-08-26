import { drizzle } from "drizzle-orm/d1";

import { foundationSchema } from "./schema";

export function createDatabase(database: D1Database) {
  return drizzle(database, { schema: foundationSchema });
}

export type Database = ReturnType<typeof createDatabase>;
