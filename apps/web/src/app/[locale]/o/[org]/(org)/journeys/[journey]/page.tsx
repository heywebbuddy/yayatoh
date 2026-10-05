import { journeyQuery, journeyRunsQuery } from '@yayatoh/automations';
import { listSeriesQuery } from '@yayatoh/events';
import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { roleCan } from '@yayatoh/tenancy';
import { Alert, Button, buttonClass, Chip, EmptyState, PageHeader, Table } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { StepsEditor } from '@/components/journey-editor.tsx';
import { Link } from '@/i18n/navigation.ts';
import { formatNumber } from '@/lib/format.ts';
import { describeWait } from '@/lib/journeys.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { deleteJourneyAction, saveJourneyAction, setJourneyEnabledAction } from '../actions.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('journeys');
  return { title: t('title') };
}

const UUID = /^[0-9a-f-]{36}$/;
const ERRORS = ['no_steps', 'anchor_needs_trigger'] as const;

/** One journey: switch it on or off, its steps (editable while off) and its run history. */
export default async function JourneyPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string; journey: string }>;
  searchParams: Promise<{
    created?: string;
    saved?: string;
    enabled?: string;
    disabled?: string;
    error?: string;
    q?: string;
    before?: string;
  }>;
}) {
  const { locale, org, journey: journeyId } = await params;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  if (!data.modules.has('marketing') || !roleCan(data.role, 'marketing:read') || !UUID.test(journeyId))
    notFound();
  const sp = await searchParams;
  const t = await getTranslations('journeys');
  const q = typeof sp.q === 'string' ? sp.q.trim().slice(0, 200) : '';
  const before = sp.before && UUID.test(sp.before) ? sp.before : null;
  let j: Awaited<ReturnType<typeof load>>;
  try {
    j = await load(data, journeyId, q, before);
  } catch (err) {
    if (isDomainError(err) && err.code === 'not_found') notFound();
    throw err;
  }
  const { journey, runs, seriesName, timeZone } = j;
  const canWrite = roleCan(data.role, 'marketing:write');
  const at = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone });
  const nf = (n: number) => formatNumber(n, locale);
  const scope = journey.eventName ?? t('seriesScope', { name: seriesName ?? '' });
  const counts = (position: number) => journey.byStep.find((b) => b.position === position)?.counts;
  const error = ERRORS.find((e) => e === sp.error);
  const base = `/o/${org}/journeys/${journey.id}`;
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/o/${org}/journeys`} className="underline underline-offset-2">
            {t('title')}
          </Link>
        }
        title={journey.name}
        description={t('detail.summary', { scope, trigger: t(`triggers.${journey.trigger}`) })}
        actions={
          canWrite ? (
            <>
              <form action={setJourneyEnabledAction.bind(null, org, journey.id, !journey.enabled)}>
                <Button
                  type="submit"
                  variant={journey.enabled ? 'secondary' : 'primary'}
                  aria-label={t(journey.enabled ? 'detail.disableFor' : 'detail.enableFor', {
                    name: journey.name,
                  })}
                >
                  {t(journey.enabled ? 'detail.disable' : 'detail.enable')}
                </Button>
              </form>
              {!journey.enabled && journey.runs === 0 ? (
                <form action={deleteJourneyAction.bind(null, org, journey.id)}>
                  <Button
                    type="submit"
                    variant="ghost"
                    aria-label={t('detail.deleteFor', { name: journey.name })}
                  >
                    {t('detail.delete')}
                  </Button>
                </form>
              ) : null}
            </>
          ) : undefined
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={journey.enabled ? 'accent' : 'neutral'}>{journey.enabled ? t('on') : t('off')}</Chip>
        {journey.enabled && journey.enabledAt ? (
          <span className="text-caption text-ink-2">
            {t('detail.enabledSince', { when: at.format(journey.enabledAt) })}
          </span>
        ) : null}
      </div>
      <div aria-live="polite" className="flex flex-col gap-2">
        {sp.created ? <Alert tone="info" title={t('detail.created')} /> : null}
        {sp.saved ? <Alert tone="info" title={t('detail.saved')} /> : null}
        {sp.enabled ? <Alert tone="info" title={t('detail.enabledDone')} /> : null}
        {sp.disabled !== undefined ? (
          <Alert tone="info" title={t('detail.disabledDone', { count: Number(sp.disabled) || 0 })} />
        ) : null}
        {error ? <Alert title={t(`detail.errors.${error}`)} /> : null}
      </div>

      <section aria-labelledby="steps-heading" className="flex flex-col gap-3">
        <h2 id="steps-heading" className="text-section">
          {t('detail.stepsTitle')}
        </h2>
        {canWrite && !journey.enabled ? (
          <StepsEditor
            name={journey.name}
            trigger={journey.trigger}
            steps={journey.steps}
            action={saveJourneyAction.bind(null, org, journey.id)}
          />
        ) : (
          <>
            {canWrite ? <p className="text-body text-ink-2">{t('detail.editOff')}</p> : null}
            {journey.steps.length === 0 ? (
              <p className="text-body text-ink-2">{t('detail.noSteps')}</p>
            ) : (
              <ol className="flex flex-col gap-2" aria-label={t('detail.stepsTitle')}>
                {journey.steps.map((s, i) => {
                  const c = counts(s.position);
                  return (
                    <li
                      key={s.id}
                      className="flex flex-col gap-1 rounded-card border border-line bg-surface p-4"
                    >
                      <p className="text-body font-medium">
                        {t('editor.step', { n: i + 1 })} · {t(`editor.actions.${s.action}`)}
                        {s.action === 'label' && s.label ? ` “${s.label}”` : ''}
                      </p>
                      <p className="text-caption text-ink-2">
                        {describeWait(t, locale, s)}
                        {s.condition ? ` · ${t(`editor.conditions.${s.condition}`)}` : ''}
                      </p>
                      {s.subject ? <p className="text-caption text-ink-2">{s.subject}</p> : null}
                      <p className="text-caption text-ink-2">
                        {t('detail.stepCounts', {
                          done: nf(c?.done ?? 0),
                          pending: nf(c?.pending ?? 0),
                          skipped: nf((c?.skipped ?? 0) + (c?.cancelled ?? 0) + (c?.failed ?? 0)),
                        })}
                      </p>
                    </li>
                  );
                })}
              </ol>
            )}
          </>
        )}
      </section>

      <section aria-labelledby="history-heading" className="flex flex-col gap-3">
        <h2 id="history-heading" className="text-section">
          {t('history.title')}
        </h2>
        <search aria-label={t('history.searchLabel')}>
          <form method="get" className="flex flex-wrap items-end gap-2">
            <div className="min-w-56 flex-1">
              <label htmlFor="journey-q" className="text-[13px] font-bold text-ink">
                {t('history.searchLabel')}
              </label>
              <input
                id="journey-q"
                name="q"
                type="search"
                defaultValue={q}
                maxLength={200}
                className="field w-full"
              />
            </div>
            <Button type="submit" variant="secondary">
              {t('history.search')}
            </Button>
            {q ? (
              <Link href={base} className={buttonClass('ghost')}>
                {t('history.clear')}
              </Link>
            ) : null}
          </form>
        </search>
        {runs.rows.length === 0 ? (
          <EmptyState
            title={q ? t('history.emptySearch', { q }) : t('history.empty')}
            description={t('history.emptyDescription')}
            action={
              q ? (
                <Link href={base} className={buttonClass('secondary', 'md')}>
                  {t('history.showEveryone')}
                </Link>
              ) : (
                <Link href="#steps-heading" className={buttonClass('secondary', 'md')}>
                  {t('history.reviewSteps')}
                </Link>
              )
            }
          />
        ) : (
          <Table
            caption={t('history.caption')}
            rowKey={(r) => r.id}
            rows={runs.rows}
            columns={[
              {
                key: 'person',
                header: t('history.person'),
                cell: (r) => (
                  <Link href={`${base}/runs/${r.id}`} className="underline underline-offset-2">
                    <bdi>{r.name || r.email || t('history.unknown')}</bdi>
                  </Link>
                ),
              },
              { key: 'email', header: t('history.email'), cell: (r) => <bdi>{r.email ?? '—'}</bdi> },
              { key: 'joined', header: t('history.joined'), cell: (r) => at.format(r.triggeredAt) },
              { key: 'status', header: t('history.status'), cell: (r) => t(`history.runStatus.${r.status}`) },
              {
                key: 'progress',
                header: t('history.progress'),
                cell: (r) =>
                  t('history.progressCounts', {
                    done: nf(r.counts.done),
                    total: nf(Object.values(r.counts).reduce((s, n) => s + n, 0)),
                  }),
              },
              { key: 'next', header: t('history.next'), cell: (r) => (r.nextAt ? at.format(r.nextAt) : '—') },
            ]}
          />
        )}
        {runs.nextBefore ? (
          <div>
            <Link
              href={`${base}?${new URLSearchParams({ ...(q ? { q } : {}), before: runs.nextBefore })}`}
              className={buttonClass('secondary', 'sm')}
            >
              {t('history.older')}
            </Link>
          </div>
        ) : null}
      </section>
    </>
  );
}

async function load(
  data: Awaited<ReturnType<typeof loadConsole>>,
  journeyId: string,
  q: string,
  before: string | null,
) {
  const journey = await executeQuery(journeyQuery, { journeyId }, data.ctx, ports);
  const runs = await executeQuery(journeyRunsQuery, { journeyId, q: q || null, before }, data.ctx, ports);
  const seriesName = journey.seriesId
    ? ((await executeQuery(listSeriesQuery, {}, data.ctx, ports)).find((s) => s.id === journey.seriesId)
        ?.name ?? null)
    : null;
  // Times show in the event's zone (series journeys: the org's).
  return { journey, runs, seriesName, timeZone: journey.timeZone ?? data.org.timezone };
}
