import { beforeEach, describe, expect, it } from 'vitest';
import { Client, PASSWORD, db, join, makeAdmins, makeEvent, makeSession, resetDb, signup } from './helpers';
import * as schema from '../netlify/database/schema';
import { runMaintenance } from '../netlify/functions/maintenance';

let ada: Client;
let ev: { id: string; slug: string };
let sess: { id: string };
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

beforeEach(async () => {
  await resetDb();
  [ada] = await makeAdmins();
  ev = await makeEvent(ada);
  sess = await makeSession(ada, ev.id);
});

async function role(r: 'speaker' | 'checkin_staff', email: string) {
  const res = await ada.post('/api/people/users', { name: `${r} person`, email, role: r });
  const c = new Client();
  await c.post('/api/auth/activate', { token: res.data.inviteLink.split('/activate/')[1], password: PASSWORD });
  return c;
}

describe('permission matrix: admin-only endpoints reject everyone else', () => {
  it.each([
    ['POST', '/api/events', {}],
    ['PATCH', '/api/events/:ev', {}],
    ['POST', '/api/events/:ev/publish', {}],
    ['DELETE', '/api/events/:ev', undefined],
    ['POST', '/api/events/:ev/tracks', { name: 'x' }],
    ['POST', '/api/events/:ev/rooms', { name: 'x' }],
    ['POST', '/api/sessions', {}],
    ['DELETE', '/api/sessions/:s', undefined],
    ['POST', '/api/sessions/bulk', {}],
    ['POST', '/api/sessions/import', {}],
    ['POST', '/api/sessions/:s/enroll', {}],
    ['GET', '/api/sessions/:s/registrations', undefined],
    ['POST', '/api/people/speakers', {}],
    ['GET', '/api/people/attendees?eventId=:ev', undefined],
    ['POST', '/api/people/attendees', {}],
    ['POST', '/api/people/attendees/import', {}],
    ['GET', '/api/people/users', undefined],
    ['POST', '/api/people/users', {}],
    ['PATCH', '/api/people/users/:me/role', { role: 'admin' }],
    ['POST', '/api/people/users/:me/disable', {}],
    ['POST', '/api/people/users/:me/link', {}],
    ['POST', '/api/comms/events/:ev/announcements', { title: 't', body: 'b' }],
    ['GET', '/api/reports/dashboard', undefined],
    ['GET', '/api/reports/audit', undefined],
    ['GET', '/api/reports/event/:ev/summary', undefined],
    ['GET', '/api/reports/event/:ev/export/attendees', undefined],
    ['DELETE', '/api/checkin/:ev/:me', undefined],
  ] as [string, string, unknown][])('%s %s', async (method, path, body) => {
    const attendee = await signup('Plain Attendee', 'plain@example.com');
    const speaker = await role('speaker', 'spk@example.com');
    const staff = await role('checkin_staff', 'staff@example.com');
    const anon = new Client();
    const resolve = (c: Client) => path.replace(':ev', ev.id).replace(':s', sess.id).replace(':me', c.user?.id ?? attendee.user!.id);
    expect((await anon.call(method, resolve(anon), body)).status).toBe(401);
    for (const c of [attendee, speaker, staff]) {
      const res = await c.call(method, resolve(c), body);
      expect([403], `${method} ${path} as ${c.user?.role}: ${res.status} ${JSON.stringify(res.data)}`).toContain(res.status);
    }
  });
});

