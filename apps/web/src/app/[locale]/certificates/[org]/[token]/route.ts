import { certificateByToken, certificateHtml } from '@yayatoh/ce';
import { z } from 'zod';
import { routing } from '@/i18n/routing.ts';
import { receiptPdfResponse } from '@/server/receipt-pdf.ts';
import { appOrigin } from '@/server/tenant-return.ts';

/**
 * The holder's CE certificate (M6.9b), reached by the signed link emailed to the holder and shown
 * on their order page. The org comes from the path (never a header); the language from the link
 * (`/ar/…` renders it right to left). `?format=html` returns the same document as HTML (the
 * accessible alternative to the PDF, and what tests read).
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ locale: string; org: string; token: string }> },
) {
  const { locale: raw, org, token } = await params;
  const locale = routing.locales.find((l) => l === raw) ?? routing.defaultLocale;
  if (!z.uuid().safeParse(org).success || token.length > 200)
    return new Response('Not found', { status: 404 });
  const doc = await certificateByToken(org, decodeURIComponent(token), appOrigin());
  if (!doc) return new Response('Not found', { status: 404 });
  const htmlDoc = certificateHtml(doc.doc, locale);
  if (new URL(req.url).searchParams.get('format') === 'html')
    return new Response(htmlDoc, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'private, no-store',
        'x-robots-tag': 'noindex',
        'referrer-policy': 'no-referrer',
      },
    });
  return receiptPdfResponse(htmlDoc, `certificate-${doc.doc.code}`);
}
