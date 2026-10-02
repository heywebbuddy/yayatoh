'use server';

import { findRsvpByNameCommand, normalizePin, rsvpLookupTarget } from '@yayatoh/guests';
import { createCtx, executeCommand, isDomainError } from '@yayatoh/kernel';
import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation.ts';
import { getHumanCheck, passedHumanCheck } from '@/server/human-check.ts';
import { ports } from '@/server/ports.ts';
import { limitAction, retryAfterMinutes } from '@/server/rate-limit.ts';

export type LookupError =
  | 'noMatch'
  | 'invalidName'
  | 'invalidPin'
  | 'challengeFailed'
  | 'challengeUnavailable'
  | 'rateLimited'
  | 'closed';

export interface LookupState {
  readonly error?: LookupError;
  /** Past this device's budget: show the human check and ask again. */
  readonly challenge?: boolean;
  readonly retryMinutes?: number;
  /** What the guest typed, so an error or a challenge never clears it (the PIN is not kept). */
  readonly name?: string;
  readonly stamp?: number;
}

/**
 * The paper fallback (M4.1d, P4-2): the exact full name on the invitation plus the party's PIN.
 * The event comes from the printed code (server-side lookup), never from input. Limited per
 * device and per event (M1.14 `rsvpLookup`); past the device budget each try needs the human
 * check. Unknown names, partial names and wrong PINs all get the same `noMatch`.
 */
export async function findRsvpAction(code: string, _prev: LookupState, form: FormData): Promise<LookupState> {
  const stamp = Date.now();
  const name = String(form.get('name') ?? '')
    .trim()
    .slice(0, 170);
  const pin = normalizePin(String(form.get('pin') ?? ''));
  const target = await rsvpLookupTarget(code);
  if (!target) return { name, error: 'closed', stamp };
  if (!name) return { name, error: 'invalidName', stamp };
  if (!pin) return { name, error: 'invalidPin', stamp };
  const limit = await limitAction('rsvpLookup', { identity: code.toUpperCase(), scope: 'rsvp' });
  if (!limit.allowed) {
    const passed = await passedHumanCheck(form);
    if (passed === false) return { name, challenge: true, error: 'challengeFailed', stamp };
    if (passed !== true)
      return getHumanCheck()
        ? { name, challenge: true, stamp }
        : { name, error: 'rateLimited', retryMinutes: retryAfterMinutes(limit), stamp };
  }
  const locale = await getLocale();
  let token: string | null = null;
  try {
    const r = await executeCommand(
      findRsvpByNameCommand,
      { eventId: target.eventId, name, pin },
      createCtx({ orgId: target.orgId, locale }),
      ports,
    );
    token = r.token;
  } catch (err) {
    if (!isDomainError(err)) throw err;
    return { name, error: 'closed', stamp };
  }
  if (!token) return { name, error: 'noMatch', stamp, ...(limit.allowed ? {} : { challenge: true }) };
  return redirect({ href: `/rsvp/${encodeURIComponent(token)}`, locale });
}
