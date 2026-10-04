import { participantState, publicLiveSession } from '@yayatoh/engagement';
import { checkoutTarget } from '@yayatoh/events';
import { createCtx, executeQuery, isDomainError } from '@yayatoh/kernel';
import { feedbackPromptQuery } from '@yayatoh/surveys';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { FeedbackPrompt } from '@/components/engagement/feedback-prompt.tsx';
import { ParticipantView } from '@/components/engagement/participant-view.tsx';
import { localizedPath } from '@/lib/seo/urls.ts';
import { liveChannelUrl, participantKeyFor, participantName, viewerAccount } from '@/server/engagement.ts';
import { pageLocale } from '@/server/locale.ts';
import { ports } from '@/server/ports.ts';
import { askAction, openFeedbackAction, upvoteAction, voteAction } from './actions.ts';

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
  // M5.7b: once the session is over, its feedback survey (if any) asks the signed-in attendee.
  const account = await viewerAccount();
  const prompt = await executeQuery(
    feedbackPromptQuery,
    { eventId: target.eventId, sessionId: session, ...(account ? { account } : {}) },
    createCtx({
      orgId: target.orgId,
      ...(account ? { actor: { type: 'user' as const, userId: account.userId } } : {}),
    }),
    ports,
  ).catch((err) => {
    // An org without surveys (entitlement) simply has no prompt.
    if (isDomainError(err)) return null;
    throw err;
  });
  const here = localizedPath(locale, `/events/${slug}/live/${session}`);
  return (
    <ParticipantView
      feedback={
        prompt && prompt.state !== 'none' ? (
          <FeedbackPrompt
            state={prompt.state}
            title={prompt.title ?? ''}
            signInHref={`${localizedPath(locale, '/sign-in')}?next=${encodeURIComponent(here)}`}
            open={openFeedbackAction.bind(null, slug, session)}
          />
        ) : null
      }
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
