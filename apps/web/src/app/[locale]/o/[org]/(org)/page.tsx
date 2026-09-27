import {
  EVENT_CATEGORIES,
  type EventCategory,
  listEventsQuery,
  orgTagsQuery,
  searchEventsQuery,
} from '@yayatoh/events';
import { executeQuery } from '@yayatoh/kernel';
import { payoutAccountQuery } from '@yayatoh/payments';
import {
  agreementsQuery,
  legalPagesQuery,
  listInvitationsQuery,
  listMembersQuery,
  roleCan,
  suspensionsQuery,
} from '@yayatoh/tenancy';
import { sellsPaidTicketsQuery } from '@yayatoh/ticketing';
import { buttonClass, Card, EmptyState, Label, PageHeader, Skeleton, StatusDot } from '@yayatoh/ui';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { type ReactNode, Suspense } from 'react';
import { OrgSales } from '@/components/org-sales.tsx';
import { Link } from '@/i18n/navigation.ts';
import { eventPhase, greetingKey } from '@/lib/event-status.ts';
import { formatEventDateRange } from '@/lib/format.ts';
import { resolvePeriod } from '@/lib/period.ts';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

const STATUS_DOT = {
  draft: 'neutral',
  published: 'success',
  postponed: 'warning',
  cancelled: 'danger',
  completed: 'info',
  archived: 'info',
} as const;

export default async function OrgHome({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string }>;
  searchParams: Promise<{ period?: string; from?: string; to?: string; category?: string; tag?: string }>;
}) {
  const { locale, org } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const data = await loadConsole(org);
  const t = await getTranslations();
  const firstName = data.session.name.split(' ')[0] ?? data.session.name;
  const canWrite = roleCan(data.role, 'events:write');
  const paused = await executeQuery(suspensionsQuery, {}, data.ctx, ports);
  const create = canWrite ? (
    <Link href={`/o/${org}/events/new`} className={buttonClass('primary')}>
      {t('orgHome.create')}
    </Link>
  ) : undefined;
  return (
    <>
      <PageHeader
        title={t(`greeting.${greetingKey(data.org.timezone)}`, { name: firstName })}
        description={data.org.name}
        actions={create}
      />
      {paused.length > 0 ? (
        <div
          role="status"
          className="flex flex-col gap-1 rounded-card border border-accent-700 bg-accent-50 px-4 py-3 text-body text-accent-text"
        >
          {paused.map((p) => (
            <p key={p.kind}>{t(`suspensions.${p.kind}`)}</p>
          ))}
          <p className="text-caption">{t('suspensions.contact')}</p>
        </div>
      ) : null}
      {roleCan(data.role, 'org:update') ? <SetupChecklist org={org} /> : null}
      {data.modules.has('reports') && roleCan(data.role, 'orders:read') ? (
        <OrgSales
          data={data}
          org={org}
          locale={locale}
          period={resolvePeriod(sp, data.org.timezone, new Date())}
        />
      ) : null}
      <section aria-labelledby="events-heading" className="flex flex-col gap-3">
        <h2 id="events-heading" className="text-section">
          {t('orgHome.events')}
        </h2>
        <Suspense fallback={<EventsSkeleton label={t('common.loading')} />}>
          <EventList
            org={org}
            locale={locale}
            create={create}
            filters={{
              category: (EVENT_CATEGORIES as readonly string[]).includes(sp.category ?? '')
                ? (sp.category as EventCategory)
                : undefined,
              tag: sp.tag?.trim().slice(0, 40) || undefined,
            }}
          />
        </Suspense>
      </section>
    </>
  );
}

function EventsSkeleton({ label }: { label: string }) {
  return (
    <div role="status" className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-52" />
      <Skeleton className="h-52" />
      <Skeleton className="h-52" />
    </div>
  );
}

