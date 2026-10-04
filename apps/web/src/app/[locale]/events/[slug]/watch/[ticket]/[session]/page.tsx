import { checkoutTarget } from '@yayatoh/events';
import { createCtx, executeQuery, isDomainError } from '@yayatoh/kernel';
import { viewerQuery } from '@yayatoh/virtual';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { VirtualPlayer } from '@/components/virtual/player.tsx';
import { pageLocale } from '@/server/locale.ts';
import { ports } from '@/server/ports.ts';
import { HEARTBEAT_URL } from '@/server/virtual.ts';
import { startPlaybackAction } from './actions.ts';

type Params = { params: Promise<{ locale: string; slug: string; ticket: string; session: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('virtual.watch');
  return { title: t('metaTitle'), robots: { index: false }, referrer: 'no-referrer' };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * One session's player (M6.9a) for a ticket holder: only a session this ticket may watch and
 * whose stream is on; anything else is a 404 (an in-person-only ticket has nothing listed).
 */
export default async function WatchSessionPage({ params }: Params) {
  const { locale, slug, ticket, session } = await params;
  pageLocale(locale);
  const token = decodeURIComponent(ticket);
  if (!UUID.test(session) || token.length > 200) notFound();
  const target = await checkoutTarget(slug);
  if (!target) notFound();
  const page = await executeQuery(
    viewerQuery,
    { eventId: target.eventId, ticketToken: token },
    createCtx({ orgId: target.orgId }),
    ports,
  ).catch((err) => {
    if (isDomainError(err)) return null;
    throw err;
  });
  const s = page?.sessions.find((x) => x.sessionId === session);
  if (!page || !s) notFound();
  return (
    <VirtualPlayer
      eventName={page.eventName}
      sessionTitle={s.title}
      backHref={`/events/${slug}/watch/${encodeURIComponent(token)}`}
      initialMinutes={s.minutes}
      heartbeatUrl={HEARTBEAT_URL}
      start={startPlaybackAction.bind(null, slug, token, session)}
    />
  );
}
