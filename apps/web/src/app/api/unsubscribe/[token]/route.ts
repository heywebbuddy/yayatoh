import { createCtx, executeCommand, isDomainError } from '@yayatoh/kernel';
import { unsubscribeCommand, unsubscribeRef } from '@yayatoh/notifications';
import { type NextRequest, NextResponse } from 'next/server';
import { ports } from '@/server/ports.ts';

/**
 * RFC 8058 one-click unsubscribe: mail clients POST `List-Unsubscribe=One-Click` here, with no
 * cookies and no confirmation page. The token names the message; nothing else is needed.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const body = await req.text();
  if (!/(^|&)List-Unsubscribe=One-Click(&|$)/.test(body.trim()))
    return new NextResponse('Expected List-Unsubscribe=One-Click', { status: 400 });
  const ref = await unsubscribeRef(token);
  if (!ref) return new NextResponse(null, { status: 404 });
  try {
    await executeCommand(
      unsubscribeCommand,
      { token, source: 'one_click' },
      createCtx({ orgId: ref.orgId }),
      ports,
    );
  } catch (err) {
    if (isDomainError(err) && err.code === 'not_found') return new NextResponse(null, { status: 404 });
    throw err;
  }
  return new NextResponse('Unsubscribed', { status: 200, headers: { 'cache-control': 'no-store' } });
}
