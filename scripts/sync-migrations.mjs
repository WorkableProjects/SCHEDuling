// Copies drizzle-kit's generated SQL into netlify/database/migrations, which is the
// folder Netlify applies on every deploy. Netlify wants `<number>_<slug>.sql` files only.
import { readdirSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
const src = 'db/drizzle';
const dest = 'netlify/database/migrations';
mkdirSync(dest, { recursive: true });
if (!existsSync(src)) process.exit(0);
for (const f of readdirSync(src)) {
  if (/^\d+_[a-z0-9_-]+\.sql$/.test(f)) copyFileSync(`${src}/${f}`, `${dest}/${f}`);
}
console.log('migrations synced to', dest);
