import { executeQuery } from '@yayatoh/kernel';
import { listMediaQuery } from '@yayatoh/media';
import { hostedTablesQuery } from '@yayatoh/orders';
import { planTablesQuery } from '@yayatoh/seating';
import { listTicketTypesQuery } from '@yayatoh/ticketing';
import { Card, EmptyState, PageHeader, StatusDot, Table } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ActionButton, NameGuestForm, SponsorForm } from '@/components/gala-tables.tsx';
import { Link } from '@/i18n/navigation.ts';
import { formatNumber } from '@/lib/format.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import {
  hostNameGuestAction,
  removeSponsorAction,
  sendRemindersAction,
  setSponsorAction,
} from './actions.ts';

/**
 * M4.2b Tables & Sponsors (gala): the tables buyers purchased (sponsor or company, size, seats
 * named, names missing) with manual naming and naming reminders; and the floor plan's tables
 * with their sponsors (name, optional logo, shown to guests or not).
 */
export default async function TablesSponsorsPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, event: ev, can } = await loadEvent(org, event, 'tablesSponsors');
  if (!can('tables:read')) notFound();
  const t = await getTranslations('galaTables');
  const tn = await getTranslations();
  const canName = can('tables:write');
  const canSponsor = can('seating:write');
  const [tables, planTables, types, images] = await Promise.all([
    executeQuery(hostedTablesQuery, { eventId: ev.id }, data.ctx, ports),
    executeQuery(planTablesQuery, { eventId: ev.id }, data.ctx, ports),
    executeQuery(listTicketTypesQuery, { eventId: ev.id }, data.ctx, ports),
    canSponsor
      ? executeQuery(listMediaQuery, { ownerType: 'event', ownerId: ev.id }, data.ctx, ports)
      : Promise.resolve([]),
  ]);
  const tableTypes = types.filter((x) => x.tableSize !== null && x.archivedAt === null);
  const logos = images.flatMap((img, i) => {
    const v = img.variants.find((x) => x.fallback) ?? img.variants[0];
    return v ? [{ url: v.url, label: img.alt || t('imageN', { n: i + 1 }) }] : [];
  });
  const missing = tables.reduce((n, x) => n + x.missing, 0);
  const tableName = (x: (typeof tables)[number]) =>
    t('tableName', { table: x.typeName, n: x.unitNo, who: x.company ?? x.buyerName });
  return (
    <>
      <PageHeader title={tn('nav.tablesSponsors')} description={t('console.description')} />
      {canName && missing > 0 ? (
        <section aria-labelledby="reminders-heading" className="flex flex-col gap-2">
          <h2 id="reminders-heading" className="sr-only">
            {t('reminders.title')}
          </h2>
          <ActionButton
            action={sendRemindersAction.bind(null, org, event)}
            label={t('reminders.send')}
            variant="primary"
            done="reminders"
          />
          <p className="text-caption text-zinc-500">{t('reminders.hint')}</p>
        </section>
      ) : null}

      <section aria-labelledby="sold-heading" className="flex flex-col gap-3">
        <h2 id="sold-heading" className="text-section">
          {t('console.soldTitle')}
        </h2>
        {tables.length === 0 ? (
          <EmptyState
            title={t('console.emptyTitle')}
            description={tableTypes.length ? t('console.emptyOnSale') : t('console.emptyNoType')}
            action={
              tableTypes.length ? undefined : (
                <Link
                  href={`/o/${org}/e/${event}/tickets-orders`}
                  className="text-body underline underline-offset-2"
                >
                  {t('console.addTableTicket')}
                </Link>
              )
            }
          />
        ) : (
          <Table
            caption={t('console.caption')}
            rowKey={(r) => r.id}
            rows={tables}
            columns={[
              { key: 'table', header: t('console.table'), cell: (r) => `${r.typeName} #${r.unitNo}` },
              {
                key: 'party',
                header: t('console.party'),
                cell: (r) => r.company ?? <span className="text-zinc-500">{t('console.noParty')}</span>,
              },
              { key: 'buyer', header: t('console.buyer'), cell: (r) => r.buyerName },
              {
                key: 'size',
                header: t('console.size'),
                cell: (r) => formatNumber(r.size, locale),
                mono: true,
                align: 'end',
              },
              {
                key: 'named',
                header: t('console.named'),
                cell: (r) => formatNumber(r.named, locale),
                mono: true,
                align: 'end',
              },
              {
                key: 'missing',
                header: t('console.missing'),
                cell: (r) =>
                  r.missing === 0 ? (
                    <StatusDot status="success" label={t('console.complete')} />
                  ) : (
                    <StatusDot status="warning" label={t('missing', { count: r.missing })} />
                  ),
              },
            ]}
          />
        )}
        {tables.length ? (
          <ul className="flex list-none flex-col gap-3 p-0">
            {tables.map((x) => (
              <li key={x.id}>
                <Card className="flex flex-col gap-3" data-table={x.id}>
                  <h3 className="text-body font-medium">{tableName(x)}</h3>
                  <p className="text-caption text-zinc-600">
                    {t('progress', {
                      named: formatNumber(x.named, locale),
                      size: formatNumber(x.slots.length, locale),
                    })}
                    {x.reminders > 0 ? ` · ${t('console.reminded', { count: x.reminders })}` : ''}
                  </p>
                  <ol
                    className="flex list-none flex-col gap-1 p-0"
                    aria-label={t('console.seatsOf', { table: tableName(x) })}
                  >
                    {x.slots.map((s, i) => (
                      <li key={s.ticketId} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-body">
                        <span className="text-caption text-zinc-500">{t('seat', { n: i + 1 })}</span>
                        <span className={s.guestName ? '' : 'text-zinc-500'}>
                          {s.guestName ?? t('unnamed')}
                        </span>
                        <span className="font-mono text-caption text-zinc-500">
                          {t('console.ticket', { code: s.shortCode })}
                        </span>
                      </li>
                    ))}
                  </ol>
                  {canName && x.missing > 0 ? (
                    <details className="rounded-card border border-zinc-200 p-3">
                      <summary className="min-h-6 cursor-pointer text-body">
                        {t('console.nameGuest', { table: tableName(x) })}
                      </summary>
                      <div className="pt-3">
                        <NameGuestForm
                          action={hostNameGuestAction.bind(null, org, event, x.id)}
                          idPrefix={`host-${x.id}`}
                          submitLabel={t('console.nameSubmit')}
                        />
                      </div>
                    </details>
                  ) : null}
                </Card>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section aria-labelledby="sponsors-heading" className="flex flex-col gap-3">
        <h2 id="sponsors-heading" className="text-section">
          {t('console.sponsorsTitle')}
        </h2>
        <p className="text-body text-zinc-600">{t('console.sponsorsIntro')}</p>
        {planTables.length === 0 ? (
          <EmptyState
            title={t('console.noPlanTitle')}
            description={t('console.noPlanHint')}
            action={
              <Link href={`/o/${org}/e/${event}/seating`} className="text-body underline underline-offset-2">
                {t('console.openSeating')}
              </Link>
            }
          />
        ) : (
          <ul className="flex list-none flex-col gap-3 p-0">
            {planTables.map((p) => (
              <li key={p.itemId}>
                <Card className="flex flex-col gap-3" data-plan-table={p.label}>
                  <h3 className="text-body font-medium">
                    {t('console.planTable', { table: p.label, seats: p.seats })}
                  </h3>
                  {p.sponsor ? (
                    <p className="flex flex-wrap items-center gap-3 text-body">
                      <span>{t('console.sponsoredBy', { sponsor: p.sponsor.sponsorName })}</span>
                      <StatusDot
                        status={p.sponsor.published ? 'success' : 'neutral'}
                        label={p.sponsor.published ? t('console.shown') : t('console.hidden')}
                      />
                    </p>
                  ) : (
                    <p className="text-body text-zinc-500">{t('console.noSponsor')}</p>
                  )}
                  {canSponsor ? (
                    <SponsorForm
                      action={setSponsorAction.bind(null, org, event, p.itemId)}
                      removeAction={p.sponsor ? removeSponsorAction.bind(null, org, event, p.itemId) : null}
                      idPrefix={`sponsor-${p.itemId}`}
                      table={p.label}
                      sponsor={p.sponsor}
                      logos={logos}
                    />
                  ) : null}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
