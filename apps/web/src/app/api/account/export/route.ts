import { isStepUpFresh } from '@yayatoh/kernel';
import { exportAccount } from '@yayatoh/privacy';
import { getSession, sessionToken } from '@/server/session.ts';

/**
 * Download my data (M1.14e): the signed-in person's account data as JSON (`yayatoh.account/1`,
 * allowlisted). Needs a step-up in the last 10 minutes (the account page confirms it first).
 * Recorded (masked) and written to their security events.
 */
export async function GET() {
  const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
  const session = await getSession();
  if (!session) return new Response('Sign in first', { status: 401, headers });
  if (!isStepUpFresh(session.stepUpAt, new Date()))
    return new Response('Confirm it’s you first', { status: 403, headers });
  const { doc, fileName } = await exportAccount({
    userId: session.userId,
    email: session.email,
    by: { type: 'self' },
    sessionToken: await sessionToken(),
    stepUpAt: session.stepUpAt,
  });
  return new Response(`${JSON.stringify(doc, null, 2)}\n`, {
    headers: {
      ...headers,
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${fileName}"`,
    },
  });
}
