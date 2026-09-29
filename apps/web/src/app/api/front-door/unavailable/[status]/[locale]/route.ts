import { LOCALES, type Locale, RTL_LOCALES } from '@yayatoh/contracts';
import { getTranslations } from 'next-intl/server';

/**
 * The front door's own answer when the legacy site can't be reached (502) or is too slow (504)
 * (M2.4a), or when a host is routed back to legacy with no origin configured (503, the M2.5a
 * cutover rollback; batch 3c merge). proxy.ts rewrites to `/api/front-door/unavailable/{status}/{locale}`; plain HTML in the visitor's language, never cached.
 */
interface Ctx {
  params: Promise<{ status: string; locale: string }>;
}

async function page(_req: Request, { params }: Ctx): Promise<Response> {
  const p = await params;
  const status = p.status === '504' ? 504 : p.status === '503' ? 503 : 502;
  const asked = p.locale;
  const locale: Locale = (LOCALES as readonly string[]).includes(asked) ? (asked as Locale) : 'en';
  const t = await getTranslations({ locale, namespace: 'frontDoor' });
  const esc = (s: string) =>
    s.replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
    );
  const title = esc(status === 504 ? t('slowTitle') : t('downTitle'));
  const html = `<!doctype html><html lang="${locale}" dir="${RTL_LOCALES.has(locale) ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title></head><body><main><h1>${title}</h1><p>${esc(t('body'))}</p></main></body></html>`;
  return new Response(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'retry-after': status === 503 ? '300' : '30',
      'x-front-door': 'legacy',
    },
  });
}

export const GET = page;
export const HEAD = page;
export const POST = page;
export const PUT = page;
export const PATCH = page;
export const DELETE = page;
export const OPTIONS = page;
