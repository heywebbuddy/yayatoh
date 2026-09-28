import { b64url, readFakePushes, recordFakePush, verifyVapidAuthorization } from '@yayatoh/notifications';
import { type NextRequest, NextResponse } from 'next/server';
import { devAuthEnabled } from '@/server/session.ts';
import { webPushConfig } from '@/server/web-push.ts';

const ID = /^[A-Za-z0-9_-]{8,64}$/;

/** The origins this request may have been addressed to (the VAPID `aud`). */
function origins(req: NextRequest): string[] {
  const host = req.headers.get('host');
  return [req.nextUrl.origin, ...(host ? [`${req.nextUrl.protocol}//${host}`] : [])];
}

/**
 * Dev/CI only (404 otherwise): a fake RFC 8030 push service. It checks the VAPID signature like a
 * real one (401 without it), keeps the encrypted body for the test to decrypt, and answers 201.
 * Ids starting `gone-` answer 410 (an expired subscription), `busy-` 429 with Retry-After.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!devAuthEnabled()) return new NextResponse(null, { status: 404 });
  const { id } = await params;
  if (!ID.test(id)) return new NextResponse(null, { status: 404 });
  const config = webPushConfig();
  if (!config) return new NextResponse(null, { status: 503 });
  const auth = req.headers.get('authorization');
  const claims = origins(req)
    .map((audience) => verifyVapidAuthorization(auth, { publicKey: config.keys.publicKey, audience }))
    .find(Boolean);
  if (!claims) return new NextResponse(null, { status: 401 });
  if (req.headers.get('content-encoding') !== 'aes128gcm') return new NextResponse(null, { status: 415 });
  const body = new Uint8Array(await req.arrayBuffer());
  if (body.length > 4096) return new NextResponse(null, { status: 413 });
  if (id.startsWith('gone-')) return new NextResponse(null, { status: 410 });
  if (id.startsWith('busy-')) return new NextResponse(null, { status: 429, headers: { 'Retry-After': '1' } });
  const at = new Date().toISOString();
  recordFakePush(id, {
    at,
    body: b64url.encode(body),
    ttl: req.headers.get('ttl'),
    urgency: req.headers.get('urgency'),
    topic: req.headers.get('topic'),
    contentEncoding: req.headers.get('content-encoding'),
    subject: claims.sub,
  });
  return new NextResponse(null, {
    status: 201,
    headers: { Location: `${req.nextUrl.origin}/api/dev/push-service/${id}/${Date.parse(at)}` },
  });
}

/** Dev/CI only: what this fake subscription received, oldest first. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!devAuthEnabled()) return new NextResponse(null, { status: 404 });
  const { id } = await params;
  return NextResponse.json(readFakePushes(id));
}
