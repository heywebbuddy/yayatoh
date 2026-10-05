import { RTL_LOCALES } from '@yayatoh/contracts';
import { light } from '@yayatoh/ui/tokens';
import { getTranslations } from 'next-intl/server';
import { routing } from '@/i18n/routing.ts';
import { hubHref, loadConferenceHub } from '@/server/conference-hub.ts';

/**
 * The conference hub's web app manifest (M5.10a): installs the registrant's own hub (its link is
 * the start URL; the scope is the hub's path), named after the event, in the visitor's language.
 * A wrong link or an order without registration gets nothing. Never in a shared cache: it carries
 * the order's link.
 */
export async function GET(req: Request, { params }: { params: Promise<{ locale: string; token: string }> }) {
  const { locale: raw, token } = await params;
  const locale = routing.locales.find((l) => l === raw) ?? routing.defaultLocale;
  const registrant = new URL(req.url).searchParams.get('registrant');
  const data = await loadConferenceHub(token, registrant);
  if (!data?.hub.registrantId) return new Response('Not found', { status: 404 });
  const t = await getTranslations({ locale, namespace: 'conferenceHub' });
  const prefix = locale === routing.defaultLocale ? '' : `/${locale}`;
  const name = data.hub.eventName;
  const manifest = {
    id: `${prefix}/orders/${token}/hub?registrant=${data.hub.registrantId}`,
    name,
    short_name: name.length > 24 ? `${name.slice(0, 23)}…` : name,
    description: t('metaTitle'),
    lang: locale,
    dir: (RTL_LOCALES as ReadonlySet<string>).has(locale) ? 'rtl' : 'ltr',
    start_url: `${prefix}${hubHref(token, data.hub.registrantId)}`,
    scope: `${prefix}/orders/${token}/hub`,
    display: 'standalone',
    orientation: 'portrait',
    background_color: light.canvas,
    theme_color: light.canvas,
    icons: [
      { src: '/conference-hub-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/conference-hub-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/conference-hub-icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
  return new Response(JSON.stringify(manifest), {
    headers: {
      'content-type': 'application/manifest+json; charset=utf-8',
      'cache-control': 'private, no-store',
      'x-robots-tag': 'noindex, nofollow',
    },
  });
}
