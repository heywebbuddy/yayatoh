import { executeQuery } from '@yayatoh/kernel';
import { composeNav, isProfileKey } from '@yayatoh/platform';
import { eventSeatingQuery, listLayoutsQuery, planTablesQuery } from '@yayatoh/seating';
import { listTicketTypesQuery } from '@yayatoh/ticketing';
import { Button, Card, PageHeader, StatusDot } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { DateChartForm } from '@/components/date-chart-form.tsx';
import { LiveSeatCounts, SeatStatesProvider } from '@/components/seat-states.tsx';
import { SeatingDatePicker } from '@/components/seating-dates.tsx';
import { SeatingEditor } from '@/components/seating-editor.tsx';
import { SeatingTabs } from '@/components/seating-tabs.tsx';
import { SettingsForm } from '@/components/settings-form.tsx';
import { localizedPath } from '@/lib/seo/urls.ts';
import { loadEvent } from '@/server/console.ts';
import { mediaPanel } from '@/server/media.ts';
import { ports } from '@/server/ports.ts';
import { seatingDates } from '@/server/seating-dates.ts';
import {
  categoryAction,
  dateChartAction,
  publishSeatingAction,
  quickBuildAction,
  saveDocAction,
  saveTemplateAction,
  useLayoutAction,
} from './actions.ts';

const field = 'min-h-10 rounded-pill border border-zinc-200 bg-white px-4 text-body';
const STATUS_DOT = { draft: 'neutral', published: 'success', locked: 'info' } as const;

