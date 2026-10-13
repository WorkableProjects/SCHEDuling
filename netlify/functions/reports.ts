import type { Config, Context } from '@netlify/functions';
import { asc, desc, eq, lt, sql } from 'drizzle-orm';
import { schema } from '../lib/db';
import { createRouter } from '../lib/router';
import { badRequest, csv, json } from '../lib/http';
import { getEventByIdOrSlug } from '../lib/permissions';
import { checkinStats } from '../lib/stats';

const r = createRouter();

r.get('/api/reports/dashboard', ['admin'], async ({ db }) => {
  const [users] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.users);
  const [admins] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.users).where(eq(schema.users.role, 'admin'));
  const events = await db.select().from(schema.events).orderBy(desc(schema.events.startDate));
  const rows = await Promise.all(events.map(async (e) => {
    const s = await checkinStats(db, e.id);
    const [reg] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.sessionRegistrations)
      .innerJoin(schema.sessions, eq(schema.sessions.id, schema.sessionRegistrations.sessionId)).where(eq(schema.sessions.eventId, e.id));
    return { id: e.id, slug: e.slug, name: e.name, startDate: e.startDate, endDate: e.endDate, published: e.published, archived: e.archived,
      members: s.members, checkedIn: s.checkedIn, sessions: s.sessions.length, registrations: reg?.n ?? 0 };
  }));
  return json({ users: users?.n ?? 0, admins: admins?.n ?? 0, events: rows });
});

r.get('/api/reports/event/:eventId/summary', ['admin'], async ({ db, params }) => {
  const ev = await getEventByIdOrSlug(db, params.eventId!);
  const stats = await checkinStats(db, ev.id);
  const now = new Date();
  const feedback = await db.select({ sessionId: schema.feedback.sessionId, avg: sql<number>`round(avg(${schema.feedback.rating})::numeric, 2)::float`, n: sql<number>`count(*)::int` })
    .from(schema.feedback).innerJoin(schema.sessions, eq(schema.sessions.id, schema.feedback.sessionId)).where(eq(schema.sessions.eventId, ev.id)).groupBy(schema.feedback.sessionId);
  const agenda = await db.select({ sessionId: schema.agendaItems.sessionId, n: sql<number>`count(*)::int` }).from(schema.agendaItems)
    .innerJoin(schema.sessions, eq(schema.sessions.id, schema.agendaItems.sessionId)).where(eq(schema.sessions.eventId, ev.id)).groupBy(schema.agendaItems.sessionId);
  const ended = new Map((await db.select({ id: schema.sessions.id, endsAt: schema.sessions.endsAt }).from(schema.sessions).where(eq(schema.sessions.eventId, ev.id))).map((s) => [s.id, s.endsAt]));
  return json({
    members: stats.members, checkedIn: stats.checkedIn, noShows: stats.members - stats.checkedIn,
    sessions: stats.sessions.map((s) => ({
      ...s,
      agendaCount: agenda.find((a) => a.sessionId === s.id)?.n ?? 0,
      noShows: (ended.get(s.id) ?? now) < now ? Math.max(0, s.registered - s.checkedIn) : null,
      capacityUse: s.capacity ? Math.round((s.registered / s.capacity) * 100) : null,
      rating: feedback.find((f) => f.sessionId === s.id)?.avg ?? null,
      ratings: feedback.find((f) => f.sessionId === s.id)?.n ?? 0,
    })),
  });
});

