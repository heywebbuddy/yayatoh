import 'server-only';
import { createHash } from 'node:crypto';
import { dsarReceiptHtml } from '@yayatoh/pdf';
import { dsarSigner, type Receipt, receiptBytes } from '@yayatoh/privacy';
import { getTranslations } from 'next-intl/server';
import { routing } from '@/i18n/routing.ts';
import { getPdfRenderer } from './pdf.ts';

const RTL = new Set(['ar']);

/** The locale asked for (`?locale=`), else the page's, else English. */
export function receiptLocale(req: Request, fallback: string): string {
  const asked = new URL(req.url).searchParams.get('locale') ?? fallback;
  return (routing.locales as readonly string[]).includes(asked) ? asked : 'en';
}

/**
 * The signed erasure receipt (M6.1c) as a PDF in the reader's language: what was erased, what was
 * kept and why, the signature and the public key that checks it. Without a renderer the same
 * document comes back as printable HTML (like credit notes).
 */
export async function receiptResponse(input: {
  readonly receipt: Receipt;
  readonly signature: string;
  readonly locale: string;
  readonly timeZone: string;
}): Promise<Response> {
  const { receipt: r, locale } = input;
  const t = await getTranslations({ locale, namespace: 'privacy' });
  const when = new Intl.DateTimeFormat(locale, {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: input.timeZone,
  });
  const day = new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: input.timeZone });
  const signer = dsarSigner();
  const html = dsarReceiptHtml({
    lang: locale,
    dir: RTL.has(locale) ? 'rtl' : 'ltr',
    title: t('pdf.title'),
    org: r.org.name,
    rows: [
      [t('pdf.request'), r.requestId],
      [t('pdf.person'), r.subject.hint],
      [t('pdf.source'), t(`sources.${r.source}`)],
      [t('pdf.requested'), when.format(new Date(r.requestedAt))],
      ...(r.dueAt ? [[t('pdf.due'), day.format(new Date(r.dueAt))] as const] : []),
      [t('pdf.completed'), when.format(new Date(r.completedAt))],
    ],
    erasedTitle: t('request.receipt.erased'),
    erasedHeaders: [t('request.receipt.table'), t('request.receipt.action'), t('request.receipt.rows')],
    erased: r.erased.map((e) => [e.table, t(`request.receipt.actions.${e.action}`), String(e.rows)] as const),
    erasedEmpty: t('request.receipt.noneErased'),
    heldTitle: t('request.receipt.held'),
    heldHeaders: [
      t('request.receipt.table'),
      t('request.receipt.ref'),
      t('request.receipt.basis'),
      t('request.receipt.until'),
    ],
    held: r.held.map(
      (h) => [h.table, `${h.ref} · ${h.id}`, t(`request.receipt.bases.${h.basis}`), h.until ?? '—'] as const,
    ),
    heldEmpty: t('request.receipt.noneHeld'),
    notes: [
      t('request.receipt.files', { count: r.files }),
      ...(r.suppressed ? [t('request.receipt.suppressed')] : []),
      t('request.receipt.connectors', { count: r.connectors.length, names: r.connectors.join(', ') }),
    ],
    signatureTitle: t('pdf.signatureTitle'),
    signatureRows: [
      [t('pdf.algorithm'), r.key.algorithm],
      [t('pdf.keyId'), r.key.id],
      [t('pdf.digest'), createHash('sha256').update(receiptBytes(r)).digest('hex')],
      [t('pdf.signature'), input.signature],
    ],
    publicKeyPem: signer.keyId === r.key.id ? signer.publicKeyPem : '',
    footer: t('pdf.footer', { org: r.org.name }),
  });
  const headers = { 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex' };
  const renderer = getPdfRenderer();
  if (!renderer)
    return new Response(html, { headers: { ...headers, 'content-type': 'text/html; charset=utf-8' } });
  try {
    const bytes = new Uint8Array(await renderer.render({ html }));
    return new Response(bytes, {
      headers: {
        ...headers,
        'content-type': 'application/pdf',
        'content-disposition': `inline; filename="erasure-receipt-${r.requestId.slice(-8)}.pdf"`,
      },
    });
  } catch (err) {
    console.error('dsar receipt pdf', err);
    return new Response('The PDF is temporarily unavailable. Please try again in a moment.', {
      status: 503,
      headers: { ...headers, 'retry-after': '5' },
    });
  }
}

/** A ZIP download (archives): attachment, no caching, no sniffing. */
export function zipResponse(file: { readonly name: string; readonly bytes: Uint8Array }): Response {
  const ascii = file.name.replace(/[^A-Za-z0-9._-]/g, '_');
  return new Response(new Uint8Array(file.bytes), {
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'x-robots-tag': 'noindex',
    },
  });
}
