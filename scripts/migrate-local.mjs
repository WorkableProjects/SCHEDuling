// Applies netlify/database/migrations/*.sql, in order, to a local Postgres (NETLIFY_DB_URL).
// Netlify does this itself on deploy; this script is only for local dev and tests.
import { readdirSync, readFileSync } from 'node:fs';
import pg from 'pg';
const url = process.env.NETLIFY_DB_URL || process.env.TEST_DATABASE_URL;
if (!url) throw new Error('Set NETLIFY_DB_URL (local Postgres) first');
const dir = new URL('../netlify/database/migrations/', import.meta.url);
const client = new pg.Client({ connectionString: url });
await client.connect();
await client.query('create table if not exists _local_migrations (name text primary key)');
for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
  const done = await client.query('select 1 from _local_migrations where name=$1', [f]);
  if (done.rowCount) continue;
  await client.query('begin');
  try {
    await client.query(readFileSync(new URL(f, dir), 'utf8'));
    await client.query('insert into _local_migrations values ($1)', [f]);
    await client.query('commit');
    console.log('applied', f);
  } catch (e) { await client.query('rollback'); throw e; }
}
await client.end();
