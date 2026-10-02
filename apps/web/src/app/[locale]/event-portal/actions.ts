'use server';

import {
  consumePortalLink,
  PORTAL_CODE_TTL_MS,
  PORTAL_LINK_TTL_MS,
  parseLinksText,
  requestPortalChallenge,
  resendPortalInvitations,
  SectionTextError,
  verifyPortalChallenge,
} from '@yayatoh/events';
import { executeCommand } from '@yayatoh/kernel';
import {
  completePortalTaskCommand,
  proposeProfileChangeCommand,
  proposeSessionChangeCommand,
} from '@yayatoh/program';
import { refresh } from 'next/cache';
import { getLocale } from 'next-intl/server';
import type { GuestCodeStatus } from '@/components/guest-code-fields.tsx';
import type { ProgramFormState } from '@/components/program-form.tsx';
import { failure, success, textOrNull } from '@/server/form.ts';
import { browserState, sendGuestEmail } from '@/server/guest.ts';
import {
  pendingPortalChallenge,
  portalLimits,
  portalRequestCtx,
  rememberPortalChallenge,
  requirePortalPrincipal,
  signInPortal,
  signOutPortal,
} from '@/server/portal.ts';
import { ports } from '@/server/ports.ts';
import { requestHost } from '@/server/request-origin.ts';

/**
 * The speaker portal (M5.3a). Sign-in follows the M1.5f guest rules through the invitation: an
 * emailed code and a magic link that only works in this browser. Every other action runs a
 * `portal:speaker` command as the signed-in principal, which re-checks the account and that the
 * session, task or profile is the speaker's own.
 */
const localePrefix = (locale: string) => (locale === 'en' ? '' : `/${locale}`);
const minutes = (ms: number | undefined) => Math.max(1, Math.ceil((ms ?? 60_000) / 60_000));
/** Where to go once signed in or out (the browser loads it itself). */
const portalHref = async (path = '') => `${localePrefix(await getLocale())}/event-portal${path}`;

export type PortalSignInState = {
  readonly step: 'start' | 'code';
  readonly code: string | null;
  readonly status?: GuestCodeStatus;
  readonly attemptsLeft?: number | null;
  readonly resendAt?: number | null;
  readonly retryMinutes?: number;
  readonly done?: string;
};

/** Step 1 (email the code and link) and step 2 (the code signs in) of an invitation's sign-in. */
export async function portalSignInAction(
  inviteToken: string,
  prev: PortalSignInState,
  form: FormData,
): Promise<PortalSignInState> {
  const code = String(form.get('verifyCode') ?? '').replace(/\s/g, '');
  const pending = await pendingPortalChallenge();
  if (prev.step === 'code' && code && form.get('verifyIntent') !== 'resend' && pending) {
    const r = await verifyPortalChallenge({ inviteToken, challengeId: pending, code }, await portalLimits());
    if (r.status === 'ok') {
      await signInPortal(r.orgId, r.accountId);
      return { step: 'code', code: null, done: await portalHref() };
    }
    if (r.status === 'rate_limited')
      return { ...prev, code: 'rate_limited', retryMinutes: minutes(r.retryAfterMs) };
    if (r.status === 'refused') return { step: 'start', code: 'forbidden' };
    return {
      step: 'code',
      code: null,
      status: r.status,
      attemptsLeft: r.status === 'wrong' ? r.attemptsLeft : r.status === 'locked' ? 0 : null,
    };
  }
  const locale = await getLocale();
  const r = await requestPortalChallenge(
    { inviteToken, browserState: (await browserState(true)) as string },
    await portalLimits(),
  );
  if (r.status === 'refused') return { step: 'start', code: 'forbidden' };
  if (r.status === 'rate_limited')
    return { step: prev.step, code: 'rate_limited', retryMinutes: minutes(r.retryAfterMs) };
  if (r.status === 'cooldown')
    return { step: 'code', code: null, status: 'cooldown', resendAt: r.resendAt.getTime() };
  const { origin } = await requestHost();
  await sendGuestEmail({
    kind: 'portal.sign-in',
    to: r.email,
    locale,
    orgId: null,
    params: {
      code: r.code,
      url: `${origin}${localePrefix(locale)}/event-portal/verify/${r.linkToken}`,
      minutes: PORTAL_CODE_TTL_MS / 60_000,
      linkMinutes: PORTAL_LINK_TTL_MS / 60_000,
      eventName: r.eventName,
    },
  });
  await rememberPortalChallenge(r.challengeId);
  return { step: 'code', code: null, status: 'sent', resendAt: r.resendAt.getTime() };
}

export type PortalLinkState = {
  readonly code: string | null;
  readonly done?: string;
  readonly status?: GuestCodeStatus;
  readonly attemptsLeft?: number | null;
  readonly retryMinutes?: number;
};

