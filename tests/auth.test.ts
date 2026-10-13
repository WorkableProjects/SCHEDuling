import { beforeEach, describe, expect, it } from 'vitest';
import { Client, PASSWORD, db, makeAdmins, resetDb, signup } from './helpers';
import * as schema from '../netlify/database/schema';
import { sql } from 'drizzle-orm';

beforeEach(resetDb);

describe('admin bootstrap', () => {
  it('is unavailable without the right token', async () => {
    const c = new Client();
    expect((await c.get('/api/setup')).status).toBe(200);
    const bad = await c.post('/api/setup', { token: 'nope', emails: ['a@example.com', 'b@example.com'] });
    expect(bad.status).toBe(403);
    const n = await db.select({ n: sql<number>`count(*)::int` }).from(schema.users);
    expect(n[0]!.n).toBe(0);
  });

  it('creates exactly two pending admins with no passwords, then 404s forever', async () => {
    const c = new Client();
    const ok = await c.post('/api/setup', { token: 'test-bootstrap-token', emails: ['a@example.com', 'b@example.com'] });
    expect(ok.status).toBe(200);
    expect(ok.data.links).toHaveLength(2);
    const users = await db.select().from(schema.users);
    expect(users.map((u) => [u.role, u.status, u.passwordHash])).toEqual([['admin', 'pending', null], ['admin', 'pending', null]]);
    // can't sign in before activation, no default password
    expect((await c.post('/api/auth/login', { email: 'a@example.com', password: 'admin' })).status).toBe(401);
    expect((await c.get('/api/setup')).status).toBe(404);
    expect((await c.post('/api/setup', { token: 'test-bootstrap-token', emails: ['x@example.com', 'y@example.com'] })).status).toBe(404);
  });

  it('requires exactly two distinct emails', async () => {
    const c = new Client();
    expect((await c.post('/api/setup', { token: 'test-bootstrap-token', emails: ['a@example.com'] })).status).toBe(400);
    expect((await c.post('/api/setup', { token: 'test-bootstrap-token', emails: ['a@example.com', 'a@example.com'] })).status).toBe(400);
  });

  it('activation links are single-use', async () => {
    const c = new Client();
    const ok = await c.post('/api/setup', { token: 'test-bootstrap-token', emails: ['a@example.com', 'b@example.com'] });
    const token = ok.data.links[0].link.split('/activate/')[1];
    expect((await new Client().post('/api/auth/activate', { token, password: PASSWORD })).status).toBe(200);
    expect((await new Client().post('/api/auth/activate', { token, password: PASSWORD + 'x' })).status).toBe(400);
  });
});

describe('admin cap', () => {
  it('refuses a third admin and refuses removing the last one', async () => {
    const [ada, grace] = await makeAdmins();
    const bob = await signup('Bob');
    const refused = await ada.patch(`/api/people/users/${bob.user!.id}/role`, { role: 'admin' });
    expect(refused.status).toBe(409);
    expect(refused.data.code).toBe('admin_cap');
    // demote grace (allowed: ada remains), then ada can't be demoted as the last admin
    expect((await ada.patch(`/api/people/users/${grace.user!.id}/role`, { role: 'attendee' })).status).toBe(200);
    expect((await ada.patch(`/api/people/users/${ada.user!.id}/role`, { role: 'attendee' })).status).toBe(409);
    expect((await ada.post(`/api/people/users/${ada.user!.id}/disable`)).status).toBe(409);
  });

  it('holds under concurrent promotions', async () => {
    const [ada] = await makeAdmins();
    const people = await Promise.all(['P1', 'P2', 'P3', 'P4', 'P5'].map((n) => signup(n)));
    // free a slot, then race five promotions for it
    await ada.patch(`/api/people/users/${(await db.select().from(schema.users).where(sql`email = 'grace@example.com'`))[0]!.id}/role`, { role: 'attendee' });
    const results = await Promise.all(people.map((p) => ada.patch(`/api/people/users/${p.user!.id}/role`, { role: 'admin' })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.users).where(sql`role = 'admin'`) as [{ n: number }];
    expect(n).toBe(2);
  });
});

describe('sessions, CSRF and rate limiting', () => {
  it('public signup is always an attendee', async () => {
    const c = new Client();
    const r = await c.call('POST', '/api/auth/signup', { name: 'Eve', email: 'eve@example.com', password: PASSWORD, role: 'admin' });
    expect(r.status).toBe(201);
    expect(r.data.user.role).toBe('attendee');
  });

  it('rejects mutating requests without a CSRF token', async () => {
    const c = await signup('Dana');
    const token = c.csrf;
    c.csrf = null;
    expect((await c.patch('/api/auth/me', { name: 'D', title: null, org: null, bio: null })).status).toBe(403);
    c.csrf = token;
    expect((await c.patch('/api/auth/me', { name: 'Dana K', title: null, org: null, bio: null })).status).toBe(200);
  });

  it('rejects cross-origin writes', async () => {
    const c = await signup('Mal');
    const r = await c.call('PATCH', '/api/auth/me', { name: 'x', title: null, org: null, bio: null }, { headers: { origin: 'https://evil.example' } });
    expect(r.status).toBe(403);
  });

  it('stores only a hash of the session token and sets HttpOnly cookies', async () => {
    const c = new Client();
    const r = await c.post('/api/auth/signup', { name: 'Hal', email: 'hal@example.com', password: PASSWORD });
    const cookie = r.headers.getSetCookie()[0]!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Secure/);
    const raw = c.cookies.get('sched_session')!;
    const rows = await db.select().from(schema.authSessions);
    expect(rows[0]!.tokenHash).not.toBe(raw);
    expect(rows[0]!.tokenHash).toHaveLength(64);
  });

  it('locks out after repeated failures', async () => {
    await signup('Lena', 'lena@example.com');
    const c = new Client();
    for (let i = 0; i < 5; i++) expect((await c.post('/api/auth/login', { email: 'lena@example.com', password: 'wrong-password' })).status).toBe(401);
    expect((await c.post('/api/auth/login', { email: 'lena@example.com', password: PASSWORD })).status).toBe(429);
  });

  it('password reset links work once and sign out old sessions', async () => {
    const [ada] = await makeAdmins();
    const u = await signup('Reset Me', 'reset@example.com');
    const link = await ada.post(`/api/people/users/${u.user!.id}/link`);
    expect(link.data.purpose).toBe('reset');
    expect(link.data.expiresInMinutes).toBe(60);
    const token = link.data.link.split('/activate/')[1];
    const fresh = new Client();
    expect((await fresh.post('/api/auth/activate', { token, password: 'a brand new password' })).status).toBe(200);
    expect((await u.get('/api/auth/me')).data.user).toBeNull();
    expect((await new Client().login('reset@example.com', 'a brand new password')).status).toBe(200);
  });

  it('disabled users cannot sign in or keep sessions', async () => {
    const [ada] = await makeAdmins();
    const u = await signup('Gone', 'gone@example.com');
    await ada.post(`/api/people/users/${u.user!.id}/disable`);
    expect((await u.get('/api/auth/me')).data.user).toBeNull();
    expect((await new Client().post('/api/auth/login', { email: 'gone@example.com', password: PASSWORD })).status).toBe(403);
  });
});
