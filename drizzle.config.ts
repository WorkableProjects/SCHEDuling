import { defineConfig } from 'drizzle-kit';

// drizzle-kit keeps its snapshots in db/drizzle. scripts/sync-migrations.mjs
// copies the SQL files into netlify/database/migrations, the only folder
// Netlify reads (it requires `<number>_<slug>.sql` and nothing else).
export default defineConfig({
  dialect: 'postgresql',
  schema: './netlify/database/schema.ts',
  out: './db/drizzle',
});
