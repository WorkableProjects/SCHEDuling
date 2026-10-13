import type { Config, Context } from '@netlify/functions';
import { and, asc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { schema, type DB } from '../lib/db';
import { createRouter, publicUser, type Ctx } from '../lib/router';
import { badRequest, conflict, forbidden, json, notFound, readJson } from '../lib/http';
import { attendeeCreateSchema, email as emailSchema, profileSchema, speakerCreateSchema } from '../../shared/schemas';
import { getEventByIdOrSlug, getMembership, isAdmin, requireViewEvent } from '../lib/permissions';
import { changeUserRole, setUserStatus } from '../lib/admins';
import { issueToken, tokenLink } from '../lib/tokens';
import { audit } from '../lib/audit';
import { parseCsvObjects } from '../lib/csv';
import { rebalanceSession } from '../lib/registration';

const r = createRouter();

async function findByEmail(db: DB, email: string) {
  const [u] = await db.select().from(schema.users).where(sql`lower(${schema.users.email}) = ${email.toLowerCase()}`).limit(1);
  return u ?? null;
}

/** Returns an invite link when the person still needs to set a password. */
async function inviteIfNeeded(c: Pick<Ctx, 'req' | 'db'>, u: typeof schema.users.$inferSelect) {
  if (u.passwordHash) return null;
  return tokenLink(c.req, await issueToken(c.db, u.id, 'invite'));
}

// ---- speakers ----
r.get('/api/people/speakers', false, async (c) => {
  const eventId = c.url.searchParams.get('eventId');
  if (!eventId) throw badRequest('eventId is required');
  const ev = await getEventByIdOrSlug(c.db, eventId);
  await requireViewEvent(c, ev);
  const admin = isAdmin(c.user);
  const people = await c.db.select({
    id: schema.users.id, name: schema.users.name, title: schema.users.title, org: schema.users.org, bio: schema.users.bio,
    photo: schema.users.photoKey, email: schema.users.email, status: schema.users.status,
  }).from(schema.eventMembers).innerJoin(schema.users, eq(schema.users.id, schema.eventMembers.userId))
    .where(and(eq(schema.eventMembers.eventId, ev.id), eq(schema.eventMembers.roleInEvent, 'speaker'))).orderBy(asc(schema.users.name));
  const links = people.length
    ? await c.db.select({ userId: schema.sessionSpeakers.userId, id: schema.sessions.id, title: schema.sessions.title, startsAt: schema.sessions.startsAt, status: schema.sessions.status })
        .from(schema.sessionSpeakers).innerJoin(schema.sessions, eq(schema.sessions.id, schema.sessionSpeakers.sessionId))
        .where(and(eq(schema.sessions.eventId, ev.id), inArray(schema.sessionSpeakers.userId, people.map((p) => p.id)), admin ? sql`true` : inArray(schema.sessions.status, ['published', 'cancelled'])))
        .orderBy(asc(schema.sessions.startsAt))
    : [];
  return json({
    speakers: people.map((p) => ({
      id: p.id, name: p.name, title: p.title, org: p.org, bio: p.bio, hasPhoto: !!p.photo,
      ...(admin ? { email: p.email, status: p.status } : {}),
      sessions: links.filter((l) => l.userId === p.id).map((l) => ({ id: l.id, title: l.title, startsAt: l.startsAt.toISOString(), status: l.status })),
    })),
  });
});

r.post('/api/people/speakers', ['admin'], async (c) => {
  const b = await readJson(c.req, speakerCreateSchema);
  const ev = await getEventByIdOrSlug(c.db, b.eventId);
  const found = await findByEmail(c.db, b.email);
  if (found && found.role !== 'speaker' && found.role !== 'attendee') throw conflict(`${b.email} is a ${found.role} account and cannot be a speaker`);
  const [u] = found
    ? await c.db.update(schema.users).set({ role: 'speaker', title: b.title ?? found.title, org: b.org ?? found.org, bio: b.bio ?? found.bio }).where(eq(schema.users.id, found.id)).returning()
    : await c.db.insert(schema.users).values({ email: b.email, name: b.name, role: 'speaker', status: 'pending', title: b.title, org: b.org, bio: b.bio }).returning();
  await c.db.insert(schema.eventMembers).values({ eventId: ev.id, userId: u!.id, roleInEvent: 'speaker' })
    .onConflictDoUpdate({ target: [schema.eventMembers.eventId, schema.eventMembers.userId], set: { roleInEvent: 'speaker' } });
  await audit(c.db, c.user!.id, 'speaker.create', 'user', u!.id);
  return json({ user: publicUser(u!), inviteLink: await inviteIfNeeded(c, u!) }, { status: 201 });
});

// ---- attendees (admin) ----
r.get('/api/people/attendees', ['admin'], async (c) => {
  const eventId = c.url.searchParams.get('eventId');
  if (!eventId) throw badRequest('eventId is required');
  const ev = await getEventByIdOrSlug(c.db, eventId);
  const rows = await c.db.select({
    userId: schema.users.id, name: schema.users.name, email: schema.users.email, role: schema.eventMembers.roleInEvent,
    ticketType: schema.eventMembers.ticketType, checkedInAt: schema.eventMembers.checkedInAt, status: schema.users.status, joinedAt: schema.eventMembers.createdAt,
  }).from(schema.eventMembers).innerJoin(schema.users, eq(schema.users.id, schema.eventMembers.userId))
    .where(eq(schema.eventMembers.eventId, ev.id)).orderBy(asc(schema.users.name));
  return json({ attendees: rows });
});

async function addAttendee(c: Pick<Ctx, 'req' | 'db'>, eventId: string, name: string, email: string, ticketType: string) {
  const found = await findByEmail(c.db, email);
  if (found && (found.role === 'admin' || found.role === 'checkin_staff')) throw badRequest(`${email} is a ${found.role} account and cannot be an attendee`);
  const created = !found;
  const [u] = found ? [found] : await c.db.insert(schema.users).values({ email, name, role: 'attendee', status: 'pending' }).returning();
  const [m] = await c.db.insert(schema.eventMembers).values({ eventId, userId: u!.id, roleInEvent: u!.role === 'speaker' ? 'speaker' : 'attendee', ticketType })
    .onConflictDoUpdate({ target: [schema.eventMembers.eventId, schema.eventMembers.userId], set: { ticketType } }).returning();
  return { user: u!, created, member: m!, inviteLink: await inviteIfNeeded(c, u!) };
}

r.post('/api/people/attendees', ['admin'], async (c) => {
  const b = await readJson(c.req, attendeeCreateSchema);
  const ev = await getEventByIdOrSlug(c.db, b.eventId);
  const res = await addAttendee(c, ev.id, b.name, b.email, b.ticketType);
  await audit(c.db, c.user!.id, 'attendee.add', 'user', res.user.id);
  return json({ user: publicUser(res.user), created: res.created, inviteLink: res.inviteLink }, { status: 201 });
});

r.post('/api/people/attendees/import', ['admin'], async (c) => {
  const body = await readJson(c.req, z.object({ eventId: z.string().uuid(), csv: z.string().max(2_000_000), dryRun: z.boolean().default(false) }));
  const ev = await getEventByIdOrSlug(c.db, body.eventId);
  const rows = parseCsvObjects(body.csv);
  if (!rows.length) throw badRequest('The CSV has no data rows');
  if (rows.length > 2000) throw badRequest('Import up to 2000 rows at a time');
  const errors: { row: number; message: string }[] = [];
  const seen = new Set<string>();
  const parsed = rows.map((row, i) => {
    const e = emailSchema.safeParse(row.email ?? '');
    if (!e.success) errors.push({ row: i + 2, message: `"${row.email ?? ''}" is not a valid email address` });
    else if (seen.has(e.data)) errors.push({ row: i + 2, message: `${e.data} appears more than once` });
    else seen.add(e.data);
    const name = (row.name || row.full_name || '').trim() || (e.success ? e.data.split('@')[0]! : '');
    if (name.length > 100) errors.push({ row: i + 2, message: 'name is too long' });
    return { email: e.success ? e.data : '', name, ticketType: (row.ticket_type || row.ticket || 'General').slice(0, 60) };
  });
  if (errors.length) return json({ ok: false, errors }, { status: 422 });
  if (body.dryRun) return json({ ok: true, dryRun: true, count: parsed.length });
  const results = { created: 0, existing: 0, invites: [] as { email: string; link: string }[], skipped: [] as { email: string; reason: string }[] };
  for (const p of parsed) {
    try {
      const res = await addAttendee(c, ev.id, p.name, p.email, p.ticketType);
      if (res.created) results.created++; else results.existing++;
      if (res.inviteLink) results.invites.push({ email: p.email, link: res.inviteLink });
    } catch (e) {
      results.skipped.push({ email: p.email, reason: e instanceof Error ? e.message : 'failed' });
    }
  }
  await audit(c.db, c.user!.id, 'attendee.import', 'event', ev.id, { created: results.created, existing: results.existing });
  return json({ ok: true, ...results });
});

r.delete('/api/people/attendees/:eventId/:userId', ['admin'], async (c) => {
  const ev = await getEventByIdOrSlug(c.db, c.params.eventId!);
  const userId = c.params.userId!;
  const regs = await c.db.select({ id: schema.sessionRegistrations.sessionId }).from(schema.sessionRegistrations)
    .innerJoin(schema.sessions, eq(schema.sessions.id, schema.sessionRegistrations.sessionId))
    .where(and(eq(schema.sessionRegistrations.userId, userId), eq(schema.sessions.eventId, ev.id), eq(schema.sessionRegistrations.status, 'registered')));
  const sessionIds = (await c.db.select({ id: schema.sessions.id }).from(schema.sessions).where(eq(schema.sessions.eventId, ev.id))).map((s) => s.id);
  if (sessionIds.length) {
    await c.db.delete(schema.agendaItems).where(and(eq(schema.agendaItems.userId, userId), inArray(schema.agendaItems.sessionId, sessionIds)));
    await c.db.delete(schema.sessionRegistrations).where(and(eq(schema.sessionRegistrations.userId, userId), inArray(schema.sessionRegistrations.sessionId, sessionIds)));
  }
  await c.db.delete(schema.eventMembers).where(and(eq(schema.eventMembers.eventId, ev.id), eq(schema.eventMembers.userId, userId)));
  for (const x of regs) await rebalanceSession(c.db, x.id);
  await audit(c.db, c.user!.id, 'attendee.remove', 'user', userId, { eventId: ev.id });
  return json({ ok: true });
});

// ---- directory (members only, when enabled) ----
r.get('/api/people/directory', 'any', async (c) => {
  const eventId = c.url.searchParams.get('eventId');
  if (!eventId) throw badRequest('eventId is required');
  const ev = await getEventByIdOrSlug(c.db, eventId);
  const admin = isAdmin(c.user);
  if (!admin) {
    if (!ev.settings.directoryVisible) throw forbidden('The attendee directory is turned off for this event');
    if (!(await getMembership(c.db, ev.id, c.user!.id))) throw forbidden('Join the event to see its directory');
  }
  const rows = await c.db.select({ id: schema.users.id, name: schema.users.name, title: schema.users.title, org: schema.users.org, photo: schema.users.photoKey, role: schema.eventMembers.roleInEvent })
    .from(schema.eventMembers).innerJoin(schema.users, eq(schema.users.id, schema.eventMembers.userId))
    .where(and(eq(schema.eventMembers.eventId, ev.id), inArray(schema.users.status, ['active']))).orderBy(asc(schema.users.name));
  return json({ people: rows.map((p) => ({ id: p.id, name: p.name, title: p.title, org: p.org, role: p.role, hasPhoto: !!p.photo })) });
});

// ---- users & admins (admin only) ----
r.get('/api/people/users', ['admin'], async (c) => {
  const q = c.url.searchParams.get('q')?.trim();
  const rows = await c.db.select().from(schema.users)
    .where(q ? or(ilike(schema.users.email, `%${q.replace(/[%_]/g, '')}%`), ilike(schema.users.name, `%${q.replace(/[%_]/g, '')}%`)) : undefined)
    .orderBy(asc(schema.users.role), asc(schema.users.name)).limit(200);
  return json({ users: rows.map((u) => ({ ...publicUser(u), createdAt: u.createdAt })) });
});

r.post('/api/people/users', ['admin'], async (c) => {
  const b = await readJson(c.req, z.object({ name: z.string().trim().min(1).max(100), email: emailSchema, role: z.enum(['speaker', 'attendee', 'checkin_staff']) }));
  if (await findByEmail(c.db, b.email)) throw conflict('A user with that email already exists');
  const [u] = await c.db.insert(schema.users).values({ ...b, status: 'pending' }).returning();
  await audit(c.db, c.user!.id, 'user.create', 'user', u!.id, { role: b.role });
  return json({ user: publicUser(u!), inviteLink: tokenLink(c.req, await issueToken(c.db, u!.id, 'invite')) }, { status: 201 });
});

r.patch('/api/people/users/:id/role', ['admin'], async (c) => {
  const { role } = await readJson(c.req, z.object({ role: z.enum(['admin', 'speaker', 'attendee', 'checkin_staff']) }));
  const u = await changeUserRole(c.db, c.params.id!, role);
  await audit(c.db, c.user!.id, 'user.role', 'user', u.id, { role });
  return json({ user: publicUser(u) });
});

r.patch('/api/people/users/:id/profile', ['admin'], async (c) => {
  const b = await readJson(c.req, profileSchema);
  const [u] = await c.db.update(schema.users).set(b).where(eq(schema.users.id, c.params.id!)).returning();
  if (!u) throw notFound('User not found');
  return json({ user: publicUser(u) });
});

r.post('/api/people/users/:id/disable', ['admin'], async (c) => {
  await setUserStatus(c.db, c.params.id!, 'disabled');
  await audit(c.db, c.user!.id, 'user.disable', 'user', c.params.id!);
  return json({ ok: true });
});
r.post('/api/people/users/:id/enable', ['admin'], async (c) => {
  await setUserStatus(c.db, c.params.id!, 'active');
  await audit(c.db, c.user!.id, 'user.enable', 'user', c.params.id!);
  return json({ ok: true });
});

// One-time link an admin copies to the person: sets (or resets) their password. Resets live 60 minutes.
r.post('/api/people/users/:id/link', ['admin'], async (c) => {
  const [u] = await c.db.select().from(schema.users).where(eq(schema.users.id, c.params.id!));
  if (!u) throw notFound('User not found');
  const purpose = u.passwordHash ? 'reset' : u.role === 'admin' ? 'activate' : 'invite';
  const token = await issueToken(c.db, u.id, purpose);
  await audit(c.db, c.user!.id, `user.${purpose}_link`, 'user', u.id);
  return json({ purpose, link: tokenLink(c.req, token), expiresInMinutes: purpose === 'reset' ? 60 : purpose === 'invite' ? 14 * 24 * 60 : 7 * 24 * 60 });
});

export default (req: Request, ctx: Context) => r.handler(req, ctx);
export const config: Config = { path: '/api/people/*' };
