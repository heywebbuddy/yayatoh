/**
 * "Are you a person?" challenge port (roadmap §6.1: past a rate limit, public lookups ask for a
 * Turnstile challenge instead of blocking). Cloudflare Turnstile is an owner account; until its
 * keys exist, development, preview and CI use the fake adapter, whose challenge is a checkbox.
 */
export interface HumanCheck {
  readonly provider: 'fake' | 'turnstile';
  /** Public site key for the browser widget (Turnstile); null for the fake adapter. */
  readonly siteKey: string | null;
  /** True when the token proves a solved challenge. Tokens are single use. */
  verify(token: string, remoteIp?: string | null): Promise<boolean>;
}

/** The fake challenge's only valid answer (the dev checkbox posts it). */
export const FAKE_HUMAN_TOKEN = 'fake-human-pass';
/**
 * A token the fake adapter always refuses (M1.2f): tests post it to see the "check failed" path
 * (any other value fails too; this one names the intent).
 */
export const FAKE_HUMAN_FAIL_TOKEN = 'fake-human-fail';

/** Development/test adapter: any request carrying the fake token passes. Never in production. */
export const fakeHumanCheck: HumanCheck = {
  provider: 'fake',
  siteKey: null,
  verify: async (token) => token === FAKE_HUMAN_TOKEN,
};

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Cloudflare Turnstile: server-side verification of the widget's token (siteverify). */
export function turnstileHumanCheck(opts: {
  siteKey: string;
  secretKey: string;
  fetch?: typeof fetch;
}): HumanCheck {
  const doFetch = opts.fetch ?? fetch;
  return {
    provider: 'turnstile',
    siteKey: opts.siteKey,
    async verify(token, remoteIp) {
      if (!token || token.length > 2048) return false;
      const body = new URLSearchParams({ secret: opts.secretKey, response: token });
      if (remoteIp) body.set('remoteip', remoteIp);
      try {
        const res = await doFetch(SITEVERIFY, { method: 'POST', body, signal: AbortSignal.timeout(5_000) });
        if (!res.ok) return false;
        const json = (await res.json()) as { success?: unknown };
        return json.success === true;
      } catch {
        // Unreachable verifier: fail closed (the person can try the challenge again).
        return false;
      }
    },
  };
}
