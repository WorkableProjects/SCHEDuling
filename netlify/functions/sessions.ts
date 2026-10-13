import type { Config, Context } from '@netlify/functions';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { schema, type DB } from '../lib/db';
import { createRouter, type Ctx } from '../lib/router';
import { badRequest, conflict, forbidden, HttpError, json, notFound, readJson } from '../lib/http';
import { feedbackSchema, sessionInputSchema } from '../../shared/schemas';
import { canSpeakerEditSession, getEventByIdOrSlug, isAdmin, requireViewEvent, type EventRow } from '../lib/permissions';
import { interestedUserIds, sessionDtos } from '../lib/sessions';
import { cancelRegistration, rebalanceSession, registerForSession } from '../lib/registration';
import { notify } from '../lib/notify';
import { audit } from '../lib/audit';
import { parseCsvObjects } from '../lib/csv';
import { parseWhen } from '../lib/time';
import { issueToken, tokenLink } from '../lib/tokens';
import { MAX_MATERIAL_BYTES, materialType, newKey, safeFileName, store } from '../lib/files';

const r = createRouter();
type SessionRow = typeof schema.sessions.$inferSelect;

async function loadSession(db: DB, id: string) {
  const [s] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, id)).limit(1);
  if (!s) throw notFound('Session not found');
  const [ev] = await db.select().from(schema.events).where(eq(schema.events.id, s.eventId));
  return { s, ev: ev! as EventRow };
}

async function assertRefs(db: DB, eventId: string, b: { roomId: string | null; trackIds: string[]; speakerIds: string[] }) {
  if (b.roomId) {
    const [x] = await db.select({ id: schema.rooms.id }).from(schema.rooms).where(and(eq(schema.rooms.id, b.roomId), eq(schema.rooms.eventId, eventId)));
    if (!x) throw badRequest('roomId: Room does not belong to this event');
  }
  if (b.trackIds.length) {
    const x = await db.select({ id: schema.tracks.id }).from(schema.tracks).where(and(inArray(schema.tracks.id, b.trackIds), eq(schema.tracks.eventId, eventId)));
    if (x.length !== new Set(b.trackIds).size) throw badRequest('trackIds: Unknown track');
  }
  if (b.speakerIds.length) {
    const x = await db.select({ id: schema.users.id }).from(schema.users).where(and(inArray(schema.users.id, b.speakerIds), eq(schema.users.role, 'speaker')));
    if (x.length !== new Set(b.speakerIds).size) throw badRequest('speakerIds: Every speaker must have the speaker role');
  }
}

async function setLinks(db: DB, sessionId: string, eventId: string, trackIds: string[], speakerIds: string[]) {
  await db.delete(schema.sessionTracks).where(eq(schema.sessionTracks.sessionId, sessionId));
  await db.delete(schema.sessionSpeakers).where(eq(schema.sessionSpeakers.sessionId, sessionId));
  if (trackIds.length) await db.insert(schema.sessionTracks).values([...new Set(trackIds)].map((trackId) => ({ sessionId, trackId })));
  if (speakerIds.length) {
    const ids = [...new Set(speakerIds)];
    await db.insert(schema.sessionSpeakers).values(ids.map((userId) => ({ sessionId, userId })));
    await db.insert(schema.eventMembers).values(ids.map((userId) => ({ eventId, userId, roleInEvent: 'speaker' }))).onConflictDoNothing();
  }
}

async function dtoFor(c: Pick<Ctx, 'db' | 'user'>, ev: EventRow, s: SessionRow) {
  return (await sessionDtos(c.db, ev, [s], c.user, { admin: isAdmin(c.user) }))[0]!;
}

r.get('/api/sessions', false, async (c) => {
  const eventId = c.url.searchParams.get('eventId');
  if (!eventId) throw badRequest('eventId is required');
  const ev = await getEventByIdOrSlug(c.db, eventId);
  await requireViewEvent(c, ev);
  const admin = isAdmin(c.user);
  const rows = await c.db.select().from(schema.sessions)
    .where(admin ? eq(schema.sessions.eventId, ev.id) : and(eq(schema.sessions.eventId, ev.id), inArray(schema.sessions.status, ['published', 'cancelled'])))
    .orderBy(asc(schema.sessions.startsAt), asc(schema.sessions.title));
  return json({ sessions: await sessionDtos(c.db, ev, rows, c.user, { admin }) });
});

