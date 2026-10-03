import { listOccurrencesQuery, listSeriesQuery, type OccurrenceDto } from '@yayatoh/events';
import { executeQuery, utcToZonedInput } from '@yayatoh/kernel';
import { roleCan } from '@yayatoh/tenancy';
import { occurrenceSalesQuery } from '@yayatoh/ticketing';
import { Alert, Button, buttonClass, Card, EmptyState, PageHeader, StatusDot, Table } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AddDateForm, EditDateForm, RecurrenceForm, SeriesPicker } from '@/components/date-forms.tsx';
import { Link } from '@/i18n/navigation.ts';
import { formatNumber } from '@/lib/format.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import {
  addDateAction,
  cancelDateAction,
  recurrenceAction,
  setSeriesAction,
  updateDateAction,
} from './actions.ts';

/**
 * M1.4b: an event's dates (one by one or from a repeating schedule), editing one or this and
 * following, cancelling with its impact, and the event's series. Times are in the event's zone.
 */
export default async function DatesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
  searchParams: Promise<{ edit?: string; cancel?: string; cancelled?: string }>;
}) {
  const { locale, org, event } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const { data, event: ev, can } = await loadEvent(org, event, 'dates');
  const t = await getTranslations();
  const canWrite = can('events:write');
  const dates = await executeQuery(listOccurrencesQuery, { eventId: ev.id }, data.ctx, ports);
  const ticketing = data.modules.has('ticketing');
  const sold = new Map(
    ticketing
      ? (await executeQuery(occurrenceSalesQuery, { eventId: ev.id }, data.ctx, ports)).map((s) => [
          s.occurrenceId,
          s.activeTickets,
        ])
      : [],
  );
  // Series are org-level: a co-host (event role only) sees this event's dates without them.
  const series = roleCan(data.role, 'events:read')
    ? await executeQuery(listSeriesQuery, {}, data.ctx, ports)
    : [];
  const currentSeries = series.find((s) => s.eventIds.includes(ev.id))?.id ?? null;
  const base = `/o/${org}/e/${event}`;
  const when = new Intl.DateTimeFormat(locale, {
    timeZone: ev.timezone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  const label = (o: Pick<OccurrenceDto, 'startsAt' | 'endsAt'>) => when.formatRange(o.startsAt, o.endsAt);
  const zone = ev.timezone.replace(/_/g, ' ');
  const editing = canWrite ? dates.find((d) => d.id === sp.edit && d.status === 'scheduled') : undefined;
  const cancelling = canWrite ? dates.find((d) => d.id === sp.cancel && d.status === 'scheduled') : undefined;
  const local = (d: Date) => utcToZonedInput(d, ev.timezone);
  const startLocal = local(ev.startsAt);

  return (
    <>
      <PageHeader title={t('dates.title')} description={t('dates.description', { timezone: zone })} />
      {sp.cancelled ? <Alert tone="info" title={t('dates.cancelled')} /> : null}

      {cancelling ? (
        <section aria-labelledby="cancel-heading">
          <Card className="flex flex-col gap-3">
            <h2 id="cancel-heading" className="text-section">
              {t('dates.cancelTitle', { date: label(cancelling) })}
            </h2>
            <p role="status" className="text-body">
              {t('dates.cancelImpact', { count: sold.get(cancelling.id) ?? 0 })}
            </p>
            <p className="text-body text-ink-2">{t('dates.cancelRefunds')}</p>
            <div className="flex flex-wrap gap-2">
              <form action={cancelDateAction.bind(null, org, event, cancelling.id)}>
                <Button type="submit">{t('dates.confirmCancel')}</Button>
              </form>
              {ticketing && can('orders:read') ? (
                <Link href={`${base}/tickets-orders#orders-heading`} className={buttonClass('secondary')}>
                  {t('dates.reviewOrders')}
                </Link>
              ) : null}
              <Link href={`${base}/dates`} className={buttonClass('ghost')}>
                {t('dates.keep')}
              </Link>
            </div>
          </Card>
        </section>
      ) : null}

      {editing ? (
        <section aria-labelledby="edit-heading">
          <Card className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="edit-heading" className="text-section">
                {t('dates.editTitle', { date: label(editing) })}
              </h2>
              <Link href={`${base}/dates`} className={buttonClass('ghost', 'sm')}>
                {t('dates.closeEdit')}
              </Link>
            </div>
            <EditDateForm
              // One form per date: its typed values and result never carry over to another date.
              key={editing.id}
              action={updateDateAction.bind(null, org, event, editing.id)}
              defaults={{
                startsAt: local(editing.startsAt),
                endsAt: local(editing.endsAt),
                capacity: editing.capacity,
              }}
              canFollow={dates.some((d) => d.status === 'scheduled' && d.startsAt > editing.startsAt)}
            />
          </Card>
        </section>
      ) : null}

      {dates.length === 0 ? (
        <EmptyState title={t('dates.emptyTitle')} description={t('dates.single', { range: label(ev) })} />
      ) : (
        <Table
          caption={t('dates.listCaption', { count: dates.length })}
          rowKey={(r) => r.id}
          rows={dates}
          columns={[
            { key: 'when', header: t('dates.when'), cell: (r) => label(r) },
            {
              key: 'capacity',
              header: t('dates.capacity'),
              cell: (r) => (r.capacity === null ? t('dates.noLimit') : formatNumber(r.capacity, locale)),
              mono: true,
              align: 'end',
            },
            ...(ticketing
              ? [
                  {
                    key: 'sold',
                    header: t('dates.sold'),
                    cell: (r: OccurrenceDto) => formatNumber(sold.get(r.id) ?? 0, locale),
                    mono: true,
                    align: 'end' as const,
                  },
                ]
              : []),
            {
              key: 'status',
              header: t('dates.status'),
              cell: (r) => (
                <StatusDot
                  status={r.status === 'cancelled' ? 'danger' : 'success'}
                  label={t(`dates.statuses.${r.status}`)}
                />
              ),
            },
            ...(canWrite
              ? [
                  {
                    key: 'actions',
                    header: t('dates.actions'),
                    align: 'end' as const,
                    cell: (r: OccurrenceDto) =>
                      r.status === 'scheduled' ? (
                        <span className="flex justify-end gap-1">
                          <Link
                            href={`${base}/dates?edit=${r.id}`}
                            className={buttonClass('ghost', 'sm')}
                            aria-label={t('dates.editFor', { date: label(r) })}
                          >
                            {t('dates.edit')}
                          </Link>
                          <Link
                            href={`${base}/dates?cancel=${r.id}`}
                            className={buttonClass('ghost', 'sm')}
                            aria-label={t('dates.cancelFor', { date: label(r) })}
                          >
                            {t('dates.cancel')}
                          </Link>
                        </span>
                      ) : null,
                  },
                ]
              : []),
          ]}
        />
      )}

      {canWrite ? (
        <>
          <section aria-labelledby="add-date-heading" className="flex flex-col gap-3">
            <h2 id="add-date-heading" className="text-section">
              {t('dates.addOne')}
            </h2>
            <Card>
              <AddDateForm action={addDateAction.bind(null, org, event)} />
            </Card>
          </section>
          <section aria-labelledby="repeat-heading" className="flex flex-col gap-3">
            <h2 id="repeat-heading" className="text-section">
              {t('dates.repeat')}
            </h2>
            <p className="text-body text-ink-2">{t('dates.repeatHint', { timezone: zone })}</p>
            <Card>
              <RecurrenceForm
                action={recurrenceAction.bind(null, org, event)}
                defaults={{
                  startDate: startLocal.slice(0, 10),
                  startTime: startLocal.slice(11, 16),
                  endTime: local(ev.endsAt).slice(11, 16),
                  weekday: ((new Date(`${startLocal.slice(0, 10)}T00:00:00Z`).getUTCDay() + 6) % 7) + 1,
                }}
              />
            </Card>
          </section>
        </>
      ) : null}

      <section aria-labelledby="series-heading" className="flex flex-col gap-3">
        <h2 id="series-heading" className="text-section">
          {t('dates.series')}
        </h2>
        <p className="text-body text-ink-2">{t('dates.seriesHint')}</p>
        <Card className="flex flex-col gap-3">
          {canWrite ? (
            <SeriesPicker
              action={setSeriesAction.bind(null, org, event)}
              series={series.map((s) => ({ id: s.id, name: s.name }))}
              current={currentSeries}
            />
          ) : (
            <p className="text-body">
              {series.find((s) => s.id === currentSeries)?.name ?? t('dates.noSeries')}
            </p>
          )}
          <Link href={`/o/${org}/series`} className="self-start text-caption text-ink-2 underline">
            {t('dates.manageSeries')}
          </Link>
        </Card>
      </section>
    </>
  );
}
