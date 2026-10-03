'use server';

import { OrgContactInput, submitOrgContactCommand } from '@yayatoh/cms';
import { createCtx, executeCommand } from '@yayatoh/kernel';
import { publicOrganizer, publicOrganizerById } from '@yayatoh/marketplace';
import { resolveHost } from '@yayatoh/tenancy';
import { headers } from 'next/headers';
import { getLocale } from 'next-intl/server';
import { checkStamp, HONEYPOT_FIELD, honeypotFilled } from '@/lib/contact-spam.ts';
import type { FormState } from '@/lib/form-state.ts';
import { failure, success } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';
import { clientIp, limitAction, retryAfterMinutes } from '@/server/rate-limit.ts';
import { requestHost } from '@/server/request-origin.ts';
import { getHumanCheck } from '@/server/seat-finder.ts';

/**
 * U10: a visitor's message through an org's contact page. The org is the page's: on a tenant host
 * the host's org (never a form field), on the marketplace the organizer page's slug. Checks, in
 * order: rate limits (device, IP, the sender's address at this org), the honeypot and the signed
 * fill-time stamp (bots get the same "sent" answer and nothing is stored), the human check where
 * a provider is configured, then the command (validation, page on, once per form key).
 */
export async function orgContactAction(
  slug: string | null,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const req = await requestHost();
  const site = req.kind === 'tenant' ? await resolveHost(req.host) : null;
  const org = site ? await publicOrganizerById(site.orgId) : slug ? await publicOrganizer(slug) : null;
  if (!org) return { ok: false, code: 'not_found' };
  const email = String(form.get('email') ?? '')
    .trim()
    .toLowerCase();
  const limit = await limitAction('orgContact', { identity: email ? `${org.orgId}:${email}` : null });
  if (!limit.allowed) return { ok: false, code: 'rate_limited', reason: String(retryAfterMinutes(limit)) };
  if (honeypotFilled(form.get(HONEYPOT_FIELD))) return success();
  const stamp = checkStamp(
    process.env.APP_TOKEN_SECRET ?? '',
    org.orgId,
    String(form.get('stamp') ?? ''),
    Date.now(),
  );
  if (stamp === 'invalid') return success();
  if (stamp !== 'ok') return { ok: false, code: 'validation_failed', fields: [], reason: stamp };
  const input = {
    submissionKey: String(form.get('submissionKey') ?? ''),
    name: String(form.get('name') ?? ''),
    email,
    message: String(form.get('message') ?? ''),
    consent: form.get('consent') === 'yes',
    locale: await getLocale(),
  };
  // Every field's problem at once, and the human check's, before anything is stored.
  const parsed = OrgContactInput.safeParse(input);
  const fields = new Set(parsed.success ? [] : parsed.error.issues.map((i) => String(i.path[0] ?? '')));
  if (getHumanCheck()) {
    const token = String(form.get('cf-turnstile-response') ?? form.get('human') ?? '');
    const passed = token ? await getHumanCheck()?.verify(token, clientIp(await headers())) : false;
    if (!passed) fields.add('human');
  }
  if (fields.size > 0) return { ok: false, code: 'validation_failed', fields: [...fields].filter(Boolean) };
  try {
    await executeCommand(
      submitOrgContactCommand,
      input as OrgContactInput,
      createCtx({ orgId: org.orgId }),
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  return success();
}