describe('event privacy', () => {
  it('hides unpublished events from everyone but admins', async () => {
    const draft = await ada.post('/api/events', { slug: 'draft', name: 'Draft', tz: 'UTC', startDate: '2031-01-01', endDate: '2031-01-01', privacy: 'public' });
    const u = await signup('Pat');
    expect((await u.get('/api/events/draft')).status).toBe(404);
    expect((await ada.get('/api/events/draft')).status).toBe(200);
    expect((await u.get('/api/events')).data.events.map((e: { slug: string }) => e.slug)).toEqual(['summit']);
    void draft;
  });

  it('invite-only events are invisible and closed to non-members', async () => {
    const inv = await makeEvent(ada, { slug: 'private', name: 'Private', privacy: 'invite_only' });
    await makeSession(ada, inv.id, { title: 'Secret' });
    const stranger = await signup('Stranger');
    expect((await stranger.get('/api/events')).data.events.map((e: { slug: string }) => e.slug)).not.toContain('private');
    expect((await stranger.get(`/api/sessions?eventId=${inv.id}`)).status).toBe(403);
    expect((await stranger.post('/api/events/private/join')).status).toBe(403);
    const added = await ada.post('/api/people/attendees', { eventId: inv.id, name: 'Invited', email: 'invited@example.com' });
    expect(added.data.inviteLink).toContain('/activate/');
    const guest = new Client();
    await guest.post('/api/auth/activate', { token: added.data.inviteLink.split('/activate/')[1], password: PASSWORD });
    expect((await guest.get('/api/events')).data.events.map((e: { slug: string }) => e.slug)).toContain('private');
    expect((await guest.get(`/api/sessions?eventId=${inv.id}`)).status).toBe(200);
  });

  it('password events need the password before sessions or joining', async () => {
    const pw = await makeEvent(ada, { slug: 'locked', name: 'Locked', privacy: 'password', password: 'open sesame' });
    await makeSession(ada, pw.id);
    const u = await signup('Quin');
    expect((await u.get(`/api/sessions?eventId=${pw.id}`)).status).toBe(403);
    expect((await u.post('/api/events/locked/join')).status).toBe(403);
    expect((await u.post('/api/events/locked/unlock', { password: 'wrong' })).status).toBe(403);
    expect((await u.post('/api/events/locked/unlock', { password: 'open sesame' })).status).toBe(200);
    expect((await u.get(`/api/sessions?eventId=${pw.id}`)).status).toBe(200);
    expect((await u.post('/api/events/locked/join')).status).toBe(201);
    // the hash is never exposed
    expect(JSON.stringify((await ada.get('/api/events/locked')).data)).not.toContain('argon2');
  });

  it('draft sessions are only visible to admins', async () => {
    await makeSession(ada, ev.id, { title: 'Hidden draft', status: 'draft' });
    const u = await signup('Rae');
    const titles = (await u.get(`/api/sessions?eventId=${ev.id}`)).data.sessions.map((s: { title: string }) => s.title);
    expect(titles).not.toContain('Hidden draft');
    expect((await ada.get(`/api/sessions?eventId=${ev.id}`)).data.sessions).toHaveLength(2);
  });

  it('slugs are unique case-insensitively', async () => {
    const r = await ada.post('/api/events', { slug: 'SUMMIT', name: 'Dup', tz: 'UTC', startDate: '2031-01-01', endDate: '2031-01-01', privacy: 'public' });
    expect(r.status).toBe(409);
  });
});

describe('speakers', () => {
  it('invite -> own profile -> edits own session only when allowed', async () => {
    const created = await ada.post('/api/people/speakers', { eventId: ev.id, name: 'Sam Speaker', email: 'sam@example.com', title: 'CTO' });
    expect(created.status).toBe(201);
    const sam = new Client();
    await sam.post('/api/auth/activate', { token: created.data.inviteLink.split('/activate/')[1], password: PASSWORD });
    expect((await sam.patch('/api/auth/me', { name: 'Sam S.', title: 'CTO', org: 'Acme', bio: 'Hi' })).data.user.org).toBe('Acme');
    const mine = await makeSession(ada, ev.id, { title: 'Sam talk', speakerIds: [created.data.user.id], startsAt: '2030-05-01T20:00:00Z', endsAt: '2030-05-01T21:00:00Z' });
    expect((await sam.patch(`/api/sessions/${mine.id}`, { description: 'Updated by speaker' })).status).toBe(200);
    expect((await sam.patch(`/api/sessions/${sess.id}`, { description: 'Not mine' })).status).toBe(403);
    expect((await sam.patch(`/api/sessions/${mine.id}`, { title: 'x', status: 'cancelled' })).status).toBe(400); // can't change other fields
    const e = (await ada.get(`/api/events/${ev.slug}`)).data.event;
    await ada.patch(`/api/events/${ev.id}`, { ...e, branding: {}, settings: { speakerEdit: false } });
    expect((await sam.patch(`/api/sessions/${mine.id}`, { description: 'Again' })).status).toBe(403);
    const list = (await new Client().get(`/api/people/speakers?eventId=${ev.id}`)).data.speakers;
    expect(list[0]).toMatchObject({ name: 'Sam S.', sessions: [{ title: 'Sam talk' }] });
    expect(list[0].email).toBeUndefined();
  });

  it('photo uploads are verified by content and served through permission checks', async () => {
    const created = await ada.post('/api/people/speakers', { eventId: ev.id, name: 'Pho', email: 'pho@example.com' });
    const sam = new Client();
    await sam.post('/api/auth/activate', { token: created.data.inviteLink.split('/activate/')[1], password: PASSWORD });
    const fake = new FormData(); fake.set('file', new File([new Uint8Array([1, 2, 3, 4])], 'x.png', { type: 'image/png' }));
    expect((await sam.call('PUT', '/api/files/photo/me', undefined, { raw: fake })).status).toBe(400);
    const good = new FormData(); good.set('file', new File([png], 'x.png', { type: 'image/png' }));
    expect((await sam.call('PUT', '/api/files/photo/me', undefined, { raw: good })).status).toBe(201);
    const got = await new Client().get(`/api/files/photo/${created.data.user.id}`); // public speaker in a public event
    expect(got.status).toBe(200);
    const attendee = await signup('Plain');
    const att = new FormData(); att.set('file', new File([png], 'a.png'));
    await attendee.call('PUT', '/api/files/photo/me', undefined, { raw: att });
    expect((await new Client().get(`/api/files/photo/${attendee.user!.id}`)).status).toBe(403);
    expect((await attendee.get(`/api/files/photo/${attendee.user!.id}`)).status).toBe(200);
  });

  it('materials upload is limited to admins and the assigned speaker', async () => {
    const created = await ada.post('/api/people/speakers', { eventId: ev.id, name: 'Mat', email: 'mat@example.com' });
    const sam = new Client();
    await sam.post('/api/auth/activate', { token: created.data.inviteLink.split('/activate/')[1], password: PASSWORD });
    const mine = await makeSession(ada, ev.id, { title: 'Slides', speakerIds: [created.data.user.id], startsAt: '2030-05-01T22:00:00Z', endsAt: '2030-05-01T23:00:00Z' });
    const form = () => { const f = new FormData(); f.set('file', new File(['%PDF-1.4'], 'deck.pdf')); return f; };
    expect((await sam.call('POST', `/api/sessions/${mine.id}/materials`, undefined, { raw: form() })).status).toBe(201);
    expect((await sam.call('POST', `/api/sessions/${sess.id}/materials`, undefined, { raw: form() })).status).toBe(403);
    const bad = new FormData(); bad.set('file', new File(['x'], 'run.exe'));
    expect((await sam.call('POST', `/api/sessions/${mine.id}/materials`, undefined, { raw: bad })).status).toBe(400);
    const dl = await new Client().call('GET', `/api/sessions/${mine.id}/materials/0`);
    expect(dl.status).toBe(200);
    expect(dl.headers.get('content-disposition')).toContain('attachment');
  });
});

