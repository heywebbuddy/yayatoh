/**
 * M5.5c kiosk self-print rules (pure: no database, no Node APIs). An attendee identifies at a
 * kiosk with their ticket's code or an emailed one-time code, checks what their badge will say,
 * and prints it once; anything the kiosk can't settle goes to the desk.
 */

/** An emailed kiosk code lives this long. */
export const KIOSK_CODE_TTL_MS = 10 * 60_000;
/** Wrong tries before a code locks (the fifth locks it, even against the right code). */
export const KIOSK_CODE_ATTEMPTS = 5;
/** After identifying, the kiosk may print for this long (the "print my badge" proof). */
export const KIOSK_PASS_TTL_MS = 5 * 60_000;
/** A kiosk forgets the attendee on screen after this long without a touch. */
export const KIOSK_IDLE_MS = 60_000;
/** The result of a print stays on screen this long, then the kiosk is ready for the next person. */
export const KIOSK_DONE_MS = 10_000;

/**
 * What the kiosk can do for one badge: print it (`ready`), say it was already printed
 * (`printed`: a reprint needs a reason, so the desk does it), or send the attendee to the desk
 * (`desk`: a balance is due, or no template applies).
 */
export type KioskBadgeStatus = 'ready' | 'printed' | 'desk';

export function kioskBadgeStatus(b: {
  readonly prints: number;
  readonly paymentDue: boolean;
  readonly hasTemplate: boolean;
}): KioskBadgeStatus {
  if (b.prints > 0) return 'printed';
  if (b.paymentDue || !b.hasTemplate) return 'desk';
  return 'ready';
}

/** What an emailed code leads to, decided when it is asked for. */
export type KioskEmailOutcome = 'ticket' | 'desk' | 'none';

/**
 * One own ticket at the event → that ticket. Several (the kiosk won't choose between them) or a
 * registration still waiting (an application, an unpaid approval) → the desk. Nothing → no email,
 * but the kiosk answers exactly as if one was sent.
 */
export function kioskEmailOutcome(ownTickets: number, waitingRegistration: boolean): KioskEmailOutcome {
  if (ownTickets === 1) return 'ticket';
  if (ownTickets > 1 || waitingRegistration) return 'desk';
  return 'none';
}

/** A six-digit code from a random integer in [0, 1_000_000). */
export const formatKioskCode = (n: number): string =>
  String(Math.trunc(Math.abs(n)) % 1_000_000).padStart(6, '0');

/** What a typed code looks like (digits only; spaces are ignored). */
export const normalizeKioskCode = (code: string): string => code.replace(/\s+/g, '');
export const isKioskCodeShape = (code: string): boolean => /^\d{6}$/.test(normalizeKioskCode(code));

export type KioskCodeCheck =
  | { readonly status: 'ok' }
  | { readonly status: 'wrong'; readonly attemptsLeft: number }
  | { readonly status: 'locked' | 'expired' };

/** Judge one try against a challenge's state (`matches`: the code's HMAC matched). */
export function judgeKioskCode(
  c: { readonly attempts: number; readonly expiresAt: Date; readonly usedAt: Date | null },
  matches: boolean,
  now: Date,
): KioskCodeCheck {
  if (c.usedAt || c.expiresAt.getTime() <= now.getTime()) return { status: 'expired' };
  if (c.attempts >= KIOSK_CODE_ATTEMPTS) return { status: 'locked' };
  if (matches) return { status: 'ok' };
  const left = KIOSK_CODE_ATTEMPTS - (c.attempts + 1);
  return left > 0 ? { status: 'wrong', attemptsLeft: left } : { status: 'locked' };
}

/** A conservative email shape check (the server decides; the kiosk only stops obvious typos). */
export const isKioskEmail = (email: string): boolean =>
  /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@.]{2,}$/.test(email.trim());
