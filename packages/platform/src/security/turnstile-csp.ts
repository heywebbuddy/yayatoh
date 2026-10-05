/**
 * CSP origins Cloudflare Turnstile needs (roadmap §10): its loader script and the challenge iframe,
 * both on `challenges.cloudflare.com`. Only when the real challenge is on: the same rule as the
 * web app's `getHumanCheck()` (`HUMAN_CHECK_PROVIDER=turnstile`, or unset in production, with both
 * keys). The fake checkbox in dev, preview and CI is same-origin, so their headers are unchanged.
 * Pure, for proxy.ts.
 */
export const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com';

export function turnstileCspSources(
  env: Record<string, string | undefined>,
  production: boolean,
): { script: string[]; frame: string[] } {
  const provider = env.HUMAN_CHECK_PROVIDER || (production ? 'turnstile' : 'fake');
  const on = provider === 'turnstile' && Boolean(env.TURNSTILE_SITE_KEY) && Boolean(env.TURNSTILE_SECRET_KEY);
  return on ? { script: [TURNSTILE_ORIGIN], frame: [TURNSTILE_ORIGIN] } : { script: [], frame: [] };
}
