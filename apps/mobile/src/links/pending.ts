/**
 * A link or push that needs sign-in, kept until the person has signed in (M7.3d): "Links that need
 * sign-in resume after it". The href is an app route, never a token or a code; it is held in memory
 * only, so a killed app starts at the welcome screen as usual.
 */
let pending: { readonly href: string; readonly at: number } | null = null;

/** A link older than this is not resumed: the person has long since moved on. */
export const PENDING_LINK_TTL_MS = 30 * 60 * 1000;

export function rememberPendingHref(href: string, now: number = Date.now()): void {
  pending = { href, at: now };
}

/** The remembered href once, if it is still fresh. */
export function takePendingHref(now: number = Date.now()): string | null {
  const p = pending;
  pending = null;
  return p && now - p.at <= PENDING_LINK_TTL_MS ? p.href : null;
}

export function hasPendingHref(): boolean {
  return pending !== null;
}
