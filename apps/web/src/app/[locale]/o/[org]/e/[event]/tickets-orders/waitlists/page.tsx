import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { listWaitlistsQuery, waitlistEntriesQuery, waitlistExportBulk } from '@yayatoh/orders';
import type { BulkOperationDto } from '@yayatoh/platform';
import { roleCan } from '@yayatoh/tenancy';
import { Button, buttonClass, Card, EmptyState, PageHeader, Table } from '@yayatoh/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AutoRefresh } from '@/components/auto-refresh.tsx';
import { StepUpForm } from '@/components/step-up.tsx';
import { WaitlistRowAction, WaitlistSettingsForm } from '@/components/waitlist-console-forms.tsx';
import { Link } from '@/i18n/navigation.ts';
import { errorMessageKey } from '@/lib/errors.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import {
  exportWaitlistAction,
  offerEntryAction,
  removeEntryAction,
  updateWaitlistAction,
} from './actions.ts';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('waitlist.console');
  return { title: t('title') };
}

/**
 * Tickets & Orders → Waitlists (M3.10a): one list per pass and date with its counts; the chosen
 * list's people in line order with offer and remove, its settings (automatic offers, offer
 * window) and the CSV export (step-up). Buyer support only (`orders:support`); viewers get 404.
 */
export default async function WaitlistsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
  searchParams: Promise<{ list?: string; op?: string; exportError?: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const { data, event: ev } = await loadEvent(org, event, 'ticketsOrders');
  if (!roleCan(data.role, 'orders:support')) notFound();
  const t = await getTranslations('waitlist.console');
  const tb = await getTranslations('bulk');
  const n = new Intl.NumberFormat(locale);
  const lists = await executeQuery(listWaitlistsQuery, { eventId: ev.id }, data.ctx, ports);
  const chosen = lists.find((l) => l.id === sp.list) ?? lists[0] ?? null;
  const detail = chosen
    ? await executeQuery(waitlistEntriesQuery, { waitlistId: chosen.id }, data.ctx, ports)
    : null;
  const canExport = roleCan(data.role, 'attendees:export');
  let op: BulkOperationDto | null = null;
  if (canExport && sp.op && /^[0-9a-f-]{36}$/.test(sp.op)) {
    op = await executeQuery(waitlistExportBulk.status, { operationId: sp.op }, data.ctx, ports).catch(
      (err) => {
        if (isDomainError(err) && (err.code === 'not_found' || err.code === 'forbidden')) return null;
        throw err;
      },
    );
    if (op && op.eventId !== ev.id) op = null;
  }
  const opActive = op ? ['queued', 'running'].includes(op.status) : false;
  const base = `/o/${org}/e/${event}/tickets-orders/waitlists`;
  const when = new Intl.DateTimeFormat(locale, {
    timeZone: ev.timezone,
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
  const listName = (l: (typeof lists)[number]) =>
    l.dateStartsAt
      ? t('listNameDate', { pass: l.ticketTypeName, date: when.format(l.dateStartsAt) })
      : l.ticketTypeName;
  return (
    <>
      <PageHeader title={t('title')} description={t('description', { event: ev.name })} />
      <p>
        <Link href={`/o/${org}/e/${event}/tickets-orders`} className="text-body underline underline-offset-2">
          {t('back')}
        </Link>
      </p>
      {lists.length === 0 ? (
        <EmptyState title={t('emptyTitle')} description={t('empty')} />
      ) : (
        <>
          <Table
            caption={t('listsCaption')}
            rowKey={(l) => l.id}
            rows={lists}
            columns={[
              {
                key: 'name',
                header: t('columns.list'),
                cell: (l) => (
                  <Link
                    href={`${base}?list=${l.id}`}
                    aria-current={l.id === chosen?.id ? 'true' : undefined}
                    className="underline underline-offset-2"
                  >
                    {listName(l)}
                  </Link>
                ),
              },
              {
                key: 'waiting',
                header: t('columns.waiting'),
                cell: (l) => t('waitingCount', { people: l.waiting, places: l.waitingPlaces }),
                align: 'end',
              },
              {
                key: 'offered',
                header: t('columns.offered'),
                cell: (l) => n.format(l.offered),
                mono: true,
                align: 'end',
              },
              {
                key: 'accepted',
                header: t('columns.accepted'),
                cell: (l) => n.format(l.accepted),
                mono: true,
                align: 'end',
              },
              {
                key: 'expired',
                header: t('columns.expired'),
                cell: (l) => n.format(l.expired),
                mono: true,
                align: 'end',
              },
              {
                key: 'free',
                header: t('columns.free'),
                cell: (l) => n.format(l.free),
                mono: true,
                align: 'end',
              },
              {
                key: 'auto',
                header: t('columns.auto'),
                cell: (l) => (l.autoOffer ? t('autoOn') : t('autoPaused')),
              },
            ]}
          />
          {chosen && detail ? (
            <section aria-labelledby="list-heading" className="flex flex-col gap-4">
              <h2 id="list-heading" className="text-section">
                {listName(chosen)}
              </h2>
              <Card>
                <WaitlistSettingsForm
                  key={chosen.id}
                  action={updateWaitlistAction.bind(null, org, event, chosen.id)}
                  autoOffer={chosen.autoOffer}
                  offerHours={Math.round((chosen.offerMinutes / 60) * 100) / 100}
                />
              </Card>
              <Table
                caption={t('peopleCaption', { list: listName(chosen) })}
                rowKey={(e) => e.id}
                rows={detail.entries}
                empty={t('noPeople')}
                columns={[
                  {
                    key: 'position',
                    header: t('columns.position'),
                    cell: (e) => (e.position === null ? '' : n.format(e.position)),
                    mono: true,
                  },
                  {
                    key: 'name',
                    header: t('columns.name'),
                    cell: (e) => (
                      <span className="flex flex-col">
                        <span>{e.name}</span>
                        <span className="text-caption text-zinc-500">{e.email}</span>
                      </span>
                    ),
                  },
                  {
                    key: 'quantity',
                    header: t('columns.quantity'),
                    cell: (e) => n.format(e.quantity),
                    mono: true,
                    align: 'end',
                  },
                  {
                    key: 'status',
                    header: t('columns.status'),
                    cell: (e) =>
                      e.status === 'offered' && e.offerExpiresAt
                        ? t('offeredUntil', { until: when.format(e.offerExpiresAt) })
                        : t(`status.${e.status}`),
                  },
                  { key: 'joined', header: t('columns.joined'), cell: (e) => when.format(e.joinedAt) },
                  {
                    key: 'actions',
                    header: t('columns.actions'),
                    cell: (e) =>
                      e.status === 'waiting' || e.status === 'offered' ? (
                        <span className="flex flex-wrap gap-2">
                          {e.status === 'waiting' ? (
                            <WaitlistRowAction
                              action={offerEntryAction.bind(null, org, event, e.id)}
                              label={t('offerNow')}
                              srLabel={t('offerNowFor', { name: e.name })}
                            />
                          ) : null}
                          <WaitlistRowAction
                            action={removeEntryAction.bind(null, org, event, e.id)}
                            label={t('remove')}
                            srLabel={t('removeFor', { name: e.name })}
                          />
                        </span>
                      ) : null,
                  },
                ]}
              />
              {canExport && detail.entries.length > 0 ? (
                <StepUpForm
                  action={exportWaitlistAction.bind(null, org, event, chosen.id)}
                  className="flex flex-wrap gap-3"
                >
                  <Button type="submit" variant="secondary" size="sm">
                    {t('export')}
                  </Button>
                </StepUpForm>
              ) : null}
              {sp.exportError ? (
                <p
                  role="alert"
                  className="rounded-card border border-pink-700 bg-pink-50 px-4 py-3 text-body text-pink-700"
                >
                  {t('exportError', { reason: (await getTranslations())(errorMessageKey(sp.exportError)) })}
                </p>
              ) : null}
              {op ? (
                <section
                  aria-labelledby="export-heading"
                  className="flex flex-col gap-2 rounded-panel border border-zinc-200 bg-white px-5 py-4"
                >
                  {opActive ? <AutoRefresh seconds={2} /> : null}
                  <h3 id="export-heading" className="text-section">
                    {t('exportTitle')}
                  </h3>
                  <p className="text-body" role="status">
                    {op.status === 'done'
                      ? tb('exportDone', { succeeded: n.format(op.succeeded) })
                      : tb(`status.${op.status}`, {
                          processed: n.format(op.processed),
                          total: n.format(op.total),
                          succeeded: n.format(op.succeeded),
                          failed: n.format(op.failed),
                          undone: n.format(op.undone),
                        })}
                  </p>
                  {op.status === 'done' && op.hasFile ? (
                    <a
                      href={`${locale === 'en' ? '' : `/${locale}`}${base}/exports/${op.id}`}
                      className={buttonClass('primary', 'sm', 'self-start')}
                      download
                    >
                      {tb('download')}
                    </a>
                  ) : null}
                </section>
              ) : null}
            </section>
          ) : null}
        </>
      )}
    </>
  );
}
