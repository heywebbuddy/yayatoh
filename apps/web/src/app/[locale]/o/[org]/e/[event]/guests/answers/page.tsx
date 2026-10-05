import {
  mealCountsQuery,
  rsvpAnswersExportBulk,
  rsvpAnswersPrivateExportBulk,
  rsvpOverviewQuery,
} from '@yayatoh/guests';
import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { type BulkOperationDto, isProfileKey, navIncludes, navLabelKey, PROFILES } from '@yayatoh/platform';
import { Alert, Button, buttonClass, Card, CardHeader, EmptyState, PageHeader } from '@yayatoh/ui';
import { Download } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AutoRefresh } from '@/components/auto-refresh.tsx';
import { StepUpForm } from '@/components/step-up.tsx';
import { Link } from '@/i18n/navigation.ts';
import { errorMessageKey } from '@/lib/errors.ts';
import { formatNumber } from '@/lib/format.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { GuestsCrumbs, RsvpTabs } from '../rsvp/nav.tsx';
import { exportAnswersAction } from './actions.ts';

const HEAD = 'px-1 py-2 text-label tracking-[0.06em] text-ink-2 uppercase';
const CELL = 'px-1 py-2.5 align-top tabular-nums';
const ROW = 'border-b border-line last:border-0';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('rsvpAnswers');
  return { title: t('title') };
}

/**
 * RSVP answers (M4.1e): meal counts per sub-event (attending guests by meal) and the answers
 * export (CSV, step-up; private columns only for members allowed to see them). Viewers see the
 * counts; the export needs `attendees:export`.
 */
