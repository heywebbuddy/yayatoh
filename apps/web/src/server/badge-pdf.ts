import 'server-only';
import { getPdfRenderer } from './pdf.ts';

/** A PDF response that is never cached, indexed or referred. */
export function pdfResponse(bytes: Uint8Array, filename: string, disposition: 'inline' | 'attachment') {
  return new Response(new Uint8Array(bytes), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `${disposition}; filename="${filename}"`,
      'cache-control': 'private, no-store',
      'x-robots-tag': 'noindex',
      'referrer-policy': 'no-referrer',
    },
  });
}

/** Render badge HTML, or answer 503 when the renderer is missing, down or cold (retry). */
export async function renderOr503(html: string, ok: (pdf: Uint8Array) => Response): Promise<Response> {
  const renderer = getPdfRenderer();
  if (!renderer) return new Response('Badge PDFs are not available here.', { status: 503 });
  try {
    return ok(await renderer.render({ html }));
  } catch (err) {
    console.error('badge pdf', err);
    return new Response('The PDF is temporarily unavailable. Please try again in a moment.', {
      status: 503,
      headers: { 'retry-after': '5', 'cache-control': 'no-store' },
    });
  }
}
