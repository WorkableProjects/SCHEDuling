import type { Config, Context } from '@netlify/functions';
import { and, asc, eq, inArray, or } from 'drizzle-orm';
import { schema } from '../lib/db';
import { createRouter } from '../lib/router';
import { badRequest, conflict, forbidden, json, notFound } from '../lib/http';
import { getEventByIdOrSlug, getMembership, isAdmin, requireViewEvent } from '../lib/permissions';
import { sessionDtos } from '../lib/sessions';

const r = createRouter();

/**
 * Personal schedule = pinned sessions (everyone gets them) + sessions the user added + sessions they are registered for.
 * Adding to the agenda is NOT registration: it does not reserve a seat or touch capacity.
 */
r.get('/api/agenda', 'any', async (c) => {
  const eventId = c.url.searchParams.get('eventId');
  if (!eventId) throw badRequest('eventId is required');
  const ev = await getEventByIdOrSlug(c.db, eventId);
  await requireViewEvent(c, ev);
  const uid = c.user!.id;
  const [added, regs] = await Promise.all([
    c.db.select({ id: schema.agendaItems.sessionId }).from(schema.agendaItems).innerJoin(schema.sessions, eq(schema.sessions.id, schema.agendaItems.sessionId))
      .where(and(eq(schema.agendaItems.userId, uid), eq(schema.sessions.eventId, ev.id))),
    c.db.select({ id: schema.sessionRegistrations.sessionId }).from(schema.sessionRegistrations).innerJoin(schema.sessions, eq(schema.sessions.id, schema.sessionRegistrations.sessionId))
      .where(and(eq(schema.sessionRegistrations.userId, uid), eq(schema.sessions.eventId, ev.id))),
  ]);
  const ids = [...new Set([...added.map((x) => x.id), ...regs.map((x) => x.id)])];
  const rows = await c.db.select().from(schema.sessions).where(and(
    eq(schema.sessions.eventId, ev.id), inArray(schema.sessions.status, ['published', 'cancelled']),
    or(eq(schema.sessions.pinned, true), ids.length ? inArray(schema.sessions.id, ids) : undefined),
  )).orderBy(asc(schema.sessions.startsAt));
  const dtos = await sessionDtos(c.db, ev, rows, c.user, { admin: isAdmin(c.user) });
  return json({ sessions: dtos.map((s) => ({ ...s, reason: s.mine?.registration ? 'registered' : s.mine?.inAgenda ? 'agenda' : 'pinned' })) });
});

r.post('/api/agenda/:sessionId', 'any', async (c) => {
  const [s] = await c.db.select().from(schema.sessions).where(eq(schema.sessions.id, c.params.sessionId!));
  if (!s || s.status === 'draft') throw notFound('Session not found');
  const [ev] = await c.db.select().from(schema.events).where(eq(schema.events.id, s.eventId));
  await requireViewEvent(c, ev!);
  if (!(await getMembership(c.db, ev!.id, c.user!.id))) throw forbidden('Join this event to build an agenda');
  if (!isAdmin(c.user) && (s.frozen || ev!.settings.scheduleFrozen)) throw forbidden('This session is frozen: it can no longer be added or removed');
  await c.db.insert(schema.agendaItems).values({ userId: c.user!.id, sessionId: s.id }).onConflictDoNothing();
  return json({ ok: true }, { status: 201 });
});

r.delete('/api/agenda/:sessionId', 'any', async (c) => {
  const [s] = await c.db.select().from(schema.sessions).where(eq(schema.sessions.id, c.params.sessionId!));
  if (!s) throw notFound('Session not found');
  const [ev] = await c.db.select().from(schema.events).where(eq(schema.events.id, s.eventId));
  if (!isAdmin(c.user) && (s.frozen || ev!.settings.scheduleFrozen)) throw forbidden('This session is frozen: it can no longer be added or removed');
  const [reg] = await c.db.select({ id: schema.sessionRegistrations.id }).from(schema.sessionRegistrations)
    .where(and(eq(schema.sessionRegistrations.sessionId, s.id), eq(schema.sessionRegistrations.userId, c.user!.id)));
  if (reg) throw conflict('You are registered for this session. Cancel your registration to remove it.');
  await c.db.delete(schema.agendaItems).where(and(eq(schema.agendaItems.sessionId, s.id), eq(schema.agendaItems.userId, c.user!.id)));
  return json({ ok: true, stillPinned: s.pinned });
});

export default (req: Request, ctx: Context) => r.handler(req, ctx);
export const config: Config = { path: ['/api/agenda', '/api/agenda/*'] };