export default async function RsvpAnswersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
  searchParams: Promise<{ op?: string; exportError?: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, event: ev, can } = await loadEvent(org, event, 'guests');
  const profile = isProfileKey(ev.profile) ? ev.profile : 'other';
  const nav = PROFILES[profile].nav.find((i) => i.key === 'guests');
  if (!nav || !navIncludes(profile, data.modules, 'guests') || !can('guests:read')) notFound();
  const sp = await searchParams;
  const t = await getTranslations('rsvpAnswers');
  const tb = await getTranslations('bulk');
  const te = await getTranslations();
  const canExport = can('attendees:export');
  const withPrivate = can('attendees:export_private');
  const [counts, ov] = await Promise.all([
    executeQuery(mealCountsQuery, { eventId: ev.id }, data.ctx, ports),
    executeQuery(rsvpOverviewQuery, { eventId: ev.id }, data.ctx, ports),
  ]);
  const n = (v: number) => formatNumber(v, locale);
  const base = `/o/${org}/e/${event}/guests`;
  let op: BulkOperationDto | null = null;
  if (canExport && sp.op && /^[0-9a-f-]{36}$/.test(sp.op)) {
    const bulk = withPrivate ? rsvpAnswersPrivateExportBulk : rsvpAnswersExportBulk;
    op = await executeQuery(bulk.status, { operationId: sp.op }, data.ctx, ports).catch((err) => {
      if (isDomainError(err)) return null;
      throw err;
    });
    if (op && op.eventId !== ev.id) op = null;
  }
  const opActive = op ? ['queued', 'running'].includes(op.status) : false;
  const responded = ov.states.responded ?? 0;
  const parties = Object.values(ov.states).reduce((a, b) => a + b, 0);

  return (
    <>
      <PageHeader
        breadcrumb={
          <GuestsCrumbs
            org={org}
            event={event}
            orgName={data.org.name}
            eventName={ev.name}
            guestsLabel={te(navLabelKey(profile, nav))}
            trail={[{ label: t('title') }]}
          />
        }
        title={t('title')}
        description={t('subtitle')}
        meta={
          <span className="font-semibold tabular-nums" data-testid="rsvp-responded">
            {t('responded', { responded, parties })}
          </span>
        }
      />
      <RsvpTabs org={org} event={event} current="answers" />

      <section aria-labelledby="ra-meals" className="flex flex-col gap-3">
        <h2 id="ra-meals" className="m-0 text-section text-ink">
          {t('mealsTitle')}
        </h2>
        {counts.menu.length === 0 ? (
          <EmptyState
            title={t('noMenuTitle')}
            description={t('noMenu')}
            action={
              <Link href={`${base}/questions`} className={buttonClass('secondary')}>
                {t('questionsLink')}
              </Link>
            }
          />
        ) : counts.subEvents.length === 0 ? (
          <EmptyState
            title={t('noSubEventsTitle')}
            description={t('noSubEvents')}
            action={
              <Link href={`${base}/sub-events`} className={buttonClass('secondary')}>
                {t('subEventsLink')}
              </Link>
            }
          />
        ) : (
          <>
            {counts.mealQuestion === null ? <Alert tone="info" title={t('noMealQuestion')} /> : null}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {counts.subEvents.map((s) => (
                <Card key={s.subEventId} size="panel" className="overflow-x-auto">
                  <table
                    className="w-full border-collapse text-body"
                    data-testid={`meal-counts-${s.subEventId}`}
                  >
                    <caption className="pb-3 text-start text-card text-ink">
                      {t('mealsFor', { name: s.name, attending: s.attending })}
                    </caption>
                    <thead>
                      <tr className="border-b border-line">
                        <th scope="col" className={`${HEAD} text-start`}>
                          {t('mealColumn')}
                        </th>
                        <th scope="col" className={`${HEAD} text-end`}>
                          {t('guestsColumn')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {counts.menu.map((m) => (
                        <tr key={m.id} className={ROW}>
                          <th scope="row" className={`${CELL} text-start font-bold text-ink`}>
                            {m.label}
                            {m.notes ? (
                              <span className="block text-caption font-medium text-ink-2">{m.notes}</span>
                            ) : null}
                          </th>
                          <td className={`${CELL} text-end text-[16px] font-extrabold text-ink`}>
                            {n(s.counts.find((c) => c.optionId === m.id)?.count ?? 0)}
                          </td>
                        </tr>
                      ))}
                      {s.other ? (
                        <tr className={ROW}>
                          <th scope="row" className={`${CELL} text-start font-bold text-ink`}>
                            {t('otherMeal')}
                          </th>
                          <td className={`${CELL} text-end text-[16px] font-extrabold text-ink`}>
                            {n(s.other)}
                          </td>
                        </tr>
                      ) : null}
                      <tr className={ROW}>
                        <th scope="row" className={`${CELL} text-start font-semibold text-ink-2`}>
                          {t('noMeal')}
                        </th>
                        <td className={`${CELL} text-end font-bold text-ink-2`}>{n(s.none)}</td>
                      </tr>
                    </tbody>
                  </table>
                </Card>
              ))}
            </div>
          </>
        )}
      </section>

      <section aria-labelledby="ra-export" className="flex flex-col gap-3">
        <Card size="panel" className="flex flex-col gap-3">
          <CardHeader id="ra-export" title={t('exportTitle')} />
          {canExport ? (
            <>
              <p className="m-0 text-body text-ink-2">{withPrivate ? t('exportPrivate') : t('exportBase')}</p>
              <StepUpForm
                action={exportAnswersAction.bind(null, org, event)}
                className="flex flex-wrap gap-3"
              >
                <Button
                  type="submit"
                  variant="secondary"
                  icon={<Download aria-hidden="true" strokeWidth={2} />}
                >
                  {t('export')}
                </Button>
              </StepUpForm>
            </>
          ) : (
            <Alert tone="info" title={t('exportNotAllowed')} />
          )}
          {sp.exportError ? (
            <Alert title={t('exportError', { reason: te(errorMessageKey(sp.exportError)) })} />
          ) : null}
          {op ? (
            <div className="flex flex-col gap-2 rounded-tile border border-line bg-surface-2 px-4 py-3">
              {opActive ? <AutoRefresh seconds={2} /> : null}
              <p className="m-0 text-body text-ink" role="status">
                {op.status === 'done'
                  ? tb('exportDone', { succeeded: n(op.succeeded) })
                  : tb(`status.${op.status}`, {
                      processed: n(op.processed),
                      total: n(op.total),
                      succeeded: n(op.succeeded),
                      failed: n(op.failed),
                      undone: n(op.undone),
                    })}
              </p>
              {op.status === 'done' && op.hasFile ? (
                <a
                  href={`${locale === 'en' ? '' : `/${locale}`}${base}/answers/exports/${op.id}`}
                  className={buttonClass('primary', 'sm', 'self-start')}
                  download
                >
                  {tb('download')}
                </a>
              ) : null}
            </div>
          ) : null}
        </Card>
      </section>
    </>
  );
}
