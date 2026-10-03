import { displaySession, publicLiveSession } from '@yayatoh/engagement';
import { isPublicEvent } from '@yayatoh/events';
import { qrPath } from '@yayatoh/pdf';
import { appTokenSecret } from '@yayatoh/platform';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { StageView } from '@/components/engagement/stage-view.tsx';
import { appOrigin, displayStreamUrl, participantPath } from '@/server/engagement.ts';
import { pageLocale } from '@/server/locale.ts';
import { channelParam } from '@/server/realtime.ts';

type Params = {
  params: Promise<{ locale: string; token: string }>;
  searchParams: Promise<{ contrast?: string; motion?: string }>;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('engagement.screen');
  return { title: t('metaTitle'), robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

/**
 * The big screen of a session (M5.7a): opened from its signed display link on a projector, no
 * sign-in. A forged or rotated link is a 404. Approved questions and shown results only; it
 * reconnects by itself and catches up (replay by id, else a snapshot). `?contrast=high` and
 * `?motion=reduced` start it in those modes.
 */
export default async function DisplayPage({ params, searchParams }: Params) {
  const { locale, token: raw } = await params;
  pageLocale(locale);
  const { contrast, motion } = await searchParams;
  const token = channelParam(raw);
  const target = await displaySession(token, appTokenSecret());
  const live = target
    ? await publicLiveSession(target.orgId, target.eventId, target.sessionId, { requirePublicEvent: false })
    : null;
  if (!target || !live) notFound();
  const open = await isPublicEvent(target.orgId, target.eventId);
  const url = `${appOrigin()}${participantPath(live.eventSlug, target.sessionId)}`;
  return (
    <StageView
      variant="screen"
      eventName={live.eventName}
      sessionTitle={live.sessionTitle}
      initial={live.state}
      streamUrl={displayStreamUrl(token)}
      join={open ? { url, qr: qrPath(url) } : null}
      defaults={{
        ...(contrast === 'high' ? { contrast: true } : {}),
        ...(motion === 'reduced' ? { reducedMotion: true } : {}),
      }}
    />
  );
}
