import { catchUpGifts, displayScreen, givingQrQuery, publicScreen } from '@yayatoh/donations';
import { checkoutTarget } from '@yayatoh/events';
import { qrPath } from '@yayatoh/pdf';
import { appTokenSecret } from '@yayatoh/platform';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { GivingScreen } from '@/components/donations/giving-screen.tsx';
import { appOrigin } from '@/server/engagement.ts';
import { pageLocale } from '@/server/locale.ts';
import { channelParam } from '@/server/realtime.ts';

type Params = {
  params: Promise<{ locale: string; token: string }>;
  searchParams: Promise<{ contrast?: string; motion?: string }>;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('donations.screen');
  return { title: t('metaTitle'), robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

/** Where a screen streams from: its own route checks the signed link, not a session. */
const screenStreamUrl = (token: string) => `/api/donations/screen/${encodeURIComponent(token)}`;

/**
 * The live giving screen (M4.8d): opened from its signed link on the room's projector, no sign-in.
 * A forged or replaced link is a 404. Totals, the level being called and names of donors who
 * opted in (P4-13); the QR code opens the campaign's giving page when it takes gifts (a connected
 * account, a published event and an open campaign). `?contrast=high` and `?motion=reduced` start
 * it in those modes.
 */
export default async function GivingScreenPage({ params, searchParams }: Params) {
  const { locale, token: raw } = await params;
  pageLocale(locale);
  const { contrast, motion } = await searchParams;
  const token = channelParam(raw);
  const target = await displayScreen(token, appTokenSecret());
  if (!target) notFound();
  // Gift outcomes the worker hasn't applied yet (dev and e2e have no worker).
  await catchUpGifts(target.orgId);
  const screen = await publicScreen(target.orgId, target.eventId);
  if (!screen) notFound();
  const checkout = screen.givingOpen ? await checkoutTarget(screen.eventSlug) : null;
  const open = checkout?.orgId === target.orgId && checkout.eventId === target.eventId;
  const url = `${appOrigin()}/events/${screen.eventSlug}/give${givingQrQuery(screen.campaignId, 'screen')}`;
  return (
    <GivingScreen
      variant="screen"
      eventName={screen.eventName}
      initial={screen.state}
      streamUrl={screenStreamUrl(token)}
      version={target.version}
      give={open ? { url, qr: qrPath(url) } : null}
      defaults={{
        ...(contrast === 'high' ? { contrast: true } : {}),
        ...(motion === 'reduced' ? { reducedMotion: true } : {}),
      }}
    />
  );
}