/** Seating (M1.7b): set up the event's floor plan, edit it, price it and put it on sale. */
export default async function SeatingPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const { locale, org, event } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const { data, event: ev, can } = await loadEvent(org, event, 'seating');
  const profile = isProfileKey(ev.profile) ? ev.profile : 'other';
  if (!composeNav(profile, data.modules).some((i) => i.path === 'seating')) notFound();
  const t = await getTranslations('seating');
  const canWrite = can('seating:write');
  // Per-date charts (M1.7g): `?date=` shows the chart that date uses.
  const { dates, date } = await seatingDates(data, ev.id, sp.date);
  const dateId = date?.id ?? null;
  const [seating, layouts, types] = await Promise.all([
    executeQuery(eventSeatingQuery, { eventId: ev.id, occurrenceId: dateId }, data.ctx, ports),
    executeQuery(listLayoutsQuery, { eventId: ev.id }, data.ctx, ports),
    executeQuery(listTicketTypesQuery, { eventId: ev.id }, data.ctx, ports),
  ]);
  const labelled = (id: string, label: string, control: React.ReactNode) => (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-caption text-zinc-600">
        {label}
      </label>
      {control}
    </div>
  );

  if (!seating)
    return (
      <>
        <PageHeader title={t('title')} description={t('description')} />
        {canWrite ? (
          <>
            <section aria-labelledby="quick-heading" className="flex flex-col gap-3">
              <h2 id="quick-heading" className="text-section">
                {t('quick.title')}
              </h2>
              <Card>
                <SettingsForm
                  action={quickBuildAction.bind(null, org, event)}
                  submitLabel={t('quick.submit')}
                  savedLabel={t('quick.done')}
                  className="grid grid-cols-2 gap-4 md:grid-cols-4"
                >
                  {labelled(
                    'q-rows',
                    t('quick.rows'),
                    <input
                      id="q-rows"
                      name="rows"
                      type="number"
                      min={0}
                      max={100}
                      defaultValue={10}
                      className={field}
                    />,
                  )}
                  {labelled(
                    'q-seats',
                    t('quick.seatsPerRow'),
                    <input
                      id="q-seats"
                      name="seatsPerRow"
                      type="number"
                      min={1}
                      max={200}
                      defaultValue={20}
                      className={field}
                    />,
                  )}
                  {labelled(
                    'q-tables',
                    t('quick.tables'),
                    <input
                      id="q-tables"
                      name="tables"
                      type="number"
                      min={0}
                      max={300}
                      defaultValue={0}
                      className={field}
                    />,
                  )}
                  {labelled(
                    'q-tseats',
                    t('quick.seatsPerTable'),
                    <input
                      id="q-tseats"
                      name="seatsPerTable"
                      type="number"
                      min={1}
                      max={20}
                      defaultValue={8}
                      className={field}
                    />,
                  )}
                  <label className="col-span-2 flex min-h-6 items-center gap-2 text-body md:col-span-4">
                    <input type="checkbox" name="stage" defaultChecked className="size-5" />
                    {t('quick.stage')}
                  </label>
                </SettingsForm>
              </Card>
            </section>
            {layouts.length ? (
              <section aria-labelledby="saved-heading" className="flex flex-col gap-3">
                <h2 id="saved-heading" className="text-section">
                  {t('saved.title')}
                </h2>
                <Card>
                  <SettingsForm
                    action={useLayoutAction.bind(null, org, event)}
                    submitLabel={t('saved.submit')}
                    savedLabel={t('quick.done')}
                  >
                    {labelled(
                      'saved-layout',
                      t('saved.layout'),
                      <select id="saved-layout" name="layoutId" className={field}>
                        {layouts.map((l) => (
                          <option key={l.id} value={l.id}>
                            {t('saved.option', { name: l.name, seats: l.seatCount })}
                          </option>
                        ))}
                      </select>,
                    )}
                  </SettingsForm>
                </Card>
              </section>
            ) : null}
          </>
        ) : (
          <p className="text-body text-zinc-600">{t('none')}</p>
        )}
      </>
    );

  const locked = seating.status === 'locked' || !canWrite;
  const base = `/o/${org}/e/${event}/seating`;
  const when = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: ev.timezone,
  });
  const tc = await getTranslations('seatingDates');
  const underlayTicket = canWrite ? (await mediaPanel(data, 'event', ev.id, 'floorplan')).ticket : null;
  const seatStatus = Object.fromEntries(seating.seats.map((s) => [s.seatUuid, s.state]));
  // M4.2b hosted tables: sponsors written on their tables (the event plan's table ids).
  const sponsors = Object.fromEntries(
    (await executeQuery(planTablesQuery, { eventId: ev.id }, data.ctx, ports)).flatMap((p) =>
      p.sponsor ? [[p.itemId, p.sponsor.sponsorName] as const] : [],
    ),
  );
  const priced = seating.seats.filter((s) => s.ticketTypeId).length;
  const items = seating.doc.items.filter((i) => i.kind !== 'object');
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <SeatingTabs base={base} active="plan" finder={data.modules.has('seat_finder')} date={dateId} />
      <SeatingDatePicker base={base} dates={dates} selected={dateId} timeZone={ev.timezone} locale={locale} />
      {date ? (
        <Card className="flex flex-col gap-3">
          <h2 className="text-section">{tc('dateTitle', { date: when.format(date.startsAt) })}</h2>
          <p className="text-body text-zinc-700" aria-live="polite" data-testid="date-chart-state">
            {seating.chart ? tc('ownChartBody') : tc('usesPlanBody')}
          </p>
          {canWrite && !date.cancelled ? (
            <DateChartForm
              key={seating.chart ? 'own' : 'plan'}
              action={dateChartAction.bind(null, org, event, date.id)}
              op={seating.chart ? 'remove' : 'give'}
            />
          ) : null}
        </Card>
      ) : dates.length ? (
        <p className="text-caption text-zinc-600">{tc('planBody')}</p>
      ) : null}
      {/* Live (M1.7f): counts and seat colours follow sales, holds and guests as they happen. */}
      <SeatStatesProvider
        url={localizedPath(locale, `/o/${org}/e/${event}/seating/stream${dateId ? `?date=${dateId}` : ''}`)}
        initialStates={seatStatus}
        initialCounts={seating.counts}
      >
        <Card className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <StatusDot status={STATUS_DOT[seating.status]} label={t(`status.${seating.status}`)} />
          <LiveSeatCounts />
          <span className="text-caption text-zinc-600">
            {t('priced', { priced, total: seating.seats.length })}
          </span>
          {seating.status === 'draft' && canWrite ? (
            <form action={publishSeatingAction.bind(null, org, event, dateId)} className="ms-auto">
              <Button type="submit" size="sm">
                {t('publish')}
              </Button>
            </form>
          ) : null}
        </Card>
        {seating.status === 'locked' ? <p className="text-caption text-zinc-600">{t('lockedNote')}</p> : null}

        <section aria-labelledby="editor-heading" className="flex flex-col gap-3">
          <h2 id="editor-heading" className="text-section">
            {t('editor.title')}
          </h2>
          <SeatingEditor
            initialDoc={seating.doc}
            seatStatus={seatStatus}
            locked={locked}
            saveDoc={saveDocAction.bind(null, org, event, dateId)}
            underlayTicket={underlayTicket}
            sponsors={sponsors}
          />
        </section>
      </SeatStatesProvider>

      {canWrite && items.length ? (
        <section aria-labelledby="prices-heading" className="flex flex-col gap-3">
          <h2 id="prices-heading" className="text-section">
            {t('prices.title')}
          </h2>
          <p className="text-body text-zinc-600">{t('prices.description')}</p>
          <Card>
            <SettingsForm
              action={categoryAction.bind(null, org, event, dateId)}
              submitLabel={t('prices.submit')}
              savedLabel={t('prices.done')}
            >
              <fieldset className="flex flex-wrap gap-x-4 gap-y-1.5">
                <legend className="mb-1.5 text-caption text-zinc-600">{t('prices.which')}</legend>
                {items.map((i) => (
                  <label key={i.id} className="flex min-h-6 items-center gap-2 text-body">
                    <input type="checkbox" name="itemId" value={i.id} className="size-5" />
                    {t(`prices.item.${i.kind}`, { label: i.label })}
                  </label>
                ))}
              </fieldset>
              {labelled(
                'prices-type',
                t('prices.ticketType'),
                <select id="prices-type" name="ticketTypeId" className={field}>
                  <option value="">{t('prices.offSale')}</option>
                  {types.map((tt) => (
                    <option key={tt.id} value={tt.id}>
                      {tt.name}
                    </option>
                  ))}
                </select>,
              )}
            </SettingsForm>
          </Card>
        </section>
      ) : null}

      {canWrite ? (
        <section aria-labelledby="template-heading" className="flex flex-col gap-3">
          <h2 id="template-heading" className="text-section">
            {t('template.title')}
          </h2>
          <Card>
            <SettingsForm
              action={saveTemplateAction.bind(null, org, event, seating.doc)}
              submitLabel={t('template.submit')}
              savedLabel={t('template.done')}
            >
              {labelled(
                'template-name',
                t('template.name'),
                <input id="template-name" name="name" required maxLength={120} className={field} />,
              )}
            </SettingsForm>
          </Card>
        </section>
      ) : null}
    </>
  );
}
