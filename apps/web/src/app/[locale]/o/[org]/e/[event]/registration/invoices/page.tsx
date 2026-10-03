import { executeQuery, formatMoney, money } from '@yayatoh/kernel';
import { eventInvoicesQuery, INVOICE_FILTERS, type InvoiceDto } from '@yayatoh/orders';
import { isProfileKey, navIncludes } from '@yayatoh/platform';
import { roleCan } from '@yayatoh/tenancy';
import { EmptyState, PageHeader, StatusDot, Table } from '@yayatoh/ui';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { dayLabel, INVOICE_DOT } from '@/components/invoice-panel.tsx';
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
  const filter: Filter = (INVOICE_FILTERS as readonly string[]).includes(sp.status ?? '')
    ? (sp.status as Filter)
    : 'all';
  const rows = await executeQuery(eventInvoicesQuery, { eventId: ev.id, filter }, data.ctx, ports);
  const fmt = (r: InvoiceDto, minor: number) => formatMoney(money(minor, r.currency), locale);
  const base = `/o/${org}/e/${event}/registration/invoices`;
  const chip = (current: boolean) =>
    `inline-flex min-h-8 items-center rounded-pill border px-3 text-caption ${current ? 'border-ink bg-tag text-white' : 'border-line bg-surface text-ink-2'}`;
  return (
    <>
      <PageHeader title={t('list.title')} description={t('list.description')} />
      <Link
        href={`/o/${org}/e/${event}/registration`}
        className="self-start text-body underline underline-offset-2"
      >
        {t('list.backToSetup')}
      </Link>
      <nav aria-label={t('list.filterLabel')}>
        <ul className="flex list-none flex-wrap gap-2 p-0">
          {INVOICE_FILTERS.map((f) => (
            <li key={f}>
              <Link
                href={f === 'all' ? base : `${base}?status=${f}`}
                aria-current={f === filter ? 'page' : undefined}
                className={chip(f === filter)}
              >
                {t(`list.filters.${f}`)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {rows.length === 0 && filter === 'all' ? (
        <EmptyState title={t('list.emptyTitle')} description={t('list.emptyDescription')} />
      ) : (
        <Table<InvoiceDto>
          caption={t('list.caption')}
          rows={rows}
          rowKey={(r) => r.id}
          empty={t('list.emptyFiltered')}
          columns={[
            {
              key: 'number',
              header: t('panel.number'),
              cell: (r) => (
                <Link
                  href={`/o/${org}/e/${event}/orders/${r.orderId}`}
                  className="inline-flex min-h-6 items-center font-mono underline underline-offset-2"
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
                  <span>{r.billingCompany ?? r.buyerName}</span>
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
                <span className="flex flex-col gap-1">
                  <StatusDot status={INVOICE_DOT[r.status]} label={t(`status.${r.status}`)} />
                  {r.overdue ? <StatusDot status="danger" label={t('overdue')} /> : null}
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
