'use server';

import { RESPONSE_STATUSES, rsvpLinkRef, submitRsvpCommand } from '@yayatoh/guests';
import { createCtx, executeCommand, isDomainError } from '@yayatoh/kernel';
import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation.ts';
import { ports } from '@/server/ports.ts';

export interface RsvpFormState {
  /** A DomainError reason (`missing_answer`, `plus_one_name_required`, `deadline_passed`…) or code. */
  readonly code: string | null;
  /** The guest a refusal is about (its answers or its name get the message and the focus). */
  readonly guestId?: string;
  readonly stamp?: number;
}

const UUID = /^[0-9a-f-]{36}$/;
const STATUSES = new Set<string>(RESPONSE_STATUSES);

/**
 * The household's answer (M4.1d). The link is the only credential: its org comes from the signed
 * link id, never from input. The form names radios `a:{subEventId}:{guestId}` and plus-one names
 * `p:{guestId}:first|last`; the command checks everything again (party, invitations, deadline).
 */
export async function submitRsvpAction(
  token: string,
  _prev: RsvpFormState,
  form: FormData,
): Promise<RsvpFormState> {
  const locale = await getLocale();
  const ref = await rsvpLinkRef(token);
  if (!ref) return { code: 'unknown_link', stamp: Date.now() };
  const answers: { guestId: string; subEventId: string; status: 'attending' | 'declined' }[] = [];
  const names = new Map<string, { firstName: string; lastName: string | null }>();
  for (const [key, raw] of form.entries()) {
    const value = String(raw);
    const [kind, a, b] = key.split(':');
    if (kind === 'a' && a && b && UUID.test(a) && UUID.test(b) && STATUSES.has(value))
      answers.push({ subEventId: a, guestId: b, status: value as 'attending' | 'declined' });
    if (kind === 'p' && a && UUID.test(a) && (b === 'first' || b === 'last')) {
      const n = names.get(a) ?? { firstName: '', lastName: null };
      if (b === 'first') n.firstName = value.trim().slice(0, 80);
      else n.lastName = value.trim().slice(0, 80) || null;
      names.set(a, n);
    }
  }
  const expected = form.getAll('expect').map(String);
  const missing = expected.find((k) => !answers.some((x) => `${x.subEventId}:${x.guestId}` === k));
  if (missing) return { code: 'missing_answer', guestId: missing.split(':')[1], stamp: Date.now() };
  try {
    await executeCommand(
      submitRsvpCommand,
      { token, answers, plusOnes: [...names].map(([guestId, n]) => ({ guestId, ...n })) },
      createCtx({ orgId: ref.orgId, locale }),
      ports,
    );
  } catch (err) {
    if (!isDomainError(err)) throw err;
    const d = (err.details ?? {}) as { reason?: unknown; guestId?: unknown };
    return {
      code: typeof d.reason === 'string' ? d.reason : err.code,
      ...(typeof d.guestId === 'string' ? { guestId: d.guestId } : {}),
      stamp: Date.now(),
    };
  }
  return redirect({ href: `/rsvp/${encodeURIComponent(token)}?thanks=1`, locale });
}
