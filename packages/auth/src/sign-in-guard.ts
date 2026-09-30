import { createHash } from 'node:crypto';
import { identityDatabase } from '@yayatoh/db/identity';
import { uuidv7 } from '@yayatoh/kernel';
import { and, eq, gt } from 'drizzle-orm';
import { verifications } from './schema.ts';

/**
 * "Are you a person?" after failed sign-ins (M1.2f): after a few wrong passwords for one email
 * within 15 minutes, further password sign-ins for that email need a solved challenge (Turnstile;
 * the fake checkbox in development). Counted per email across devices, so spraying from many
 * devices is challenged too; the rate limiter still caps attempts. A successful sign-in clears it.
 */
export const SIGN_IN_FAILURES_BEFORE_CHECK = 3;
export const SIGN_IN_FAILURE_WINDOW_MS = 15 * 60_000;

const key = (email: string) =>
  `yy-sign-in-failures:${createHash('sha256').update(email.trim().toLowerCase()).digest('hex')}`;

async function current(email: string, now: Date) {
  const [row] = await identityDatabase()
    .select({ id: verifications.id, value: verifications.value })
    .from(verifications)
    .where(and(eq(verifications.identifier, key(email)), gt(verifications.expiresAt, now)));
  return row ?? null;
}

/** Whether the next password sign-in for this email must carry a solved challenge. */
export async function signInNeedsHumanCheck(email: string, now: Date = new Date()): Promise<boolean> {
  const row = await current(email, now);
  return Number(row?.value ?? 0) >= SIGN_IN_FAILURES_BEFORE_CHECK;
}

/** Count a failed password sign-in; returns whether the challenge is now due. */
export async function recordSignInFailure(email: string, now: Date = new Date()): Promise<boolean> {
  const db = identityDatabase();
  const row = await current(email, now);
  const count = Number(row?.value ?? 0) + 1;
  if (row)
    await db
      .update(verifications)
      .set({ value: String(count), updatedAt: now })
      .where(eq(verifications.id, row.id));
  else {
    await db.delete(verifications).where(eq(verifications.identifier, key(email)));
    await db.insert(verifications).values({
      id: uuidv7(),
      identifier: key(email),
      value: String(count),
      expiresAt: new Date(now.getTime() + SIGN_IN_FAILURE_WINDOW_MS),
      createdAt: now,
      updatedAt: now,
    });
  }
  return count >= SIGN_IN_FAILURES_BEFORE_CHECK;
}

/** A successful sign-in: the count starts again. */
export async function clearSignInFailures(email: string): Promise<void> {
  await identityDatabase()
    .delete(verifications)
    .where(eq(verifications.identifier, key(email)));
}
