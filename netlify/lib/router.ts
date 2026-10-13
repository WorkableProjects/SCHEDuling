import type { Context } from '@netlify/functions';
import { and, eq, gt } from 'drizzle-orm';
import { getDb, schema, type DB } from './db';
import { cookie, errorResponse, forbidden, HttpError, notFound, parseCookies, unauthorized } from './http';
import { randomToken, safeEqual, sha256 } from './crypto';

export type Role = 'admin' | 'speaker' | 'attendee' | 'checkin_staff';
export type AuthUser = typeof schema.users.$inferSelect;

export const SESSION_COOKIE = 'sched_session';
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;

export type Ctx = {
  req: Request;
  url: URL;
  db: DB;
  params: Record<string, string>;
  user: AuthUser | null;
  csrf: string | null;
  netlify?: Context;
};

type Handler = (c: Ctx) => Promise<Response> | Response;
type Auth = false | 'any' | Role[];
type Route = { method: string; parts: string[]; auth: Auth; handler: Handler };

/** Collects routes for one function; `create()` returns the Netlify function handler. */
export function createRouter() {
  const list: Route[] = [];
  const add = (method: string) => (path: string, auth: Auth, handler: Handler) => {
    list.push({ method, parts: path.split('/').filter(Boolean), auth, handler });
  };
  return {
    get: add('GET'), post: add('POST'), put: add('PUT'), patch: add('PATCH'), delete: add('DELETE'),
    handler: async (req: Request, netlify?: Context): Promise<Response> => {
      try {
        const url = new URL(req.url);
        const segs = url.pathname.split('/').filter(Boolean);
        let pathMatched = false;
        for (const r of list) {
          const params = match(r.parts, segs);
          if (!params) continue;
          pathMatched = true;
          if (r.method !== req.method) continue;
          const db = getDb();
          const { user, csrf } = await loadSession(req, db);
          if (r.auth !== false) {
            if (!user) throw unauthorized();
            if (r.auth !== 'any' && !r.auth.includes(user.role)) throw forbidden();
          }
          if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) assertSameOriginAndCsrf(req, user ? csrf : null, !!user);
          return await r.handler({ req, url, db, params, user, csrf, netlify });
        }
        if (pathMatched) throw new HttpError(405, 'Method not allowed', 'method_not_allowed');
        throw notFound('No such endpoint');
      } catch (e) {
        return errorResponse(e);
      }
    },
  };
}

function match(pattern: string[], segs: string[]) {
  if (pattern.length !== segs.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i++) {
    const p = pattern[i]!;
    if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(segs[i]!);
    else if (p !== segs[i]) return null;
  }
  return params;
}

async function loadSession(req: Request, db: DB) {
  const raw = parseCookies(req)[SESSION_COOKIE];
  if (!raw) return { user: null, csrf: null };
  const rows = await db
    .select({ user: schema.users, csrf: schema.authSessions.csrfToken })
    .from(schema.authSessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.authSessions.userId))
    .where(and(eq(schema.authSessions.tokenHash, sha256(raw)), gt(schema.authSessions.expiresAt, new Date())))
    .limit(1);
  const row = rows[0];
  if (!row || row.user.status !== 'active') return { user: null, csrf: null };
  return { user: row.user, csrf: row.csrf };
}

function assertSameOriginAndCsrf(req: Request, csrf: string | null, needsCsrf: boolean) {
  const origin = req.headers.get('origin');
  if (origin && origin !== new URL(req.url).origin) throw forbidden('Cross-origin request blocked');
  if (!needsCsrf) return;
  const sent = req.headers.get('x-csrf-token');
  if (!csrf || !sent || !safeEqual(csrf, sent)) throw new HttpError(403, 'Missing or invalid CSRF token', 'csrf');
}

/** Creates a login session; returns Set-Cookie and the CSRF token for the client. */
export async function startSession(req: Request, db: DB, userId: string) {
  const token = randomToken(32);
  const csrfToken = randomToken(24);
  await db.insert(schema.authSessions).values({
    userId, tokenHash: sha256(token), csrfToken,
    expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000),
  });
  return { cookie: cookie(req, SESSION_COOKIE, token, SESSION_TTL_SECONDS), csrfToken };
}

export function publicUser(u: AuthUser) {
  return {
    id: u.id, email: u.email, name: u.name, role: u.role, title: u.title, org: u.org, bio: u.bio,
    hasPhoto: !!u.photoKey, status: u.status,
  };
}