r.get('/api/sessions/:id', false, async (c) => {
  const { s, ev } = await loadSession(c.db, c.params.id!);
  await requireViewEvent(c, ev);
  if (s.status === 'draft' && !isAdmin(c.user) && !(c.user && (await canSpeakerEditSession(c.db, c.user, s.id, ev)))) throw notFound('Session not found');
  return json({ session: await dtoFor(c, ev, s) });
});

r.post('/api/sessions', ['admin'], async (c) => {
  const b = await readJson(c.req, sessionInputSchema);
  const ev = await getEventByIdOrSlug(c.db, b.eventId);
  await assertRefs(c.db, ev.id, b);
  const s = await c.db.transaction(async (tx) => {
    const q = tx as unknown as DB;
    const [row] = await q.insert(schema.sessions).values({
      eventId: ev.id, title: b.title, description: b.description, startsAt: new Date(b.startsAt), endsAt: new Date(b.endsAt),
      roomId: b.roomId, status: b.status, capacity: b.capacity, requiresRegistration: b.requiresRegistration, pinned: b.pinned, frozen: b.frozen,
    }).returning();
    await setLinks(q, row!.id, ev.id, b.trackIds, b.speakerIds);
    return row!;
  });
  await audit(c.db, c.user!.id, 'session.create', 'session', s.id);
  return json({ session: await dtoFor(c, ev, s) }, { status: 201 });
});

r.patch('/api/sessions/:id', 'any', async (c) => {
  const { s: before, ev } = await loadSession(c.db, c.params.id!);
  const admin = isAdmin(c.user);

  // Speakers: description only, on their own sessions, when the event allows it.
  if (!admin) {
    if (!(await canSpeakerEditSession(c.db, c.user!, before.id, ev))) throw forbidden();
    const { description } = await readJson(c.req, z.object({ description: z.string().trim().max(10000).nullable() }));
    const [s] = await c.db.update(schema.sessions).set({ description: description || null }).where(eq(schema.sessions.id, before.id)).returning();
    await audit(c.db, c.user!.id, 'session.speaker_edit', 'session', before.id);
    return json({ session: await dtoFor(c, ev, s!) });
  }

  const b = await readJson(c.req, sessionInputSchema);
  if (b.eventId !== before.eventId) throw badRequest('A session cannot move to another event');
  await assertRefs(c.db, ev.id, b);
  const next = await c.db.transaction(async (tx) => {
    const q = tx as unknown as DB;
    const [row] = await q.update(schema.sessions).set({
      title: b.title, description: b.description, startsAt: new Date(b.startsAt), endsAt: new Date(b.endsAt), roomId: b.roomId,
      status: b.status, capacity: b.capacity, requiresRegistration: b.requiresRegistration, pinned: b.pinned, frozen: b.frozen,
    }).where(eq(schema.sessions.id, before.id)).returning();
    await setLinks(q, before.id, ev.id, b.trackIds, b.speakerIds);
    return row!;
  });
  if (next.status === 'published' && (next.capacity !== before.capacity || before.status !== 'published')) await rebalanceSession(c.db, next.id);
  await notifyChange(c.db, ev, before, next);
  await audit(c.db, c.user!.id, 'session.update', 'session', before.id);
  return json({ session: await dtoFor(c, ev, next) });
});

async function notifyChange(db: DB, ev: EventRow, before: SessionRow, next: SessionRow) {
  if (before.status === 'draft') return; // drafts are private
  const cancelled = next.status === 'cancelled' && before.status !== 'cancelled';
  const changes: string[] = [];
  if (before.startsAt.getTime() !== next.startsAt.getTime() || before.endsAt.getTime() !== next.endsAt.getTime()) changes.push('time');
  if (before.roomId !== next.roomId) changes.push('room');
  if (before.title !== next.title) changes.push('title');
  if (!cancelled && !changes.length) return;
  if (next.status === 'draft') return;
  const users = await interestedUserIds(db, next);
  await notify(db, users.map((userId) => ({
    userId, eventId: ev.id, kind: cancelled ? 'session_cancelled' : 'session_change',
    title: cancelled ? `Cancelled: ${next.title}` : `Updated: ${next.title}`,
    body: cancelled ? 'This session has been cancelled.' : `The ${changes.join(' and ')} changed. Check the schedule for details.`,
    link: `/e/${ev.slug}/session/${next.id}`,
  })));
}

