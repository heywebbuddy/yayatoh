import { journeyQuery, journeyRunQuery } from '@yayatoh/automations';
import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { roleCan } from '@yayatoh/tenancy';
import { Chip, PageHeader, Table } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { describeWait, outcomeKey } from '@/lib/journeys.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('journeys');
  return { title: t('run.metaTitle') };
}

const UUID = /^[0-9a-f-]{36}$/;

/** One person's way through a journey (M3.7a run history per person): every step and what it did. */
export default async function JourneyRunPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; journey: string; run: string }>;
}) {
  const { locale, org, journey: journeyId, run: runId } = await params;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  if (
    !data.modules.has('marketing') ||
    !roleCan(data.role, 'marketing:read') ||
    !UUID.test(journeyId) ||
    !UUID.test(runId)
  )
    notFound();
  const t = await getTranslations('journeys');
  let loaded: [Awaited<ReturnType<typeof getJourney>>, Awaited<ReturnType<typeof getRun>>];
  try {
    loaded = await Promise.all([getJourney(data, journeyId), getRun(data, journeyId, runId)]);
  } catch (err) {
    if (isDomainError(err) && err.code === 'not_found') notFound();
    throw err;
  }
  const [journey, { run, actions }] = loaded;
  const at = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: journey.timeZone ?? data.org.timezone,
  });
  const stepAt = new Map(journey.steps.map((s) => [s.position, s]));
  const person = run.name || run.email || t('history.unknown');
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/o/${org}/journeys/${journey.id}`} className="underline underline-offset-2">
            {journey.name}
          </Link>
        }
        title={<bdi>{person}</bdi>}
        description={run.email && run.name ? <bdi>{run.email}</bdi> : undefined}
      />
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-caption text-zinc-500">{t('run.event')}</dt>
          <dd className="text-body">{run.eventName}</dd>
        </div>
        <div>
          <dt className="text-caption text-zinc-500">{t('run.trigger')}</dt>
          <dd className="text-body">{t(`triggers.${run.trigger}`)}</dd>
        </div>
        <div>
          <dt className="text-caption text-zinc-500">{t('history.joined')}</dt>
          <dd className="text-body">{at.format(run.triggeredAt)}</dd>
        </div>
        <div>
          <dt className="text-caption text-zinc-500">{t('history.status')}</dt>
          <dd className="text-body">
            <Chip tone={run.status === 'active' ? 'accent' : 'neutral'}>
              {t(`history.runStatus.${run.status}`)}
            </Chip>
            {run.reason ? (
              <span className="ms-2 text-caption text-zinc-500">{t(outcomeKey(run.reason))}</span>
            ) : null}
          </dd>
        </div>
      </dl>
      <Table
        caption={t('run.caption')}
        captionHidden={false}
        rowKey={(r) => r.id}
        rows={actions}
        columns={[
          {
            key: 'step',
            header: t('run.step'),
            cell: (r) => {
              const s = stepAt.get(r.position);
              return (
                <span className="flex flex-col">
                  <span>
                    {t('editor.step', { n: r.position + 1 })} · {t(`editor.actions.${r.action}`)}
                  </span>
                  {s ? (
                    <span className="text-caption text-zinc-500">{describeWait(t, locale, s)}</span>
                  ) : null}
                </span>
              );
            },
          },
          { key: 'planned', header: t('run.planned'), cell: (r) => at.format(r.scheduledFor) },
          { key: 'status', header: t('history.status'), cell: (r) => t(`run.actionStatus.${r.status}`) },
          {
            key: 'result',
            header: t('run.result'),
            cell: (r) => (r.outcome ? t(outcomeKey(r.outcome)) : '—'),
          },
          { key: 'at', header: t('run.at'), cell: (r) => (r.completedAt ? at.format(r.completedAt) : '—') },
        ]}
      />
    </>
  );
}

const getJourney = (data: Awaited<ReturnType<typeof loadConsole>>, journeyId: string) =>
  executeQuery(journeyQuery, { journeyId }, data.ctx, ports);
const getRun = (data: Awaited<ReturnType<typeof loadConsole>>, journeyId: string, runId: string) =>
  executeQuery(journeyRunQuery, { journeyId, runId }, data.ctx, ports);
