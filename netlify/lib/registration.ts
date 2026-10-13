import { and, asc, eq, gt, lt, ne, sql } from 'drizzle-orm';
import { schema, type DB } from './db';
import { conflict, forbidden, HttpError, notFound } from './http';
import { notify } from './notify';

type SessionRow = typeof schema.sessions.$inferSelect;
type EventRow = typeof schema.events.$inferSelect;
export type CapacityLabel = 'open' | 'filling' | 'nearly_full' | 'full';

export function capacityLabel(capacity: number | null, registered: number): CapacityLabel | null {
  if (!capacity) return null;
  const ratio = registered / capacity;
  if (ratio >= 1) return 'full';
  if (ratio >= 0.9) return 'nearly_full';
  if (ratio >= 0.6) return 'filling';
  return 'open';
}

export async function registeredCounts(db: DB, sessionIds: string[]) {
  const map = new Map<string, number>();
  if (!sessionIds.length) return map;
  const rows = await db.select({ id: schema.sessionRegistrations.sessionId, n: sql<number>`count(*)::int` })
    .from(schema.sessionRegistrations)
    .where(and(eq(schema.sessionRegistrations.status, 'registered'), sql`${schema.sessionRegistrations.sessionId} in ${sessionIds}`))
    .groupBy(schema.sessionRegistrations.sessionId);
  for (const r of rows) map.set(r.id, r.n);
  return map;
}

async function lockSession(tx: DB, sessionId: string) {
  const [s] = await tx.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).for('update');
  if (!s) throw notFound('Session not found');
  const [ev] = await tx.select().from(schema.events).where(eq(schema.events.id, s.eventId));
  return { s, ev: ev! as EventRow };
}

async function conflictingSession(tx: DB, userId: string, s: SessionRow) {
  const [c] = await tx.select({ id: schema.sessions.id, title: schema.sessions.title })
    .from(schema.sessionRegistrations)
    .innerJoin(schema.sessions, eq(schema.sessions.id, schema.sessionRegistrations.sessionId))
    .where(and(
      eq(schema.sessionRegistrations.userId, userId),
      eq(schema.sessionRegistrations.status, 'registered'),
      eq(schema.sessions.eventId, s.eventId),
      ne(schema.sessions.id, s.id),
      ne(schema.sessions.status, 'cancelled'),
      lt(schema.sessions.startsAt, s.endsAt),
      gt(schema.sessions.endsAt, s.startsAt),
    )).limit(1);
  return c ?? null;
}

async function countRegistered(tx: DB, sessionId: string) {
  const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.sessionRegistrations)
    .where(and(eq(schema.sessionRegistrations.sessionId, sessionId), eq(schema.sessionRegistrations.status, 'registered')));
  return r?.n ?? 0;
}

export type RegisterResult = { status: 'registered' | 'waitlisted'; position: number | null; already: boolean };

/**
 * Registers a user for a session. Runs in a transaction that locks the session row,
 * so capacity can never be oversold by concurrent requests.
 * `admin` bypasses frozen sessions and conflicts (admins can always enroll people).
 */
