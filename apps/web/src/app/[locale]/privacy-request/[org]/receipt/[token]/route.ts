import { receiptLocale, receiptResponse } from '@/server/dsar-receipt.ts';
import { selfReceipt } from '@/server/privacy-request.ts';

/** The person's copy of the erasure receipt (M6.1c), from the signed link they were emailed. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ locale: string; org: string; token: string }> },
) {
  const { locale, org, token } = await params;
  const r = await selfReceipt(org, decodeURIComponent(token));
  if (!r)
    return new Response('This link is not valid.', {
      status: 404,
      headers: { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' },
    });
  return receiptResponse({ ...r, locale: receiptLocale(req, locale), timeZone: 'UTC' });
}