describe('CSV import', () => {
  it('validates every row and imports nothing when any row is bad', async () => {
    const csv = 'title,start,end,room,tracks,capacity\nGood,2030-05-01 09:00,2030-05-01 10:00,Hall A,Main,10\nBad date,tomorrow,2030-05-01 10:00,,,\nBad cap,2030-05-01 09:00,2030-05-01 10:00,,,-3\nBackwards,2030-05-01 12:00,2030-05-01 11:00,,,\n';
    const r = await ada.post('/api/sessions/import', { eventId: ev.id, csv });
    expect(r.status).toBe(422);
    expect(r.data.errors.map((e: { row: number }) => e.row)).toEqual([3, 4, 5]);
    expect(await db.select().from(schema.rooms)).toHaveLength(0);
    expect(await db.select().from(schema.sessions)).toHaveLength(1);
  });

  it('creates sessions, rooms, tracks and speakers; interprets times in the event time zone', async () => {
    const csv = 'title,start,end,room,tracks,capacity,requires_registration,pinned,speakers,description\n"Intro, with comma",2030-05-01 09:00,2030-05-01 10:00,Hall A,Main;Beginner,25,yes,,new@example.com,"Line ""quoted"""\n';
    const r = await ada.post('/api/sessions/import', { eventId: ev.id, csv });
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ created: 1 });
    expect(r.data.invites).toHaveLength(1);
    const [s] = (await ada.get(`/api/sessions?eventId=${ev.id}`)).data.sessions.filter((x: { title: string }) => x.title.startsWith('Intro'));
    expect(s.title).toBe('Intro, with comma');
    expect(s.startsAt).toBe('2030-05-01T16:00:00.000Z'); // 09:00 PDT
    expect(s).toMatchObject({ capacity: 25, requiresRegistration: true, status: 'draft', description: 'Line "quoted"' });
    expect(s.tracks.map((t: { name: string }) => t.name).sort()).toEqual(['Beginner', 'Main']);
    expect(s.speakers).toHaveLength(1);
    // bulk capacity update by id, as in Sched's spreadsheet import
    const upd = await ada.post('/api/sessions/import', { eventId: ev.id, csv: `id,capacity,pinned\n${s.id},40,true\n` });
    expect(upd.data).toMatchObject({ created: 0, updated: 1 });
    expect((await ada.get(`/api/sessions/${s.id}`)).data.session).toMatchObject({ capacity: 40, pinned: true });
  });

  it('imports attendees, returning invite links, and skips admins', async () => {
    const csv = 'name,email,ticket_type\nAnn,ann@example.com,VIP\nBob,bob@example.com,\n';
    const dry = await ada.post('/api/people/attendees/import', { eventId: ev.id, csv, dryRun: true });
    expect(dry.data).toMatchObject({ ok: true, dryRun: true, count: 2 });
    const r = await ada.post('/api/people/attendees/import', { eventId: ev.id, csv });
    expect(r.data).toMatchObject({ created: 2, existing: 0 });
    expect(r.data.invites).toHaveLength(2);
    const bad = await ada.post('/api/people/attendees/import', { eventId: ev.id, csv: 'name,email\nX,not-an-email\n' });
    expect(bad.status).toBe(422);
    const adm = await ada.post('/api/people/attendees/import', { eventId: ev.id, csv: 'name,email\nAda,ada@example.com\n' });
    expect(adm.data.skipped).toHaveLength(1);
  });
});