export async function registerForSession(db: DB, opts: { sessionId: string; userId: string; admin?: boolean }): Promise<RegisterResult> {
  return db.transaction(async (tx) => {
    // Serialise the same user's registrations so two overlapping sessions can't both slip through.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${opts.userId}))`);
    const { s, ev } = await lockSession(tx as unknown as DB, opts.sessionId);
    const q = tx as unknown as DB;
    if (s.status !== 'published') throw conflict('This session is not open for registration');
    if (!s.requiresRegistration) throw new HttpError(400, 'This session does not use registration. Add it to your agenda instead.', 'no_registration');

    const [existing] = await q.select().from(schema.sessionRegistrations)
      .where(and(eq(schema.sessionRegistrations.sessionId, s.id), eq(schema.sessionRegistrations.userId, opts.userId)));
    if (existing) return { status: existing.status, position: existing.position, already: true };

    const [member] = await q.select({ id: schema.eventMembers.id }).from(schema.eventMembers)
      .where(and(eq(schema.eventMembers.eventId, s.eventId), eq(schema.eventMembers.userId, opts.userId)));
    if (!member) {
      if (!opts.admin) throw forbidden('Join this event before registering for sessions');
      await q.insert(schema.eventMembers).values({ eventId: s.eventId, userId: opts.userId });
    }

    if (!opts.admin) {
      if (s.frozen || ev.settings.scheduleFrozen) throw forbidden('Registration for this session is frozen');
      if (!ev.settings.allowConflicts) {
        const c = await conflictingSession(q, opts.userId, s);
        if (c) throw conflict(`This overlaps with "${c.title}", which you are already registered for`, { conflictWith: c });
      }
    }

    const registered = await countRegistered(q, s.id);
    let status: 'registered' | 'waitlisted' = 'registered';
    let position: number | null = null;
    if (s.capacity !== null && registered >= s.capacity) {
      status = 'waitlisted';
      const [m] = await q.select({ p: sql<number>`coalesce(max(${schema.sessionRegistrations.position}), 0)::int` }).from(schema.sessionRegistrations)
        .where(and(eq(schema.sessionRegistrations.sessionId, s.id), eq(schema.sessionRegistrations.status, 'waitlisted')));
      position = (m?.p ?? 0) + 1;
    }
    await q.insert(schema.sessionRegistrations).values({ sessionId: s.id, userId: opts.userId, status, position });
    await q.insert(schema.agendaItems).values({ userId: opts.userId, sessionId: s.id }).onConflictDoNothing();
    if (status === 'waitlisted') {
      await notify(q, [{
        userId: opts.userId, eventId: s.eventId, kind: 'waitlist', title: `You're on the waitlist for ${s.title}`,
        body: `Waitlist position ${position}. We'll notify you if a spot opens.`, link: `/e/${ev.slug}/session/${s.id}`,
      }]);
    }
    return { status, position, already: false };
  });
}

/** Moves waitlisted attendees into open spots (oldest first), skipping anyone a conflict rule would block. */
export async function promoteWaitlist(tx: DB, s: SessionRow, ev: EventRow) {
  if (s.capacity === null) {
    // Unlimited now: everyone waiting gets in.
  }
  let registered = await countRegistered(tx, s.id);
  const waiting = await tx.select().from(schema.sessionRegistrations)
    .where(and(eq(schema.sessionRegistrations.sessionId, s.id), eq(schema.sessionRegistrations.status, 'waitlisted')))
    .orderBy(asc(schema.sessionRegistrations.position), asc(schema.sessionRegistrations.createdAt));
  const promoted: string[] = [];
  for (const w of waiting) {
    if (s.capacity !== null && registered >= s.capacity) break;
    if (!ev.settings.allowConflicts && (await conflictingSession(tx, w.userId, s))) continue;
    await tx.update(schema.sessionRegistrations).set({ status: 'registered', position: null }).where(eq(schema.sessionRegistrations.id, w.id));
    registered++;
    promoted.push(w.userId);
  }
  await notify(tx, promoted.map((userId) => ({
    userId, eventId: s.eventId, kind: 'promoted', title: `A spot opened up: you're in for ${s.title}`,
    body: 'You were moved off the waitlist and are now registered.', link: `/e/${ev.slug}/session/${s.id}`,
  })));
  return promoted;
}

export async function cancelRegistration(db: DB, opts: { sessionId: string; userId: string; admin?: boolean }) {
  return db.transaction(async (tx) => {
    const q = tx as unknown as DB;
    const { s, ev } = await lockSession(q, opts.sessionId);
    if (!opts.admin && (s.frozen || ev.settings.scheduleFrozen)) throw forbidden('This session is frozen: you can no longer leave it');
    const [reg] = await q.delete(schema.sessionRegistrations)
      .where(and(eq(schema.sessionRegistrations.sessionId, s.id), eq(schema.sessionRegistrations.userId, opts.userId))).returning();
    if (!reg) return { removed: false, promoted: [] as string[] };
    const promoted = reg.status === 'registered' ? await promoteWaitlist(q, s, ev) : [];
    return { removed: true, promoted };
  });
}

/** Called after an admin changes capacity or cancels: fills newly opened spots. */
export async function rebalanceSession(db: DB, sessionId: string) {
  return db.transaction(async (tx) => {
    const q = tx as unknown as DB;
    const { s, ev } = await lockSession(q, sessionId);
    if (s.status !== 'published') return [];
    return promoteWaitlist(q, s, ev);
  });
}
