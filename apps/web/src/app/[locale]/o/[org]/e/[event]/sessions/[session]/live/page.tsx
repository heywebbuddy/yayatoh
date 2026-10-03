import { moderationQuery } from '@yayatoh/engagement';
import { executeQuery } from '@yayatoh/kernel';
import { qrPath } from '@yayatoh/pdf';
import { Button, EmptyState, PageHeader } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ModeratorConsole } from '@/components/engagement/moderator-console.tsx';
import { Link } from '@/i18n/navigation.ts';
import { appOrigin, displayToken, moderationChannelUrl, participantPath } from '@/server/engagement.ts';
import { ports } from '@/server/ports.ts';
import { loadProgramPage } from '@/server/program.ts';
import { createPollAction, enableLiveAction, moderatorAction, settingsAction } from './actions.ts';

type Params = { params: Promise<{ locale: string; org: string; event: string; session: string }> };

export async function generateMetadata() {
  const t = await getTranslations('engagement.moderator');
  return { title: t('metaTitle') };
}

/**
 * Polls and Q&A of one session (M5.7a), the moderator's view: the question queue (approve,
 * dismiss, answer, pin), polls (create, open, close, results, present), settings, and the links
 * to share (participant page with its QR code, presenter view, signed big-screen link). Viewers
 * see it all read-only.
 */
export default async function SessionLivePage({ params }: Params) {
  const { locale, org, event, session } = await params;
  setRequestLocale(locale);
  const { data, ev, program, canWrite } = await loadProgramPage(org, event, 'sessions');
  const s = program.sessions.find((x) => x.id === session);
  if (!s) notFound();
  const t = await getTranslations('engagement.moderator');
  const page = await executeQuery(moderationQuery, { eventId: ev.id, sessionId: s.id }, data.ctx, ports);
  const base = `/o/${org}/e/${event}/sessions/${s.id}/live`;
  const back = (
    <Link
      href={`/o/${org}/e/${event}/sessions`}
      className="inline-flex min-h-10 items-center underline underline-offset-2"
    >
      {t('back')}
    </Link>
  );
  if (!page.enabled || !page.settings || !page.state)
    return (
      <>
        <PageHeader title={t('title')} description={s.title} actions={back} />
        <EmptyState
          title={t('offTitle')}
          description={canWrite ? t('offDescription') : t('offViewer')}
          action={
            canWrite ? (
              <form action={enableLiveAction.bind(null, org, event, s.id)}>
                <Button type="submit">{t('enable')}</Button>
              </form>
            ) : undefined
          }
        />
      </>
    );
  const isPublic = ev.status === 'published' && ev.visibility !== 'private';
  const participantUrl = `${appOrigin()}${participantPath(ev.slug, s.id)}`;
  const qr = qrPath(participantUrl);
  const displayPath = canWrite
    ? `/display/${displayToken(data.ctx.orgId ?? '', s.id, page.settings.displayVersion)}`
    : null;
  return (
    <>
      <PageHeader
        title={t('title')}
        description={s.title}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href={`${base}/present`}
              className="inline-flex min-h-10 items-center underline underline-offset-2"
            >
              {t('presenterLink')}
            </Link>
            {back}
          </div>
        }
      />
      <ModeratorConsole
        canWrite={canWrite}
        initial={page.state}
        settings={page.settings}
        streamUrl={moderationChannelUrl(data.ctx.orgId ?? '', ev.id, s.id)}
        act={moderatorAction.bind(null, org, event, s.id)}
        createPoll={createPollAction.bind(null, org, event, s.id)}
        saveSettings={settingsAction.bind(null, org, event, s.id)}
        share={{
          isPublic,
          participantUrl,
          participantPath: participantPath(ev.slug, s.id),
          qr,
          displayPath,
          displayUrl: displayPath ? `${appOrigin()}${displayPath}` : null,
        }}
      />
    </>
  );
}
