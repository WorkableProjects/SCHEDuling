import type { Config, Context } from '@netlify/functions';
import { and, eq, inArray, or } from 'drizzle-orm';
import { schema } from '../lib/db';
import { createRouter } from '../lib/router';
import { notFound, text } from '../lib/http';
import { buildIcs, type IcsEvent } from '../lib/ical';

const r = createRouter();

// Calendar apps can't send cookies, so the feed is addressed by a long secret token (rotatable from the account page).
r.get('/api/ical/:token', false, async ({ db, params, url }) => {
  const token = params.token!.replace(/\.ics$/i, '');
  const [u] = await db.select().from(schema.users).where(eq(schema.users.icalToken, token));
  if (!u || u.status !== 'active') throw notFound();
  const memberships = await db.select({ eventId: schema.eventMembers.eventId }).from(schema.eventMembers).where(eq(schema.eventMembers.userId, u.id));
  const eventIds = memberships.map((m) => m.eventId);
  const items: IcsEvent[] = [];
  if (eventIds.length) {
    const [added, regs] = await Promise.all([
      db.select({ id: schema.agendaItems.sessionId }).from(schema.agendaItems).where(eq(schema.agendaItems.userId, u.id)),
      db.select({ id: schema.sessionRegistrations.sessionId }).from(schema.sessionRegistrations).where(and(eq(schema.sessionRegistrations.userId, u.id), eq(schema.sessionRegistrations.status, 'registered'))),
    ]);
    const ids = [...new Set([...added, ...regs].map((x) => x.id))];
    const rows = await db.select({ s: schema.sessions, room: schema.rooms.name, event: schema.events })
      .from(schema.sessions).innerJoin(schema.events, eq(schema.events.id, schema.sessions.eventId)).leftJoin(schema.rooms, eq(schema.rooms.id, schema.sessions.roomId))
      .where(and(
        inArray(schema.sessions.eventId, eventIds), inArray(schema.sessions.status, ['published', 'cancelled']), eq(schema.events.published, true),
        or(eq(schema.sessions.pinned, true), ids.length ? inArray(schema.sessions.id, ids) : undefined),
      ));
    for (const x of rows) {
      items.push({
        uid: x.s.id, title: x.s.title, description: x.s.description, start: x.s.startsAt, end: x.s.endsAt, cancelled: x.s.status === 'cancelled',
        location: [x.room, x.event.location].filter(Boolean).join(', ') || null, url: `${url.origin}/e/${x.event.slug}/session/${x.s.id}`,
      });
    }
  }
  return text(buildIcs('SCHEDuling agenda', items), 'text/calendar; charset=utf-8', { headers: { 'content-disposition': 'inline; filename="agenda.ics"' } });
});

export default (req: Request, ctx: Context) => r.handler(req, ctx);
export const config: Config = { path: '/api/ical/*' };
