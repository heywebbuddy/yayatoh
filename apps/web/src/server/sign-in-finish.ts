import 'server-only';
import { issueHandoff } from '@yayatoh/auth';
import { localizedPath } from '@/lib/seo/urls.ts';
import { verifiedTenantReturn } from './tenant-return.ts';

export interface SignInTarget {
  readonly locale: string;
  /** Where to go on the app host (a same-site path). */
  readonly next: string;
  /** Signing in for a tenant site (M1.2d). */
  readonly handoff: { readonly returnUrl: string; readonly state: string } | null;
}

/** A same-site path only (no open redirect); the console otherwise. */
export const safeNext = (next: string | null | undefined) =>
  next?.startsWith('/') && !next.startsWith('//') && !next.includes('\\') ? next : '/o';

/** The sign-in page with the second step open, keeping where to go afterwards. */
export function challengeUrl(t: SignInTarget): string {
  const q = new URLSearchParams({ challenge: '1' });
  if (t.handoff) {
    q.set('return', t.handoff.returnUrl);
    q.set('state', t.handoff.state);
  } else q.set('next', t.next);
  return `${localizedPath(t.locale, '/sign-in')}?${q}`;
}

/** The sign-in page with a message (a refused or cancelled provider sign-in), keeping the target. */
export function signInUrl(t: SignInTarget, extra: Record<string, string>): string {
  const q = new URLSearchParams(extra);
  if (t.handoff) {
    q.set('return', t.handoff.returnUrl);
    q.set('state', t.handoff.state);
  } else if (t.next !== '/o') q.set('next', t.next);
  return `${localizedPath(t.locale, '/sign-in')}?${q}`;
}

/**
 * Signed in on the app host: back to the tenant site with a one-time code when signing in for one
 * (M1.2d), else to `next` here. A tenant return that is no longer valid opens the console.
 */
export async function afterSignIn(userId: string, t: SignInTarget): Promise<string> {
  if (t.handoff && /^[A-Za-z0-9_-]{43}$/.test(t.handoff.state)) {
    const ret = await verifiedTenantReturn(t.handoff.returnUrl);
    if (ret) {
      const { code } = await issueHandoff({
        userId,
        host: ret.host,
        returnPath: ret.path,
        state: t.handoff.state,
      });
      return `${ret.origin}/auth/handoff?code=${encodeURIComponent(code)}`;
    }
  }
  return localizedPath(t.locale, safeNext(t.next));
}
