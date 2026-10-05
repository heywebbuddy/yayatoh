import { executeQuery } from '@yayatoh/kernel';
import { listMediaQuery } from '@yayatoh/media';
import { hostedTablesQuery } from '@yayatoh/orders';
import { planTablesQuery } from '@yayatoh/seating';
import { listTicketTypesQuery } from '@yayatoh/ticketing';
import { Alert, buttonClass, Card, EmptyState, PageHeader, StatusDot, StatusPill, Table } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Crumbs } from '@/components/crumbs.tsx';
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
  const title = tn('nav.tablesSponsors');
  const tableName = (x: (typeof tables)[number]) =>
    t('tableName', { table: x.typeName, n: x.unitNo, who: x.company ?? x.buyerName });
  return (
    <>
      <PageHeader
        breadcrumb={
          <Crumbs
            items={[
              { label: data.org.name, href: `/o/${org}` },
              { label: ev.name, href: `/o/${org}/e/${event}` },
              { label: title },
            ]}
          />
        }
        title={title}
        description={t('console.description')}
      />
      {canName || canSponsor ? null : <Alert tone="info" title={t('console.viewerNotice')} />}
      {canName && missing > 0 ? (
        <section
          aria-labelledby="reminders-heading"
          className="flex flex-col gap-3 rounded-card border border-line bg-feature p-5 elevation-card"
        >
          <h2 id="reminders-heading" className="m-0 text-card text-ink">
            {t('reminders.title')}
          </h2>
          <p className="m-0 text-body text-ink-2">{t('reminders.hint')}</p>
          <ActionButton
            action={sendRemindersAction.bind(null, org, event)}
            label={t('reminders.send')}
            variant="primary"
            done="reminders"
          />
        </section>
      ) : null}

      <section aria-labelledby="sold-heading" className="flex flex-col gap-3">
        <h2 id="sold-heading" className="m-0 text-section text-ink">
          {t('console.soldTitle')}
        </h2>
        {tables.length === 0 ? (
          <EmptyState
            title={t('console.emptyTitle')}
            description={tableTypes.length ? t('console.emptyOnSale') : t('console.emptyNoType')}
            action={
              tableTypes.length ? undefined : (
                <Link href={`/o/${org}/e/${event}/tickets-orders`} className={buttonClass('secondary')}>
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
                cell: (r) => r.company ?? <span className="text-ink-2">{t('console.noParty')}</span>,
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
          <ul className="m-0 grid list-none grid-cols-1 gap-4 p-0 lg:grid-cols-2">
            {tables.map((x) => (
              <li key={x.id}>
                <Card className="flex h-full flex-col gap-3" data-table={x.id}>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="m-0 grow text-[16px] font-extrabold text-ink">{tableName(x)}</h3>
                    {x.missing === 0 ? (
                      <StatusPill tone="success" label={t('console.complete')} />
                    ) : (
                      <StatusPill tone="waiting" label={t('missing', { count: x.missing })} />
                    )}
                  </div>
                  <p className="m-0 text-caption text-ink-2 tabular-nums">
                    {t('progress', {
                      named: formatNumber(x.named, locale),
                      size: formatNumber(x.slots.length, locale),
                    })}
                    {x.reminders > 0 ? ` · ${t('console.reminded', { count: x.reminders })}` : ''}
                  </p>
                  <ol
                    className="m-0 flex list-none flex-col rounded-tile border border-line bg-surface-2 px-3 py-1"
                    aria-label={t('console.seatsOf', { table: tableName(x) })}
                  >
                    {x.slots.map((s, i) => (
                      <li
                        key={s.ticketId}
                        className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 border-b border-line py-1.5 text-body last:border-0"
                      >
                        <span className="min-w-14 shrink-0 text-caption font-bold text-ink-2">
                          {t('seat', { n: i + 1 })}
                        </span>
                        <span className={`grow ${s.guestName ? 'font-semibold text-ink' : 'text-ink-2'}`}>
                          {s.guestName ?? t('unnamed')}
                        </span>
                        <span className="font-mono text-caption text-ink-2">
                          {t('console.ticket', { code: s.shortCode })}
                        </span>
                      </li>
                    ))}
                  </ol>
                  {canName && x.missing > 0 ? (
                    <details className="rounded-tile border border-line px-3 py-2">
                      <summary className="inline-flex min-h-8 cursor-pointer items-center rounded-[10px] px-1 text-caption font-bold text-primary-ink">
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
        <div className="flex flex-col gap-1">
          <h2 id="sponsors-heading" className="m-0 text-section text-ink">
            {t('console.sponsorsTitle')}
          </h2>
          <p className="m-0 text-body text-ink-2">{t('console.sponsorsIntro')}</p>
        </div>
        {planTables.length === 0 ? (
          <EmptyState
            title={t('console.noPlanTitle')}
            description={t('console.noPlanHint')}
            action={
              <Link href={`/o/${org}/e/${event}/seating`} className={buttonClass('secondary')}>
                {t('console.openSeating')}
              </Link>
            }
          />
        ) : (
          <ul className="m-0 grid list-none grid-cols-1 gap-4 p-0 lg:grid-cols-2">
            {planTables.map((p) => {
              const label = t('tableLabel', { label: p.label });
              return (
                <li key={p.itemId}>
                  <Card size="panel" className="flex h-full flex-col gap-4" data-plan-table={label}>
                    <h3 className="m-0 text-card text-ink">
                      {t('console.planTable', { table: label, seats: p.seats })}
                    </h3>
                    {p.sponsor ? (
                      <p className="m-0 flex flex-wrap items-center gap-3 text-body font-semibold text-ink">
                        <span>{t('console.sponsoredBy', { sponsor: p.sponsor.sponsorName })}</span>
                        <StatusPill
                          tone={p.sponsor.published ? 'success' : 'neutral'}
                          label={p.sponsor.published ? t('console.shown') : t('console.hidden')}
                        />
                      </p>
                    ) : (
                      <p className="m-0 text-body text-ink-2">{t('console.noSponsor')}</p>
                    )}
                    {canSponsor ? (
                      <SponsorForm
                        action={setSponsorAction.bind(null, org, event, p.itemId)}
                        removeAction={p.sponsor ? removeSponsorAction.bind(null, org, event, p.itemId) : null}
                        idPrefix={`sponsor-${p.itemId}`}
                        table={label}
                        sponsor={p.sponsor}
                        logos={logos}
                      />
                    ) : null}
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
