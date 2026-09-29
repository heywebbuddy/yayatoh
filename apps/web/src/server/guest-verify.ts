import 'server-only';
import { isDomainError } from '@yayatoh/kernel';
import { GUEST_CODE_TTL_MS, requestGuestChallenge, verifyGuestChallenge } from '@yayatoh/orders';
import { signLinkToken, verifyLinkToken } from '@yayatoh/platform';
import { guestLimits, rememberVerifiedEmail, sendGuestEmail } from '@/server/guest.ts';

/** The email-code step's state, as the form shows it (M1.5f; shared by the waitlist, M3.10a). */
export interface GuestVerifyStep {
  readonly email: string;
  readonly status: 'sent' | 'cooldown' | 'wrong' | 'locked' | 'expired' | 'used';
  readonly attemptsLeft?: number | null;
  readonly resendAt?: number | null;
  /** The pending code's challenge id, signed; posted back with the code. */
  readonly token?: string;
}

export type GuestVerifyOutcome =
  | { readonly kind: 'verified' }
  | { readonly kind: 'step'; readonly verify: GuestVerifyStep }
  | { readonly kind: 'rate_limited'; readonly retryMinutes: number }
  | { readonly kind: 'error'; readonly code: string; readonly reason: string };

/**
 * One round of "prove this address with the code we email" for a guest flow: with a code posted
 * back (and its signed challenge), check it; otherwise send one (or point at the live one within
 * the cooldown). Once verified the browser is remembered for 30 minutes (`yy_gv`), like checkout.
 */
export async function guestEmailStep(input: {
  readonly purpose: 'waitlist';
  readonly orgId: string;
  readonly email: string;
  readonly locale: string;
  readonly form: FormData;
  readonly params: Readonly<Record<string, string | number>>;
}): Promise<GuestVerifyOutcome> {
  const pendingPurpose = `guest-${input.purpose}`;
  const limits = await guestLimits();
  const code = String(input.form.get('verifyCode') ?? '').replace(/\s/g, '');
  const pending = verifyLinkToken(pendingPurpose, String(input.form.get('verifyToken') ?? ''));
  const sign = (id: string) => signLinkToken(pendingPurpose, id);
  if (code && input.form.get('verifyIntent') !== 'resend' && pending) {
    const r = await verifyGuestChallenge(
      { challengeId: pending, code, purpose: input.purpose, scopeOrgId: input.orgId, email: input.email },
      limits,
    );
    if (r.status === 'ok') {
      await rememberVerifiedEmail(input.email);
      return { kind: 'verified' };
    }
    if (r.status === 'rate_limited')
      return {
        kind: 'rate_limited',
        retryMinutes: Math.max(1, Math.ceil((r.retryAfterMs ?? 60_000) / 60_000)),
      };
    return {
      kind: 'step',
      verify: { email: input.email, status: r.status, attemptsLeft: r.attemptsLeft, token: sign(pending) },
    };
  }
  let sent: Awaited<ReturnType<typeof requestGuestChallenge>>;
  try {
    sent = await requestGuestChallenge(
      { purpose: input.purpose, scopeOrgId: input.orgId, email: input.email },
      limits,
    );
  } catch (err) {
    if (isDomainError(err))
      return { kind: 'error', code: err.code, reason: String(err.details?.reason ?? '') };
    throw err;
  }
  if (sent.status === 'rate_limited')
    return { kind: 'rate_limited', retryMinutes: Math.max(1, Math.ceil(sent.retryAfterMs / 60_000)) };
  if (sent.status === 'cooldown')
    return {
      kind: 'step',
      verify: {
        email: input.email,
        status: 'cooldown',
        resendAt: sent.resendAt.getTime(),
        token: sign(sent.challengeId),
      },
    };
  await sendGuestEmail({
    kind: 'guest.waitlist-code',
    to: input.email,
    locale: input.locale,
    orgId: input.orgId,
    params: { ...input.params, code: sent.code, minutes: GUEST_CODE_TTL_MS / 60_000 },
  });
  return {
    kind: 'step',
    verify: {
      email: input.email,
      status: 'sent',
      resendAt: sent.resendAt.getTime(),
      token: sign(sent.challengeId),
    },
  };
}
