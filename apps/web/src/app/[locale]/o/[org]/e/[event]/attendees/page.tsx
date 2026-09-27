import { listAttendeesQuery } from '@yayatoh/attendees';
import { executeQuery } from '@yayatoh/kernel';
import { isProfileKey, term } from '@yayatoh/platform';
import { roleCan } from '@yayatoh/tenancy';
import { ticketSummariesQuery } from '@yayatoh/ticketing';
import {
  Avatar,
  Button,
  buttonClass,
  Card,
  EmptyState,
  Label,
  SearchPill,
  StatusDot,
  Table,
} from '@yayatoh/ui';
import { X } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { AttendeeStatus, DemoAttendee } from '@/demo/events.ts';
import { Link } from '@/i18n/navigation.ts';
import { formatNumber } from '@/lib/format.ts';
import { loadEvent } from '@/server/console.ts';
import { demoOverlay } from '@/server/demo.ts';
import { ports } from '@/server/ports.ts';

const STATUS_DOT: Record<AttendeeStatus, 'success' | 'warning' | 'danger'> = {
  paid: 'success',
  attending: 'success',
  needs_seat: 'warning',
  awaiting_payment: 'warning',
  pending: 'warning',
  refund_requested: 'danger',
  declined: 'danger',
};

const SEGMENT_FILTER: Record<string, (a: DemoAttendee) => boolean> = {
  all: () => true,
  registered: (a) => a.status === 'paid',
  attending: (a) => a.status === 'attending',
  needsSeat: (a) => a.seat === null && a.status !== 'declined',
  awaitingPayment: (a) => a.status === 'awaiting_payment',
  pending: (a) => a.status === 'pending',
  waitlist: () => false,
};

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

