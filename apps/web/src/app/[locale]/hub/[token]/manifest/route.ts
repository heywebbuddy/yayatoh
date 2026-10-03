import { RTL_LOCALES } from '@yayatoh/contracts';
import { light } from '@yayatoh/ui/tokens';
import { getTranslations } from 'next-intl/server';
import { hubPath, loadPartyHub } from '@/server/guest-hub.ts';

/**
 * The party hub's web app manifest (M4.7a): installs the party's own page (its link is the start
 * URL and the scope), named after the event, in the visitor's language. Unknown, reset or expired
 * links get nothing. Never cached by shared caches: it carries the party's link.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ locale: string; token: string }> }) {
  const { locale, token: raw } = await params;
  const token = decodeURIComponent(raw);
  const hub = await loadPartyHub(token, locale);
  if (hub?.state !== 'ok') return new Response('Not found', { status: 404 });
  const t = await getTranslations({ locale, namespace: 'hub' });
  const path = hubPath(token, locale);
  const manifest = {
    id: path,
    name: hub.eventName,
    short_name: hub.eventName.length > 24 ? `${hub.eventName.slice(0, 23)}…` : hub.eventName,
    description: t('metaTitle'),
    lang: locale,
    dir: (RTL_LOCALES as ReadonlySet<string>).has(locale) ? 'rtl' : 'ltr',
    start_url: path,
    scope: path,
    display: 'standalone',
    orientation: 'portrait',
    background_color: light.canvas,
    theme_color: light.canvas,
    icons: [
      { src: '/hub-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/hub-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/hub-icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
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
