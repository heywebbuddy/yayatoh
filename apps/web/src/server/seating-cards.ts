import 'server-only';
import { RTL_LOCALES } from '@yayatoh/contracts';
import type { CardKind, CardsCopy, ExportCopy } from '@yayatoh/seating';
import { getTranslations } from 'next-intl/server';
import { routing } from '@/i18n/routing.ts';
import { getPdfRenderer } from './pdf.ts';

/**
 * Cards and exports (M4.3b): the words printed on cards and in the export files, in the chosen
 * language (next-intl, `seating.cards.doc` / `seating.cards.file`), and the PDF response.
 */

export const isAppLocale = (v: string | null): v is string =>
  v !== null && (routing.locales as readonly string[]).includes(v);

export const localeDir = (lang: string): 'ltr' | 'rtl' => (RTL_LOCALES.has(lang as 'ar') ? 'rtl' : 'ltr');

/** "Table 3", "Row A" in a language (the plan's labels are bare). */
export async function placeNamer(lang: string) {
  const t = await getTranslations({ locale: lang, namespace: 'seating.guestSeating.place' });
  return (p: { kind: 'table' | 'row'; label: string }) => t(p.kind, { label: p.label });
}

export async function cardsCopy(lang: string, kind: CardKind): Promise<CardsCopy> {
  const t = await getTranslations({ locale: lang, namespace: 'seating.cards.doc' });
  return {
    title: t(`title.${kind}`),
    yourTable: t('yourTable'),
    guestOf: (name) => t('guestOf', { name }),
    hostedBy: (name) => t('hostedBy', { name }),
  };
}

export async function exportCopy(
  locale: string,
): Promise<ExportCopy & { sheetChart: string; sheetMeals: string }> {
  const t = await getTranslations({ locale, namespace: 'seating.cards' });
  return {
    place: t('file.place'),
    guest: t('file.guest'),
    party: t('file.party'),
    age: t('file.age'),
    meal: t('file.meal'),
    reply: t('file.reply'),
    ageClass: {
      adult: t('file.ageClass.adult'),
      child: t('file.ageClass.child'),
      infant: t('file.ageClass.infant'),
    },
    status: {
      attending: t('file.status.attending'),
      pending: t('file.status.pending'),
      declined: t('file.status.declined'),
    },
    notSeated: t('file.notSeated'),
    notChosen: t('file.notChosen'),
    children: t('file.children'),
    infants: t('file.infants'),
    total: t('file.total'),
    guestOf: (name) => t('doc.guestOf', { name }),
    sheetChart: t('file.sheetChart'),
    sheetMeals: t('file.sheetMeals'),
  };
}

const PRIVATE = {
  'cache-control': 'private, no-store',
  'x-robots-tag': 'noindex',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
};

/** A file download: an ASCII name plus the UTF-8 one. */
export function download(body: BodyInit, contentType: string, name: string): Response {
  const ascii = name.replace(/[^A-Za-z0-9._-]/g, '_');
  return new Response(body, {
    headers: {
      ...PRIVATE,
      'content-type': contentType,
      'content-disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    },
  });
}

/**
 * The cards as a PDF download, or as printable HTML when no renderer is configured (development
 * without Gotenberg); a 503 to retry when the renderer is down or still starting.
 */
export async function cardsPdfResponse(html: string, name: string): Promise<Response> {
  const renderer = getPdfRenderer();
  if (!renderer)
    return new Response(html, { headers: { ...PRIVATE, 'content-type': 'text/html; charset=utf-8' } });
  try {
    const bytes = new Uint8Array(await renderer.render({ html }));
    return download(bytes, 'application/pdf', `${name}.pdf`);
  } catch (err) {
    console.error('cards pdf', err);
    return new Response('The PDF is temporarily unavailable. Please try again in a moment.', {
      status: 503,
      headers: { ...PRIVATE, 'retry-after': '5' },
    });
  }
}
