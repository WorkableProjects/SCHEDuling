import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// @node-rs/argon2 defaults to Argon2id.
export const hashPassword = (pw: string) => hash(pw);

let dummyHash: Promise<string> | undefined;
/** Verifies a password; when there is no hash, burns equal time so unknown users aren't distinguishable. */
export async function verifyPassword(pw: string, stored: string | null | undefined) {
  if (!stored) {
    dummyHash ??= hash('dummy-password-for-timing');
    await verify(await dummyHash, pw).catch(() => false);
    return false;
  }
  try {
    return await verify(stored, pw);
  } catch {
    return false;
  }
}
