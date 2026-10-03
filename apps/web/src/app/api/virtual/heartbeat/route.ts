import { createCtx, ERROR_STATUS, executeCommand, isDomainError } from '@yayatoh/kernel';
import { heartbeatCommand, MAX_TOKEN_LENGTH, playbackOrg } from '@yayatoh/virtual';
import { type NextRequest, NextResponse } from 'next/server';
import { ports } from '@/server/ports.ts';

/**
 * The virtual player's heartbeat (M6.9a): `{ token, seq }` as JSON. The org comes from the
 * playback token itself (signed by the video provider), never from a header; the command checks
 * the token again, counts the server's current minute once and ignores replays.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { token?: unknown; seq?: unknown } | null;
  const token = typeof body?.token === 'string' && body.token.length <= MAX_TOKEN_LENGTH ? body.token : null;
  const seq = typeof body?.seq === 'number' ? body.seq : null;
  if (!token || seq === null) return NextResponse.json({ code: 'validation_failed' }, { status: 400 });
  const orgId = playbackOrg(token, new Date());
  if (!orgId) return NextResponse.json({ code: 'forbidden', reason: 'invalid_token' }, { status: 403 });
  try {
    const r = await executeCommand(heartbeatCommand, { token, seq }, createCtx({ orgId }), ports);
    return NextResponse.json(r, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    if (!isDomainError(err)) throw err;
    const reason = typeof err.details?.reason === 'string' ? err.details.reason : null;
    return NextResponse.json({ code: err.code, reason }, { status: ERROR_STATUS[err.code] });
  }
}
