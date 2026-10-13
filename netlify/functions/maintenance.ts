import type { Config } from '@netlify/functions';
import { and, eq, gt, lt, or, sql } from 'drizzle-orm';
import { getDb, schema } from '../lib/db';
import { notify } from '../lib/notify';

/**
 * Scheduled every 15 minutes:
 *  - in-app reminders for sessions starting within the next hour (once per user per session)
 *  - purge expired login sessions, used/expired one-time tokens, and old login attempts
 */
export async function runMaintenance(now = new Date()) {
  const db = getDb();
  const horizon = new Date(now.getTime() + 60 * 60_000);
  const upcoming = await db.select({ s: schema.sessions, slug: schema.events.slug }).from(schema.sessions)
    .innerJoin(schema.events, eq(schema.events.id, schema.sessions.eventId))
    .where(and(eq(schema.sessions.status, 'published'), eq(schema.events.published, true), gt(schema.sessions.startsAt, now), lt(schema.sessions.startsAt, horizon)));
  let reminders = 0;
  for (const { s, slug } of upcoming) {
    const [a, rg] = await Promise.all([
      db.select({ u: schema.agendaItems.userId }).from(schema.agendaItems).where(eq(schema.agendaItems.sessionId, s.id)),
      db.select({ u: schema.sessionRegistrations.userId }).from(schema.sessionRegistrations).where(and(eq(schema.sessionRegistrations.sessionId, s.id), eq(schema.sessionRegistrations.status, 'registered'))),
    ]);
    const users = [...new Set([...a, ...rg].map((x) => x.u))];
    const mins = Math.max(1, Math.round((s.startsAt.getTime() - now.getTime()) / 60_000));
    await notify(db, users.map((userId) => ({
      userId, eventId: s.eventId, kind: 'reminder', title: `Starting soon: ${s.title}`, body: `Starts in about ${mins} minutes.`,
      link: `/e/${slug}/session/${s.id}`, dedupeKey: `reminder:${s.id}`,
    })));
    reminders += users.length;
  }
  await db.delete(schema.authSessions).where(lt(schema.authSessions.expiresAt, now));
  await db.delete(schema.oneTimeTokens).where(or(lt(schema.oneTimeTokens.expiresAt, new Date(now.getTime() - 24 * 3600_000)), sql`${schema.oneTimeTokens.usedAt} < ${new Date(now.getTime() - 24 * 3600_000)}`));
  await db.delete(schema.loginAttempts).where(lt(schema.loginAttempts.at, new Date(now.getTime() - 24 * 3600_000)));
  return { sessions: upcoming.length, reminders };
}

export default async () => {
  const result = await runMaintenance();
  console.log('maintenance', result);
};

export const config: Config = { schedule: '*/15 * * * *' };