/** The magic link in the browser that asked for it: spend it and sign in. */
export async function portalOpenLinkAction(token: string, _prev: PortalLinkState): Promise<PortalLinkState> {
  const r = await consumePortalLink({ token, browserState: await browserState(false) });
  if (r.status !== 'ok') return { code: null, status: 'expired' };
  await signInPortal(r.orgId, r.accountId);
  return { code: null, done: await portalHref() };
}

/** The magic link opened in another browser: the code from the same email signs in here. */
export async function portalLinkCodeAction(
  token: string,
  _prev: PortalLinkState,
  form: FormData,
): Promise<PortalLinkState> {
  const r = await consumePortalLink({ token, browserState: null, spend: false });
  if (r.status !== 'other_browser') return { code: null, status: 'expired' };
  const v = await verifyPortalChallenge(
    {
      inviteToken: r.inviteToken,
      challengeId: r.challengeId,
      code: String(form.get('verifyCode') ?? '').replace(/\s/g, ''),
    },
    await portalLimits(),
  );
  if (v.status === 'ok') {
    await signInPortal(v.orgId, v.accountId);
    return { code: null, done: await portalHref() };
  }
  if (v.status === 'rate_limited') return { code: 'rate_limited', retryMinutes: minutes(v.retryAfterMs) };
  if (v.status === 'wrong') return { code: null, status: 'wrong', attemptsLeft: v.attemptsLeft };
  if (v.status === 'locked') return { code: null, status: 'locked', attemptsLeft: 0 };
  return { code: null, status: 'expired' };
}

/**
 * An event's shareable sign-in page (M5.4a, on the one sign-in flow): "email me my invitation
 * again". The answer is the same whether or not the address has access (no enumeration); the
 * invitation it emails then signs in with a code or magic link like any other.
 */
export async function resendInvitationAction(
  site: string,
  _prev: ProgramFormState,
  form: FormData,
): Promise<ProgramFormState> {
  const email = String(form.get('email') ?? '')
    .trim()
    .toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
    return { ok: false, code: 'validation_failed', fields: ['email'] };
  const locale = await getLocale();
  const r = await resendPortalInvitations(
    { siteToken: site, email, appOrigin: (await requestHost()).origin, locale },
    await portalLimits(),
  );
  if (r.status === 'refused') return { ok: false, code: 'invalid_state', reason: 'site_invalid' };
  if (r.status === 'rate_limited') return { ok: false, code: 'rate_limited', reason: 'rate_limited' };
  for (const i of r.invites)
    await sendGuestEmail({
      kind: 'portal.invite',
      to: i.email,
      locale,
      orgId: r.orgId,
      params: { url: i.url, eventName: i.eventName, role: i.role },
    });
  return success();
}

export type PortalSignOutState = { readonly done: string | null };

export async function portalSignOutAction(_prev: PortalSignOutState): Promise<PortalSignOutState> {
  await signOutPortal();
  return { done: await portalHref('?signedOut=1') };
}

/* ---------------------------------------------------------------------- the portal ---- */

async function asSpeaker() {
  const p = await requirePortalPrincipal();
  return portalRequestCtx(p);
}

/** Profile changes go to the organizer for approval (nothing public changes yet). */
export async function proposeProfileAction(
  _prev: ProgramFormState,
  form: FormData,
): Promise<ProgramFormState> {
  try {
    await executeCommand(
      proposeProfileChangeCommand,
      {
        name: String(form.get('name') ?? ''),
        title: textOrNull(form, 'title'),
        company: textOrNull(form, 'company'),
        bio: String(form.get('bio') ?? ''),
        links: parseLinksText(String(form.get('links') ?? '')),
      },
      await asSpeaker(),
      ports,
    );
  } catch (err) {
    if (err instanceof SectionTextError)
      return { ok: false, code: 'validation_failed', fields: ['links'], reason: err.reason, line: err.line };
    return failure(err);
  }
  refresh();
  return success();
}

export async function proposeSessionAction(
  sessionId: string,
  _prev: ProgramFormState,
  form: FormData,
): Promise<ProgramFormState> {
  try {
    await executeCommand(
      proposeSessionChangeCommand,
      {
        sessionId,
        title: String(form.get('title') ?? ''),
        description: String(form.get('description') ?? ''),
      },
      await asSpeaker(),
      ports,
    );
  } catch (err) {
    return failure(err);
  }
  refresh();
  return success();
}

/** Accept an agreement or mark a confirmation task done. */
export async function completeTaskAction(
  assigneeId: string,
  _prev: ProgramFormState,
  form: FormData,
): Promise<ProgramFormState> {
  if (form.get('accept') !== 'yes')
    return { ok: false, code: 'validation_failed', fields: ['accept'], reason: 'accept_required' };
  try {
    await executeCommand(completePortalTaskCommand, { assigneeId, accept: true }, await asSpeaker(), ports);
  } catch (err) {
    return failure(err);
  }
  refresh();
  return success();
}
