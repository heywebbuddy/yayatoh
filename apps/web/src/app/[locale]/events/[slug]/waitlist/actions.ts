'use server';

import { checkoutTarget, publicEventBySlug } from '@yayatoh/events';
import { createCtx, executeCommand, isDomainError } from '@yayatoh/kernel';
import { joinWaitlistCommand, waitlistToken } from '@yayatoh/orders';
import { getLocale } from 'next-intl/server';
import { emailVerifiedHere } from '@/server/guest.ts';
import { type GuestVerifyStep, guestEmailStep } from '@/server/guest-verify.ts';
import { ports } from '@/server/ports.ts';
import { limitAction, retryAfterMinutes } from '@/server/rate-limit.ts';

export interface WaitlistJoinState {
  readonly code: string | null;
  readonly reason?: string;
  readonly field?: string;
  readonly retryMinutes?: number;
  /** The email-code step (M1.5f helper): the person proves the address offers will go to. */
  readonly verify?: GuestVerifyStep;
  /** Done: the place in line and the person's own link. */
  readonly joined?: {
    readonly position: number | null;
    readonly alreadyJoined: boolean;
    readonly href: string;
  };
}

const UUID = /^[0-9a-f-]{36}$/;

/**
 * Join a sold-out pass's waitlist (public). The org and event come from the slug (server-side
 * lookup), never from the form. Rate-limited per device and per address; the address is proved
 * with an emailed code first (a browser that proved it in the last 30 minutes skips the code).
 * The command re-checks that the pass is really sold out.
 */
export async function joinWaitlistAction(
  slug: string,
  _prev: WaitlistJoinState,
  form: FormData,
): Promise<WaitlistJoinState> {
  const locale = await getLocale();
  const email = String(form.get('email') ?? '')
    .trim()
    .slice(0, 254);
  const name = String(form.get('name') ?? '')
    .trim()
    .slice(0, 120);
  const ticketTypeId = String(form.get('pass') ?? '');
  const date = String(form.get('date') ?? '');
  const quantity = Number(form.get('quantity') ?? 1);
  if (!name) return { code: 'validation_failed', field: 'name' };
  if (!email.includes('@')) return { code: 'validation_failed', field: 'email' };
  if (!UUID.test(ticketTypeId)) return { code: 'validation_failed', field: 'pass' };
  const limit = await limitAction('waitlistJoin', { identity: email.toLowerCase(), scope: 'join' });
  if (!limit.allowed) return { code: 'rate_limited', retryMinutes: retryAfterMinutes(limit) };
  const target = await checkoutTarget(slug);
  const event = target ? await publicEventBySlug(slug) : null;
  if (!target || !event) return { code: 'not_found' };
  if (!(await emailVerifiedHere(email, target.orgId))) {
    const step = await guestEmailStep({
      purpose: 'waitlist',
      orgId: target.orgId,
      email,
      locale,
      form,
      params: { eventName: event.name },
    });
    if (step.kind === 'rate_limited') return { code: 'rate_limited', retryMinutes: step.retryMinutes };
    if (step.kind === 'error') return { code: step.code, reason: step.reason, field: 'email' };
    if (step.kind === 'step') return { code: 'verify_email', verify: step.verify };
  }
  try {
    const r = await executeCommand(
      joinWaitlistCommand,
      {
        eventId: target.eventId,
        ticketTypeId,
        ...(UUID.test(date) ? { occurrenceId: date } : {}),
        name,
        email,
        quantity: Number.isInteger(quantity) ? quantity : 1,
        locale,
      },
      createCtx({ orgId: target.orgId, locale }),
      ports,
    );
    return {
      code: null,
      joined: {
        position: r.position,
        alreadyJoined: r.alreadyJoined,
        href: `/waitlist/${waitlistToken(r.entryId)}`,
      },
    };
  } catch (err) {
    if (!isDomainError(err)) throw err;
    return {
      code: err.code,
      reason: String(err.details?.reason ?? ''),
      ...(typeof err.details?.field === 'string' ? { field: err.details.field } : {}),
    };
  }
}
