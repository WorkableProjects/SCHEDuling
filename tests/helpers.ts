import { vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { getDb } from '../netlify/lib/db';
import * as schema from '../netlify/database/schema';

// In-memory stand-in for Netlify Blobs.
const blobs = new Map<string, { data: ArrayBuffer; metadata?: Record<string, unknown> }>();
vi.mock('@netlify/blobs', () => ({
  getStore: () => ({
    set: async (k: string, data: ArrayBuffer, o?: { metadata?: Record<string, unknown> }) => { blobs.set(k, { data, metadata: o?.metadata }); },
    get: async (k: string) => blobs.get(k)?.data ?? null,
    getWithMetadata: async (k: string) => (blobs.has(k) ? { data: blobs.get(k)!.data, metadata: blobs.get(k)!.metadata } : null),
    delete: async (k: string) => { blobs.delete(k); },
  }),
}));

import setup from '../netlify/functions/setup';
import auth from '../netlify/functions/auth';
import events from '../netlify/functions/events';
import sessions from '../netlify/functions/sessions';
import people from '../netlify/functions/people';
import agenda from '../netlify/functions/agenda';
import checkin from '../netlify/functions/checkin';
import comms from '../netlify/functions/comms';
import reports from '../netlify/functions/reports';
import files from '../netlify/functions/files';
import ical from '../netlify/functions/ical';

type H = (req: Request, ctx: never) => Promise<Response>;
const handlers: [string, H][] = [
  ['/api/setup', setup as H], ['/api/auth/', auth as H], ['/api/events', events as H], ['/api/sessions', sessions as H],
  ['/api/people/', people as H], ['/api/agenda', agenda as H], ['/api/checkin/', checkin as H], ['/api/comms/', comms as H],
  ['/api/reports/', reports as H], ['/api/files/', files as H], ['/api/ical/', ical as H],
];

export const ORIGIN = 'https://scheduling.test';
export const db = getDb();

export async function resetDb() {
  await db.execute(sql`truncate table ${sql.raw(
    ['users', 'events', 'login_attempts', 'audit_log'].join(', '),
  )} restart identity cascade`);
  blobs.clear();
}

export class Client {
  cookies = new Map<string, string>();
  csrf: string | null = null;
  ip = '203.0.113.' + Math.floor(Math.random() * 250);
  user: { id: string; email: string; role: string; name: string } | null = null;

  async call(method: string, path: string, body?: unknown, extra: { headers?: Record<string, string>; raw?: BodyInit } = {}) {
    const url = new URL(path, ORIGIN);
    const h = handlers.find(([p]) => url.pathname.startsWith(p));
    if (!h) throw new Error('No handler for ' + path);
    const headers = new Headers(extra.headers);
    headers.set('x-nf-client-connection-ip', this.ip);
    if (this.cookies.size) headers.set('cookie', [...this.cookies].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; '));
    if (this.csrf && method !== 'GET') headers.set('x-csrf-token', this.csrf);
    let init: RequestInit = { method, headers };
    if (extra.raw) init.body = extra.raw;
    else if (body !== undefined) { headers.set('content-type', 'application/json'); init.body = JSON.stringify(body); }
    const res = await h[1](new Request(url, init), {} as never);
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair!.indexOf('=');
      const name = pair!.slice(0, i);
      const value = decodeURIComponent(pair!.slice(i + 1));
      if (/Max-Age=0/i.test(c) || value === '') this.cookies.delete(name); else this.cookies.set(name, value);
    }
    const ct = res.headers.get('content-type') ?? '';
    const data = ct.includes('json') ? await res.json() : await res.text();
    const out = { status: res.status, data: data as any, headers: res.headers };
    if (out.data && typeof out.data === 'object' && out.data.csrfToken) { this.csrf = out.data.csrfToken; this.user = out.data.user; }
    return out;
  }
  get = (p: string) => this.call('GET', p);
  post = (p: string, b?: unknown) => this.call('POST', p, b ?? {});
  patch = (p: string, b?: unknown) => this.call('PATCH', p, b ?? {});
  put = (p: string, b?: unknown) => this.call('PUT', p, b);
  del = (p: string) => this.call('DELETE', p);

  async login(email: string, password: string) {
    const r = await this.post('/api/auth/login', { email, password });
    if (r.status !== 200) throw new Error(`login failed ${r.status} ${JSON.stringify(r.data)}`);
    return r;
  }
}

export const PASSWORD = 'correct horse battery';

/** Bootstraps the two admins and returns logged-in clients for both. */
export async function makeAdmins() {
  const anon = new Client();
  const res = await anon.post('/api/setup', { token: process.env.ADMIN_BOOTSTRAP_TOKEN, emails: ['ada@example.com', 'grace@example.com'] });
  if (res.status !== 200) throw new Error('setup failed ' + JSON.stringify(res.data));
  const out: Client[] = [];
  for (const l of res.data.links as { link: string }[]) {
    const c = new Client();
    const token = l.link.split('/activate/')[1]!;
    const a = await c.post('/api/auth/activate', { token, password: PASSWORD });
    if (a.status !== 200) throw new Error('activate failed ' + JSON.stringify(a.data));
    out.push(c);
  }
  return out as [Client, Client];
}

export async function signup(name: string, email = `${name.toLowerCase().replace(/\W/g, '')}@example.com`) {
  const c = new Client();
  const r = await c.post('/api/auth/signup', { name, email, password: PASSWORD });
  if (r.status !== 201) throw new Error('signup failed ' + JSON.stringify(r.data));
  return c;
}

export async function makeEvent(admin: Client, over: Record<string, unknown> = {}) {
  const r = await admin.post('/api/events', {
    slug: 'summit', name: 'Summit 2030', tz: 'America/Los_Angeles', startDate: '2030-05-01', endDate: '2030-05-02',
    privacy: 'public', ...over,
  });
  if (r.status !== 201) throw new Error('event failed ' + JSON.stringify(r.data));
  const publish = await admin.post(`/api/events/${r.data.event.id}/publish`);
  return publish.data.event as { id: string; slug: string };
}

export async function makeSession(admin: Client, eventId: string, over: Record<string, unknown> = {}) {
  const r = await admin.post('/api/sessions', {
    eventId, title: 'Opening keynote', startsAt: '2030-05-01T17:00:00Z', endsAt: '2030-05-01T18:00:00Z', status: 'published', ...over,
  });
  if (r.status !== 201) throw new Error('session failed ' + JSON.stringify(r.data));
  return r.data.session as { id: string };
}

export async function join(c: Client, slug: string) {
  const r = await c.post(`/api/events/${slug}/join`);
  if (r.status >= 300) throw new Error('join failed ' + JSON.stringify(r.data));
  return r.data.membership as { qrToken: string; userId: string };
}

