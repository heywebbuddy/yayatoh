import { listEventsQuery } from '@yayatoh/events';
import { executeQuery, formatMoney, money } from '@yayatoh/kernel';
import { roleCan } from '@yayatoh/tenancy';
import { listCouponsQuery, listOrgPromoCodesQuery } from '@yayatoh/ticketing';
import { Button, buttonClass, Card, EmptyState, PageHeader, StatusDot, Table } from '@yayatoh/ui';
import { TicketPercent } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CouponForm } from '@/components/coupon-form.tsx';
import { HowItWorks } from '@/components/how-it-works.tsx';
import { Link } from '@/i18n/navigation.ts';
import { formatNumber } from '@/lib/format.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';
import { createCouponAction, setCouponActiveAction, setEventCodeActiveAction } from './actions.ts';

interface Row {
  readonly id: string;
  readonly source: 'coupon' | 'event';
  readonly code: string;
  readonly kind: 'percent' | 'amount';
  readonly percentBps: number | null;
  readonly amountMinor: number | null;
  readonly currency: string | null;
  /** Event codes: their event; coupons: the chosen events (empty = every event). */
  readonly eventIds: readonly string[];
  readonly redeemedCount: number;
  readonly maxRedemptions: number | null;
  readonly perBuyerLimit: number | null;
  readonly startsAt: Date | null;
  readonly endsAt: Date | null;
  readonly active: boolean;
}

/**
 * U9 (UX-5): one list of every discount code in the org: org-wide coupons (all events or chosen
 * ones) and each event's own promo codes, with their usage. New coupons are made here; event codes
 * stay on the event's Tickets & Orders page.
 */
