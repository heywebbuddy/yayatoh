import 'server-only';
import { FAKE_HUMAN_TOKEN, fakeHumanCheck, type HumanCheck, turnstileHumanCheck } from '@yayatoh/platform';

let humanCheck: HumanCheck | null | undefined;

/**
 * The "are you a person?" challenge (the seat finder past its rate limit; open signup, M3.11a):
 * Cloudflare Turnstile when its keys are set (`HUMAN_CHECK_PROVIDER=turnstile`, owner account),
 * otherwise the fake checkbox in dev, preview and CI. Production without Turnstile has no
 * challenge (null): over-limit lookups wait instead, and signups rely on the rate limits.
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

/** What the browser needs to show the challenge. */
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

/** Did this form carry a solved challenge? */
export async function passedHumanCheck(form: FormData): Promise<boolean | null> {
  const token = String(form.get('cf-turnstile-response') ?? form.get('human') ?? '');
  if (!token) return null;
  return (await getHumanCheck()?.verify(token)) ?? false;
}
