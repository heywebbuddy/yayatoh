import { participantState, publicLiveSession } from '@yayatoh/engagement';
import { checkoutTarget } from '@yayatoh/events';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ParticipantView } from '@/components/engagement/participant-view.tsx';
import { liveChannelUrl, participantKeyFor, participantName } from '@/server/engagement.ts';
import { pageLocale } from '@/server/locale.ts';
import { askAction, upvoteAction, voteAction } from './actions.ts';

type Params = { params: Promise<{ locale: string; slug: string; session: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('engagement.participant');
  return { title: t('metaTitle'), robots: { index: false } };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * A session's live polls and Q&A for its audience (M5.7a), phone first: from the public agenda or
 * the QR code on the big screen. Only published, public events whose session has live engagement
 * on; anything else is a 404. Approved questions and shown results only.
 */
export default async function LiveSessionPage({ params }: Params) {
  const { locale, slug, session } = await params;
  pageLocale(locale);
  if (!UUID.test(session)) notFound();
  const target = await checkoutTarget(slug);
  const live = target ? await publicLiveSession(target.orgId, target.eventId, session) : null;
  if (!target || !live) notFound();
  const key = await participantKeyFor(session);
  const me = key
    ? await participantState(target.orgId, session, key)
    : { votedPollIds: [], upvotedQuestionIds: [], pendingQuestions: 0 };
  return (
    <ParticipantView
      eventName={live.eventName}
      eventHref={`/events/${slug}`}
      sessionTitle={live.sessionTitle}
      initial={live.state}
      me={me}
      defaultName={await participantName()}
      streamUrl={liveChannelUrl(target.orgId, target.eventId, session)}
      vote={voteAction.bind(null, slug, session)}
      ask={askAction.bind(null, slug, session)}
      upvote={upvoteAction.bind(null, slug, session)}
    />
  );
}
