import { and, eq } from 'drizzle-orm';
import { schema, type DB } from './db';
import { forbidden, notFound, parseCookies, cookie, isUuid } from './http';
import { sha256 } from './crypto';
import type { AuthUser, Ctx } from './router';

export type EventRow = typeof schema.events.$inferSelect;

export const isAdmin = (u: AuthUser | null) => u?.role === 'admin';
export const isStaff = (u: AuthUser | null) => u?.role === 'admin' || u?.role === 'checkin_staff';

export async function getEventByIdOrSlug(db: DB, key: string): Promise<EventRow> {
  const where = isUuid(key) ? eq(schema.events.id, key) : eq(schema.events.slug, key.toLowerCase());
  const [ev] = await db.select().from(schema.events).where(where).limit(1);
  if (!ev) throw notFound('Event not found');
  return ev;
}

export async function getMembership(db: DB, eventId: string, userId: string) {
  const [m] = await db.select().from(schema.eventMembers)
    .where(and(eq(schema.eventMembers.eventId, eventId), eq(schema.eventMembers.userId, userId))).limit(1);
  return m ?? null;
}

export const unlockCookieName = (eventId: string) => `sched_unlock_${eventId.slice(0, 8)}`;
export const unlockValue = (ev: EventRow) => sha256(`${ev.passwordHash ?? ''}:${ev.id}`);
export const unlockCookie = (req: Request, ev: EventRow) => cookie(req, unlockCookieName(ev.id), unlockValue(ev), 60 * 60 * 24 * 14);

/**
 * Can this requester see the event's schedule/speakers? Admins and staff always can.
 * Unpublished events are admin-only. Invite-only needs membership. Password events need
 * membership or the unlock cookie.
 */
export async function canViewEvent(c: Pick<Ctx, 'req' | 'db' | 'user'>, ev: EventRow) {
  const u = c.user;
  if (isStaff(u)) return true;
  if (!ev.published) return false;
  if (ev.privacy === 'public') return true;
  if (u && (await getMembership(c.db, ev.id, u.id))) return true;
  if (ev.privacy === 'password') return parseCookies(c.req)[unlockCookieName(ev.id)] === unlockValue(ev);
  return false;
}

export async function requireViewEvent(c: Pick<Ctx, 'req' | 'db' | 'user'>, ev: EventRow) {
  if (!(await canViewEvent(c, ev))) {
    // Don't confirm that unpublished events exist.
    if (!ev.published) throw notFound('Event not found');
    throw forbidden(ev.privacy === 'password' ? 'This event is password protected' : 'This event is invite-only');
  }
}

/** Speakers may edit only sessions they are assigned to, and only when the event allows it. */
export async function canSpeakerEditSession(db: DB, user: AuthUser, sessionId: string, ev: EventRow) {
  if (user.role !== 'speaker' || !ev.settings.speakerEdit) return false;
  const [row] = await db.select({ u: schema.sessionSpeakers.userId }).from(schema.sessionSpeakers)
    .where(and(eq(schema.sessionSpeakers.sessionId, sessionId), eq(schema.sessionSpeakers.userId, user.id))).limit(1);
  return !!row;
}
