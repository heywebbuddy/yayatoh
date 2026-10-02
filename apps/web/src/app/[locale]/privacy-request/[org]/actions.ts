'use server';

import { normalizeGuestEmail } from '@yayatoh/orders';
import { DsarEmail } from '@yayatoh/privacy';
import { confirmRequestCode, privacyOrg, type SelfKind, sendRequestCode } from '@/server/privacy-request.ts';

export type SelfRequestState =
  | { readonly step: 'start'; readonly code?: string; readonly retryMinutes?: number }
  | {
      readonly step: 'code';
      readonly email: string;
      readonly kind: SelfKind;
      readonly code?: string;
      readonly attemptsLeft?: number | null;
      readonly resent?: boolean;
    }
  | {
      readonly step: 'done';
      readonly reference: string;
      readonly dueAt: string;
      readonly existing: boolean;
    };

const minutes = (ms: number) => Math.max(1, Math.ceil(ms / 60_000));

/**
 * The person's own request (M6.1c): step 1 sends a code to the address, step 2 checks it and
 * opens the request. Every address gets the same answer at step 1, whether the org holds
 * anything about it or not.
 */
export async function selfRequestAction(
  orgSlug: string,
  prev: SelfRequestState,
  form: FormData,
): Promise<SelfRequestState> {
  const org = await privacyOrg(orgSlug);
  if (!org) return { step: 'start', code: 'not_found' };
  if (prev.step === 'code' && form.get('intent') !== 'resend' && form.get('intent') !== 'restart') {
    const code = String(form.get('verifyCode') ?? '').replace(/\s/g, '');
    if (!/^\d{6}$/.test(code)) return { ...prev, code: 'code_format' };
    const r = await confirmRequestCode(org.orgId, prev.email, code, prev.kind);
    if (r.status !== 'ok' || !('requestId' in r))
      return { ...prev, code: r.status, attemptsLeft: r.attemptsLeft };
    return {
      step: 'done',
      reference: r.requestId.slice(-8).toUpperCase(),
      dueAt: r.dueAt.toISOString(),
      existing: r.existing,
    };
  }
  if (prev.step === 'code' && form.get('intent') === 'restart') return { step: 'start' };
  const email = DsarEmail.safeParse(prev.step === 'code' ? prev.email : form.get('email'));
  if (!email.success) return { step: 'start', code: 'invalid_email' };
  const kindRaw = prev.step === 'code' ? prev.kind : form.get('kind');
  if (kindRaw !== 'access' && kindRaw !== 'erasure') return { step: 'start', code: 'kind_required' };
  const r = await sendRequestCode(org.orgId, normalizeGuestEmail(email.data), kindRaw);
  if (r.status === 'rate_limited')
    return { step: 'start', code: 'rate_limited', retryMinutes: minutes(r.retryAfterMs) };
  return {
    step: 'code',
    email: normalizeGuestEmail(email.data),
    kind: kindRaw,
    resent: prev.step === 'code',
  };
}
