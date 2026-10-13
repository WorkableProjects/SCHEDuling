import type { Config, Context } from '@netlify/functions';
import { and, eq, ne, sql } from 'drizzle-orm';
import { schema } from '../lib/db';
import { createRouter, publicUser, SESSION_COOKIE, startSession } from '../lib/router';
import { clientIp, cookie, HttpError, json, parseCookies, readJson } from '../lib/http';
import { hashPassword, sha256, verifyPassword } from '../lib/crypto';
import { activateSchema, changePasswordSchema, loginSchema, profileSchema, signupSchema } from '../../shared/schemas';
import { assertBucket, assertNotLocked, recordAttempt } from '../lib/ratelimit';
import { findToken } from '../lib/tokens';

const r = createRouter();

r.get('/api/auth/me', false, async ({ user, csrf }) =>
  json({ user: user ? publicUser(user) : null, csrfToken: csrf }));

r.post('/api/auth/login', false, async ({ req, db }) => {
  const body = await readJson(req, loginSchema);
  const ip = clientIp(req);
  await assertNotLocked(db, ip, body.email);
  const [u] = await db.select().from(schema.users).where(sql`lower(${schema.users.email}) = ${body.email}`).limit(1);
  const ok = await verifyPassword(body.password, u?.passwordHash);
  if (!u || !ok) {
    await recordAttempt(db, ip, body.email, false);
    throw new HttpError(401, 'Incorrect email or password', 'bad_credentials');
  }
  if (u.status === 'pending') throw new HttpError(403, 'This account has not been activated yet. Use your activation link.', 'pending');
  if (u.status === 'disabled') throw new HttpError(403, 'This account has been disabled', 'disabled');
  await recordAttempt(db, ip, body.email, true);
  const s = await startSession(req, db, u.id);
  return json({ user: publicUser(u), csrfToken: s.csrfToken }, { cookies: [s.cookie] });
});

r.post('/api/auth/logout', false, async ({ req, db }) => {
  const raw = parseCookies(req)[SESSION_COOKIE];
  if (raw) await db.delete(schema.authSessions).where(eq(schema.authSessions.tokenHash, sha256(raw)));
  return json({ ok: true }, { cookies: [cookie(req, SESSION_COOKIE, '', 0)] });
});

// Public sign-up always creates an attendee. There is no way to request another role here.
r.post('/api/auth/signup', false, async ({ req, db }) => {
  const body = await readJson(req, signupSchema);
  await assertBucket(db, clientIp(req), 'signup', 10, 60 * 60_000);
  const [exists] = await db.select({ id: schema.users.id }).from(schema.users).where(sql`lower(${schema.users.email}) = ${body.email}`).limit(1);
  if (exists) throw new HttpError(409, 'An account with this email already exists. Try signing in.', 'email_taken');
  const [u] = await db.insert(schema.users).values({
    email: body.email, name: body.name, passwordHash: await hashPassword(body.password), role: 'attendee', status: 'active',
  }).returning();
  const s = await startSession(req, db, u!.id);
  return json({ user: publicUser(u!), csrfToken: s.csrfToken }, { cookies: [s.cookie], status: 201 });
});

r.get('/api/auth/token/:token', false, async ({ db, params }) => {
  const t = await findToken(db, params.token!);
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, t.userId));
  return json({ purpose: t.purpose, email: u!.email, name: u!.name, role: u!.role });
});

// Activation, invite acceptance and password reset all end here: set a password and sign in.
r.post('/api/auth/activate', false, async ({ req, db }) => {
  const body = await readJson(req, activateSchema);
  const t = await findToken(db, body.token);
  const hash = await hashPassword(body.password);
  const [u] = await db.transaction(async (tx) => {
    const q = tx as unknown as typeof db;
    const claimed = await q.update(schema.oneTimeTokens).set({ usedAt: new Date() })
      .where(and(eq(schema.oneTimeTokens.id, t.id), sql`${schema.oneTimeTokens.usedAt} is null`)).returning();
    if (!claimed.length) throw new HttpError(400, 'This link was already used.', 'bad_token');
    if (t.purpose === 'reset') await q.delete(schema.authSessions).where(eq(schema.authSessions.userId, t.userId));
    return q.update(schema.users).set({ passwordHash: hash, status: 'active', ...(body.name ? { name: body.name } : {}) })
      .where(and(eq(schema.users.id, t.userId), ne(schema.users.status, 'disabled'))).returning();
  });
  if (!u) throw new HttpError(403, 'This account has been disabled', 'disabled');
  const s = await startSession(req, db, u.id);
  return json({ user: publicUser(u), csrfToken: s.csrfToken }, { cookies: [s.cookie] });
});

r.patch('/api/auth/me', 'any', async ({ req, db, user }) => {
  const body = await readJson(req, profileSchema);
  const [u] = await db.update(schema.users).set(body).where(eq(schema.users.id, user!.id)).returning();
  return json({ user: publicUser(u!) });
});

r.post('/api/auth/password', 'any', async ({ req, db, user }) => {
  const body = await readJson(req, changePasswordSchema);
  if (!(await verifyPassword(body.current, user!.passwordHash))) throw new HttpError(400, 'Current password is incorrect', 'bad_credentials');
  await db.update(schema.users).set({ passwordHash: await hashPassword(body.next) }).where(eq(schema.users.id, user!.id));
  // Sign out every other device.
  const raw = parseCookies(req)[SESSION_COOKIE];
  await db.delete(schema.authSessions).where(and(eq(schema.authSessions.userId, user!.id), ne(schema.authSessions.tokenHash, sha256(raw ?? ''))));
  return json({ ok: true });
});

r.post('/api/auth/ical-token/rotate', 'any', async ({ db, user }) => {
  const [u] = await db.update(schema.users)
    .set({ icalToken: sql`replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')` })
    .where(eq(schema.users.id, user!.id)).returning({ t: schema.users.icalToken });
  return json({ icalToken: u!.t });
});
r.get('/api/auth/ical-token', 'any', async ({ user }) => json({ icalToken: user!.icalToken }));

export default (req: Request, ctx: Context) => r.handler(req, ctx);
export const config: Config = { path: '/api/auth/*' };