r.get('/api/reports/event/:eventId/export/:kind', ['admin'], async ({ db, params }) => {
  const ev = await getEventByIdOrSlug(db, params.eventId!);
  const iso = (d: Date | null | undefined) => (d ? d.toISOString() : '');
  switch (params.kind) {
    case 'attendees': {
      const rows = await db.select({ name: schema.users.name, email: schema.users.email, role: schema.eventMembers.roleInEvent, ticket: schema.eventMembers.ticketType, joined: schema.eventMembers.createdAt, checkedIn: schema.eventMembers.checkedInAt })
        .from(schema.eventMembers).innerJoin(schema.users, eq(schema.users.id, schema.eventMembers.userId)).where(eq(schema.eventMembers.eventId, ev.id)).orderBy(asc(schema.users.name));
      return csv(`${ev.slug}-attendees.csv`, [['Name', 'Email', 'Role', 'Ticket type', 'Joined', 'Checked in at'], ...rows.map((x) => [x.name, x.email, x.role, x.ticket, iso(x.joined), iso(x.checkedIn)])]);
    }
    case 'registrations': {
      const rows = await db.select({ session: schema.sessions.title, starts: schema.sessions.startsAt, name: schema.users.name, email: schema.users.email, status: schema.sessionRegistrations.status, position: schema.sessionRegistrations.position, at: schema.sessionRegistrations.createdAt })
        .from(schema.sessionRegistrations).innerJoin(schema.sessions, eq(schema.sessions.id, schema.sessionRegistrations.sessionId)).innerJoin(schema.users, eq(schema.users.id, schema.sessionRegistrations.userId))
        .where(eq(schema.sessions.eventId, ev.id)).orderBy(asc(schema.sessions.startsAt), asc(schema.sessionRegistrations.status), asc(schema.sessionRegistrations.position));
      return csv(`${ev.slug}-registrations.csv`, [['Session', 'Starts (UTC)', 'Name', 'Email', 'Status', 'Waitlist position', 'Registered at'], ...rows.map((x) => [x.session, iso(x.starts), x.name, x.email, x.status, x.position, iso(x.at)])]);
    }
    case 'checkins': {
      const rows = await db.select({ session: schema.sessions.title, name: schema.users.name, email: schema.users.email, method: schema.sessionCheckins.method, at: schema.sessionCheckins.at })
        .from(schema.sessionCheckins).innerJoin(schema.sessions, eq(schema.sessions.id, schema.sessionCheckins.sessionId)).innerJoin(schema.users, eq(schema.users.id, schema.sessionCheckins.userId))
        .where(eq(schema.sessions.eventId, ev.id)).orderBy(asc(schema.sessions.startsAt), asc(schema.sessionCheckins.at));
      return csv(`${ev.slug}-session-attendance.csv`, [['Session', 'Name', 'Email', 'Method', 'Checked in at'], ...rows.map((x) => [x.session, x.name, x.email, x.method, iso(x.at)])]);
    }
    case 'sessions': {
      const s = await checkinStats(db, ev.id);
      return csv(`${ev.slug}-sessions.csv`, [['Session', 'Starts (UTC)', 'Capacity', 'Registered', 'Waitlisted', 'Checked in'], ...s.sessions.map((x) => [x.title, x.startsAt, x.capacity, x.registered, x.waitlisted, x.checkedIn])]);
    }
    case 'feedback': {
      const rows = await db.select({ session: schema.sessions.title, rating: schema.feedback.rating, comment: schema.feedback.comment, at: schema.feedback.createdAt })
        .from(schema.feedback).innerJoin(schema.sessions, eq(schema.sessions.id, schema.feedback.sessionId)).where(eq(schema.sessions.eventId, ev.id)).orderBy(asc(schema.sessions.title));
      return csv(`${ev.slug}-feedback.csv`, [['Session', 'Rating', 'Comment', 'Submitted'], ...rows.map((x) => [x.session, x.rating, x.comment, iso(x.at)])]);
    }
    default:
      throw badRequest('Unknown export. Use attendees, registrations, checkins, sessions or feedback.');
  }
});

r.get('/api/reports/audit', ['admin'], async ({ db, url }) => {
  const before = url.searchParams.get('before');
  const rows = await db.select({ id: schema.auditLog.id, at: schema.auditLog.at, action: schema.auditLog.action, entity: schema.auditLog.entity, entityId: schema.auditLog.entityId, diff: schema.auditLog.diff, actor: schema.users.name })
    .from(schema.auditLog).leftJoin(schema.users, eq(schema.users.id, schema.auditLog.actorId))
    .where(before ? lt(schema.auditLog.at, new Date(before)) : undefined).orderBy(desc(schema.auditLog.at)).limit(100);
  return json({ entries: rows });
});

export default (req: Request, ctx: Context) => r.handler(req, ctx);
export const config: Config = { path: '/api/reports/*' };
