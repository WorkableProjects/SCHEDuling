import type { Config, Context } from '@netlify/functions';
import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';
import { schema } from '../lib/db';
import { createRouter } from '../lib/router';
import { badRequest, clientIp, conflict, forbidden, json, parseCookies, readJson, HttpError } from '../lib/http';
import { hashPassword, verifyPassword } from '../lib/crypto';
import { eventBaseSchema, eventInputSchema, roomSchema, trackSchema, unlockSchema } from '../../shared/schemas';
import {
  canViewEvent, getEventByIdOrSlug, getMembership, isAdmin, requireViewEvent, unlockCookie, unlockCookieName, unlockValue, type EventRow,
} from '../lib/permissions';
import { audit } from '../lib/audit';
import { assertBucket } from '../lib/ratelimit';

const r = createRouter();
const DEFAULT_SETTINGS = { allowConflicts: false, directoryVisible: true, selfCheckin: true, speakerEdit: true, showCapacityLabels: true, scheduleFrozen: false };

const dto = (ev: EventRow) => {
  const { passwordHash, ...rest } = ev;
  return { ...rest, hasPassword: !!passwordHash };
};
const teaser = (ev: EventRow) => ({
  id: ev.id, slug: ev.slug, name: ev.name, description: ev.description, tz: ev.tz, startDate: ev.startDate, endDate: ev.endDate,
  location: ev.location, branding: ev.branding, privacy: ev.privacy, published: ev.published, archived: ev.archived,
});

r.get('/api/events', false, async (c) => {
  const { db, user } = c;
  let rows: EventRow[];
  if (isAdmin(user)) {
    rows = await db.select().from(schema.events).orderBy(asc(schema.events.startDate));
  } else {
    const memberOf = user
      ? (await db.select({ id: schema.eventMembers.eventId }).from(schema.eventMembers).where(eq(schema.eventMembers.userId, user.id))).map((m) => m.id)
      : [];
    rows = await db.select().from(schema.events).where(and(
      eq(schema.events.published, true),
      or(inArray(schema.events.privacy, ['public', 'password']), memberOf.length ? inArray(schema.events.id, memberOf) : sql`false`),
    )).orderBy(asc(schema.events.startDate));
  }
  const memberships = user
    ? new Set((await db.select({ id: schema.eventMembers.eventId }).from(schema.eventMembers).where(eq(schema.eventMembers.userId, user.id))).map((m) => m.id))
    : new Set<string>();
  let counts = new Map<string, { sessions: number; members: number }>();
  if (isAdmin(user) && rows.length) {
    const ids = rows.map((e) => e.id);
    const s = await db.select({ id: schema.sessions.eventId, n: sql<number>`count(*)::int` }).from(schema.sessions).where(inArray(schema.sessions.eventId, ids)).groupBy(schema.sessions.eventId);
    const m = await db.select({ id: schema.eventMembers.eventId, n: sql<number>`count(*)::int` }).from(schema.eventMembers).where(inArray(schema.eventMembers.eventId, ids)).groupBy(schema.eventMembers.eventId);
    counts = new Map(ids.map((id) => [id, { sessions: s.find((x) => x.id === id)?.n ?? 0, members: m.find((x) => x.id === id)?.n ?? 0 }]));
  }
  return json({ events: rows.map((e) => ({ ...teaser(e), isMember: memberships.has(e.id), ...(counts.get(e.id) ?? {}) })) });
});

