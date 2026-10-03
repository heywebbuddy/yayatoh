import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * U10 contact page spam checks (pure, so unit-tested): a signed "form shown at" stamp and a
 * honeypot field. A form sent back faster than a person can type, or with the hidden field
 * filled, is a bot. The stamp is signed so it can't be backdated.
 */
export const MIN_FILL_MS = 2_000;
/** Older forms are refused too (a stale page: reload and send again). */
export const MAX_FILL_MS = 6 * 60 * 60 * 1000;
/** The honeypot's name: a field people never see (bots fill every field). */
export const HONEYPOT_FIELD = 'website';

const sign = (secret: string, payload: string) =>
  createHmac('sha256', secret).update(`contact-form:${payload}`).digest('base64url').slice(0, 32);

/** The stamp the page renders into the form: `{ms}.{orgId}.{signature}`. */
export function formStamp(secret: string, orgId: string, now: number): string {
  return `${now}.${orgId}.${sign(secret, `${now}.${orgId}`)}`;
}

export type StampVerdict = 'ok' | 'invalid' | 'too_fast' | 'expired';

/** Whether a stamp is ours, for this org, and the form took a person's time to fill. */
export function checkStamp(secret: string, orgId: string, stamp: string, now: number): StampVerdict {
  const m = /^(\d{10,16})\.([0-9a-f-]{36})\.([A-Za-z0-9_-]{32})$/.exec(stamp);
  if (!m || m[2] !== orgId) return 'invalid';
  const expected = Buffer.from(sign(secret, `${m[1]}.${m[2]}`));
  const given = Buffer.from(m[3] ?? '');
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return 'invalid';
  const age = now - Number(m[1]);
  if (age < MIN_FILL_MS) return 'too_fast';
  if (age > MAX_FILL_MS) return 'expired';
  return 'ok';
}

/** A filled honeypot (anything but whitespace) means a bot. */
export const honeypotFilled = (value: FormDataEntryValue | null): boolean =>
  typeof value === 'string' && value.trim().length > 0;
