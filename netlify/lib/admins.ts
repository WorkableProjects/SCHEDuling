import { and, eq, ne, sql } from 'drizzle-orm';
import { schema, type DB } from './db';
import { conflict, notFound } from './http';

export const MAX_ADMINS = Number(process.env.MAX_ADMINS ?? 2);
type Role = (typeof schema.roleEnum.enumValues)[number];

const ADMIN_LOCK = 7_000_001;

/**
 * The only code path that changes a user's role or disables a user. It runs in a transaction
 * under an advisory lock, so two concurrent requests can't push the admin count past MAX_ADMINS
 * or remove the last admin.
 */
export async function changeUserRole(db: DB, userId: string, role: Role) {
  return db.transaction(async (tx) => {
    const q = tx as unknown as DB;
    await q.execute(sql`select pg_advisory_xact_lock(${ADMIN_LOCK})`);
    const [u] = await q.select().from(schema.users).where(eq(schema.users.id, userId));
    if (!u) throw notFound('User not found');
    if (u.role === role) return u;
    const [{ n } = { n: 0 }] = await q.select({ n: sql<number>`count(*)::int` }).from(schema.users)
      .where(and(eq(schema.users.role, 'admin'), ne(schema.users.status, 'disabled')));
    if (role === 'admin' && n >= MAX_ADMINS) throw conflict(`Only ${MAX_ADMINS} admin accounts are allowed. Demote an admin first.`, { code: 'admin_cap' });
    if (u.role === 'admin' && n <= 1) throw conflict('You cannot remove the last remaining admin.', { code: 'last_admin' });
    const [updated] = await q.update(schema.users).set({ role }).where(eq(schema.users.id, userId)).returning();
    return updated!;
  });
}

export async function setUserStatus(db: DB, userId: string, status: 'active' | 'disabled') {
  return db.transaction(async (tx) => {
    const q = tx as unknown as DB;
    await q.execute(sql`select pg_advisory_xact_lock(${ADMIN_LOCK})`);
    const [u] = await q.select().from(schema.users).where(eq(schema.users.id, userId));
    if (!u) throw notFound('User not found');
    if (status === 'disabled' && u.role === 'admin') {
      const [{ n } = { n: 0 }] = await q.select({ n: sql<number>`count(*)::int` }).from(schema.users)
        .where(and(eq(schema.users.role, 'admin'), ne(schema.users.status, 'disabled')));
      if (n <= 1) throw conflict('You cannot disable the last remaining admin.', { code: 'last_admin' });
    }
    await q.update(schema.users).set({ status }).where(eq(schema.users.id, userId));
    if (status === 'disabled') await q.delete(schema.authSessions).where(eq(schema.authSessions.userId, userId));
  });
}

/** Creates the two initial admins. Returns null if any admin already exists. */
export async function bootstrapAdmins(db: DB, emails: string[]) {
  return db.transaction(async (tx) => {
    const q = tx as unknown as DB;
    await q.execute(sql`select pg_advisory_xact_lock(${ADMIN_LOCK})`);
    const [{ n } = { n: 0 }] = await q.select({ n: sql<number>`count(*)::int` }).from(schema.users).where(eq(schema.users.role, 'admin'));
    if (n > 0) return null;
    const created: { id: string; email: string }[] = [];
    for (const email of emails.slice(0, MAX_ADMINS)) {
      const [existing] = await q.select().from(schema.users).where(sql`lower(${schema.users.email}) = ${email}`);
      if (existing) {
        await q.update(schema.users).set({ role: 'admin', status: 'pending', passwordHash: null }).where(eq(schema.users.id, existing.id));
        created.push({ id: existing.id, email });
      } else {
        const [u] = await q.insert(schema.users).values({ email, name: email.split('@')[0]!, role: 'admin', status: 'pending' }).returning();
        created.push({ id: u!.id, email });
      }
    }
    return created;
  });
}
