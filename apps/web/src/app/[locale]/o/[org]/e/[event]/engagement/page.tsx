import { ENGAGEMENT_KINDS, eventScoresQuery } from '@yayatoh/engagement';
import { executeQuery } from '@yayatoh/kernel';
import { buttonClass, Card, EmptyState, PageHeader, StatCard, Table } from '@yayatoh/ui';
import { ArrowLeft, Sparkles } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Crumbs } from '@/components/crumbs.tsx';
import { WeightsForm } from '@/components/engagement/weights-form.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { resetWeightsAction, saveWeightsAction } from './actions.ts';

type Params = { params: Promise<{ locale: string; org: string; event: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('engagement.scores');
  return { title: t('title') };
}

/**
 * Engagement scores of an event (M5.7b): the attendees who took part most (door scans, live polls
 * and Q&A, answered surveys, session enrollments × the org's weights), every session's score, and
 * the org's weights (owners and admins change them). Needs `attendees:read` (names and emails).
 */
export default async function EngagementPage({ params }: Params) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, event: ev, can } = await loadEvent(org, event, 'sessions');
  if (!can('attendees:read')) notFound();
  const t = await getTranslations('engagement.scores');
  const tr = await getTranslations();
  const r = await executeQuery(eventScoresQuery, { eventId: ev.id }, data.ctx, ports);
  const nf = new Intl.NumberFormat(locale);
  const when = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: ev.timezone,
  });
  const breakdown = (c: Record<string, number>) =>
    ENGAGEMENT_KINDS.filter((k) => c[k])
      .map((k) => t('countOf', { kind: t(`kinds.${k}`), count: c[k] ?? 0 }))
      .join(' · ');
  return (
    <>
      <PageHeader
        breadcrumb={
          <Crumbs
            items={[
              { label: data.org.name, href: `/o/${org}` },
              { label: ev.name, href: `/o/${org}/e/${event}` },
              { label: tr('nav.sessions'), href: `/o/${org}/e/${event}/sessions` },
              { label: t('title') },
            ]}
          />
        }
        title={t('title')}
        description={t('description', { event: ev.name })}
        actions={
          <Link href={`/o/${org}/e/${event}/sessions`} className={buttonClass('ghost')}>
            <ArrowLeft aria-hidden="true" className="rtl:-scale-x-100" />
            {t('back')}
          </Link>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard label={t('engaged')} value={nf.format(r.engaged)} testId="engaged-count" />
        <StatCard label={t('average')} value={nf.format(r.averageScore)} testId="average-score" />
      </div>
      <div className="flex flex-col gap-3">
        <h2 className="text-section">{t('attendeesTitle')}</h2>
        {r.attendees.length === 0 ? (
          <EmptyState
            icon={<Sparkles />}
            title={t('emptyTitle')}
            description={t('emptyHint')}
            action={
              <a href="#weights-heading" className={buttonClass('secondary', 'md')}>
                {t('weightsTitle')}
              </a>
            }
          />
        ) : (
          <Table
            caption={t('attendeesTitle')}
            rowKey={(a) => a.contactId}
            rows={r.attendees}
            stackOnPhone
            columns={[
              {
                key: 'name',
                header: t('attendee'),
                cell: (a) => (
                  <span className="flex flex-col">
                    <span className="font-medium">{a.name || a.email}</span>
                    <span className="text-caption text-ink-2">{a.email}</span>
                  </span>
                ),
              },
              { key: 'score', header: t('score'), align: 'end', cell: (a) => nf.format(a.score) },
              { key: 'breakdown', header: t('breakdown'), cell: (a) => breakdown(a.counts) },
            ]}
          />
        )}
      </div>
      <div className="flex flex-col gap-3">
        <h2 className="text-section">{t('sessionsTitle')}</h2>
        <Table
          caption={t('sessionsTitle')}
          rowKey={(s) => s.sessionId}
          rows={r.sessions}
          stackOnPhone
          empty={t('noSessions')}
          columns={[
            {
              key: 'title',
              header: t('session'),
              cell: (s) => (
                <span className="flex flex-col">
                  <span className="font-medium">{s.title}</span>
                  <span className="text-caption text-ink-2">{when.format(s.startsAt)}</span>
                </span>
              ),
            },
            {
              key: 'people',
              header: t('participants'),
              align: 'end',
              cell: (s) => nf.format(s.participants),
            },
            { key: 'score', header: t('score'), align: 'end', cell: (s) => nf.format(s.score) },
            { key: 'breakdown', header: t('breakdown'), cell: (s) => breakdown(s.counts) || '—' },
          ]}
        />
      </div>
      <section aria-labelledby="weights-heading" className="flex flex-col gap-3">
        <h2 id="weights-heading" className="text-section">
          {t('weightsTitle')}
        </h2>
        <Card className="flex flex-col gap-4">
          <p className="text-body text-ink-2">{t('formula')}</p>
          <WeightsForm
            weights={r.weights}
            custom={r.custom}
            canEdit={can('org:update')}
            save={saveWeightsAction.bind(null, org, event)}
            reset={resetWeightsAction.bind(null, org, event)}
          />
        </Card>
      </section>
    </>
  );
}
