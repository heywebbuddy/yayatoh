'use server';

import { checkoutTarget } from '@yayatoh/events';
import { createCtx, executeCommand, isDomainError } from '@yayatoh/kernel';
import {
  findSeatByNameCommand,
  requestFinderCodeCommand,
  type SeatFinderResultDto,
  verifyFinderCodeCommand,
} from '@yayatoh/seating';
import { refresh } from 'next/cache';
import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation.ts';
import { ports } from '@/server/ports.ts';
import { limitAction, retryAfterMinutes } from '@/server/rate-limit.ts';
import {
  deviceKey,
  forgetFinder,
  getHumanCheck,
  passedHumanCheck,
  pendingCode,
  rememberPendingCode,
  rememberVerifiedCode,
} from '@/server/seat-finder.ts';

export type FinderError =
  | 'wrong'
  | 'locked'
  | 'expired'
  | 'used'
  | 'invalidCode'
  | 'invalidEmail'
  | 'invalidName'
  | 'challengeFailed'
  | 'challengeUnavailable'
  | 'rateLimited'
  | 'closed'
  | 'internal';

export interface FinderState {
  readonly step: 'email' | 'code';
  /** The neutral "if you're on the list" answer after asking for a code. */
  readonly sent?: boolean;
  readonly error?: FinderError;
  readonly attemptsLeft?: number;
  /** `rateLimited` (M1.5f): minutes until this device or address may ask for another code. */
  readonly retryMinutes?: number;
  /** Past the device's lookup budget: show the challenge and ask again. */
  readonly challenge?: boolean;
  /** What the guest typed, so a challenge or an error never clears it. */
  readonly email?: string;
  readonly name?: string;
  /** Instant name lookup's answer. */
  readonly result?: SeatFinderResultDto | null;
}

/** The org and event come from the slug (server-side lookup), never from the request. */
async function context(slug: string) {
  const target = await checkoutTarget(slug);
  if (!target) return null;
  return { target, ctx: createCtx({ orgId: target.orgId, locale: await getLocale() }) };
}

const failure = (err: unknown): FinderError => {
  if (!isDomainError(err)) throw err;
  if (err.code === 'not_found' || err.code === 'invalid_state' || err.code === 'module_not_enabled')
    return 'closed';
  return 'internal';
};

/**
 * Whether this submission may go past the lookup budget: null = it carried no challenge answer,
 * true = solved, false = the answer failed (or there is no challenge in this deployment).
 */
async function challengeAnswer(form: FormData): Promise<{ human: boolean; failed: boolean }> {
  const passed = await passedHumanCheck(form);
  return { human: passed === true, failed: passed === false };
}

const challenged = (): Pick<FinderState, 'challenge' | 'error'> =>
  getHumanCheck() ? { challenge: true } : { error: 'challengeUnavailable' };

/** Code mode, step 1: email me a code. Same answer whether or not the address is on the list. */
async function requestCodeAction(slug: string, _prev: FinderState, form: FormData): Promise<FinderState> {
  const email = String(form.get('email') ?? '').trim();
  const c = await context(slug);
  if (!c) return { step: 'email', email, error: 'closed' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
    return { step: 'email', email, error: 'invalidEmail' };
  const { human, failed } = await challengeAnswer(form);
  if (failed) return { step: 'email', email, challenge: true, error: 'challengeFailed' };
  // M1.5f: every code is an email, so codes are also limited per device and per address (the M1.14
  // limiter; the same for listed and unlisted addresses, so it reveals nothing).
  const limit = await limitAction('guestCode', { identity: email.toLowerCase(), scope: 'seat-finder' });
  if (!limit.allowed)
    return { step: 'email', email, error: 'rateLimited', retryMinutes: retryAfterMinutes(limit) };
  try {
    const r = await executeCommand(
      requestFinderCodeCommand,
      { eventId: c.target.eventId, email, device: await deviceKey(), human },
      c.ctx,
      ports,
    );
    if (r.status === 'challenge' || !r.codeId) return { step: 'email', email, ...challenged() };
    await rememberPendingCode(c.target.eventId, r.codeId);
    return { step: 'code', sent: true, email };
  } catch (err) {
    if (isDomainError(err) && err.code === 'validation_failed')
      return { step: 'email', email, error: 'invalidEmail' };
    return { step: 'email', email, error: failure(err) };
  }
}

/** Code mode, step 2: check the code; a right one shows the seats (the page reads the cookie). */
async function verifyCodeAction(slug: string, prev: FinderState, form: FormData): Promise<FinderState> {
  const code = String(form.get('code') ?? '').replace(/\s+/g, '');
  const c = await context(slug);
  if (!c) return { step: 'email', error: 'closed' };
  const codeId = await pendingCode(c.target.eventId);
  if (!codeId) return { step: 'email', email: prev.email, error: 'expired' };
  if (!/^\d{6}$/.test(code)) return { step: 'code', email: prev.email, error: 'invalidCode' };
  const { human, failed } = await challengeAnswer(form);
  if (failed) return { step: 'code', challenge: true, error: 'challengeFailed' };
  let status: string;
  let attemptsLeft: number | null = null;
  try {
    ({ status, attemptsLeft } = await executeCommand(
      verifyFinderCodeCommand,
      { eventId: c.target.eventId, codeId, code, device: await deviceKey(), human },
      c.ctx,
      ports,
    ));
  } catch (err) {
    return { step: 'code', error: failure(err) };
  }
  if (status === 'challenge') return { step: 'code', ...challenged() };
  if (status === 'wrong') return { step: 'code', error: 'wrong', attemptsLeft: attemptsLeft ?? 0 };
  if (status !== 'ok') return { step: 'code', error: status as FinderError };
  await rememberVerifiedCode(c.target.eventId, codeId);
  return redirect({ href: `/events/${slug}/seat-finder`, locale: c.ctx.locale });
}

/** Name mode (organizer opt-in): the seats of an exact full name, straight away. */
export async function findByNameAction(
  slug: string,
  /** The date chosen on the page (M1.7g): seats on the chart that date uses. */
  date: string | null,
  _prev: FinderState,
  form: FormData,
): Promise<FinderState> {
  const name = String(form.get('name') ?? '').trim();
  const c = await context(slug);
  if (!c) return { step: 'email', name, error: 'closed' };
  if (!name || name.length > 120) return { step: 'email', name, error: 'invalidName' };
  const { human, failed } = await challengeAnswer(form);
  if (failed) return { step: 'email', name, challenge: true, error: 'challengeFailed' };
  try {
    const r = await executeCommand(
      findSeatByNameCommand,
      {
        eventId: c.target.eventId,
        name,
        occurrenceId: date && /^[0-9a-f-]{36}$/.test(date) ? date : null,
        device: await deviceKey(),
        human,
      },
      c.ctx,
      ports,
    );
    if (r.status === 'challenge') return { step: 'email', name, ...challenged() };
    return { step: 'email', name, result: r.result };
  } catch (err) {
    return { step: 'email', name, error: failure(err) };
  }
}

/** Code mode's one form state: ask for a code, then check it (`intent` says which). */
export async function codeFlowAction(slug: string, prev: FinderState, form: FormData): Promise<FinderState> {
  return form.get('intent') === 'verify'
    ? verifyCodeAction(slug, prev, form)
    : requestCodeAction(slug, prev, form);
}

/** Start again: forget the pending code and the seats shown (the page re-renders without them). */
export async function resetFinderAction(slug: string): Promise<void> {
  const c = await context(slug);
  if (c) await forgetFinder(c.target.eventId);
  refresh();
}
