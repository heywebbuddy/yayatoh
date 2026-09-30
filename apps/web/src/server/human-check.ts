import 'server-only';
import { FAKE_HUMAN_TOKEN, fakeHumanCheck, type HumanCheck, turnstileHumanCheck } from '@yayatoh/platform';
import { headers } from 'next/headers';
import { clientIp } from './rate-limit.ts';

let humanCheck: HumanCheck | null | undefined;

/**
 * "Are you a person?" (roadmap §6.1, §10): Cloudflare Turnstile when its keys are set
 * (`HUMAN_CHECK_PROVIDER=turnstile`, owner account), otherwise the fake checkbox in dev, preview
 * and CI. Production without Turnstile has no challenge (null): the rate limits still apply.
 * Used by the seat finder (M1.7e), sign-in after failed attempts, emailed sign-in codes (which
 * create accounts), password resets, the venue quote form (M1.2f) and open signup (M3.11a).
 * Verified server-side.
 */
export function getHumanCheck(): HumanCheck | null {
  if (humanCheck !== undefined) return humanCheck;
  const production = process.env.VERCEL_ENV === 'production';
  const provider = process.env.HUMAN_CHECK_PROVIDER || (production ? 'turnstile' : 'fake');
  const siteKey = process.env.TURNSTILE_SITE_KEY;
  const secretKey = process.env.TURNSTILE_SECRET_KEY;
  humanCheck =
    provider === 'turnstile'
      ? siteKey && secretKey
        ? turnstileHumanCheck({ siteKey, secretKey })
        : null
      : production
        ? null
        : fakeHumanCheck;
  return humanCheck;
}

/** What the browser needs to show the challenge (null: no challenge configured). */
export function humanCheckWidget(): {
  provider: 'fake' | 'turnstile';
  siteKey: string | null;
  fakeToken: string;
} | null {
  const h = getHumanCheck();
  return h
    ? { provider: h.provider, siteKey: h.siteKey, fakeToken: h.provider === 'fake' ? FAKE_HUMAN_TOKEN : '' }
    : null;
}

/** The challenge's token in a form: Turnstile's field, or the fake checkbox. */
export const humanToken = (form: FormData) =>
  String(form.get('cf-turnstile-response') ?? form.get('human') ?? '').slice(0, 2048);

/** Did this form carry a solved challenge? null when it carried none. */
export async function passedHumanCheck(form: FormData): Promise<boolean | null> {
  const token = humanToken(form);
  if (!token) return null;
  return (await getHumanCheck()?.verify(token)) ?? false;
}

/**
 * For forms that always ask (sign-in codes, resets, quotes): `ok` when solved or when no
 * challenge is configured (production before the owner's Turnstile keys: rate limits only),
 * `missing` without a token, `failed` when the verifier refused it.
 */
export async function requireHumanCheck(
  token: string,
  remoteIp?: string | null,
): Promise<'ok' | 'missing' | 'failed'> {
  const h = getHumanCheck();
  if (!h) return 'ok';
  if (!token) return 'missing';
  const ip = remoteIp === undefined ? clientIp(await headers()) : remoteIp;
  return (await h.verify(token.slice(0, 2048), ip)) ? 'ok' : 'failed';
}
