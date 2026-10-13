import { and, eq, gt, sql } from 'drizzle-orm';
import { schema, type DB } from './db';
import { HttpError } from './http';

const WINDOW_MS = 15 * 60_000;
const MAX_FAILS_PER_EMAIL = 5;
const MAX_FAILS_PER_IP = 20;

/** Throws 429 if the email or IP has too many recent failed attempts. */
export async function assertNotLocked(db: DB, ip: string, email: string) {
  const since = new Date(Date.now() - WINDOW_MS);
  const [byEmail] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.loginAttempts)
    .where(and(eq(schema.loginAttempts.email, email), eq(schema.loginAttempts.success, false), gt(schema.loginAttempts.at, since)));
  const [byIp] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.loginAttempts)
    .where(and(eq(schema.loginAttempts.ip, ip), eq(schema.loginAttempts.success, false), gt(schema.loginAttempts.at, since)));
  if ((byEmail?.n ?? 0) >= MAX_FAILS_PER_EMAIL || (byIp?.n ?? 0) >= MAX_FAILS_PER_IP) {
    throw new HttpError(429, 'Too many failed attempts. Try again in 15 minutes.', 'rate_limited');
  }
}

export async function recordAttempt(db: DB, ip: string, email: string, success: boolean) {
  await db.insert(schema.loginAttempts).values({ ip, email, success });
  if (success) {
    // A good login clears that email's failure streak.
    await db.delete(schema.loginAttempts).where(and(eq(schema.loginAttempts.email, email), eq(schema.loginAttempts.success, false)));
  }
}

/** Generic per-IP limiter for public endpoints (signup, setup), counting rows tagged with `bucket`. */
export async function assertBucket(db: DB, ip: string, bucket: string, max: number, windowMs: number) {
  const since = new Date(Date.now() - windowMs);
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.loginAttempts)
    .where(and(eq(schema.loginAttempts.ip, ip), eq(schema.loginAttempts.email, bucket), gt(schema.loginAttempts.at, since)));
  if ((r?.n ?? 0) >= max) throw new HttpError(429, 'Too many requests. Please try again later.', 'rate_limited');
  await db.insert(schema.loginAttempts).values({ ip, email: bucket, success: true });
}
