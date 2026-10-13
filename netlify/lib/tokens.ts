import { and, eq, gt, isNull } from 'drizzle-orm';
import { schema, type DB } from './db';
import { randomToken, sha256 } from './crypto';
import { HttpError } from './http';

export type TokenPurpose = 'activate' | 'reset' | 'invite';
const TTL_MS: Record<TokenPurpose, number> = {
  activate: 7 * 24 * 3600_000,
  invite: 14 * 24 * 3600_000,
  reset: 60 * 60_000, // 60 minutes, per MASTER_PLAN
};

/** Creates a one-time token and returns the raw value. Only the SHA-256 is stored. Older unused tokens for the same purpose are revoked. */
export async function issueToken(db: DB, userId: string, purpose: TokenPurpose) {
  await db.update(schema.oneTimeTokens).set({ usedAt: new Date() })
    .where(and(eq(schema.oneTimeTokens.userId, userId), eq(schema.oneTimeTokens.purpose, purpose), isNull(schema.oneTimeTokens.usedAt)));
  const raw = randomToken(32);
  await db.insert(schema.oneTimeTokens).values({
    userId, purpose, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + TTL_MS[purpose]),
  });
  return raw;
}

export const tokenLink = (req: Request, raw: string) => `${new URL(req.url).origin}/activate/${raw}`;

export async function findToken(db: DB, raw: string) {
  const [row] = await db.select().from(schema.oneTimeTokens)
    .where(and(eq(schema.oneTimeTokens.tokenHash, sha256(raw)), isNull(schema.oneTimeTokens.usedAt), gt(schema.oneTimeTokens.expiresAt, new Date())))
    .limit(1);
  if (!row) throw new HttpError(400, 'This link is invalid or has expired. Ask an admin for a new one.', 'bad_token');
  return row;
}
