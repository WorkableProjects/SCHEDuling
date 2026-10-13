import { schema, type DB } from './db';

export async function audit(db: DB, actorId: string | null, action: string, entity: string, entityId?: string | null, diff?: unknown) {
  await db.insert(schema.auditLog).values({ actorId, action, entity, entityId: entityId ?? null, diff: (diff ?? null) as never });
}
