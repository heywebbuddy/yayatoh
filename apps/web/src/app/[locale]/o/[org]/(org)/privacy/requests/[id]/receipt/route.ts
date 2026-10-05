import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { requestQuery } from '@yayatoh/privacy';
import { loadConsole } from '@/server/console.ts';
import { receiptLocale, receiptResponse } from '@/server/dsar-receipt.ts';
import { ports } from '@/server/ports.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The signed erasure receipt as a PDF (M6.1c): owners and admins (`privacy:manage`). */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ locale: string; org: string; id: string }> },
) {
  const { locale, org, id } = await params;
  const notFound = () => new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
  if (!UUID.test(id)) return notFound();
  const data = await loadConsole(org);
  try {
    const r = await executeQuery(requestQuery, { requestId: id }, data.ctx, ports);
    if (!r.receipt || !r.signature) return notFound();
    return receiptResponse({
      receipt: r.receipt,
      signature: r.signature,
      locale: receiptLocale(req, locale),
      timeZone: data.org.timezone,
    });
  } catch (err) {
    if (isDomainError(err) && ['not_found', 'forbidden'].includes(err.code)) return notFound();
    throw err;
  }
}
