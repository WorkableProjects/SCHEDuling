import { beforeEach, describe, expect, it } from 'vitest';
import { Client, db, join, makeAdmins, makeEvent, makeSession, resetDb, signup } from './helpers';
import * as schema from '../netlify/database/schema';
import { eq } from 'drizzle-orm';

let ada: Client;
let ev: { id: string; slug: string };

beforeEach(async () => {
  await resetDb();
  [ada] = await makeAdmins();
  ev = await makeEvent(ada, { startDate: '2020-01-01', endDate: '2040-01-01' });
});

async function staff() {
  const r = await ada.post('/api/people/users', { name: 'Vera Volunteer', email: 'vera@example.com', role: 'checkin_staff' });
  const c = new Client();
  await c.post('/api/auth/activate', { token: r.data.inviteLink.split('/activate/')[1], password: 'volunteer password' });
  return c;
}

describe('check-in', () => {
  it('QR scan checks in once and reports duplicates without erroring', async () => {
    const u = await signup('Jo');
    const m = await join(u, ev.slug);
    const first = await ada.post(`/api/checkin/${ev.id}/scan`, { qrToken: `sched:${m.qrToken}` });
    expect(first.status).toBe(200);
    expect(first.data.event.alreadyCheckedIn).toBe(false);
    const second = await ada.post(`/api/checkin/${ev.id}/scan`, { qrToken: m.qrToken });
    expect(second.status).toBe(200);
    expect(second.data.event.alreadyCheckedIn).toBe(true);
    expect(second.data.event.at).toBe(first.data.event.at);
    expect((await ada.post(`/api/checkin/${ev.id}/scan`, { qrToken: 'not-a-real-token' })).status).toBe(404);
  });

  it('rejects QR codes from another event', async () => {
    const other = await makeEvent(ada, { slug: 'other', name: 'Other' });
    const u = await signup('Kim');
    const m = await join(u, other.slug);
    expect((await ada.post(`/api/checkin/${ev.id}/scan`, { qrToken: m.qrToken })).status).toBe(404);
  });

  it('records session check-in with the event check-in, once', async () => {
    const s = await makeSession(ada, ev.id, { requiresRegistration: true, capacity: 5 });
    const u = await signup('Lou');
    const m = await join(u, ev.slug);
    const r1 = await ada.post(`/api/checkin/${ev.id}/scan`, { qrToken: m.qrToken, sessionId: s.id });
    expect(r1.data.session).toMatchObject({ alreadyCheckedIn: false, warning: 'Not registered for this session' });
    const r2 = await ada.post(`/api/checkin/${ev.id}/scan`, { qrToken: m.qrToken, sessionId: s.id });
    expect(r2.data.session.alreadyCheckedIn).toBe(true);
    expect(await db.select().from(schema.sessionCheckins)).toHaveLength(1);
  });

  it('manual check-in by search works and undo is admin-only', async () => {
    const u = await signup('Mina Park', 'mina@example.com');
    await join(u, ev.slug);
    const found = await ada.get(`/api/checkin/${ev.id}/search?q=mina`);
    expect(found.data.people).toHaveLength(1);
    const done = await ada.post(`/api/checkin/${ev.id}/manual`, { userId: found.data.people[0].userId });
    expect(done.data.event.alreadyCheckedIn).toBe(false);
    const v = await staff();
    expect((await v.del(`/api/checkin/${ev.id}/${u.user!.id}`)).status).toBe(403);
    expect((await ada.del(`/api/checkin/${ev.id}/${u.user!.id}`)).status).toBe(200);
    const [m] = await db.select().from(schema.eventMembers).where(eq(schema.eventMembers.userId, u.user!.id));
    expect(m!.checkedInAt).toBeNull();
  });

  it('staff can scan and search but nothing else', async () => {
    const v = await staff();
    const u = await signup('Ned');
    const m = await join(u, ev.slug);
    expect((await v.post(`/api/checkin/${ev.id}/scan`, { qrToken: m.qrToken })).status).toBe(200);
    expect((await v.get(`/api/checkin/${ev.id}/stats`)).status).toBe(200);
    expect((await v.get(`/api/reports/event/${ev.id}/export/attendees`)).status).toBe(403);
    expect((await v.post('/api/events', {})).status).toBe(403);
    expect((await v.get('/api/people/users')).status).toBe(403);
  });

  it('self check-in only opens within 30 minutes of a session start', async () => {
    const soon = new Date(Date.now() + 10 * 60_000);
    const later = new Date(Date.now() + 5 * 3600_000);
    const sNow = await makeSession(ada, ev.id, { title: 'Now', startsAt: soon.toISOString(), endsAt: new Date(+soon + 3600_000).toISOString() });
    const sLater = await makeSession(ada, ev.id, { title: 'Later', startsAt: later.toISOString(), endsAt: new Date(+later + 3600_000).toISOString() });
    const u = await signup('Oli');
    await join(u, ev.slug);
    expect((await u.post(`/api/checkin/${ev.id}/self`, { sessionId: sLater.id })).status).toBe(409);
    const ok = await u.post(`/api/checkin/${ev.id}/self`, { sessionId: sNow.id });
    expect(ok.status).toBe(200);
    expect(ok.data.session.alreadyCheckedIn).toBe(false);
    expect((await u.post(`/api/checkin/${ev.id}/self`, { sessionId: sNow.id })).data.session.alreadyCheckedIn).toBe(true);
  });

  it('self check-in needs registration for registration-only sessions and respects the event setting', async () => {
    const soon = new Date(Date.now() + 5 * 60_000);
    const s = await makeSession(ada, ev.id, { requiresRegistration: true, capacity: 5, startsAt: soon.toISOString(), endsAt: new Date(+soon + 3600_000).toISOString() });
    const u = await signup('Pia');
    await join(u, ev.slug);
    expect((await u.post(`/api/checkin/${ev.id}/self`, { sessionId: s.id })).status).toBe(403);
    await u.post(`/api/sessions/${s.id}/register`);
    expect((await u.post(`/api/checkin/${ev.id}/self`, { sessionId: s.id })).status).toBe(200);
    const e = (await ada.get(`/api/events/${ev.slug}`)).data.event;
    await ada.patch(`/api/events/${ev.id}`, { ...e, branding: {}, settings: { selfCheckin: false } });
    expect((await u.post(`/api/checkin/${ev.id}/self`, {})).status).toBe(403);
  });

  it('stats and CSV exports reflect attendance', async () => {
    const s = await makeSession(ada, ev.id, { requiresRegistration: true, capacity: 2 });
    const [a, b] = await Promise.all([signup('=Evil Name', 'evil@example.com'), signup('Quinn', 'quinn@example.com')]);
    const ma = await join(a, ev.slug);
    await join(b, ev.slug);
    await a.post(`/api/sessions/${s.id}/register`);
    await b.post(`/api/sessions/${s.id}/register`);
    await ada.post(`/api/checkin/${ev.id}/scan`, { qrToken: ma.qrToken, sessionId: s.id });
    const stats = (await ada.get(`/api/checkin/${ev.id}/stats`)).data;
    expect(stats).toMatchObject({ members: 2, checkedIn: 1 });
    expect(stats.sessions[0]).toMatchObject({ registered: 2, checkedIn: 1 });
    const att = await ada.get(`/api/reports/event/${ev.id}/export/attendees`);
    expect(att.headers.get('content-type')).toMatch(/text\/csv/);
    expect(att.data).toContain('Name,Email,Role,Ticket type,Joined,Checked in at');
    expect(att.data).toContain("'=Evil Name"); // formula-injection guard
    const ck = await ada.get(`/api/reports/event/${ev.id}/export/checkins`);
    expect(ck.data.split('\r\n').filter(Boolean)).toHaveLength(2);
    const summary = (await ada.get(`/api/reports/event/${ev.id}/summary`)).data;
    expect(summary.noShows).toBe(1);
  });
});
