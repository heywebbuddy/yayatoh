import { batchFileByLink } from '@yayatoh/badges';
import { pdfResponse } from '@/server/badge-pdf.ts';

/** A finished badge batch PDF behind its signed, expiring link (M5.5a). */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const file = token.length <= 200 ? await batchFileByLink(token) : null;
  if (!file) return new Response('This link has expired or is not valid.', { status: 404 });
  return pdfResponse(file.bytes, 'badges.pdf', 'attachment');
}
