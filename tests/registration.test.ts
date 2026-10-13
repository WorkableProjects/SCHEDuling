import { beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { Client, db, join, makeAdmins, makeEvent, makeSession, resetDb, signup } from './helpers';
import * as schema from '../netlify/database/schema';

let ada: Client;
let ev: { id: string; slug: string };

beforeEach(async () => {
  await resetDb();
  [ada] = await makeAdmins();
  ev = await makeEvent(ada);
});

const reg = (c: Client, id: string) => c.post(`/api/sessions/${id}/register`);

describe('registration and capacity', () => {
  it('registering is separate from adding to the agenda', async () => {
    const s = await makeSession(ada, ev.id, { requiresRegistration: true, capacity: 1 });
    const u = await signup('Ann');
    await join(u, ev.slug);
    expect((await u.post(`/api/agenda/${s.id}`)).status).toBe(201);
    const list = await u.get(`/api/sessions?eventId=${ev.id}`);
    const mine = list.data.sessions[0];
    expect(mine.mine).toMatchObject({ inAgenda: true, registration: null });
    expect(mine.registeredCount).toBe(0); // agenda did not consume capacity
  });

  it('requires event membership and a published, registration-enabled session', async () => {
    const s = await makeSession(ada, ev.id, { requiresRegistration: true });
    const draft = await makeSession(ada, ev.id, { requiresRegistration: true, status: 'draft', title: 'Draft' });
    const plain = await makeSession(ada, ev.id, { title: 'Plain', startsAt: '2030-05-01T20:00:00Z', endsAt: '2030-05-01T21:00:00Z' });
    const u = await signup('Ben');
    expect((await reg(u, s.id)).status).toBe(403);
    await join(u, ev.slug);
    expect((await reg(u, s.id)).status).toBe(201);
    expect((await reg(u, draft.id)).status).toBe(409);
    expect((await reg(u, plain.id)).status).toBe(400);
  });

  it('is idempotent', async () => {
    const s = await makeSession(ada, ev.id, { requiresRegistration: true, capacity: 5 });
    const u = await signup('Cy');
    await join(u, ev.slug);
    expect((await reg(u, s.id)).status).toBe(201);
    const again = await reg(u, s.id);
    expect(again.status).toBe(200);
    expect(again.data.already).toBe(true);
  });

  it('never oversells under concurrency, and waitlists the rest in order', async () => {
    const s = await makeSession(ada, ev.id, { requiresRegistration: true, capacity: 3 });
    const users = await Promise.all(Array.from({ length: 10 }, (_, i) => signup(`Racer ${i}`, `racer${i}@example.com`)));
    for (const u of users) await join(u, ev.slug);
    const results = await Promise.all(users.map((u) => reg(u, s.id)));
    expect(results.every((r) => r.status === 201)).toBe(true);
    const rows = await db.select().from(schema.sessionRegistrations).where(eq(schema.sessionRegistrations.sessionId, s.id));
    expect(rows.filter((r) => r.status === 'registered')).toHaveLength(3);
    const waiting = rows.filter((r) => r.status === 'waitlisted').map((r) => r.position).sort((a, b) => a! - b!);
    expect(waiting).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('promotes the first waitlisted person when a registered one cancels, and notifies them', async () => {
    const s = await makeSession(ada, ev.id, { requiresRegistration: true, capacity: 1 });
    const [a, b, c] = await Promise.all(['A', 'B', 'C'].map((n) => signup(`Person ${n}`, `p${n}@example.com`)));
    for (const u of [a!, b!, c!]) await join(u, ev.slug);
    expect((await reg(a!, s.id)).data.status).toBe('registered');
    const rb = await reg(b!, s.id);
    expect(rb.data).toMatchObject({ status: 'waitlisted', position: 1 });
    expect((await reg(c!, s.id)).data.position).toBe(2);
    expect((await a!.del(`/api/sessions/${s.id}/register`)).data.promoted).toEqual([b!.user!.id]);
    const notes = await b!.get('/api/comms/notifications');
    expect(notes.data.notifications.map((n: { kind: string }) => n.kind)).toContain('promoted');
    const after = await db.select().from(schema.sessionRegistrations).where(and(eq(schema.sessionRegistrations.userId, b!.user!.id)));
    expect(after[0]).toMatchObject({ status: 'registered', position: null });
  });

  it('fills open spots when an admin raises capacity', async () => {
    const s = await makeSession(ada, ev.id, { requiresRegistration: true, capacity: 1 });
    const [a, b] = await Promise.all(['A', 'B'].map((n) => signup(`Q ${n}`, `q${n}@example.com`)));
    for (const u of [a!, b!]) { await join(u, ev.slug); await reg(u, s.id); }
    const full = (await ada.get(`/api/sessions/${s.id}`)).data.session;
    expect(full.capacityLabel).toBe('full');
    await ada.patch(`/api/sessions/${s.id}`, { eventId: ev.id, title: 'Opening keynote', startsAt: full.startsAt, endsAt: full.endsAt, status: 'published', capacity: 2, requiresRegistration: true });
    const rows = await db.select().from(schema.sessionRegistrations);
    expect(rows.every((r) => r.status === 'registered')).toBe(true);
  });

  it('blocks overlapping registrations unless the event allows conflicts', async () => {
    const s1 = await makeSession(ada, ev.id, { requiresRegistration: true, title: 'One' });
    const s2 = await makeSession(ada, ev.id, { requiresRegistration: true, title: 'Two', startsAt: '2030-05-01T17:30:00Z', endsAt: '2030-05-01T18:30:00Z' });
    const s3 = await makeSession(ada, ev.id, { requiresRegistration: true, title: 'Three', startsAt: '2030-05-01T18:00:00Z', endsAt: '2030-05-01T19:00:00Z' });
    const u = await signup('Dee');
    await join(u, ev.slug);
    expect((await reg(u, s1.id)).status).toBe(201);
    const clash = await reg(u, s2.id);
    expect(clash.status).toBe(409);
    expect(clash.data.error).toMatch(/overlaps with "One"/);
    expect((await reg(u, s3.id)).status).toBe(201); // back-to-back is fine
    const e = (await ada.get(`/api/events/${ev.slug}`)).data.event;
    await ada.patch(`/api/events/${ev.id}`, { ...e, branding: {}, settings: { allowConflicts: true } });
    expect((await reg(u, s2.id)).status).toBe(201);
  });

  it('applies the conflict check concurrently too', async () => {
    const s1 = await makeSession(ada, ev.id, { requiresRegistration: true, title: 'One' });
    const s2 = await makeSession(ada, ev.id, { requiresRegistration: true, title: 'Two' });
    const u = await signup('Eli');
    await join(u, ev.slug);
    const [x, y] = await Promise.all([reg(u, s1.id), reg(u, s2.id)]);
    expect([x.status, y.status].sort()).toEqual([201, 409]);
  });

  it('frozen sessions block joining and leaving, but admins can still enroll', async () => {
    const s = await makeSession(ada, ev.id, { requiresRegistration: true, frozen: true });
    const open = await makeSession(ada, ev.id, { requiresRegistration: true, title: 'Open', startsAt: '2030-05-01T20:00:00Z', endsAt: '2030-05-01T21:00:00Z' });
    const u = await signup('Fay');
    await join(u, ev.slug);
    expect((await reg(u, s.id)).status).toBe(403);
    expect((await u.post(`/api/agenda/${s.id}`)).status).toBe(403);
    expect((await ada.post(`/api/sessions/${s.id}/enroll`, { userId: u.user!.id })).status).toBe(200);
    expect((await u.del(`/api/sessions/${s.id}/register`)).status).toBe(403);
    // leaving a non-frozen session still works; freezing the whole schedule blocks everything
    expect((await reg(u, open.id)).status).toBe(201);
    const e = (await ada.get(`/api/events/${ev.slug}`)).data.event;
    await ada.patch(`/api/events/${ev.id}`, { ...e, branding: {}, settings: { scheduleFrozen: true } });
    expect((await u.del(`/api/sessions/${open.id}/register`)).status).toBe(403);
  });

  it('pinned sessions show on every agenda without registering anyone', async () => {
    const s = await makeSession(ada, ev.id, { pinned: true, title: 'Welcome' });
    const u = await signup('Gus');
    await join(u, ev.slug);
    const a = await u.get(`/api/agenda?eventId=${ev.id}`);
    expect(a.data.sessions).toHaveLength(1);
    expect(a.data.sessions[0]).toMatchObject({ id: s.id, reason: 'pinned' });
    const rows = await db.select().from(schema.sessionRegistrations);
    expect(rows).toHaveLength(0);
    expect((await u.del(`/api/agenda/${s.id}`)).data.stillPinned).toBe(true);
  });

  it('cannot remove a registered session from the agenda', async () => {
    const s = await makeSession(ada, ev.id, { requiresRegistration: true });
    const u = await signup('Hope');
    await join(u, ev.slug);
    await reg(u, s.id);
    expect((await u.del(`/api/agenda/${s.id}`)).status).toBe(409);
  });

  it('notifies agenda holders when a published session changes or is cancelled', async () => {
    const s = await makeSession(ada, ev.id, { title: 'Workshop' });
    const u = await signup('Ivy');
    await join(u, ev.slug);
    await u.post(`/api/agenda/${s.id}`);
    const base = { eventId: ev.id, title: 'Workshop', startsAt: '2030-05-01T19:00:00Z', endsAt: '2030-05-01T20:00:00Z', status: 'published' };
    await ada.patch(`/api/sessions/${s.id}`, base);
    await ada.patch(`/api/sessions/${s.id}`, { ...base, status: 'cancelled' });
    const kinds = (await u.get('/api/comms/notifications')).data.notifications.map((n: { kind: string }) => n.kind).sort();
    expect(kinds).toEqual(['session_cancelled', 'session_change']);
  });
});