export default async function AttendeesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; org: string; event: string }>;
  searchParams: Promise<{ segment?: string; q?: string; a?: string }>;
}) {
  const { locale, org, event } = await params;
  const { segment = 'all', q = '', a: selectedId } = await searchParams;
  setRequestLocale(locale);
  const { data, event: real } = await loadEvent(org, event);
  const t = await getTranslations();
  const profile = isProfileKey(real.profile) ? real.profile : 'other';
  const needle = q.trim().toLowerCase();
  // Real attendees (created at ticket issue) win; seeded showcase events without any keep a demo list.
  const list = (extra: { search?: string; limit?: number }) =>
    executeQuery(listAttendeesQuery, { eventId: real.id, ...extra }, data.ctx, ports);
  const overall = roleCan(data.role, 'attendees:read') ? await list({ limit: 1 }) : { items: [], total: 0 };
  const hasReal = overall.total > 0;
  const live = hasReal ? await list({ search: needle || undefined }) : overall;
  const demo = hasReal ? undefined : demoOverlay(org, event);
  let ev: { segments: readonly { key: string; count: number }[]; attendees: DemoAttendee[] };
  let rows: DemoAttendee[];
  if (demo) {
    ev = { segments: demo.segments, attendees: [...demo.attendees] };
    rows = ev.attendees
      .filter(SEGMENT_FILTER[segment] ?? SEGMENT_FILTER.all ?? (() => true))
      .filter(
        (a) =>
          !needle || [a.name, a.company, a.order, a.seat ?? ''].some((v) => v.toLowerCase().includes(needle)),
      );
  } else {
    const tickets = new Map(
      (
        await executeQuery(
          ticketSummariesQuery,
          { ticketIds: live.items.flatMap((a) => (a.ticketId ? [a.ticketId] : [])) },
          data.ctx,
          ports,
        )
      ).map((tk) => [tk.id, tk]),
    );
    rows = live.items.map((a) => {
      const tk = a.ticketId ? tickets.get(a.ticketId) : undefined;
      return {
        id: a.id,
        name: a.name,
        company: a.email,
        ticketType: tk?.ticketTypeName ?? '—',
        seat: null,
        status: a.status === 'active' ? 'paid' : 'declined',
        order: tk?.shortCode ?? '—',
      } satisfies DemoAttendee;
    });
    ev = { segments: [{ key: 'all', count: overall.total }], attendees: rows };
  }
  const base = `/o/${org}/e/${event}/attendees`;
  const selected = ev.attendees.find((a) => a.id === selectedId);
  const title = t(term(profile, 'attendees'));
  const href = (p: Record<string, string | undefined>) => {
    const sp = new URLSearchParams(
      Object.entries({ segment, q, ...p }).filter(([, v]) => v) as [string, string][],
    );
    if (sp.get('segment') === 'all') sp.delete('segment');
    const s = sp.toString();
    return s ? `${base}?${s}` : base;
  };

  return (
    <div className="flex flex-col gap-[18px] xl:flex-row">
      <div className="flex min-w-0 flex-1 flex-col gap-[18px]">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>{real.name}</Label>
            <h1 className="flex items-baseline gap-3 text-[32px] leading-[1.1] font-light tracking-[-0.04em] md:text-title">
              {title}
              <span className="font-mono text-[15px] text-zinc-500">
                {formatNumber(ev.segments[0]?.count ?? 0, locale)}
              </span>
            </h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled title={t('common.comingSoon')}>
              {t('actions.import')}
            </Button>
            <Button variant="secondary" disabled title={t('common.comingSoon')}>
              {t('actions.export')}
            </Button>
            <Button disabled title={t('common.comingSoon')}>
              {t('actions.addAttendee', { term: t(term(profile, 'attendee')) })}
            </Button>
          </div>
        </div>

        <nav aria-label={t('attendees.segments')} className="-mx-1 overflow-x-auto">
          <ul className="flex list-none gap-1.5 px-1 pb-1">
            {ev.segments.map((s) => {
              const active = s.key === segment;
              return (
                <li key={s.key}>
                  <Link
                    href={href({ segment: s.key, a: undefined })}
                    aria-current={active ? 'page' : undefined}
                    className={`inline-flex min-h-9 items-center gap-2 rounded-pill border px-3.5 text-[13px] whitespace-nowrap ${active ? 'border-ink bg-ink text-white' : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50'}`}
                  >
                    {t(`segments.${s.key}`)}
                    <span className={`font-mono text-[11px] ${active ? 'text-white/70' : 'text-zinc-500'}`}>
                      {formatNumber(s.count, locale)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <search>
          <form action={base} className="flex flex-wrap items-center gap-2">
            {segment !== 'all' ? <input type="hidden" name="segment" value={segment} /> : null}
            <SearchPill
              id="attendee-search"
              name="q"
              defaultValue={q}
              label={t('attendees.search', { term: title })}
              placeholder={t('attendees.searchPlaceholder')}
              className="w-full sm:w-[360px]"
            />
            <button type="submit" className={buttonClass('secondary')}>
              {t('actions.search')}
            </button>
          </form>
        </search>

        {(demo ? ev.attendees.length === 0 : !hasReal) ? (
          <EmptyState
            title={t('attendees.emptyTitle', { term: title })}
            description={t('attendees.emptyDescription')}
          />
        ) : rows.length === 0 ? (
          <EmptyState title={t('attendees.noMatches')} description={t('attendees.noMatchesHint')} />
        ) : (
          <Table
            caption={title}
            rowKey={(r) => r.id}
            rows={rows}
            columns={[
              {
                key: 'name',
                header: t('attendees.name'),
                cell: (r) => (
                  <Link
                    href={href({ a: r.id })}
                    className="flex items-center gap-2.5 underline-offset-2 hover:underline"
                  >
                    <Avatar initials={initials(r.name)} label={r.name} size={28} />
                    <span className="flex flex-col">
                      <span className="text-zinc-900">{r.name}</span>
                      <span className="text-caption text-zinc-500">{r.company}</span>
                    </span>
                  </Link>
                ),
              },
              { key: 'ticket', header: t('attendees.ticketType'), cell: (r) => r.ticketType },
              { key: 'seat', header: t('attendees.seat'), cell: (r) => r.seat ?? '—' },
              {
                key: 'status',
                header: t('attendees.status'),
                cell: (r) => (
                  <StatusDot status={STATUS_DOT[r.status]} label={t(`attendeeStatus.${r.status}`)} />
                ),
              },
              { key: 'order', header: t('attendees.order'), cell: (r) => r.order, mono: true, align: 'end' },
            ]}
          />
        )}
      </div>

      {selected ? (
        <aside aria-label={t('attendees.profile')} className="w-full shrink-0 xl:w-[360px]">
          <Card size="panel" className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <Label>{t(term(profile, 'attendee'))}</Label>
              <Link
                href={href({ a: undefined })}
                aria-label={t('attendees.closeProfile')}
                className="flex size-8 items-center justify-center rounded-pill hover:bg-zinc-100"
              >
                <X aria-hidden="true" className="size-4" strokeWidth={1.6} />
              </Link>
            </div>
            <div className="flex items-center gap-3">
              <Avatar initials={initials(selected.name)} label={selected.name} size={48} />
              <div className="flex flex-col">
                <p className="text-[22px] leading-tight font-light tracking-[-0.03em]">{selected.name}</p>
                <p className="text-body text-zinc-500">{selected.company}</p>
              </div>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-body">
              <dt className="text-zinc-500">{t('attendees.ticketType')}</dt>
              <dd className="m-0">{selected.ticketType}</dd>
              <dt className="text-zinc-500">{t('attendees.order')}</dt>
              <dd className="m-0 font-mono text-caption">{selected.order}</dd>
              <dt className="text-zinc-500">{t('attendees.seat')}</dt>
              <dd className="m-0">{selected.seat ?? '—'}</dd>
              <dt className="text-zinc-500">{t('attendees.status')}</dt>
              <dd className="m-0">
                <StatusDot
                  status={STATUS_DOT[selected.status]}
                  label={t(`attendeeStatus.${selected.status}`)}
                />
              </dd>
            </dl>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" disabled title={t('common.comingSoon')}>
                {t('actions.sendTicket')}
              </Button>
              <Button variant="secondary" size="sm" disabled title={t('common.comingSoon')}>
                {t('actions.changeSeat')}
              </Button>
              <Button size="sm" disabled title={t('common.comingSoon')}>
                {t('actions.checkIn')}
              </Button>
            </div>
          </Card>
        </aside>
      ) : null}
    </div>
  );
}