async function EventList({
  org,
  locale,
  create,
  filters,
}: {
  org: string;
  locale: string;
  create: ReactNode;
  filters: { category?: EventCategory; tag?: string };
}) {
  const data = await loadConsole(org);
  const t = await getTranslations();
  const filtered = Boolean(filters.category || filters.tag);
  const [events, tags] = await Promise.all([
    executeQuery(searchEventsQuery, filters, data.ctx, ports).then((all) =>
      all.filter((e) => e.status !== 'archived'),
    ),
    executeQuery(orgTagsQuery, {}, data.ctx, ports),
  ]);
  const selectClass = 'min-h-10 rounded-pill border border-zinc-200 bg-white px-4 text-body';
  return (
    <>
      <search aria-label={t('eventFilters.label')}>
        <form method="get" className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="filter-category" className="text-caption text-zinc-600">
              {t('eventFilters.category')}
            </label>
            <select
              id="filter-category"
              name="category"
              defaultValue={filters.category ?? ''}
              className={selectClass}
            >
              <option value="">{t('eventFilters.anyCategory')}</option>
              {EVENT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(`categories.${c}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="filter-tag" className="text-caption text-zinc-600">
              {t('eventFilters.tag')}
            </label>
            <select
              id="filter-tag"
              name="tag"
              defaultValue={filters.tag?.toLowerCase() ?? ''}
              className={selectClass}
            >
              <option value="">{t('eventFilters.anyTag')}</option>
              {tags.map((tag) => (
                <option key={tag.key} value={tag.key}>
                  {tag.tag}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className={buttonClass('secondary')}>
            {t('eventFilters.apply')}
          </button>
          {filtered ? (
            <Link
              href={`/o/${org}`}
              className="inline-flex min-h-10 items-center text-caption underline underline-offset-2"
            >
              {t('eventFilters.clear')}
            </Link>
          ) : null}
        </form>
      </search>
      {events.length === 0 ? (
        filtered ? (
          <EmptyState title={t('eventFilters.noneTitle')} description={t('eventFilters.noneDescription')} />
        ) : (
          <EmptyState
            title={t('orgHome.emptyTitle')}
            description={t('orgHome.emptyDescription')}
            action={create}
          />
        )
      ) : (
        <ul className="grid list-none grid-cols-1 gap-3.5 p-0 md:grid-cols-2 xl:grid-cols-3">
          {events.map((e) => {
            const phase = eventPhase(e.startsAt.toISOString(), e.endsAt.toISOString());
            return (
              <li key={e.id}>
                <Card className="flex h-full flex-col gap-3">
                  <Label>
                    {t(`profiles.${e.profile}`)}
                    {e.category ? ` · ${t(`categories.${e.category as EventCategory}`)}` : ''}
                  </Label>
                  <h3 className="text-[22px] leading-tight font-light tracking-[-0.03em]">{e.name}</h3>
                  <p className="text-body text-zinc-500">
                    {formatEventDateRange(e.startsAt.toISOString(), e.endsAt.toISOString(), {
                      locale,
                      currency: e.currency,
                      timeZone: e.timezone,
                    })}
                    {e.venueName ? ` · ${e.venueName}` : ''}
                  </p>
                  {e.tags.length > 0 ? (
                    <ul aria-label={t('eventFilters.tags')} className="flex list-none flex-wrap gap-1.5 p-0">
                      {e.tags.map((tag) => (
                        <li
                          key={tag}
                          className="rounded-pill bg-zinc-100 px-2.5 py-0.5 text-caption text-zinc-700"
                        >
                          {tag}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <StatusDot
                    status={STATUS_DOT[e.status]}
                    label={`${t(`eventStatus.${e.status}`)} · ${t(`phase.${phase.phase}`, { days: phase.days })}`}
                  />
                  <Link
                    href={`/o/${org}/e/${e.slug}`}
                    className={buttonClass('secondary', 'md', 'mt-auto self-start')}
                  >
                    {t('orgHome.open')}
                  </Link>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

/**
 * Setup checklist (M1.3): what an organizer still needs before selling. Hidden once everything is
 * done. Payouts join the list once the org sells paid tickets.
 */
async function SetupChecklist({ org }: { org: string }) {
  const data = await loadConsole(org);
  const t = await getTranslations('setup');
  const [agreements, legal, events, members, invitations, sells, payouts] = await Promise.all([
    executeQuery(agreementsQuery, {}, data.ctx, ports),
    executeQuery(legalPagesQuery, {}, data.ctx, ports),
    executeQuery(listEventsQuery, {}, data.ctx, ports),
    executeQuery(listMembersQuery, {}, data.ctx, ports),
    roleCan(data.role, 'members:manage') ? executeQuery(listInvitationsQuery, {}, data.ctx, ports) : [],
    data.modules.has('ticketing')
      ? executeQuery(sellsPaidTicketsQuery, {}, data.ctx, ports)
      : { paid: false },
    executeQuery(payoutAccountQuery, {}, data.ctx, ports),
  ]);
  const items = [
    { key: 'terms', done: agreements.every((a) => a.acceptedAt !== null), href: `/o/${org}/settings` },
    {
      key: 'legal',
      done: ['privacy', 'refund'].every((k) => legal.some((p) => p.kind === k)),
      href: `/o/${org}/settings`,
    },
    { key: 'brand', done: data.org.brandColor !== null, href: `/o/${org}/settings` },
    { key: 'event', done: events.length > 0, href: `/o/${org}/events/new` },
    { key: 'team', done: members.length > 1 || invitations.length > 0, href: `/o/${org}/team` },
    ...(sells.paid ? [{ key: 'payouts', done: payouts.state === 'active', href: `/o/${org}/payouts` }] : []),
  ];
  const doneCount = items.filter((i) => i.done).length;
  if (doneCount === items.length) return null;
  return (
    <section aria-labelledby="setup-heading" className="flex flex-col gap-3">
      <h2 id="setup-heading" className="text-section">
        {t('title', { done: doneCount, total: items.length })}
      </h2>
      <Card className="flex flex-col">
        <ul className="flex list-none flex-col divide-y divide-zinc-100 p-0">
          {items.map((i) => (
            <li key={i.key} className="flex min-h-11 items-center gap-3 py-2">
              <StatusDot status={i.done ? 'success' : 'neutral'} label={i.done ? t('done') : t('todo')} />
              {i.done ? (
                <span className="text-zinc-500 line-through">{t(`item.${i.key}`)}</span>
              ) : (
                <Link href={i.href} className="underline underline-offset-2">
                  {t(`item.${i.key}`)}
                </Link>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}
