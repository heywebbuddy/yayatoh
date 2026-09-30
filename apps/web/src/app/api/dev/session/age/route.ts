import { type NextRequest, NextResponse } from 'next/server';
import { getAuth, getTwoFactor } from '@/server/auth.ts';
import { devAuthEnabled, getSession, sessionToken } from '@/server/session.ts';

/**
 * Development only: move this session's last re-authentication into the past (default 11
 * minutes), so the 10-minute step-up window can be tested without waiting. The authenticator
 * code last used is then that long ago too (TOTP replay protection forgets it). 404 unless enabled.
 */
export async function POST(req: NextRequest) {
  if (!devAuthEnabled()) return new NextResponse(null, { status: 404 });
  const token = await sessionToken();
  if (!token) return new NextResponse(null, { status: 401 });
  const form = await req.formData().catch(() => new FormData());
  const minutes = Math.min(Math.max(Number(form.get('minutes') ?? 11) || 11, 1), 60 * 24);
  const at = new Date(Date.now() - minutes * 60_000);
  const ctx = await getAuth().$context;
  await ctx.internalAdapter.updateSession(token, { createdAt: at, stepUpAt: null });
  const session = await getSession();
  if (session) await getTwoFactor().forgetUsedCodes(session.userId);
  return new NextResponse(null, { status: 204 });
}
