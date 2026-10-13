import type { Config, Context } from '@netlify/functions';
import { and, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { schema, type DB } from '../lib/db';
import { createRouter, type AuthUser } from '../lib/router';
import { badRequest, forbidden, HttpError, json, notFound } from '../lib/http';
import { isAdmin } from '../lib/permissions';
import { MAX_PHOTO_BYTES, newKey, sniffImage, store } from '../lib/files';

const r = createRouter();

async function savePhoto(db: DB, targetId: string, req: Request) {
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) throw badRequest('Attach an image in the "file" field');
  if (file.size > MAX_PHOTO_BYTES) throw new HttpError(413, 'Photos can be up to 2 MB', 'too_large');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffImage(bytes);
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, targetId));
  if (!u) throw notFound('User not found');
  const key = newKey(`photos/${targetId}`);
  await store().set(key, bytes.buffer as ArrayBuffer, { metadata: { type } });
  await db.update(schema.users).set({ photoKey: key }).where(eq(schema.users.id, targetId));
  if (u.photoKey) await store().delete(u.photoKey).catch(() => undefined);
  return json({ ok: true }, { status: 201 });
}

r.put('/api/files/photo/me', 'any', async (c) => savePhoto(c.db, c.user!.id, c.req));
r.put('/api/files/photo/:userId', ['admin'], async (c) => savePhoto(c.db, c.params.userId!, c.req));
r.delete('/api/files/photo/me', 'any', async (c) => {
  if (c.user!.photoKey) await store().delete(c.user!.photoKey).catch(() => undefined);
  await c.db.update(schema.users).set({ photoKey: null }).where(eq(schema.users.id, c.user!.id));
  return json({ ok: true });
});

/** Photos are served through this permission check, never from a public blob URL. */
async function canSeePhoto(db: DB, viewer: AuthUser | null, target: typeof schema.users.$inferSelect) {
  if (viewer && (viewer.id === target.id || isAdmin(viewer))) return true;
  if (target.role === 'speaker') {
    // Speaker profiles are public wherever their event is publicly visible.
    const [pub] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.eventMembers)
      .innerJoin(schema.events, eq(schema.events.id, schema.eventMembers.eventId))
      .where(and(eq(schema.eventMembers.userId, target.id), eq(schema.events.published, true), eq(schema.events.privacy, 'public')));
    if ((pub?.n ?? 0) > 0) return true;
  }
  if (!viewer) return false;
  // Otherwise: viewer and target share an event whose directory is visible.
  const a = alias(schema.eventMembers, 'a');
  const b = alias(schema.eventMembers, 'b');
  const shared = await db.select({ n: sql<number>`1` }).from(a)
    .innerJoin(b, eq(a.eventId, b.eventId)).innerJoin(schema.events, eq(schema.events.id, a.eventId))
    .where(and(eq(a.userId, viewer.id), eq(b.userId, target.id), eq(schema.events.published, true), sql`(${schema.events.settings}->>'directoryVisible')::boolean`)).limit(1);
  return shared.length > 0;
}

r.get('/api/files/photo/:userId', false, async (c) => {
  const [u] = await c.db.select().from(schema.users).where(eq(schema.users.id, c.params.userId!));
  if (!u?.photoKey) throw notFound();
  if (!(await canSeePhoto(c.db, c.user, u))) throw forbidden();
  const got = await store().getWithMetadata(u.photoKey, { type: 'arrayBuffer' });
  if (!got) throw notFound();
  return new Response(got.data, { headers: {
    'content-type': String(got.metadata?.type ?? 'image/jpeg'), 'x-content-type-options': 'nosniff', 'cache-control': 'private, max-age=300',
  } });
});

export default (req: Request, ctx: Context) => r.handler(req, ctx);
export const config: Config = { path: '/api/files/*' };
