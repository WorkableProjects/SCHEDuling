import type { Config, Context } from '@netlify/functions';
import { and, asc, eq, ilike, or, sql } from 'drizzle-orm';
import { schema, type DB } from '../lib/db';
import { createRouter } from '../lib/router';
import { conflict, forbidden, json, notFound, readJson } from '../lib/http';
import { manualCheckinSchema, scanSchema, selfCheckinSchema } from '../../shared/schemas';
import { getEventByIdOrSlug, getMembership, type EventRow } from '../lib/permissions';
import { eventWindow } from '../lib/time';
import { audit } from '../lib/audit';
import { checkinStats } from '../lib/stats';

const r = createRouter();
const STAFF: ('admin' | 'checkin_staff')[] = ['admin', 'checkin_staff'];
const SELF_WINDOW_MS = 30 * 60_000;

type Method = 'qr' | 'manual' | 'self';

/**
 * Records event-level (and optionally session-level) check-in. Idempotent: repeating it returns
 * `alreadyCheckedIn: true` with the original timestamp instead of an error or a duplicate row.
 */
async function performCheckin(db: DB, ev: EventRow, userId: string, sessionId: string | undefined, method: Method, byUserId: string) {
  const [person] = await db.select({ id: schema.users.id, name: schema.users.name, email: schema.users.email, ticketType: schema.eventMembers.ticketType, checkedInAt: schema.eventMembers.checkedInAt })
    .from(schema.eventMembers).innerJoin(schema.users, eq(schema.users.id, schema.eventMembers.userId))
    .where(and(eq(schema.eventMembers.eventId, ev.id), eq(schema.eventMembers.userId, userId)));
  if (!person) throw notFound('That person is not registered for this event');

  const now = new Date();
  const claimed = await db.update(schema.eventMembers).set({ checkedInAt: now })
    .where(and(eq(schema.eventMembers.eventId, ev.id), eq(schema.eventMembers.userId, userId), sql`${schema.eventMembers.checkedInAt} is null`)).returning({ at: schema.eventMembers.checkedInAt });
  const eventResult = claimed.length
    ? { alreadyCheckedIn: false, at: now.toISOString() }
    : { alreadyCheckedIn: true, at: person.checkedInAt?.toISOString() ?? now.toISOString() };

  let sessionResult: { id: string; title: string; alreadyCheckedIn: boolean; at: string; warning?: string } | undefined;
  if (sessionId) {
    const [s] = await db.select().from(schema.sessions).where(and(eq(schema.sessions.id, sessionId), eq(schema.sessions.eventId, ev.id)));
    if (!s) throw notFound('Session not found in this event');
    if (s.status !== 'published') throw conflict('This session is not published');
    const inserted = await db.insert(schema.sessionCheckins).values({ sessionId, userId, method, byUserId, at: now }).onConflictDoNothing().returning();
    let at = now;
    if (!inserted.length) {
      const [old] = await db.select().from(schema.sessionCheckins).where(and(eq(schema.sessionCheckins.sessionId, sessionId), eq(schema.sessionCheckins.userId, userId)));
      at = old?.at ?? now;
    }
    let warning: string | undefined;
    if (s.requiresRegistration) {
      const [reg] = await db.select().from(schema.sessionRegistrations).where(and(eq(schema.sessionRegistrations.sessionId, sessionId), eq(schema.sessionRegistrations.userId, userId)));
      if (!reg) warning = 'Not registered for this session';
      else if (reg.status === 'waitlisted') warning = 'On the waitlist for this session';
    }
    sessionResult = { id: s.id, title: s.title, alreadyCheckedIn: !inserted.length, at: at.toISOString(), warning };
  }
  return { person: { id: person.id, name: person.name, email: person.email, ticketType: person.ticketType }, event: eventResult, session: sessionResult };
}

r.post('/api/checkin/:eventId/scan', STAFF, async (c) => {
  const ev = await getEventByIdOrSlug(c.db, c.params.eventId!);
  const b = await readJson(c.req, scanSchema);
  const token = b.qrToken.replace(/^sched:/, '').trim();
  const [m] = await c.db.select({ userId: schema.eventMembers.userId }).from(schema.eventMembers)
    .where(and(eq(schema.eventMembers.qrToken, token), eq(schema.eventMembers.eventId, ev.id)));
  if (!m) throw notFound('Unrecognised QR code for this event');
  return json(await performCheckin(c.db, ev, m.userId, b.sessionId, 'qr', c.user!.id));
});

r.post('/api/checkin/:eventId/manual', STAFF, async (c) => {
  const ev = await getEventByIdOrSlug(c.db, c.params.eventId!);
  const b = await readJson(c.req, manualCheckinSchema);
  return json(await performCheckin(c.db, ev, b.userId, b.sessionId, 'manual', c.user!.id));
});

