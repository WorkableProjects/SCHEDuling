import type { Config, Context } from '@netlify/functions';
import { sql } from 'drizzle-orm';
import { schema } from '../lib/db';
import { createRouter } from '../lib/router';
import { json, notFound, readJson, HttpError, clientIp } from '../lib/http';
import { safeEqual, sha256 } from '../lib/crypto';
import { setupSchema } from '../../shared/schemas';
import { bootstrapAdmins } from '../lib/admins';
import { issueToken, tokenLink } from '../lib/tokens';
import { assertBucket } from '../lib/ratelimit';
import { audit } from '../lib/audit';
import { eq } from 'drizzle-orm';

const r = createRouter();

async function adminExists(db: Parameters<Parameters<typeof r.get>[2]>[0]['db']) {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.users).where(eq(schema.users.role, 'admin'));
  return (row?.n ?? 0) > 0;
}

// One-time bootstrap. 404s forever once any admin exists.
r.get('/api/setup', false, async ({ db }) => {
  if (await adminExists(db)) throw notFound();
  if (!process.env.ADMIN_BOOTSTRAP_TOKEN) {
    throw new HttpError(503, 'Setup is not enabled: set the ADMIN_BOOTSTRAP_TOKEN environment variable in the Netlify UI and redeploy.', 'not_configured');
  }
  return json({ available: true });
});

r.post('/api/setup', false, async ({ req, db }) => {
  if (await adminExists(db)) throw notFound();
  const expected = process.env.ADMIN_BOOTSTRAP_TOKEN;
  if (!expected) throw new HttpError(503, 'Setup is not enabled: ADMIN_BOOTSTRAP_TOKEN is not set.', 'not_configured');
  await assertBucket(db, clientIp(req), 'setup', 10, 15 * 60_000);
  const body = await readJson(req, setupSchema);
  // Compare hashes so the comparison is constant-length.
  if (!safeEqual(sha256(body.token), sha256(expected))) throw new HttpError(403, 'Wrong setup token', 'forbidden');
  const admins = await bootstrapAdmins(db, body.emails);
  if (!admins) throw notFound();
  const links: { email: string; link: string }[] = [];
  for (const a of admins) links.push({ email: a.email, link: tokenLink(req, await issueToken(db, a.id, 'activate')) });
  await audit(db, null, 'setup.bootstrap', 'user', null, { emails: body.emails });
  return json({ links });
});

export default (req: Request, ctx: Context) => r.handler(req, ctx);
export const config: Config = { path: '/api/setup' };
