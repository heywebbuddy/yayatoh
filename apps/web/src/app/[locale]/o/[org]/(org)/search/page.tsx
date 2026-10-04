import { searchAttendeesQuery } from '@yayatoh/attendees';
import { listEventsQuery } from '@yayatoh/events';
import { executeQuery, formatMoney, money } from '@yayatoh/kernel';
import { searchOrdersQuery } from '@yayatoh/orders';
import { roleCan } from '@yayatoh/tenancy';
import { findTicketsByCodeQuery } from '@yayatoh/ticketing';
import { buttonClass, Card, EmptyState, PageHeader } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

/**
 * Org-wide search (the console's ⌘K field): events by name, attendees by name or email, orders
 * by buyer or order id, and tickets by their code. Each group appears only for roles that can
 * read it; every query runs under the org's RLS.
 */
export default async function SearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { locale, org } = await params;
  const q = ((await searchParams).q ?? '').trim().slice(0, 200);
  setRequestLocale(locale);
  const data = await loadConsole(org);
  const t = await getTranslations();
  if (q.length < 2) {
    return (
      <>
        <PageHeader title={t('search.title')} />
        <EmptyState
          title={t('search.tooShortTitle')}
          description={t('search.tooShortDescription')}
          action={
            <Link href={`/o/${org}`} className={buttonClass('primary', 'md')}>
              {t('search.browseEvents')}
            </Link>
          }
        />
      </>
    );
  }
  const can = (p: string) => roleCan(data.role, p);
  const allEvents = can('events:read') ? await executeQuery(listEventsQuery, {}, data.ctx, ports) : [];
  const byId = new Map(allEvents.map((e) => [e.id, e]));
  const needle = q.toLocaleLowerCase(locale);
  const events = allEvents.filter((e) => e.name.toLocaleLowerCase(locale).includes(needle)).slice(0, 10);
  const tickets =
    can('attendees:read') && data.modules.has('ticketing')
      ? await executeQuery(findTicketsByCodeQuery, { code: q }, data.ctx, ports)
      : [];
  const attendees =
    can('attendees:read') && data.modules.has('attendees')
      ? await executeQuery(
          searchAttendeesQuery,
          { q, ticketIds: tickets.map((x) => x.id), limit: 20 },
          data.ctx,
          ports,
        )
      : [];
  const orders =
    can('orders:read') && data.modules.has('ticketing')
      ? await executeQuery(searchOrdersQuery, { q, limit: 20 }, data.ctx, ports)
      : [];
  const eventHref = (id: string, rest = '') => {
    const e = byId.get(id);
    return e ? `/o/${org}/e/${e.slug}${rest}` : null;
  };
  const date = new Intl.DateTimeFormat(locale, { timeZone: data.org.timezone, dateStyle: 'medium' });
  const nothing = events.length + attendees.length + orders.length === 0;
  const group = (
    id: string,
    title: string,
    items: { key: string; href: string | null; main: string; sub: string }[],
  ) =>
    items.length ? (
      <section aria-labelledby={id} className="flex flex-col gap-2">
        <h2 id={id} className="text-section">
          {title}
        </h2>
        <Card size="panel">
          <ul className="flex list-none flex-col divide-y divide-line p-0">
            {items.map((i) => (
              <li key={i.key} className="py-2.5">
                {i.href ? (
                  <Link href={i.href} className="flex flex-col underline-offset-2 hover:underline">
                    <span className="text-ink">{i.main}</span>
                    <span className="text-caption text-ink-2">{i.sub}</span>
                  </Link>
                ) : (
                  <span className="flex flex-col">
                    <span>{i.main}</span>
                    <span className="text-caption text-ink-2">{i.sub}</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      </section>
    ) : null;

  return (
    <>
      <PageHeader title={t('search.resultsFor', { q })} />
      {nothing ? (
        <EmptyState
          title={t('search.noneTitle')}
          description={t('search.noneDescription')}
          action={
            <Link href={`/o/${org}`} className={buttonClass('primary', 'md')}>
              {t('search.browseEvents')}
            </Link>
          }
        />
      ) : null}
      {group(
        'search-events',
        t('search.events'),
        events.map((e) => ({
          key: e.id,
          href: eventHref(e.id),
          main: e.name,
          sub: date.format(e.startsAt),
        })),
      )}
      {group(
        'search-attendees',
        t('search.attendees'),
        attendees.map((a) => {
          const code = tickets.find((x) => x.id === a.ticketId)?.shortCode;
          return {
            key: a.id,
            href: eventHref(a.eventId, `/attendees?a=${a.id}`),
            main: a.name,
            sub: [a.email, byId.get(a.eventId)?.name, code ? t('search.ticketCode', { code }) : null]
              .filter(Boolean)
              .join(' · '),
          };
        }),
      )}
      {group(
        'search-orders',
        t('search.orders'),
        orders.map((o) => ({
          key: o.id,
          href: eventHref(o.eventId, `/attendees?q=${encodeURIComponent(o.buyerEmail)}`),
          main: `${o.buyerName} · ${formatMoney(money(o.totalMinor, o.currency), locale)}`,
          sub: [
            o.buyerEmail,
            byId.get(o.eventId)?.name,
            t(`order.status.${o.status}`),
            date.format(o.createdAt),
            t('search.orderRef', { ref: o.id.slice(0, 8) }),
          ]
            .filter(Boolean)
            .join(' · '),
        })),
      )}
    </>
  );
}
