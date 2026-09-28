import { clearSignInFailures, recordSignInFailure, signInNeedsHumanCheck } from '@yayatoh/auth';
import type { RateLimitPolicyName } from '@yayatoh/platform/security';
import { tooManyRequests } from '@yayatoh/platform/security';
import { getAuth } from '@/server/auth.ts';
import { requireHumanCheck } from '@/server/human-check.ts';
import { clientIp, limitRequest } from '@/server/rate-limit.ts';

// Better Auth endpoints for this host (sign-in, OTP, sessions, 2FA).
// Password sign-up is closed (invite-only, M1.3): accounts start with an emailed code, which
// verifies the address, and organizations need a signup code. Password resets are requested
// through the app's own page (M1.2f: it checks the human challenge first), never directly here.
const closed = (req: Request) =>
  /\/(sign-up|request-password-reset|forget-password|reset-password)(\/|$)/.test(new URL(req.url).pathname);

/**
 * Abuse limits in front of Better Auth (M1.14a): per device (or IP without one), per targeted
 * email and a generous per-IP ceiling. Anything under /sign-in/ counts as a sign-in attempt;
 * sending a code counts against the stricter OTP policy (each one sends an email). Two-factor
 * verification (M1.2c, built in parallel) should add its paths here at merge.
 */
const LIMITED: readonly [RegExp, RateLimitPolicyName][] = [
  [/\/api\/auth\/sign-in\//, 'signIn'],
  [/\/api\/auth\/email-otp\/send-verification-otp$/, 'otpSend'],
  [/\/api\/auth\/sign-in\/magic-link$/, 'otpSend'],
];

/**
 * "Are you a person?" (M1.2f), token in the `x-human-check` header: always before an emailed code
 * or link is sent (a first code creates the account: this is sign-up), and for password sign-ins
 * once an email has had three failures in 15 minutes.
 */
const ALWAYS_CHECKED = /\/api\/auth\/(email-otp\/send-verification-otp|sign-in\/magic-link)$/;
const PASSWORD_SIGN_IN = /\/api\/auth\/sign-in\/email$/;

const refuse = (code: 'HUMAN_CHECK_REQUIRED' | 'HUMAN_CHECK_FAILED') =>
  Response.json(
    { code, message: 'Complete the security check' },
    { status: 403, headers: { 'x-human-check': 'required' } },
  );

async function emailOf(req: Request): Promise<string | null> {
  try {
    const body = (await req.clone().json()) as { email?: unknown };
    return typeof body.email === 'string' ? body.email.slice(0, 320) : null;
  } catch {
    return null;
  }
}

export const GET = (req: Request) => getAuth().handler(req);
export async function POST(req: Request) {
  if (closed(req)) return Response.json({ code: 'CLOSED' }, { status: 403 });
  const path = new URL(req.url).pathname;
  const email = await emailOf(req);
  const policy = LIMITED.find(([re]) => re.test(path))?.[1];
  if (policy) {
    const decision = await limitRequest(req, policy, { identity: email });
    if (!decision.allowed) return tooManyRequests(decision, { message: 'Too many attempts' });
  }
  const token = req.headers.get('x-human-check') ?? '';
  const password = PASSWORD_SIGN_IN.test(path) && email !== null;
  if (ALWAYS_CHECKED.test(path) || (password && (await signInNeedsHumanCheck(email)))) {
    const check = await requireHumanCheck(token, clientIp(req.headers));
    if (check !== 'ok') return refuse(check === 'missing' ? 'HUMAN_CHECK_REQUIRED' : 'HUMAN_CHECK_FAILED');
  }
  const res = await getAuth().handler(req);
  if (!password || !email) return res;
  if (res.ok) {
    await clearSignInFailures(email);
    return res;
  }
  if (res.status !== 401) return res;
  if (!(await recordSignInFailure(email))) return res;
  // The next attempt needs the check: tell the form now, so it shows it before the retry.
  const out = new Response(res.body, res);
  out.headers.set('x-human-check', 'required');
  return out;
}
