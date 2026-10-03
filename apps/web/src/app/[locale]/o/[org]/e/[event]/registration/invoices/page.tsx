import { executeQuery, formatMoney, money } from '@yayatoh/kernel';
import { eventInvoicesQuery, INVOICE_FILTERS, type InvoiceDto } from '@yayatoh/orders';
import { isProfileKey, navIncludes } from '@yayatoh/platform';
import { roleCan } from '@yayatoh/tenancy';
import { buttonClass, EmptyState, PageHeader, StatusPill, Table, Tabs, tabClass } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Crumbs } from '@/components/crumbs.tsx';
import { dayLabel, INVOICE_TONE } from '@/components/invoice-panel.tsx';
import { Link } from '@/i18n/navigation.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

type Filter = (typeof INVOICE_FILTERS)[number];

/**
 * Invoices (M5.1d): the event's pay-later invoices, newest first, filtered by status (open,
 * overdue, paid, void): number, who, PO, total, paid, balance and due date, each linking to its
 * order (record a payment, void, PDF). Anyone who can read orders; nothing is changed here.
 */
export default async function InvoicesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const { data, event: ev } = await loadEvent(org, event, 'registration');
  const profile = isProfileKey(ev.profile) ? ev.profile : 'other';
  if (!navIncludes(profile, data.modules, 'registration') || !roleCan(data.role, 'orders:read')) notFound();
  const t = await getTranslations('invoices');
  const tv = await getTranslations('vocab');
  const filter: Filter = (INVOICE_FILTERS as readonly string[]).includes(sp.status ?? '')
    ? (sp.status as Filter)
    : 'all';
  const rows = await executeQuery(eventInvoicesQuery, { eventId: ev.id, filter }, data.ctx, ports);
  const fmt = (r: InvoiceDto, minor: number) => formatMoney(money(minor, r.currency), locale);
  const base = `/o/${org}/e/${event}/registration/invoices`;
  return (
    <>
      <PageHeader
        breadcrumb={
          <Crumbs
            items={[
              { label: data.org.name, href: `/o/${org}` },
              { label: ev.name, href: `/o/${org}/e/${event}` },
              { label: tv('registration'), href: `/o/${org}/e/${event}/registration` },
              { label: t('list.title') },
            ]}
          />
        }
        title={t('list.title')}
        description={t('list.description')}
      />
      <Tabs label={t('list.filterLabel')} className="self-start">
        {INVOICE_FILTERS.map((f) => (
          <Link
            key={f}
            href={f === 'all' ? base : `${base}?status=${f}`}
            aria-current={f === filter ? 'page' : undefined}
            className={tabClass(f === filter)}
          >
            {t(`list.filters.${f}`)}
          </Link>
        ))}
      </Tabs>
      {rows.length === 0 && filter === 'all' ? (
        <EmptyState title={t('list.emptyTitle')} description={t('list.emptyDescription')} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={t('list.emptyFiltered')}
          action={
            <Link href={base} className={buttonClass('secondary')}>
              {t('list.filters.all')}
            </Link>
          }
        />
      ) : (
        <Table<InvoiceDto>
          caption={t('list.caption')}
          rows={rows}
          rowKey={(r) => r.id}
          stackOnPhone
          columns={[
            {
              key: 'number',
              header: t('panel.number'),
              cell: (r) => (
                <Link
                  href={`/o/${org}/e/${event}/orders/${r.orderId}`}
                  className="inline-flex min-h-6 items-center rounded-tag font-mono font-bold text-primary-ink underline-offset-2 hover:underline"
                >
                  {r.label}
                </Link>
              ),
            },
            {
              key: 'who',
              header: t('list.billedTo'),
              cell: (r) => (
                <span className="flex flex-col">
                  <span className="font-bold text-ink">{r.billingCompany ?? r.buyerName}</span>
                  <span className="text-caption text-ink-2">
                    {r.billingCompany ? `${r.buyerName} · ` : ''}
                    {r.poNumber ? t('list.po', { po: r.poNumber }) : t('list.noPo')}
                  </span>
                </span>
              ),
            },
            {
              key: 'status',
              header: t('list.status'),
              cell: (r) => (
                <span className="flex flex-wrap gap-1.5">
                  <StatusPill tone={INVOICE_TONE[r.status]} label={t(`status.${r.status}`)} />
                  {r.overdue ? <StatusPill tone="danger" label={t('overdue')} /> : null}
                </span>
              ),
            },
            { key: 'due', header: t('panel.due'), cell: (r) => dayLabel(locale, r.dueOn) },
            { key: 'total', header: t('panel.total'), align: 'end', cell: (r) => fmt(r, r.totalMinor) },
            { key: 'balance', header: t('panel.balance'), align: 'end', cell: (r) => fmt(r, r.balanceMinor) },
          ]}
        />
      )}
    </>
  );
}
