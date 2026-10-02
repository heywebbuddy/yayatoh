import {
  mealCountsQuery,
  rsvpAnswersExportBulk,
  rsvpAnswersPrivateExportBulk,
  rsvpOverviewQuery,
} from '@yayatoh/guests';
import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { type BulkOperationDto, isProfileKey, navIncludes, PROFILES } from '@yayatoh/platform';
import { Button, buttonClass, Card, EmptyState, PageHeader } from '@yayatoh/ui';
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
import { exportAnswersAction } from './actions.ts';

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
      <PageHeader title={t('title')} description={t('subtitle')} />
      <nav aria-label={t('linksLabel')} className="flex flex-wrap gap-x-4">
        <Link href={`${base}/rsvp`} className="min-h-6 py-1 text-caption underline">
          {t('back')}
        </Link>
        <Link href={`${base}/questions`} className="min-h-6 py-1 text-caption underline">
          {t('questionsLink')}
        </Link>
      </nav>
      <p className="text-body text-zinc-700" data-testid="rsvp-responded">
        {t('responded', { responded, parties })}
      </p>

      <section aria-labelledby="ra-meals" className="flex flex-col gap-3">
        <h2 id="ra-meals" className="text-section">
          {t('mealsTitle')}
        </h2>
        {counts.menu.length === 0 ? (
          <EmptyState
            title={t('noMenuTitle')}
            description={t('noMenu')}
            action={
              <Link href={`${base}/questions`} className="min-h-6 py-1 text-caption underline">
                {t('questionsLink')}
              </Link>
            }
          />
        ) : counts.subEvents.length === 0 ? (
          <EmptyState
            title={t('noSubEventsTitle')}
            description={t('noSubEvents')}
            action={
              <Link href={`${base}/sub-events`} className="min-h-6 py-1 text-caption underline">
                {t('subEventsLink')}
              </Link>
            }
          />
        ) : (
          <>
            {counts.mealQuestion === null ? (
              <p className="text-body text-zinc-600">{t('noMealQuestion')}</p>
            ) : null}
            <div className="flex flex-col gap-3">
              {counts.subEvents.map((s) => (
                <Card key={s.subEventId} className="flex flex-col gap-2 overflow-x-auto">
                  <table className="w-full text-body" data-testid={`meal-counts-${s.subEventId}`}>
                    <caption className="pb-2 text-start text-section">
                      {t('mealsFor', { name: s.name, attending: s.attending })}
                    </caption>
                    <thead>
                      <tr className="border-b border-zinc-200 text-caption text-zinc-600">
                        <th scope="col" className="py-1 text-start font-normal">
                          {t('mealColumn')}
                        </th>
                        <th scope="col" className="py-1 text-end font-normal">
                          {t('guestsColumn')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {counts.menu.map((m) => (
                        <tr key={m.id} className="border-b border-zinc-100">
                          <th scope="row" className="py-1.5 text-start font-normal">
                            {m.label}
                            {m.notes ? (
                              <span className="block text-caption text-zinc-600">{m.notes}</span>
                            ) : null}
                          </th>
                          <td className="py-1.5 text-end tabular-nums">
                            {n(s.counts.find((c) => c.optionId === m.id)?.count ?? 0)}
                          </td>
                        </tr>
                      ))}
                      {s.other ? (
                        <tr className="border-b border-zinc-100">
                          <th scope="row" className="py-1.5 text-start font-normal">
                            {t('otherMeal')}
                          </th>
                          <td className="py-1.5 text-end tabular-nums">{n(s.other)}</td>
                        </tr>
                      ) : null}
                      <tr>
                        <th scope="row" className="py-1.5 text-start font-normal text-zinc-600">
                          {t('noMeal')}
                        </th>
                        <td className="py-1.5 text-end tabular-nums">{n(s.none)}</td>
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
        <h2 id="ra-export" className="text-section">
          {t('exportTitle')}
        </h2>
        {canExport ? (
          <>
            <p className="text-body text-zinc-600">{withPrivate ? t('exportPrivate') : t('exportBase')}</p>
            <StepUpForm action={exportAnswersAction.bind(null, org, event)} className="flex flex-wrap gap-3">
              <Button type="submit">{t('export')}</Button>
            </StepUpForm>
          </>
        ) : (
          <p className="text-body text-zinc-600">{t('exportNotAllowed')}</p>
        )}
        {sp.exportError ? (
          <p
            role="alert"
            className="rounded-card border border-pink-700 bg-pink-50 px-4 py-3 text-body text-pink-700"
          >
            {t('exportError', { reason: te(errorMessageKey(sp.exportError)) })}
          </p>
        ) : null}
        {op ? (
          <div className="flex flex-col gap-2 rounded-panel border border-zinc-200 bg-white px-5 py-4">
            {opActive ? <AutoRefresh seconds={2} /> : null}
            <p className="text-body" role="status">
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
      </section>
    </>
  );
}
