import { receiptByToken, receiptHtml } from '@yayatoh/donations';
import { z } from 'zod';
import { routing } from '@/i18n/routing.ts';
import { receiptPdfResponse } from '@/server/receipt-pdf.ts';

/**
 * The donor's receipt (M4.8b), reached by the signed link emailed to the donor only (P4-13). The
 * org comes from the path (never a header); the language from the link (the donor's).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ locale: string; org: string; token: string }> },
) {
  const { locale: raw, org, token } = await params;
  const locale = routing.locales.find((l) => l === raw) ?? routing.defaultLocale;
  if (!z.uuid().safeParse(org).success || token.length > 200)
    return new Response('Not found', { status: 404 });
  const doc = await receiptByToken(org, decodeURIComponent(token));
  if (!doc) return new Response('Not found', { status: 404 });
  return receiptPdfResponse(receiptHtml(doc.doc, locale), `receipt-${doc.doc.number}`);
}