export default async function CouponsPage({ params }: { params: Promise<{ locale: string; org: string }> }) {
  const { locale, org } = await params;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  if (!data.modules.has('ticketing') || !roleCan(data.role, 'events:read')) notFound();
  const t = await getTranslations('coupons');
  const tr = await getTranslations();
  const canWrite = roleCan(data.role, 'events:write');
  const [coupons, promos, events] = await Promise.all([
    executeQuery(listCouponsQuery, {}, data.ctx, ports),
    executeQuery(listOrgPromoCodesQuery, {}, data.ctx, ports),
    executeQuery(listEventsQuery, {}, data.ctx, ports),
  ]);
  const eventById = new Map(events.map((e) => [e.id, e]));
  const rows: Row[] = [
    ...coupons.map((c) => ({ ...c, source: 'coupon' as const })),
    ...promos.map((p) => ({ ...p, source: 'event' as const, eventIds: [p.eventId], perBuyerLimit: null })),
  ].sort((x, y) => x.code.localeCompare(y.code));
  const pct = (bps: number) =>
    new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 }).format(bps / 10_000);
  const when = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: data.org.timezone,
  });
  const window = (r: Row) =>
    r.startsAt && r.endsAt
      ? when.formatRange(r.startsAt, r.endsAt)
      : r.endsAt
        ? t('until', { date: when.format(r.endsAt) })
        : r.startsAt
          ? t('from', { date: when.format(r.startsAt) })
          : t('always');
  const appliesTo = (r: Row) => {
    if (r.source === 'event') {
      const e = eventById.get(r.eventIds[0] ?? '');
      return e ? (
        <Link href={`/o/${org}/e/${e.slug}/tickets-orders`} className="underline underline-offset-2">
          {e.name}
        </Link>
      ) : (
        '—'
      );
    }
    if (r.eventIds.length === 0) return t('scopeAll');
    const names = r.eventIds.map((id) => eventById.get(id)?.name).filter(Boolean);
    return names.join(', ');
  };
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      {/* U2: the Create menu's "Coupon" lands here; how codes work, before the list. */}
      <HowItWorks topic="coupons" />
      <section aria-labelledby="coupon-list-heading" className="flex flex-col gap-3">
        <h2 id="coupon-list-heading" className="text-section">
          {t('listTitle')}
        </h2>
        {rows.length === 0 ? (
          // U2 (no dead ends): without events there is nothing to discount yet; with events, add a coupon.
          events.length === 0 ? (
            <EmptyState
              icon={<TicketPercent strokeWidth={2} />}
              title={t('noEventsTitle')}
              description={t('noEventsDescription')}
              action={
                canWrite ? (
                  <Link href={`/o/${org}/events/new/guided`} className={buttonClass('primary', 'md')}>
                    {t('emptyAction')}
                  </Link>
                ) : (
                  <Link href={`/o/${org}`} className={buttonClass('secondary', 'md')}>
                    {tr('emptyActions.seeEvents')}
                  </Link>
                )
              }
            />
          ) : (
            <EmptyState
              icon={<TicketPercent strokeWidth={2} />}
              title={t('emptyTitle')}
              description={canWrite ? t('emptyDescription') : t('emptyViewer')}
              action={
                canWrite ? (
                  <Link href={`/o/${org}/coupons#new-coupon`} className={buttonClass('primary', 'md')}>
                    {t('newTitle')}
                  </Link>
                ) : (
                  <Link href={`/o/${org}`} className={buttonClass('secondary', 'md')}>
                    {tr('emptyActions.seeEvents')}
                  </Link>
                )
              }
            />
          )
        ) : (
          <Table
            caption={t('listTitle')}
            rowKey={(r) => `${r.source}-${r.id}`}
            rows={rows}
            stackOnPhone
            columns={[
              { key: 'code', header: t('code'), cell: (r) => r.code, mono: true },
              {
                key: 'type',
                header: t('type'),
                cell: (r) => (r.source === 'coupon' ? t('typeCoupon') : t('typeEvent')),
              },
              { key: 'applies', header: t('appliesTo'), cell: appliesTo },
              {
                key: 'discount',
                header: t('discount'),
                cell: (r) =>
                  r.kind === 'percent'
                    ? t('percentOff', { value: pct(r.percentBps ?? 0) })
                    : t('amountOff', {
                        amount: formatMoney(
                          money(r.amountMinor ?? 0, r.currency ?? data.org.currency),
                          locale,
                        ),
                      }),
              },
              {
                key: 'uses',
                header: t('uses'),
                align: 'end',
                mono: true,
                cell: (r) =>
                  r.maxRedemptions === null
                    ? formatNumber(r.redeemedCount, locale)
                    : `${formatNumber(r.redeemedCount, locale)} / ${formatNumber(r.maxRedemptions, locale)}`,
              },
              {
                key: 'perBuyer',
                header: t('perBuyerShort'),
                align: 'end',
                cell: (r) => (r.perBuyerLimit === null ? '—' : formatNumber(r.perBuyerLimit, locale)),
              },
              { key: 'window', header: t('valid'), cell: window },
              {
                key: 'status',
                header: t('status'),
                cell: (r) =>
                  r.active ? (
                    <StatusDot status="success" label={t('active')} />
                  ) : (
                    <StatusDot status="neutral" label={t('paused')} />
                  ),
              },
              ...(canWrite
                ? [
                    {
                      key: 'actions',
                      header: t('actions'),
                      align: 'end' as const,
                      cell: (r: Row) => (
                        <form
                          action={
                            r.source === 'coupon'
                              ? setCouponActiveAction.bind(null, org, r.id, !r.active)
                              : setEventCodeActiveAction.bind(null, org, r.id, !r.active)
                          }
                        >
                          <Button
                            type="submit"
                            variant="ghost"
                            size="sm"
                            aria-label={t(r.active ? 'pauseCode' : 'resumeCode', { code: r.code })}
                          >
                            {t(r.active ? 'pause' : 'resume')}
                          </Button>
                        </form>
                      ),
                    },
                  ]
                : []),
            ]}
          />
        )}
      </section>
      {canWrite ? (
        <section
          id="new-coupon"
          aria-labelledby="coupon-new-heading"
          className="flex scroll-mt-6 flex-col gap-3"
        >
          <h2 id="coupon-new-heading" className="text-section">
            {t('newTitle')}
          </h2>
          <Card size="panel">
            <CouponForm
              action={createCouponAction.bind(null, org)}
              events={events.map((e) => ({ id: e.id, name: e.name, currency: e.currency }))}
              currency={data.org.currency}
              timeZone={data.org.timezone}
            />
          </Card>
        </section>
      ) : null}
    </>
  );
}
