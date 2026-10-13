import { and, asc, eq, sql } from 'drizzle-orm';
import { schema, type DB } from './db';

export async function checkinStats(db: DB, eventId: string) {
  const [tot] = await db.select({
    members: sql<number>`count(*)::int`, checkedIn: sql<number>`count(${schema.eventMembers.checkedInAt})::int`,
  }).from(schema.eventMembers).where(eq(schema.eventMembers.eventId, eventId));
  const sessions = await db.select({
    id: schema.sessions.id, title: schema.sessions.title, startsAt: schema.sessions.startsAt, capacity: schema.sessions.capacity, requiresRegistration: schema.sessions.requiresRegistration,
    registered: sql<number>`(select count(*)::int from ${schema.sessionRegistrations} r where r.session_id = sessions.id and r.status = 'registered')`,
    waitlisted: sql<number>`(select count(*)::int from ${schema.sessionRegistrations} r where r.session_id = sessions.id and r.status = 'waitlisted')`,
    checkedIn: sql<number>`(select count(*)::int from ${schema.sessionCheckins} k where k.session_id = sessions.id)`,
  }).from(schema.sessions).where(and(eq(schema.sessions.eventId, eventId), eq(schema.sessions.status, 'published'))).orderBy(asc(schema.sessions.startsAt));
  return { members: tot?.members ?? 0, checkedIn: tot?.checkedIn ?? 0, sessions: sessions.map((s) => ({ ...s, startsAt: s.startsAt.toISOString() })) };
}
