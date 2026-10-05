import { describe, expect, it } from 'vitest';
import { generateNonce, parseCsp } from '../src/security/csp.ts';
import { securityHeaders } from '../src/security/headers.ts';
import { TURNSTILE_ORIGIN, turnstileCspSources } from '../src/security/turnstile-csp.ts';

const keys = { TURNSTILE_SITE_KEY: 'site', TURNSTILE_SECRET_KEY: 'secret' };
const none = { script: [], frame: [] };

describe('Turnstile CSP sources', () => {
  it('allows the loader and the challenge iframe once the real challenge is on', () => {
    const on = { script: [TURNSTILE_ORIGIN], frame: [TURNSTILE_ORIGIN] };
    expect(turnstileCspSources({ HUMAN_CHECK_PROVIDER: 'turnstile', ...keys }, false)).toEqual(on);
    // Production defaults to Turnstile when the provider is unset.
    expect(turnstileCspSources(keys, true)).toEqual(on);
  });

  it('adds nothing for the fake checkbox or without both keys', () => {
    expect(turnstileCspSources(keys, false)).toEqual(none);
    expect(turnstileCspSources({ HUMAN_CHECK_PROVIDER: 'fake', ...keys }, true)).toEqual(none);
    expect(
      turnstileCspSources({ HUMAN_CHECK_PROVIDER: 'turnstile', TURNSTILE_SITE_KEY: 'site' }, true),
    ).toEqual(none);
  });

  it('sign-in (console) and public pages may load and frame the challenge', () => {
    const t = turnstileCspSources({ HUMAN_CHECK_PROVIDER: 'turnstile', ...keys }, true);
    const nonce = generateNonce();
    const console = parseCsp(
      securityHeaders('console', { nonce, extra: t })['content-security-policy'] as string,
    );
    expect(console.get('frame-src')).toEqual(["'self'", TURNSTILE_ORIGIN]);
    const pub = parseCsp(securityHeaders('public', { nonce, extra: t })['content-security-policy'] as string);
    expect(pub.get('frame-src')).toEqual([TURNSTILE_ORIGIN]);
    expect(pub.get('script-src')).toContain(TURNSTILE_ORIGIN);
  });
});
