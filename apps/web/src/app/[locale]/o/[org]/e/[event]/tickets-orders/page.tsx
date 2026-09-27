import { executeQuery, formatMoney, money } from '@yayatoh/kernel';
import { roleCan } from '@yayatoh/tenancy';
import { listTicketTypesQuery } from '@yayatoh/ticketing';
import { Button, Card, EmptyState, PageHeader, StatusDot, Table } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { TicketTypeForm } from '@/components/ticket-type-form.tsx';
import { formatNumber } from '@/lib/format.ts';
import { loadEvent } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { archiveTicketTypeAction, createTicketTypeAction } from './actions.ts';

export default async function TicketsPage({
  params,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
}) {
  const { locale, org, event } = await params;
  setRequestLocale(locale);
  const { data, event: ev } = await loadEvent(org, event);
  const t = await getTranslations();
  const types = await executeQuery(listTicketTypesQuery, { eventId: ev.id }, data.ctx, ports);
  const canWrite = roleCan(data.role, 'events:write');
  const fmt = (minor: number) => formatMoney(money(minor, ev.currency), locale);
  return (
    <>
      <PageHeader title={t('nav.ticketsOrders')} description={t('tickets.subtitle')} />
      {types.length === 0 ? (
        <EmptyState title={t('tickets.emptyTitle')} description={t('tickets.emptyDescription')} />
      ) : (
        <Table
          caption={t('tickets.caption')}
          rowKey={(r) => r.id}
          rows={types}
          columns={[
            {
              key: 'name',
              header: t('tickets.name'),
              cell: (r) => (
                <span className="flex flex-col">
                  <span>{r.name}</span>
                  {r.visibility === 'hidden' ? (
                    <span className="text-caption text-zinc-500">{t('tickets.hidden')}</span>
                  ) : null}
                </span>
              ),
            },
            {
              key: 'price',
              header: t('tickets.price'),
              cell: (r) => fmt(r.priceMinor),
              mono: true,
              align: 'end',
            },
            {
              key: 'allIn',
              header: t('tickets.allIn'),
              cell: (r) => (
                <span className="flex flex-col items-end">
                  <span>{fmt(r.allInMinor)}</span>
                  <span className="text-[11px] text-zinc-500">
                    {r.feeMode === 'absorb'
                      ? t('tickets.feeAbsorbed')
                      : t('tickets.feeIncluded', { fee: fmt(r.feeMinor) })}
                  </span>
                </span>
              ),
              mono: true,
              align: 'end',
            },
            {
              key: 'sold',
              header: t('tickets.sold'),
              cell: (r) =>
                `${formatNumber(r.quantitySold, locale)} / ${formatNumber(r.quantityTotal, locale)}`,
              mono: true,
              align: 'end',
            },
            {
              key: 'status',
              header: t('tickets.status'),
              cell: (r) =>
                r.quantitySold >= r.quantityTotal ? (
                  <StatusDot status="danger" label={t('tickets.soldOut')} />
                ) : (
                  <StatusDot status="success" label={t('tickets.onSale')} />
                ),
            },
            ...(canWrite
              ? [
                  {
                    key: 'actions',
                    header: t('tickets.actions'),
                    align: 'end' as const,
                    cell: (r: (typeof types)[number]) => (
                      <form action={archiveTicketTypeAction.bind(null, org, event, r.id)}>
                        <Button
                          type="submit"
                          variant="ghost"
                          size="sm"
                          aria-label={t('tickets.archive', { name: r.name })}
                        >
                          {t('tickets.remove')}
                        </Button>
                      </form>
                    ),
                  },
                ]
              : []),
          ]}
        />
      )}
      {canWrite ? (
        <Card className="flex flex-col gap-3">
          <h2 className="text-section">{t('tickets.addTitle')}</h2>
          <TicketTypeForm currency={ev.currency} action={createTicketTypeAction.bind(null, org, event)} />
        </Card>
      ) : null}
    </>
  );
}
