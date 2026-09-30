/**
 * Central login (M1.2d): the tenant host's sign-in state. "Sign in" on a tenant host sets this
 * cookie (host-only) before sending the person to the app host; the handoff code the app host
 * issues is bound to the same value, so only the browser that asked can redeem it.
 */
export const handoffStateCookie = (https: boolean) => (https ? '__Host-yy.handoff' : 'yy.handoff');

/** Ten minutes to finish signing in on the app host. */
export const HANDOFF_STATE_MAX_AGE_S = 600;

/** 256 random bits, base64url (the same shape as a handoff code). */
export function newHandoffState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The tenant host's path back after signing in (same host only). */
export function tenantNextPath(next: string | null | undefined, fallback: string): string {
  return next?.startsWith('/') && !next.startsWith('//') && !next.includes('\\') ? next : fallback;
}
