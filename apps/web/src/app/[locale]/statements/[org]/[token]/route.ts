import { statementByToken, statementHtml } from '@yayatoh/donations';
import { z } from 'zod';
import { routing } from '@/i18n/routing.ts';
import { receiptPdfResponse } from '@/server/receipt-pdf.ts';

/** The donor's year-end giving statement (M4.8b), by the signed link emailed to the donor only. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ locale: string; org: string; token: string }> },
) {
  const { locale: raw, org, token } = await params;
  const locale = routing.locales.find((l) => l === raw) ?? routing.defaultLocale;
  if (!z.uuid().safeParse(org).success || token.length > 200)
    return new Response('Not found', { status: 404 });
  const doc = await statementByToken(org, decodeURIComponent(token));
  if (!doc) return new Response('Not found', { status: 404 });
  return receiptPdfResponse(statementHtml(doc.doc, locale), `statement-${doc.doc.taxYear}`);
}
