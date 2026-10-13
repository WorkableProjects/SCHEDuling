import type { Config, Context } from '@netlify/functions';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { schema } from '../lib/db';
import { createRouter } from '../lib/router';
import { badRequest, json, notFound, readJson } from '../lib/http';
import { announcementSchema } from '../../shared/schemas';
import { getEventByIdOrSlug, requireViewEvent } from '../lib/permissions';
import { notify } from '../lib/notify';
import { audit } from '../lib/audit';

const r = createRouter();

r.get('/api/comms/announcements', false, async (c) => {
  const eventId = c.url.searchParams.get('eventId');
  if (!eventId) throw badRequest('eventId is required');
  const ev = await getEventByIdOrSlug(c.db, eventId);
  await requireViewEvent(c, ev);
  const rows = await c.db.select().from(schema.announcements).where(eq(schema.announcements.eventId, ev.id)).orderBy(desc(schema.announcements.createdAt)).limit(50);
  return json({ announcements: rows.map(({ createdBy, ...a }) => a) });
});

// Posts an announcement and drops an in-app notification in every member's inbox.
r.post('/api/comms/events/:eventId/announcements', ['admin'], async (c) => {
  const ev = await getEventByIdOrSlug(c.db, c.params.eventId!);
  const b = await readJson(c.req, announcementSchema);
  const [a] = await c.db.insert(schema.announcements).values({ eventId: ev.id, title: b.title, body: b.body, createdBy: c.user!.id }).returning();
  const members = await c.db.select({ u: schema.eventMembers.userId }).from(schema.eventMembers).where(eq(schema.eventMembers.eventId, ev.id));
  await notify(c.db, members.map((m) => ({
    userId: m.u, eventId: ev.id, kind: 'announcement', title: b.title, body: b.body, link: `/e/${ev.slug}`, dedupeKey: `announcement:${a!.id}`,
  })));
  await audit(c.db, c.user!.id, 'announcement.create', 'announcement', a!.id, { recipients: members.length });
  return json({ announcement: a, recipients: members.length }, { status: 201 });
});

r.delete('/api/comms/announcements/:id', ['admin'], async (c) => {
  const res = await c.db.delete(schema.announcements).where(eq(schema.announcements.id, c.params.id!)).returning({ id: schema.announcements.id });
  if (!res.length) throw notFound('Announcement not found');
  return json({ ok: true });
});

r.get('/api/comms/notifications', 'any', async (c) => {
  const eventId = c.url.searchParams.get('eventId');
  const where = eventId
    ? and(eq(schema.notifications.userId, c.user!.id), eq(schema.notifications.eventId, eventId))
    : eq(schema.notifications.userId, c.user!.id);
  const rows = await c.db.select().from(schema.notifications).where(where).orderBy(desc(schema.notifications.createdAt)).limit(50);
  const [u] = await c.db.select({ n: sql<number>`count(*)::int` }).from(schema.notifications)
    .where(and(eq(schema.notifications.userId, c.user!.id), isNull(schema.notifications.readAt)));
  return json({ notifications: rows.map((n) => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, link: n.link, read: !!n.readAt, createdAt: n.createdAt })), unread: u?.n ?? 0 });
});

r.post('/api/comms/notifications/read', 'any', async (c) => {
  const b = await readJson(c.req, z.object({ ids: z.array(z.string().uuid()).max(200).optional() }));
  await c.db.update(schema.notifications).set({ readAt: new Date() })
    .where(and(eq(schema.notifications.userId, c.user!.id), isNull(schema.notifications.readAt), b.ids ? inArray(schema.notifications.id, b.ids) : undefined));
  return json({ ok: true });
});

export default (req: Request, ctx: Context) => r.handler(req, ctx);
export const config: Config = { path: '/api/comms/*' };
