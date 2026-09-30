'use server';

import { CONTACT_TOPICS, submitContactRequestCommand } from '@yayatoh/cms';
import { createCtx, executeCommand } from '@yayatoh/kernel';
import { headers } from 'next/headers';
import { getLocale } from 'next-intl/server';
import type { FormState } from '@/lib/form-state.ts';
import { failure, success } from '@/server/form.ts';
import { platformContentOrg } from '@/server/help.ts';
import { ports } from '@/server/ports.ts';
import { clientIp, limitAction, retryAfterMinutes } from '@/server/rate-limit.ts';
import { requestHost } from '@/server/request-origin.ts';
import { getHumanCheck } from '@/server/seat-finder.ts';

/**
 * Contact / sales request (M3.11b). Rate-limited per device, per sender address and per IP;
 * a human check (Turnstile where configured, the fake checkbox in dev and CI) is required when a
 * provider exists. Stored in the platform content org for its team.
 */
export async function contactAction(_prev: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get('email') ?? '')
    .trim()
    .toLowerCase();
  const limit = await limitAction('contactRequest', { identity: email || null });
  if (!limit.allowed) return { ok: false, code: 'rate_limited', reason: String(retryAfterMinutes(limit)) };
  const org = await platformContentOrg(await requestHost());
  if (!org) return { ok: false, code: 'not_found' };
  if (getHumanCheck()) {
    const token = String(form.get('cf-turnstile-response') ?? form.get('human') ?? '');
    const passed = token ? await getHumanCheck()?.verify(token, clientIp(await headers())) : false;
    if (!passed) return { ok: false, code: 'validation_failed', fields: ['human'], reason: 'human' };
  }
  const topic = String(form.get('topic') ?? '');
  try {
    await executeCommand(
      submitContactRequestCommand,
      {
        topic: ((CONTACT_TOPICS as readonly string[]).includes(topic) ? topic : '') as never,
        name: String(form.get('name') ?? ''),
        email,
        company: String(form.get('company') ?? ''),
        message: String(form.get('message') ?? ''),
        locale: (await getLocale()) as never,
      },
      createCtx({ orgId: org.orgId }),
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  return success();
}