r.post('/api/checkin/:eventId/self', 'any', async (c) => {
  const ev = await getEventByIdOrSlug(c.db, c.params.eventId!);
  if (!ev.settings.selfCheckin) throw forbidden('Self check-in is not enabled for this event');
  if (!(await getMembership(c.db, ev.id, c.user!.id))) throw forbidden('You are not registered for this event');
  const { sessionId } = await readJson(c.req, selfCheckinSchema);
  const now = Date.now();
  if (sessionId) {
    const [s] = await c.db.select().from(schema.sessions).where(and(eq(schema.sessions.id, sessionId), eq(schema.sessions.eventId, ev.id)));
    if (!s) throw notFound('Session not found');
    if (Math.abs(now - s.startsAt.getTime()) > SELF_WINDOW_MS) throw conflict('Self check-in opens 30 minutes before the session starts and closes 30 minutes after.');
    if (s.requiresRegistration) {
      const [reg] = await c.db.select().from(schema.sessionRegistrations).where(and(eq(schema.sessionRegistrations.sessionId, s.id), eq(schema.sessionRegistrations.userId, c.user!.id), eq(schema.sessionRegistrations.status, 'registered')));
      if (!reg) throw forbidden('You need to be registered for this session to check in');
    }
  } else {
    const w = eventWindow(ev.startDate, ev.endDate, ev.tz);
    if (now < w.start.getTime() || now > w.end.getTime()) throw conflict('Event check-in is only open on the event dates.');
  }
  return json(await performCheckin(c.db, ev, c.user!.id, sessionId, 'self', c.user!.id));
});

r.delete('/api/checkin/:eventId/:userId', ['admin'], async (c) => {
  const ev = await getEventByIdOrSlug(c.db, c.params.eventId!);
  const sessionId = c.url.searchParams.get('sessionId');
  if (sessionId) {
    await c.db.delete(schema.sessionCheckins).where(and(eq(schema.sessionCheckins.sessionId, sessionId), eq(schema.sessionCheckins.userId, c.params.userId!)));
  } else {
    await c.db.update(schema.eventMembers).set({ checkedInAt: null }).where(and(eq(schema.eventMembers.eventId, ev.id), eq(schema.eventMembers.userId, c.params.userId!)));
  }
  await audit(c.db, c.user!.id, 'checkin.undo', 'user', c.params.userId!, { eventId: ev.id, sessionId });
  return json({ ok: true });
});

r.get('/api/checkin/:eventId/search', STAFF, async (c) => {
  const ev = await getEventByIdOrSlug(c.db, c.params.eventId!);
  const q = (c.url.searchParams.get('q') ?? '').trim().replace(/[%_]/g, '');
  const sessionId = c.url.searchParams.get('sessionId');
  if (q.length < 1) return json({ people: [] });
  const rows = await c.db.select({
    userId: schema.users.id, name: schema.users.name, email: schema.users.email, ticketType: schema.eventMembers.ticketType, checkedInAt: schema.eventMembers.checkedInAt,
  }).from(schema.eventMembers).innerJoin(schema.users, eq(schema.users.id, schema.eventMembers.userId))
    .where(and(eq(schema.eventMembers.eventId, ev.id), or(ilike(schema.users.name, `%${q}%`), ilike(schema.users.email, `%${q}%`))))
    .orderBy(asc(schema.users.name)).limit(25);
  const sessionDone = new Set<string>();
  if (sessionId && rows.length) {
    (await c.db.select({ u: schema.sessionCheckins.userId }).from(schema.sessionCheckins).where(eq(schema.sessionCheckins.sessionId, sessionId))).forEach((x) => sessionDone.add(x.u));
  }
  return json({ people: rows.map((p) => ({ ...p, sessionCheckedIn: sessionId ? sessionDone.has(p.userId) : undefined })) });
});

r.get('/api/checkin/:eventId/sessions', STAFF, async (c) => {
  const ev = await getEventByIdOrSlug(c.db, c.params.eventId!);
  const rows = await c.db.select({ id: schema.sessions.id, title: schema.sessions.title, startsAt: schema.sessions.startsAt }).from(schema.sessions)
    .where(and(eq(schema.sessions.eventId, ev.id), eq(schema.sessions.status, 'published'))).orderBy(asc(schema.sessions.startsAt));
  return json({ sessions: rows.map((s) => ({ ...s, startsAt: s.startsAt.toISOString() })), event: { id: ev.id, name: ev.name, slug: ev.slug, tz: ev.tz } });
});

r.get('/api/checkin/:eventId/stats', STAFF, async (c) => {
  const ev = await getEventByIdOrSlug(c.db, c.params.eventId!);
  return json(await checkinStats(c.db, ev.id));
});

export default (req: Request, ctx: Context) => r.handler(req, ctx);
export const config: Config = { path: '/api/checkin/*' };