r.post('/api/events', ['admin'], async ({ req, db, user }) => {
  const b = await readJson(req, eventInputSchema);
  if (b.privacy === 'password' && !b.password) throw badRequest('password: Set a password for a password-protected event');
  const [dupe] = await db.select({ id: schema.events.id }).from(schema.events).where(sql`lower(${schema.events.slug}) = ${b.slug}`);
  if (dupe) throw conflict('That URL is already taken by another event');
  const [ev] = await db.insert(schema.events).values({
    slug: b.slug, name: b.name, description: b.description, tz: b.tz, startDate: b.startDate, endDate: b.endDate, location: b.location,
    branding: b.branding, privacy: b.privacy, passwordHash: b.password ? await hashPassword(b.password) : null,
    settings: { ...DEFAULT_SETTINGS, ...b.settings },
  }).returning();
  await audit(db, user!.id, 'event.create', 'event', ev!.id, { slug: b.slug });
  return json({ event: dto(ev!) }, { status: 201 });
});

r.get('/api/events/:key', false, async (c) => {
  const ev = await getEventByIdOrSlug(c.db, c.params.key!);
  const admin = isAdmin(c.user);
  if (!ev.published && !admin) throw new HttpError(404, 'Event not found', 'not_found');
  const canView = await canViewEvent(c, ev);
  const membership = c.user ? await getMembership(c.db, ev.id, c.user.id) : null;
  return json({
    event: canView ? (admin ? dto(ev) : { ...dto(ev), hasPassword: undefined }) : teaser(ev),
    canView, locked: !canView,
    membership: membership ? { roleInEvent: membership.roleInEvent, ticketType: membership.ticketType, checkedInAt: membership.checkedInAt, qrToken: membership.qrToken } : null,
  });
});

r.patch('/api/events/:id', ['admin'], async ({ req, db, params, user }) => {
  const ev = await getEventByIdOrSlug(db, params.id!);
  const b = await readJson(req, eventInputSchema);
  if (b.slug !== ev.slug) {
    const [dupe] = await db.select({ id: schema.events.id }).from(schema.events).where(sql`lower(${schema.events.slug}) = ${b.slug}`);
    if (dupe) throw conflict('That URL is already taken by another event');
  }
  let passwordHash = ev.passwordHash;
  if (b.privacy === 'password') {
    if (b.password) passwordHash = await hashPassword(b.password);
    else if (!passwordHash) throw badRequest('password: Set a password for a password-protected event');
  }
  const [updated] = await db.update(schema.events).set({
    slug: b.slug, name: b.name, description: b.description, tz: b.tz, startDate: b.startDate, endDate: b.endDate, location: b.location,
    branding: b.branding, privacy: b.privacy, passwordHash, settings: { ...ev.settings, ...b.settings },
  }).where(eq(schema.events.id, ev.id)).returning();
  await audit(db, user!.id, 'event.update', 'event', ev.id);
  return json({ event: dto(updated!) });
});

const flag = (action: string, set: Partial<typeof schema.events.$inferInsert>) =>
  r.post(`/api/events/:id/${action}`, ['admin'], async ({ db, params, user }) => {
    const ev = await getEventByIdOrSlug(db, params.id!);
    const [u] = await db.update(schema.events).set(set).where(eq(schema.events.id, ev.id)).returning();
    await audit(db, user!.id, `event.${action}`, 'event', ev.id);
    return json({ event: dto(u!) });
  });
flag('publish', { published: true });
flag('unpublish', { published: false });
flag('archive', { archived: true });
flag('unarchive', { archived: false });

r.delete('/api/events/:id', ['admin'], async ({ db, params, user }) => {
  const ev = await getEventByIdOrSlug(db, params.id!);
  if (ev.published) throw conflict('Unpublish the event before deleting it');
  await db.delete(schema.events).where(eq(schema.events.id, ev.id));
  await audit(db, user!.id, 'event.delete', 'event', ev.id, { slug: ev.slug });
  return json({ ok: true });
});

