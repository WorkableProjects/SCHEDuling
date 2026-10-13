import { drizzle } from 'drizzle-orm/netlify-db';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import * as schema from '../database/schema';

// A transaction is also a PgDatabase, so helpers can take `DB` and work in either.
export type DB = PgDatabase<any, typeof schema>;

let instance: DB | undefined;

/**
 * On Netlify, NETLIFY_DB_URL is injected and drizzle() picks the right driver.
 * Locally / in tests, set NETLIFY_DB_URL to a local Postgres and NETLIFY_DB_DRIVER=server.
 */
export function getDb(): DB {
  instance ??= drizzle({ schema }) as unknown as DB;
  return instance;
}

export { schema };
