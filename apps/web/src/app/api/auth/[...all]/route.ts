import type { RateLimitPolicyName } from '@yayatoh/platform/security';
import { tooManyRequests } from '@yayatoh/platform/security';
import { getAuth } from '@/server/auth.ts';
import { limitRequest } from '@/server/rate-limit.ts';

// Better Auth endpoints for this host (sign-in, OTP, sessions, 2FA).
// Password sign-up is closed (invite-only, M1.3): accounts start with an emailed code, which
// verifies the address, and organizations need a signup code.
const closed = (req: Request) => /\/sign-up(\/|$)/.test(new URL(req.url).pathname);

/**
 * Abuse limits in front of Better Auth (M1.14a): per device (or IP without one), per targeted
 * email and a generous per-IP ceiling. Anything under /sign-in/ counts as a sign-in attempt;
 * sending a code counts against the stricter OTP policy (each one sends an email). Two-factor
 * verification (M1.2c, built in parallel) should add its paths here at merge.
 */
const LIMITED: readonly [RegExp, RateLimitPolicyName][] = [
  [/\/api\/auth\/sign-in\//, 'signIn'],
  [/\/api\/auth\/email-otp\/send-verification-otp$/, 'otpSend'],
];

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
  if (closed(req)) return Response.json({ code: 'SIGN_UP_CLOSED' }, { status: 403 });
  const path = new URL(req.url).pathname;
  const policy = LIMITED.find(([re]) => re.test(path))?.[1];
  if (policy) {
    const decision = await limitRequest(req, policy, { identity: await emailOf(req) });
    if (!decision.allowed) return tooManyRequests(decision, { message: 'Too many attempts' });
  }
  return getAuth().handler(req);
}
