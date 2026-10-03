import 'server-only';
import { getPdfRenderer } from './pdf.ts';

/**
 * A receipt or year-end statement document (M4.8b) as a PDF, or as printable HTML when no
 * renderer is configured. Never cached, never indexed, no referrer (the link is the credential).
 */
export async function receiptPdfResponse(html: string, name: string): Promise<Response> {
  const headers = {
    'cache-control': 'private, no-store',
    'x-robots-tag': 'noindex',
    'referrer-policy': 'no-referrer',
  };
  const renderer = getPdfRenderer();
  if (!renderer)
    return new Response(html, { headers: { ...headers, 'content-type': 'text/html; charset=utf-8' } });
  try {
    const bytes = new Uint8Array(await renderer.render({ html }));
    return new Response(bytes, {
      headers: {
        ...headers,
        'content-type': 'application/pdf',
        'content-disposition': `inline; filename="${name}.pdf"`,
      },
    });
  } catch (err) {
    console.error('receipt pdf', err);
    return new Response('The PDF is temporarily unavailable. Please try again in a moment.', {
      status: 503,
      headers: { ...headers, 'retry-after': '5' },
    });
  }
}