// Copies tracks, rooms and sessions (as drafts) into a new event. People and registrations are not copied.
r.post('/api/events/:id/duplicate', ['admin'], async ({ req, db, params, user }) => {
  const ev = await getEventByIdOrSlug(db, params.id!);
  const { slug, name, startDate } = await readJson(req, eventBaseSchema.pick({ slug: true, name: true, startDate: true }));
  const [dupe] = await db.select({ id: schema.events.id }).from(schema.events).where(sql`lower(${schema.events.slug}) = ${slug}`);
  if (dupe) throw conflict('That URL is already taken by another event');
  const shiftDays = Math.round((Date.parse(startDate) - Date.parse(ev.startDate)) / 86_400_000);
  const endDate = new Date(Date.parse(ev.endDate) + shiftDays * 86_400_000).toISOString().slice(0, 10);
  const created = await db.transaction(async (tx) => {
    const q = tx as unknown as typeof db;
    const [n] = await q.insert(schema.events).values({
      slug, name, description: ev.description, tz: ev.tz, startDate, endDate, location: ev.location, branding: ev.branding,
      privacy: ev.privacy, passwordHash: ev.passwordHash, settings: ev.settings, published: false,
    }).returning();
    const tr = await q.select().from(schema.tracks).where(eq(schema.tracks.eventId, ev.id));
    const rm = await q.select().from(schema.rooms).where(eq(schema.rooms.eventId, ev.id));
    const trackMap = new Map<string, string>();
    const roomMap = new Map<string, string>();
    for (const t of tr) { const [x] = await q.insert(schema.tracks).values({ eventId: n!.id, name: t.name, color: t.color }).returning(); trackMap.set(t.id, x!.id); }
    for (const rr of rm) { const [x] = await q.insert(schema.rooms).values({ eventId: n!.id, name: rr.name, capacity: rr.capacity }).returning(); roomMap.set(rr.id, x!.id); }
    const ss = await q.select().from(schema.sessions).where(eq(schema.sessions.eventId, ev.id));
    const links = await q.select().from(schema.sessionTracks).innerJoin(schema.sessions, eq(schema.sessions.id, schema.sessionTracks.sessionId)).where(eq(schema.sessions.eventId, ev.id));
    for (const s of ss) {
      const shift = shiftDays * 86_400_000;
      const [x] = await q.insert(schema.sessions).values({
        eventId: n!.id, title: s.title, description: s.description, startsAt: new Date(s.startsAt.getTime() + shift), endsAt: new Date(s.endsAt.getTime() + shift),
        roomId: s.roomId ? roomMap.get(s.roomId) ?? null : null, status: 'draft', capacity: s.capacity,
        requiresRegistration: s.requiresRegistration, pinned: s.pinned, frozen: false,
      }).returning();
      for (const l of links.filter((l) => l.session_tracks.sessionId === s.id)) {
        await q.insert(schema.sessionTracks).values({ sessionId: x!.id, trackId: trackMap.get(l.session_tracks.trackId)! });
      }
    }
    return n!;
  });
  await audit(db, user!.id, 'event.duplicate', 'event', created.id, { from: ev.id });
  return json({ event: dto(created) }, { status: 201 });
});

r.post('/api/events/:key/unlock', false, async ({ req, db, params }) => {
  const ev = await getEventByIdOrSlug(db, params.key!);
  if (!ev.published || ev.privacy !== 'password') throw new HttpError(404, 'Event not found', 'not_found');
  await assertBucket(db, clientIp(req), `unlock:${ev.id}`, 15, 15 * 60_000);
  const { password } = await readJson(req, unlockSchema);
  if (!(await verifyPassword(password, ev.passwordHash))) throw new HttpError(403, 'Incorrect event password', 'bad_password');
  return json({ ok: true }, { cookies: [unlockCookie(req, ev)] });
});

