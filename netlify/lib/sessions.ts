import { and, eq, inArray } from 'drizzle-orm';
import { schema, type DB } from './db';
import { capacityLabel, registeredCounts } from './registration';
import type { AuthUser } from './router';

type EventRow = typeof schema.events.$inferSelect;
type SessionRow = typeof schema.sessions.$inferSelect;

export async function sessionDtos(db: DB, ev: EventRow, rows: SessionRow[], user: AuthUser | null, opts: { admin?: boolean } = {}) {
  if (!rows.length) return [];
  const ids = rows.map((s) => s.id);
  const [trackRows, speakerRows, roomRows, counts] = await Promise.all([
    db.select({ sessionId: schema.sessionTracks.sessionId, id: schema.tracks.id, name: schema.tracks.name, color: schema.tracks.color })
      .from(schema.sessionTracks).innerJoin(schema.tracks, eq(schema.tracks.id, schema.sessionTracks.trackId)).where(inArray(schema.sessionTracks.sessionId, ids)),
    db.select({ sessionId: schema.sessionSpeakers.sessionId, id: schema.users.id, name: schema.users.name, title: schema.users.title, org: schema.users.org, photo: schema.users.photoKey })
      .from(schema.sessionSpeakers).innerJoin(schema.users, eq(schema.users.id, schema.sessionSpeakers.userId)).where(inArray(schema.sessionSpeakers.sessionId, ids)),
    db.select().from(schema.rooms).where(eq(schema.rooms.eventId, ev.id)),
    registeredCounts(db, ids),
  ]);
  const mine = new Map<string, { inAgenda: boolean; registration: 'registered' | 'waitlisted' | null; position: number | null; checkedIn: boolean }>();
  if (user) {
    const [a, reg, ck] = await Promise.all([
      db.select().from(schema.agendaItems).where(and(eq(schema.agendaItems.userId, user.id), inArray(schema.agendaItems.sessionId, ids))),
      db.select().from(schema.sessionRegistrations).where(and(eq(schema.sessionRegistrations.userId, user.id), inArray(schema.sessionRegistrations.sessionId, ids))),
      db.select().from(schema.sessionCheckins).where(and(eq(schema.sessionCheckins.userId, user.id), inArray(schema.sessionCheckins.sessionId, ids))),
    ]);
    for (const id of ids) mine.set(id, { inAgenda: false, registration: null, position: null, checkedIn: false });
    for (const x of a) mine.get(x.sessionId)!.inAgenda = true;
    for (const x of reg) Object.assign(mine.get(x.sessionId)!, { registration: x.status, position: x.position });
    for (const x of ck) mine.get(x.sessionId)!.checkedIn = true;
  }
  const rooms = new Map(roomRows.map((x) => [x.id, x]));
  return rows.map((s) => {
    const registered = counts.get(s.id) ?? 0;
    return {
      id: s.id, eventId: s.eventId, title: s.title, description: s.description,
      startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString(), status: s.status,
      room: s.roomId ? { id: s.roomId, name: rooms.get(s.roomId)?.name ?? '' } : null,
      capacity: s.capacity, requiresRegistration: s.requiresRegistration, pinned: s.pinned, frozen: s.frozen || ev.settings.scheduleFrozen,
      registeredCount: opts.admin || ev.settings.showCapacityLabels ? registered : undefined,
      capacityLabel: ev.settings.showCapacityLabels || opts.admin ? capacityLabel(s.capacity, registered) : null,
      materials: s.materials.map((m, i) => ({ index: i, name: m.name, size: m.size })),
      tracks: trackRows.filter((t) => t.sessionId === s.id).map(({ sessionId, ...t }) => t),
      speakers: speakerRows.filter((p) => p.sessionId === s.id).map((p) => ({ id: p.id, name: p.name, title: p.title, org: p.org, hasPhoto: !!p.photo })),
      mine: mine.get(s.id) ?? null,
    };
  });
}

/** Everyone who should hear about a change: agenda + registrations, plus all members if pinned. */
export async function interestedUserIds(db: DB, s: SessionRow) {
  const out = new Set<string>();
  const [a, r] = await Promise.all([
    db.select({ u: schema.agendaItems.userId }).from(schema.agendaItems).where(eq(schema.agendaItems.sessionId, s.id)),
    db.select({ u: schema.sessionRegistrations.userId }).from(schema.sessionRegistrations).where(eq(schema.sessionRegistrations.sessionId, s.id)),
  ]);
  a.forEach((x) => out.add(x.u));
  r.forEach((x) => out.add(x.u));
  if (s.pinned) (await db.select({ u: schema.eventMembers.userId }).from(schema.eventMembers).where(eq(schema.eventMembers.eventId, s.eventId))).forEach((x) => out.add(x.u));
  return [...out];
}
