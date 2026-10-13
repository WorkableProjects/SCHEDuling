import { schema, type DB } from './db';

export type NewNotification = {
  userId: string; eventId?: string | null; kind: string; title: string; body?: string | null; link?: string | null; dedupeKey?: string | null;
};

export async function notify(db: DB, items: NewNotification[]) {
  if (!items.length) return;
  for (let i = 0; i < items.length; i += 500) {
    await db.insert(schema.notifications)
      .values(items.slice(i, i + 500).map((n) => ({
        userId: n.userId, eventId: n.eventId ?? null, kind: n.kind, title: n.title,
        body: n.body ?? null, link: n.link ?? null, dedupeKey: n.dedupeKey ?? null,
      })))
      .onConflictDoNothing();
  }
}
