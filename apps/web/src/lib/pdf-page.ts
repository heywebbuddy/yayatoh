/**
 * A page of a venue's PDF floor plan as an image (M6.11b underlay tracing), drawn in the
 * organizer's browser: the server only ever receives an image, which goes through the media
 * pipeline like any upload (sniffed, re-encoded, EXIF stripped). pdf.js runs on the main thread
 * (the console's strict CSP allows no workers) with eval off, and loads only when a PDF is picked.
 */

/** The longest edge of the drawn page, in pixels (sharp enough to trace, well under the limits). */
export const PDF_PAGE_EDGE = 2400;
export const PDF_MAX_PAGE = 500;

export type PdfPageResult =
  | { readonly ok: true; readonly blob: Blob; readonly pages: number }
  | {
      readonly ok: false;
      readonly reason: 'pdf_page' | 'pdf_unreadable' | 'too_large';
      readonly pages?: number;
    };

/** Whether a picked file is a PDF (by type, or by extension when the type is empty). */
export function looksLikePdf(file: { name: string; type: string }): boolean {
  return file.type === 'application/pdf' || (!file.type && /\.pdf$/i.test(file.name));
}

/** The scale that draws a page of `width` × `height` points with its longest edge at `edge` px. */
export function pageScale(width: number, height: number, edge = PDF_PAGE_EDGE): number {
  const longest = Math.max(width, height);
  return longest > 0 ? edge / longest : 1;
}

/**
 * Draw page `page` (1-based) of a PDF as an image of at most `maxBytes`: a PNG (line drawings stay
 * crisp), else a JPEG, smaller each time, until it fits.
 */
export async function pdfPageImage(file: Blob, page: number, maxBytes: number): Promise<PdfPageResult> {
  const pdfjs = await import('pdfjs-dist');
  const g = globalThis as { pdfjsWorker?: unknown };
  g.pdfjsWorker ??= await import('pdfjs-dist/build/pdf.worker.mjs');
  let doc: Awaited<ReturnType<typeof pdfjs.getDocument>['promise']>;
  try {
    doc = await pdfjs.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
      isEvalSupported: false,
      useSystemFonts: true,
    }).promise;
  } catch {
    return { ok: false, reason: 'pdf_unreadable' };
  }
  try {
    const pages = doc.numPages;
    if (!Number.isInteger(page) || page < 1 || page > pages) return { ok: false, reason: 'pdf_page', pages };
    const p = await doc.getPage(page);
    const base = p.getViewport({ scale: 1 });
    let edge = PDF_PAGE_EDGE;
    for (let attempt = 0; attempt < 4; attempt++) {
      const viewport = p.getViewport({ scale: pageScale(base.width, base.height, edge) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      const context = canvas.getContext('2d');
      if (!context) return { ok: false, reason: 'pdf_unreadable' };
      // A white sheet under the drawing (PDF pages are transparent where nothing is drawn).
      context.fillStyle = 'white';
      context.fillRect(0, 0, canvas.width, canvas.height);
      await p.render({ canvas, canvasContext: context, viewport }).promise;
      for (const [type, quality] of [
        ['image/png', undefined],
        ['image/jpeg', 0.85],
      ] as const) {
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
        if (blob && blob.size <= maxBytes) return { ok: true, blob, pages };
      }
      edge = Math.round(edge * 0.7);
    }
    return { ok: false, reason: 'too_large', pages };
  } finally {
    await doc.destroy();
  }
}