describe('ical, notifications and maintenance', () => {
  it('serves a per-user ICS feed addressed by secret token', async () => {
    const u = await signup('Cal');
    await join(u, ev.slug);
    await u.post(`/api/agenda/${sess.id}`);
    const token = (await u.get('/api/auth/ical-token')).data.icalToken;
    const feed = await new Client().get(`/api/ical/${token}.ics`);
    expect(feed.status).toBe(200);
    expect(feed.headers.get('content-type')).toContain('text/calendar');
    expect(feed.data).toContain('SUMMARY:Opening keynote');
    expect(feed.data).toContain('DTSTART:20300501T170000Z');
    expect((await new Client().get('/api/ical/nope')).status).toBe(404);
    const old = token;
    const rotated = (await u.post('/api/auth/ical-token/rotate')).data.icalToken;
    expect(rotated).not.toBe(old);
    expect((await new Client().get(`/api/ical/${old}`)).status).toBe(404);
  });

  it('announcements reach every member and reminders are sent once', async () => {
    const [a, b] = await Promise.all([signup('N1', 'n1@example.com'), signup('N2', 'n2@example.com')]);
    await join(a, ev.slug); await join(b, ev.slug);
    expect((await ada.post(`/api/comms/events/${ev.id}/announcements`, { title: 'Doors open', body: '8am' })).data.recipients).toBe(2);
    expect((await a.get('/api/comms/notifications')).data.unread).toBe(1);
    await a.post('/api/comms/notifications/read', {});
    expect((await a.get('/api/comms/notifications')).data.unread).toBe(0);

    const soon = new Date(Date.now() + 20 * 60_000);
    const s = await makeSession(ada, ev.id, { title: 'Starting', startsAt: soon.toISOString(), endsAt: new Date(+soon + 3600_000).toISOString() });
    await a.post(`/api/agenda/${s.id}`);
    expect((await runMaintenance()).reminders).toBe(1);
    await runMaintenance();
    const reminders = (await a.get('/api/comms/notifications')).data.notifications.filter((n: { kind: string }) => n.kind === 'reminder');
    expect(reminders).toHaveLength(1);
  });

  it('feedback opens after the session starts, for attendees who joined it', async () => {
    const past = await makeSession(ada, ev.id, { title: 'Past', startsAt: '2020-05-01T10:00:00Z', endsAt: '2020-05-01T11:00:00Z' });
    const u = await signup('Fee');
    await join(u, ev.slug);
    expect((await u.post(`/api/sessions/${past.id}/feedback`, { rating: 5 })).status).toBe(403);
    await u.post(`/api/agenda/${past.id}`);
    expect((await u.post(`/api/sessions/${past.id}/feedback`, { rating: 9 })).status).toBe(400);
    expect((await u.post(`/api/sessions/${past.id}/feedback`, { rating: 4, comment: 'Great' })).status).toBe(200);
    expect((await u.post(`/api/sessions/${past.id}/feedback`, { rating: 5 })).status).toBe(200); // upsert
    expect((await u.post(`/api/sessions/${sess.id}/feedback`, { rating: 5 })).status).toBe(409); // not started
    const summary = (await ada.get(`/api/reports/event/${ev.id}/summary`)).data;
    expect(summary.sessions.find((s: { id: string }) => s.id === past.id)).toMatchObject({ rating: 5, ratings: 1 });
  });
});

describe('event duplication', () => {
  it('copies structure as drafts, shifting dates', async () => {
    await ada.post(`/api/events/${ev.id}/tracks`, { name: 'Main' });
    const r = await ada.post(`/api/events/${ev.id}/duplicate`, { slug: 'summit-2031', name: 'Summit 2031', startDate: '2031-05-01' });
    expect(r.status).toBe(201);
    expect(r.data.event).toMatchObject({ published: false, endDate: '2031-05-02' });
    const copy = await ada.get(`/api/sessions?eventId=${r.data.event.id}`);
    expect(copy.data.sessions[0]).toMatchObject({ title: 'Opening keynote', status: 'draft' });
    expect(copy.data.sessions[0].startsAt.startsWith('2031-05-01')).toBe(true);
  });
});