r.delete('/api/sessions/:id', ['admin'], async ({ db, params, user }) => {
  const { s, ev } = await loadSession(db, params.id!);
  if (s.status === 'published') {
    const users = await interestedUserIds(db, s);
    await notify(db, users.map((userId) => ({ userId, eventId: ev.id, kind: 'session_cancelled', title: `Removed: ${s.title}`, body: 'This session was removed from the schedule.', link: `/e/${ev.slug}/schedule` })));
  }
  await db.delete(schema.sessions).where(eq(schema.sessions.id, s.id));
  await audit(db, user!.id, 'session.delete', 'session', s.id, { title: s.title });
  return json({ ok: true });
});

r.post('/api/sessions/bulk', ['admin'], async ({ req, db, user }) => {
  const b = await readJson(req, z.object({ eventId: z.string().uuid(), action: z.enum(['publish', 'unpublish']) }));
  const ev = await getEventByIdOrSlug(db, b.eventId);
  const from = b.action === 'publish' ? 'draft' : 'published';
  const to = b.action === 'publish' ? 'published' : 'draft';
  const rows = await db.update(schema.sessions).set({ status: to }).where(and(eq(schema.sessions.eventId, ev.id), eq(schema.sessions.status, from))).returning({ id: schema.sessions.id });
  await audit(db, user!.id, `session.bulk_${b.action}`, 'event', ev.id, { count: rows.length });
  return json({ changed: rows.length });
});

// ---- registration (distinct from "add to agenda") ----
r.post('/api/sessions/:id/register', 'any', async (c) => {
  const { s, ev } = await loadSession(c.db, c.params.id!);
  await requireViewEvent(c, ev);
  const res = await registerForSession(c.db, { sessionId: s.id, userId: c.user!.id });
  return json(res, { status: res.already ? 200 : 201 });
});
r.delete('/api/sessions/:id/register', 'any', async (c) => {
  const res = await cancelRegistration(c.db, { sessionId: c.params.id!, userId: c.user!.id });
  return json(res);
});
r.post('/api/sessions/:id/enroll', ['admin'], async (c) => {
  const { userId } = await readJson(c.req, z.object({ userId: z.string().uuid() }));
  const res = await registerForSession(c.db, { sessionId: c.params.id!, userId, admin: true });
  await audit(c.db, c.user!.id, 'session.enroll', 'session', c.params.id!, { userId });
  return json(res);
});
r.delete('/api/sessions/:id/enroll/:userId', ['admin'], async (c) => {
  const res = await cancelRegistration(c.db, { sessionId: c.params.id!, userId: c.params.userId!, admin: true });
  await audit(c.db, c.user!.id, 'session.unenroll', 'session', c.params.id!, { userId: c.params.userId });
  return json(res);
});

r.get('/api/sessions/:id/registrations', ['admin'], async ({ db, params }) => {
  const rows = await db.select({
    userId: schema.users.id, name: schema.users.name, email: schema.users.email, status: schema.sessionRegistrations.status,
    position: schema.sessionRegistrations.position, at: schema.sessionRegistrations.createdAt, checkedInAt: schema.sessionCheckins.at,
  }).from(schema.sessionRegistrations)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessionRegistrations.userId))
    .leftJoin(schema.sessionCheckins, and(eq(schema.sessionCheckins.sessionId, schema.sessionRegistrations.sessionId), eq(schema.sessionCheckins.userId, schema.sessionRegistrations.userId)))
    .where(eq(schema.sessionRegistrations.sessionId, params.id!))
    .orderBy(asc(schema.sessionRegistrations.status), asc(schema.sessionRegistrations.position), asc(schema.sessionRegistrations.createdAt));
  return json({ registrations: rows });
});

