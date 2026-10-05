import { zipResponse } from '@/server/dsar-receipt.ts';
import { selfArchive } from '@/server/privacy-request.ts';

/** The person's own archive (M6.1c), from the signed link they were emailed; 7 days. */
export async function GET(_req: Request, { params }: { params: Promise<{ org: string; token: string }> }) {
  const { org, token } = await params;
  const file = await selfArchive(org, decodeURIComponent(token));
  if (!file)
    return new Response('This link has expired or is not valid.', {
      status: 404,
      headers: { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' },
    });
  return zipResponse(file);
}