r.post('/api/events/:key/join', 'any', async (c) => {
  const ev = await getEventByIdOrSlug(c.db, c.params.key!);
  if (!ev.published && !isAdmin(c.user)) throw new HttpError(404, 'Event not found', 'not_found');
  const existing = await getMembership(c.db, ev.id, c.user!.id);
  if (existing) return json({ membership: existing });
  if (ev.privacy === 'invite_only' && !isAdmin(c.user)) throw forbidden('This event is invite-only. Ask the organizers for an invitation.');
  if (ev.privacy === 'password' && !isAdmin(c.user) && parseCookies(c.req)[unlockCookieName(ev.id)] !== unlockValue(ev)) {
    throw forbidden('Enter the event password first');
  }
  if (c.user!.role === 'checkin_staff') throw forbidden('Staff accounts cannot register as attendees');
  const [m] = await c.db.insert(schema.eventMembers).values({
    eventId: ev.id, userId: c.user!.id, roleInEvent: c.user!.role === 'speaker' ? 'speaker' : 'attendee',
  }).onConflictDoNothing().returning();
  return json({ membership: m }, { status: 201 });
});

// ---- tracks & rooms ----
r.get('/api/events/:id/tracks', false, async (c) => {
  const ev = await getEventByIdOrSlug(c.db, c.params.id!);
  await requireViewEvent(c, ev);
  return json({ tracks: await c.db.select().from(schema.tracks).where(eq(schema.tracks.eventId, ev.id)).orderBy(asc(schema.tracks.name)) });
});
r.post('/api/events/:id/tracks', ['admin'], async ({ req, db, params }) => {
  const ev = await getEventByIdOrSlug(db, params.id!);
  const b = await readJson(req, trackSchema);
  const [t] = await db.insert(schema.tracks).values({ eventId: ev.id, ...b }).onConflictDoNothing().returning();
  if (!t) throw conflict('A track with that name already exists');
  return json({ track: t }, { status: 201 });
});
r.patch('/api/events/:id/tracks/:trackId', ['admin'], async ({ req, db, params }) => {
  const b = await readJson(req, trackSchema);
  const [t] = await db.update(schema.tracks).set(b).where(and(eq(schema.tracks.id, params.trackId!), eq(schema.tracks.eventId, params.id!))).returning();
  if (!t) throw new HttpError(404, 'Track not found', 'not_found');
  return json({ track: t });
});
r.delete('/api/events/:id/tracks/:trackId', ['admin'], async ({ db, params }) => {
  await db.delete(schema.tracks).where(and(eq(schema.tracks.id, params.trackId!), eq(schema.tracks.eventId, params.id!)));
  return json({ ok: true });
});

r.get('/api/events/:id/rooms', false, async (c) => {
  const ev = await getEventByIdOrSlug(c.db, c.params.id!);
  await requireViewEvent(c, ev);
  return json({ rooms: await c.db.select().from(schema.rooms).where(eq(schema.rooms.eventId, ev.id)).orderBy(asc(schema.rooms.name)) });
});
r.post('/api/events/:id/rooms', ['admin'], async ({ req, db, params }) => {
  const ev = await getEventByIdOrSlug(db, params.id!);
  const b = await readJson(req, roomSchema);
  const [x] = await db.insert(schema.rooms).values({ eventId: ev.id, ...b }).onConflictDoNothing().returning();
  if (!x) throw conflict('A room with that name already exists');
  return json({ room: x }, { status: 201 });
});
r.patch('/api/events/:id/rooms/:roomId', ['admin'], async ({ req, db, params }) => {
  const b = await readJson(req, roomSchema);
  const [x] = await db.update(schema.rooms).set(b).where(and(eq(schema.rooms.id, params.roomId!), eq(schema.rooms.eventId, params.id!))).returning();
  if (!x) throw new HttpError(404, 'Room not found', 'not_found');
  return json({ room: x });
});
r.delete('/api/events/:id/rooms/:roomId', ['admin'], async ({ db, params }) => {
  await db.delete(schema.rooms).where(and(eq(schema.rooms.id, params.roomId!), eq(schema.rooms.eventId, params.id!)));
  return json({ ok: true });
});

export default (req: Request, ctx: Context) => r.handler(req, ctx);
export const config: Config = { path: ['/api/events', '/api/events/*'] };
