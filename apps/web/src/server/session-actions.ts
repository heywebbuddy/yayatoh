'use server';

import { endImpersonation, issueHandoff } from '@yayatoh/auth';
import { createCtx, executeCommand } from '@yayatoh/kernel';
import { endImpersonationCommand } from '@yayatoh/tenancy';
import { redirect as nextRedirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation.ts';
import { getTwoFactor } from './auth.ts';
import { ports } from './ports.ts';
import { requestHost } from './request-origin.ts';
import { endThisHostSession, getSession, ownSession } from './session.ts';
import { verifiedTenantReturn } from './tenant-return.ts';

export interface ContinueState {
  readonly url: string | null;
  readonly code: 'unauthenticated' | 'invalid_return' | null;
}

/**
 * Signed in on the app host: issue a 60-second, single-use code bound to the tenant host, this
 * person and the tenant's sign-in state, and return where to send the browser.
 */
export async function continueToSiteAction(returnUrl: string, state: string): Promise<ContinueState> {
  // Only the app host hands sessions out; a tenant host's own session never does.
  if ((await requestHost()).kind === 'tenant') return { url: null, code: 'unauthenticated' };
  const session = await ownSession();
  if (!session) return { url: null, code: 'unauthenticated' };
  const ret = await verifiedTenantReturn(returnUrl);
  if (!ret || !/^[A-Za-z0-9_-]{43}$/.test(state)) return { url: null, code: 'invalid_return' };
  const { code } = await issueHandoff({
    userId: session.userId,
    host: ret.host,
    returnPath: ret.path,
    state,
  });
  return { url: `${ret.origin}/auth/handoff?code=${encodeURIComponent(code)}`, code: null };
}

/** "Use a different account" on the app host's sign-in: end this host's session only. */
export async function signOutHereAction(): Promise<void> {
  await endThisHostSession();
}

/** Account security: end every session of this person, on every host and device (audited). */
export async function signOutEverywhereAction(): Promise<void> {
  const locale = await getLocale();
  const session = await ownSession();
  if (!session) return redirect({ href: '/sign-in', locale });
  await getTwoFactor().signOutEverywhere(session.userId);
  await signOutHereAction();
  return redirect({ href: '/sign-in?signedOut=everywhere', locale });
}

/**
 * Staff end an impersonation from its banner (M1.2e): the session ends, the org's audit log
 * records it (the staff member as the actor), and the browser goes back to the staff console.
 */
export async function endImpersonationAction(): Promise<void> {
  const locale = await getLocale();
  const session = await getSession();
  const imp = session?.impersonation;
  if (!session || !imp) return redirect({ href: '/sign-in', locale });
  await signOutHereAction();
  const ended = await endImpersonation(imp.id, 'ended');
  if (ended) {
    const ctx = createCtx({
      orgId: ended.orgId,
      actor: { type: 'system', name: `staff:${ended.staffUserId}` },
    });
    await executeCommand(
      endImpersonationCommand,
      { impersonationId: ended.id, userId: ended.userId, how: 'ended' },
      ctx,
      ports,
    );
  }
  const back = ended?.returnUrl;
  nextRedirect(back && /^https?:\/\//.test(back) ? back : '/sign-in');
}