// ---- feedback ----
r.post('/api/sessions/:id/feedback', 'any', async (c) => {
  const { s, ev } = await loadSession(c.db, c.params.id!);
  await requireViewEvent(c, ev);
  if (s.status !== 'published') throw conflict('Feedback is only open for published sessions');
  if (s.startsAt.getTime() > Date.now()) throw conflict('Feedback opens when the session starts');
  const [attended] = await c.db.select({ n: sql<number>`count(*)::int` }).from(schema.sessionCheckins).where(and(eq(schema.sessionCheckins.sessionId, s.id), eq(schema.sessionCheckins.userId, c.user!.id)));
  const [onAgenda] = await c.db.select({ n: sql<number>`count(*)::int` }).from(schema.agendaItems).where(and(eq(schema.agendaItems.sessionId, s.id), eq(schema.agendaItems.userId, c.user!.id)));
  const [reg] = await c.db.select({ n: sql<number>`count(*)::int` }).from(schema.sessionRegistrations).where(and(eq(schema.sessionRegistrations.sessionId, s.id), eq(schema.sessionRegistrations.userId, c.user!.id), eq(schema.sessionRegistrations.status, 'registered')));
  if (!(attended?.n || onAgenda?.n || reg?.n)) throw forbidden('Only attendees who joined this session can leave feedback');
  const b = await readJson(c.req, feedbackSchema);
  await c.db.insert(schema.feedback).values({ sessionId: s.id, userId: c.user!.id, rating: b.rating, comment: b.comment })
    .onConflictDoUpdate({ target: [schema.feedback.sessionId, schema.feedback.userId], set: { rating: b.rating, comment: b.comment } });
  return json({ ok: true });
});
r.get('/api/sessions/:id/feedback/mine', 'any', async (c) => {
  const [f] = await c.db.select().from(schema.feedback).where(and(eq(schema.feedback.sessionId, c.params.id!), eq(schema.feedback.userId, c.user!.id)));
  return json({ feedback: f ?? null });
});

// ---- materials (Netlify Blobs) ----
async function assertCanEditMaterials(c: Ctx, sessionId: string) {
  const { s, ev } = await loadSession(c.db, sessionId);
  if (!isAdmin(c.user) && !(await canSpeakerEditSession(c.db, c.user!, s.id, ev))) throw forbidden();
  return s;
}
r.post('/api/sessions/:id/materials', 'any', async (c) => {
  const s = await assertCanEditMaterials(c, c.params.id!);
  const form = await c.req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) throw badRequest('Attach a file in the "file" field');
  if (file.size > MAX_MATERIAL_BYTES) throw new HttpError(413, 'Files can be up to 5 MB', 'too_large');
  if (s.materials.length >= 10) throw conflict('A session can have up to 10 files');
  const name = safeFileName(file.name);
  materialType(name);
  const key = newKey(`materials/${s.id}`);
  await store().set(key, await file.arrayBuffer(), { metadata: { name } });
  const [u] = await c.db.update(schema.sessions).set({ materials: [...s.materials, { key, name, size: file.size }] }).where(eq(schema.sessions.id, s.id)).returning();
  return json({ materials: u!.materials.map((m, i) => ({ index: i, name: m.name, size: m.size })) }, { status: 201 });
});
r.delete('/api/sessions/:id/materials/:index', 'any', async (c) => {
  const s = await assertCanEditMaterials(c, c.params.id!);
  const i = Number(c.params.index);
  const m = s.materials[i];
  if (!m) throw notFound('File not found');
  await store().delete(m.key);
  await c.db.update(schema.sessions).set({ materials: s.materials.filter((_, j) => j !== i) }).where(eq(schema.sessions.id, s.id));
  return json({ ok: true });
});
r.get('/api/sessions/:id/materials/:index', false, async (c) => {
  const { s, ev } = await loadSession(c.db, c.params.id!);
  await requireViewEvent(c, ev);
  if (s.status === 'draft' && !isAdmin(c.user)) throw notFound();
  const m = s.materials[Number(c.params.index)];
  if (!m) throw notFound('File not found');
  const data = await store().get(m.key, { type: 'arrayBuffer' });
  if (!data) throw notFound('File not found');
  return new Response(data, { headers: {
    'content-type': materialType(m.name), 'content-disposition': `attachment; filename="${m.name}"`,
    'x-content-type-options': 'nosniff', 'cache-control': 'private, max-age=300',
  } });
});

