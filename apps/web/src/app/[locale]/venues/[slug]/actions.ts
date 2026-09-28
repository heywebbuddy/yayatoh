'use server';

import { createCtx, executeCommand, isDomainError } from '@yayatoh/kernel';
import { quoteTarget, submitQuoteRequestCommand } from '@yayatoh/venues';
import type { FormState } from '@/lib/form-state.ts';
import { failure, numberOrNull, success, textOrNull } from '@/server/form.ts';
import { humanToken, requireHumanCheck } from '@/server/human-check.ts';
import { ports } from '@/server/ports.ts';
import { clientKey } from '@/server/visitor.ts';

/**
 * Public "request a quote". The org and venue come from the slug (server-side), never the form.
 * Spam: a hidden honeypot field (bots fill it; they get a fake success and nothing is stored), plus
 * per-device and per-email hourly limits in the command, and (M1.2f) the human check: Turnstile
 * with the owner's keys, the fake checkbox in development.
 */
export async function requestQuoteAction(slug: string, _prev: FormState, form: FormData): Promise<FormState> {
  if (String(form.get('website') ?? '') !== '') return success();
  const check = await requireHumanCheck(humanToken(form));
  if (check !== 'ok') return { ok: false, code: check === 'missing' ? 'human_required' : 'human_failed' };
  const target = await quoteTarget(slug);
  if (!target) return { ok: false, code: 'not_found' };
  try {
    await executeCommand(
      submitQuoteRequestCommand,
      {
        venueId: target.venueId,
        name: String(form.get('name') ?? '').trim(),
        email: String(form.get('email') ?? '').trim(),
        phone: textOrNull(form, 'phone'),
        eventDate: textOrNull(form, 'eventDate'),
        guests: numberOrNull(form, 'guests'),
        message: String(form.get('message') ?? '').trim(),
        clientKey: await clientKey('venue-quote'),
      },
      createCtx({ orgId: target.orgId }),
      ports,
    );
  } catch (err) {
    if (isDomainError(err)) return failure(err);
    throw err;
  }
  return success();
}
