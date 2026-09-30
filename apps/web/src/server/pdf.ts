import 'server-only';
import { gotenbergRenderer, type PdfRenderer } from '@yayatoh/pdf';

let renderer: PdfRenderer | null | undefined;

/** The PDF renderer (ADR 0017), or null when GOTENBERG_URL is unset (downloads are then not offered). */
export function getPdfRenderer(): PdfRenderer | null {
  if (renderer === undefined) {
    const url = process.env.GOTENBERG_URL;
    renderer = url ? gotenbergRenderer({ url }) : null;
  }
  return renderer;
}