// ---- CSV import: creates sessions, or updates existing ones when an `id` column is present ----
const rowBool = (v: string | undefined) => (v === undefined || v === '' ? undefined : /^(1|true|yes|y)$/i.test(v));
r.post('/api/sessions/import', ['admin'], async (c) => {
  const body = await readJson(c.req, z.object({ eventId: z.string().uuid(), csv: z.string().max(2_000_000), dryRun: z.boolean().default(false) }));
  const ev = await getEventByIdOrSlug(c.db, body.eventId);
  const rows = parseCsvObjects(body.csv);
  if (!rows.length) throw badRequest('The CSV has no data rows');
  if (rows.length > 1000) throw badRequest('Import up to 1000 rows at a time');

  const errors: { row: number; message: string }[] = [];
  const existingRooms = new Map((await c.db.select().from(schema.rooms).where(eq(schema.rooms.eventId, ev.id))).map((x) => [x.name.toLowerCase(), x.id]));
  const existingTracks = new Map((await c.db.select().from(schema.tracks).where(eq(schema.tracks.eventId, ev.id))).map((x) => [x.name.toLowerCase(), x.id]));
  const existingSessions = new Map((await c.db.select().from(schema.sessions).where(eq(schema.sessions.eventId, ev.id))).map((x) => [x.id, x]));

  type Plan = { id?: string; title?: string; description?: string; startsAt?: Date; endsAt?: Date; room?: string; tracks?: string[]; speakers?: string[]; capacity?: number | null; requiresRegistration?: boolean; pinned?: boolean; frozen?: boolean; status?: 'draft' | 'published' | 'cancelled' };
  const plans: Plan[] = rows.map((row, i) => {
    const n = i + 2; // spreadsheet row number (1 = header)
    const p: Plan = {};
    const err = (m: string) => errors.push({ row: n, message: m });
    if (row.id) {
      if (!existingSessions.has(row.id)) err(`id ${row.id} is not a session in this event`);
      p.id = row.id;
    }
    if (row.title) p.title = row.title; else if (!row.id) err('title is required');
    if (row.description) p.description = row.description;
    if (row.start || !row.id) {
      const d = row.start ? parseWhen(row.start, ev.tz) : null;
      if (!d) err(`start "${row.start ?? ''}" is not a valid date/time (use YYYY-MM-DD HH:mm)`); else p.startsAt = d;
    }
    if (row.end || !row.id) {
      const d = row.end ? parseWhen(row.end, ev.tz) : null;
      if (!d) err(`end "${row.end ?? ''}" is not a valid date/time (use YYYY-MM-DD HH:mm)`); else p.endsAt = d;
    }
    const startsAt = p.startsAt ?? (p.id ? existingSessions.get(p.id)?.startsAt : undefined);
    const endsAt = p.endsAt ?? (p.id ? existingSessions.get(p.id)?.endsAt : undefined);
    if (startsAt && endsAt && endsAt <= startsAt) err('end must be after start');
    if (row.room) p.room = row.room;
    if (row.tracks) p.tracks = row.tracks.split(/[;|]/).map((t) => t.trim()).filter(Boolean);
    if (row.speakers) {
      p.speakers = row.speakers.split(/[;|]/).map((t) => t.trim().toLowerCase()).filter(Boolean);
      for (const e of p.speakers) if (!z.string().email().safeParse(e).success) err(`speaker "${e}" must be an email address`);
    }
    if (row.capacity !== undefined && row.capacity !== '') {
      const cap = Number(row.capacity);
      if (!Number.isInteger(cap) || cap < 1) err('capacity must be a whole number of 1 or more'); else p.capacity = cap;
    }
    p.requiresRegistration = rowBool(row.requires_registration);
    p.pinned = rowBool(row.pinned);
    p.frozen = rowBool(row.frozen);
    if (row.status) {
      if (!['draft', 'published', 'cancelled'].includes(row.status)) err('status must be draft, published or cancelled'); else p.status = row.status as Plan['status'];
    }
    return p;
  });
  if (errors.length) return json({ ok: false, errors }, { status: 422 });
  const created = plans.filter((p) => !p.id).length;
  if (body.dryRun) return json({ ok: true, dryRun: true, created, updated: plans.length - created });

  const invites: { email: string; link: string }[] = [];
  await c.db.transaction(async (tx) => {
    const q = tx as unknown as DB;
    const roomId = async (name: string) => {
      const k = name.toLowerCase();
      if (!existingRooms.has(k)) { const [x] = await q.insert(schema.rooms).values({ eventId: ev.id, name }).returning(); existingRooms.set(k, x!.id); }
      return existingRooms.get(k)!;
    };
    const trackId = async (name: string) => {
      const k = name.toLowerCase();
      if (!existingTracks.has(k)) { const [x] = await q.insert(schema.tracks).values({ eventId: ev.id, name }).returning(); existingTracks.set(k, x!.id); }
      return existingTracks.get(k)!;
    };
    const speakerId = async (email: string) => {
      const [u] = await q.select().from(schema.users).where(sql`lower(${schema.users.email}) = ${email}`);
      if (u) {
        if (u.role === 'attendee') await q.update(schema.users).set({ role: 'speaker' }).where(eq(schema.users.id, u.id));
        else if (u.role !== 'speaker') throw badRequest(`${email} is a ${u.role} account and cannot be a speaker`);
        return u.id;
      }
      const [n] = await q.insert(schema.users).values({ email, name: email.split('@')[0]!, role: 'speaker', status: 'pending' }).returning();
      invites.push({ email, link: tokenLink(c.req, await issueToken(q, n!.id, 'invite')) });
      return n!.id;
    };
    for (const p of plans) {
      const values: Partial<typeof schema.sessions.$inferInsert> = {};
      if (p.title !== undefined) values.title = p.title;
      if (p.description !== undefined) values.description = p.description;
      if (p.startsAt) values.startsAt = p.startsAt;
      if (p.endsAt) values.endsAt = p.endsAt;
      if (p.room) values.roomId = await roomId(p.room);
      if (p.capacity !== undefined) values.capacity = p.capacity;
      if (p.requiresRegistration !== undefined) values.requiresRegistration = p.requiresRegistration;
      if (p.pinned !== undefined) values.pinned = p.pinned;
      if (p.frozen !== undefined) values.frozen = p.frozen;
      if (p.status) values.status = p.status;
      let sid = p.id;
      if (sid) await q.update(schema.sessions).set(values).where(eq(schema.sessions.id, sid));
      else {
        const [x] = await q.insert(schema.sessions).values({ eventId: ev.id, status: 'draft', ...values } as typeof schema.sessions.$inferInsert).returning();
        sid = x!.id;
      }
      if (p.tracks) {
        await q.delete(schema.sessionTracks).where(eq(schema.sessionTracks.sessionId, sid));
        const ids = [...new Set(await Promise.all(p.tracks.map(trackId)))];
        if (ids.length) await q.insert(schema.sessionTracks).values(ids.map((t) => ({ sessionId: sid!, trackId: t })));
      }
      if (p.speakers) {
        await q.delete(schema.sessionSpeakers).where(eq(schema.sessionSpeakers.sessionId, sid));
        const ids: string[] = [];
        for (const e of p.speakers) ids.push(await speakerId(e));
        const uniq = [...new Set(ids)];
        if (uniq.length) {
          await q.insert(schema.sessionSpeakers).values(uniq.map((u) => ({ sessionId: sid!, userId: u })));
          await q.insert(schema.eventMembers).values(uniq.map((u) => ({ eventId: ev.id, userId: u, roleInEvent: 'speaker' }))).onConflictDoNothing();
        }
      }
    }
  });
  for (const p of plans) if (p.id && p.capacity !== undefined) await rebalanceSession(c.db, p.id);
  await audit(c.db, c.user!.id, 'session.import', 'event', ev.id, { created, updated: plans.length - created });
  return json({ ok: true, created, updated: plans.length - created, invites });
});

export default (req: Request, ctx: Context) => r.handler(req, ctx);
export const config: Config = { path: ['/api/sessions', '/api/sessions/*'] };
