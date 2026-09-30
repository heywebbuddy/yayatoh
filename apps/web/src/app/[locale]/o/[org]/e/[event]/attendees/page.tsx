import {
  ATTENDEE_SOURCES,
  ATTENDEE_STATUSES,
  type AttendeeDto,
  attendeeEmailBulk,
  attendeeImportBulk,
  attendeeLabelBulk,
  attendeeLabelsQuery,
  getAttendeeQuery,
} from '@yayatoh/attendees';
import { executeQuery, formatMoney, isDomainError, money } from '@yayatoh/kernel';
import { ticketCancelBulk } from '@yayatoh/orders';
import { type BulkOperationDto, isProfileKey, term } from '@yayatoh/platform';
import {
  attendeeExportBulk,
  attendeeListQuery,
  CHECKED_IN_FILTERS,
  contactTimelineQuery,
} from '@yayatoh/reports';
import {
  activeAdaRule,
  attendeeSeatLabelsQuery,
  eventSeatingQuery,
  seatAssignBulk,
  seatGroupsQuery,
  seatingRulesQuery,
} from '@yayatoh/seating';
import { roleCan } from '@yayatoh/tenancy';
import {
  listClaimLinksQuery,
  listTicketTypesQuery,
  ticketResendBulk,
  ticketSummariesQuery,
} from '@yayatoh/ticketing';
import {
  Avatar,
  Button,
  buttonClass,
  Card,
  Chip,
  EmptyState,
  Label,
  SearchPill,
  StatusDot,
  Table,
} from '@yayatoh/ui';
import { X } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AutoRefresh } from '@/components/auto-refresh.tsx';
import { BulkFields, type SeatTarget } from '@/components/bulk-fields.tsx';
import { ClaimLinkForm } from '@/components/claim-link-form.tsx';
import { GuestForm } from '@/components/guest-form.tsx';
import { LabelForm } from '@/components/label-form.tsx';
import { StepUpForm } from '@/components/step-up.tsx';
import type { AttendeeStatus, DemoAttendee } from '@/demo/events.ts';
import { Link } from '@/i18n/navigation.ts';
import { errorMessageKey } from '@/lib/errors.ts';
import { formatNumber } from '@/lib/format.ts';
import { loadEvent } from '@/server/console.ts';
import { demoOverlay } from '@/server/demo.ts';
import { ports } from '@/server/ports.ts';
import { seatingDates } from '@/server/seating-dates.ts';
import {
  addGuestAction,
  addLabelAction,
  type BulkKind,
  bulkAction,
  removeGuestAction,
  removeLabelAction,
  revokeClaimAction,
  sendTicketAction,
  undoBulkAction,
} from './actions.ts';

const PAGE_SIZE = 50;
const asArray = (v: string | string[] | undefined) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | undefined =>
  list.includes(v as T) ? (v as T) : undefined;

/** Per-item failure and warning codes the progress panel explains (others read "unexpected error"). */
const KNOWN_CODES = new Set([
  'too_many_labels',
  'not_found',
  'not_attending',
  'not_enough_seats',
  'seated_by_ticket',
  'attendee_cancelled',
  'no_ticket',
  'ticket_void',
]);
const OP_KINDS: readonly BulkKind[] = ['export', 'label', 'import', 'email', 'seats', 'resend', 'cancel'];

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
  searchParams: Promise<{
    segment?: string;
    q?: string;
    a?: string;
    label?: string | string[];
    source?: string;
    status?: string;
    type?: string;
    checkin?: string;
    page?: string;
    op?: string;
    opk?: string;
    batch?: string;
    bulkError?: string;
  }>;
}) {
  const { locale, org, event } = await params;
  const sp = await searchParams;
  const { segment = 'all', q = '', a: selectedId } = sp;
  const labels = asArray(sp.label).slice(0, 20);
  const source = oneOf(ATTENDEE_SOURCES, sp.source);
  const status = oneOf(ATTENDEE_STATUSES, sp.status);
  const ticketTypeId = sp.type && /^[0-9a-f-]{36}$/.test(sp.type) ? sp.type : undefined;
  const checkedIn = oneOf(CHECKED_IN_FILTERS, sp.checkin);
  const page = Math.max(1, Math.min(10_000, Number.parseInt(sp.page ?? '1', 10) || 1));
  setRequestLocale(locale);
  const { data, event: real, can } = await loadEvent(org, event, 'attendees');
  const t = await getTranslations();
  const profile = isProfileKey(real.profile) ? real.profile : 'other';
  const needle = q.trim().toLowerCase();
  // Real attendees (created at ticket issue) win; seeded showcase events without any keep a demo list.
  const list = (extra: Record<string, unknown>) =>
    executeQuery(attendeeListQuery, { eventId: real.id, ...extra }, data.ctx, ports);
  const overall = can('attendees:read') ? await list({ limit: 1 }) : { items: [], total: 0 };
  const hasReal = overall.total > 0;
  const live = hasReal
    ? await list({
        search: needle || undefined,
        labels,
        source,
        status,
        ticketTypeIds: ticketTypeId ? [ticketTypeId] : [],
        checkedIn,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      })
    : overall;
  const labelCounts = hasReal
    ? await executeQuery(attendeeLabelsQuery, { eventId: real.id }, data.ctx, ports)
    : [];
  const canWrite = can('attendees:write');
  const canExport = can('attendees:export');
  const ticketing = data.modules.has('ticketing');
  const canResend = canWrite && ticketing;
  // Cancelling refunds the order (order-keyed commands): org roles only.
  const canCancel = roleCan(data.role, 'orders:refund') && ticketing;
  const canSeat = can('events:write') && data.modules.has('seating');
  const canBulk = hasReal && (canWrite || canExport || canCancel || canSeat);
  const ticketTypes =
    hasReal && ticketing
      ? await executeQuery(listTicketTypesQuery, { eventId: real.id }, data.ctx, ports)
      : [];
  // Where "Assign seats" can seat people: the whole plan, each section, table and row, each group block.
  let seatTargets: SeatTarget[] | null = null;
  let seatDates: SeatTarget[] = [];
  let adaEnforced = false;
  if (hasReal && canSeat) {
    const seating = await executeQuery(eventSeatingQuery, { eventId: real.id }, data.ctx, ports);
    if (seating) {
      const ts = await getTranslations('seating');
      const available = new Set(seating.seats.filter((x) => x.state === 'available').map((x) => x.seatUuid));
      const groups = await executeQuery(seatGroupsQuery, { eventId: real.id }, data.ctx, ports);
      // Dates with their own chart (M1.7g): "Assign seats" can seat people there instead.
      const { dates } = await seatingDates(data, real.id, undefined);
      const day = new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: real.timezone,
      });
      seatDates = dates
        .filter((d) => d.own && !d.cancelled)
        .map((d) => ({ value: d.id, label: day.format(d.startsAt) }));
      const rules = await executeQuery(seatingRulesQuery, { eventId: real.id }, data.ctx, ports);
      adaEnforced = activeAdaRule(rules, real.startsAt, data.ctx.now)?.severity === 'enforce';
      const items = seating.doc.items.flatMap((i) => (i.kind === 'object' ? [] : [i]));
      seatTargets = [
        { value: 'best', label: t('bulk.targetBest', { free: available.size }) },
        ...seating.doc.sections.map((sec) => ({
          value: `section:${sec.id}`,
          label: t('bulk.targetSection', { section: sec.label }),
        })),
        ...items.map((i) => ({
          value: `item:${i.id}`,
          label: ts('assign.form.option', {
            item: ts(`prices.item.${i.kind}`, { label: i.label }),
            free: i.seats.filter((x) => available.has(x.id)).length,
            capacity: i.seats.length,
          }),
        })),
        ...groups.map((g) => ({
          value: `group:${g.label}`,
          label: t('bulk.targetGroup', { group: g.label, unused: g.unused }),
        })),
      ];
    }
  }
  // The bulk operation the page was sent back to (progress, failures, undo, download).
  const opKind: BulkKind | null = oneOf(OP_KINDS, sp.opk) ?? null;
  let op: BulkOperationDto | null = null;
  if (opKind && sp.op && /^[0-9a-f-]{36}$/.test(sp.op)) {
    const q = {
      export: attendeeExportBulk.status,
      import: attendeeImportBulk.status,
      email: attendeeEmailBulk.status,
      label: attendeeLabelBulk.status,
      seats: seatAssignBulk.status,
      resend: ticketResendBulk.status,
      cancel: ticketCancelBulk.status,
    }[opKind];
    op = await executeQuery(q, { operationId: sp.op }, data.ctx, ports).catch((err) => {
      if (isDomainError(err) && (err.code === 'not_found' || err.code === 'forbidden')) return null;
      throw err;
    });
  }
  const opActive = op ? ['queued', 'running', 'undoing'].includes(op.status) : false;
  const tally = (items: readonly { code: string }[]) =>
    Object.entries(
      items.reduce<Record<string, number>>((acc, f) => {
        acc[f.code] = (acc[f.code] ?? 0) + 1;
        return acc;
      }, {}),
    );
  const failureCodes = op ? tally(op.failures) : [];
  const warningCodes = op ? tally(op.warnings) : [];
  const liveById = new Map<string, AttendeeDto>(live.items.map((x) => [x.id, x]));
  // The profile panel opens from search results too, so it can't rely on the current page.
  if (hasReal && selectedId && !liveById.has(selectedId) && /^[0-9a-f-]{36}$/.test(selectedId)) {
    const one = await executeQuery(
      getAttendeeQuery,
      { eventId: real.id, attendeeId: selectedId },
      data.ctx,
      ports,
    ).catch((err) => {
      if (isDomainError(err) && err.code === 'not_found') return null;
      throw err;
    });
    if (one) liveById.set(one.id, one);
  }
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
          { ticketIds: [...liveById.values()].flatMap((a) => (a.ticketId ? [a.ticketId] : [])) },
          data.ctx,
          ports,
        )
      ).map((tk) => [tk.id, tk]),
    );
    // The Seat column (M1.7g): each person's seat for their ticket's date.
    const seatOf = new Map(
      data.modules.has('seating')
        ? (
            await executeQuery(
              attendeeSeatLabelsQuery,
              {
                eventId: real.id,
                people: [...liveById.values()].map((x) => ({
                  attendeeId: x.id,
                  ticketId: x.ticketId,
                  occurrenceId: (x.ticketId ? tickets.get(x.ticketId)?.occurrenceId : null) ?? null,
                })),
              },
              data.ctx,
              ports,
            )
          ).map((r) => [r.attendeeId, r.seat])
        : [],
    );
    const toRow = (a: AttendeeDto) => {
      const tk = a.ticketId ? tickets.get(a.ticketId) : undefined;
      return {
        id: a.id,
        name: a.name,
        company: a.email,
        ticketType: tk?.ticketTypeName ?? '—',
        seat: seatOf.get(a.id) ?? null,
        status: a.status === 'active' ? 'paid' : 'declined',
        order: tk?.shortCode ?? '—',
      } satisfies DemoAttendee;
    };
    rows = live.items.map(toRow);
    ev = { segments: [{ key: 'all', count: overall.total }], attendees: [...liveById.values()].map(toRow) };
  }
  const base = `/o/${org}/e/${event}/attendees`;
  const selected = ev.attendees.find((a) => a.id === selectedId);
  const title = t(term(profile, 'attendees'));
  const href = (p: Record<string, string | string[] | undefined>) => {
    const merged: Record<string, string | string[] | undefined> = {
      segment,
      q,
      label: labels,
      source,
      status,
      type: ticketTypeId,
      checkin: checkedIn,
      page: page > 1 ? String(page) : undefined,
      ...p,
    };
    const out = new URLSearchParams();
    for (const [k, v] of Object.entries(merged))
      for (const one of Array.isArray(v) ? v : v ? [v] : []) out.append(k, one);
    if (out.get('segment') === 'all') out.delete('segment');
    const s = out.toString();
    return s ? `${base}?${s}` : base;
  };
  const selectedLabels = selectedId ? (liveById.get(selectedId)?.labels ?? []) : [];
  const selectedTicketId = selectedId ? (liveById.get(selectedId)?.ticketId ?? null) : null;
  const claims =
    selectedTicketId && data.modules.has('ticketing')
      ? await executeQuery(
          listClaimLinksQuery,
          { eventId: real.id, ticketIds: [selectedTicketId] },
          data.ctx,
          ports,
        )
      : [];
  const openClaim = claims.find((c) => c.state === 'open');
  const selectedRecord = selectedId ? liveById.get(selectedId) : undefined;
  const timeline =
    selectedRecord && roleCan(data.role, 'contacts:read')
      ? await executeQuery(contactTimelineQuery, { attendeeId: selectedRecord.id }, data.ctx, ports)
      : null;
  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: real.timezone });
  const filtered = Boolean(needle || labels.length || source || status || ticketTypeId || checkedIn);
  const from = live.total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(live.total, page * PAGE_SIZE);

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
            {!demo && canWrite && data.modules.has('attendees') ? (
              <Link href={`${base}/import`} className={buttonClass('secondary')}>
                {t('actions.import')}
              </Link>
            ) : (
              <Button variant="secondary" disabled title={t('common.comingSoon')}>
                {t('actions.import')}
              </Button>
            )}
            {!demo && canWrite && data.modules.has('attendees') ? null : (
              <Button disabled title={t('common.comingSoon')}>
                {t('actions.addAttendee', { term: t(term(profile, 'attendee')) })}
              </Button>
            )}
          </div>
        </div>

        {!demo && canWrite && data.modules.has('attendees') ? (
          <details className="group rounded-card border border-zinc-200 bg-white px-4 py-3">
            <summary className="flex min-h-8 cursor-pointer list-none items-center text-body [&::-webkit-details-marker]:hidden">
              {t('actions.addAttendee', { term: t(term(profile, 'attendee')) })}
            </summary>
            <div className="pt-3">
              <GuestForm action={addGuestAction.bind(null, org, event)} />
            </div>
          </details>
        ) : null}

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
            {labels.map((l) => (
              <input key={l} type="hidden" name="label" value={l} />
            ))}
            <SearchPill
              id="attendee-search"
              name="q"
              defaultValue={q}
              label={t('attendees.search', { term: title })}
              placeholder={t('attendees.searchPlaceholder')}
              className="w-full sm:w-[360px]"
            />
            {hasReal ? (
              <>
                <label htmlFor="attendee-source" className="sr-only">
                  {t('attendees.source')}
                </label>
                <select
                  id="attendee-source"
                  name="source"
                  defaultValue={source ?? ''}
                  className="min-h-10 rounded-pill border border-zinc-200 bg-white px-4 text-body"
                >
                  <option value="">{t('attendees.anySource')}</option>
                  {ATTENDEE_SOURCES.map((x) => (
                    <option key={x} value={x}>
                      {t(`attendeeSource.${x}`)}
                    </option>
                  ))}
                </select>
                <label htmlFor="attendee-status" className="sr-only">
                  {t('attendees.status')}
                </label>
                <select
                  id="attendee-status"
                  name="status"
                  defaultValue={status ?? ''}
                  className="min-h-10 rounded-pill border border-zinc-200 bg-white px-4 text-body"
                >
                  <option value="">{t('attendees.anyStatus')}</option>
                  {ATTENDEE_STATUSES.map((x) => (
                    <option key={x} value={x}>
                      {t(`attendeeRecordStatus.${x}`)}
                    </option>
                  ))}
                </select>
                {ticketing ? (
                  <>
                    <label htmlFor="attendee-type" className="sr-only">
                      {t('attendees.ticketType')}
                    </label>
                    <select
                      id="attendee-type"
                      name="type"
                      defaultValue={ticketTypeId ?? ''}
                      className="min-h-10 rounded-pill border border-zinc-200 bg-white px-4 text-body"
                    >
                      <option value="">{t('attendees.anyTicketType')}</option>
                      {ticketTypes.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                    </select>
                    <label htmlFor="attendee-checkin" className="sr-only">
                      {t('attendees.checkIn')}
                    </label>
                    <select
                      id="attendee-checkin"
                      name="checkin"
                      defaultValue={checkedIn ?? ''}
                      className="min-h-10 rounded-pill border border-zinc-200 bg-white px-4 text-body"
                    >
                      <option value="">{t('attendees.anyCheckIn')}</option>
                      {CHECKED_IN_FILTERS.map((x) => (
                        <option key={x} value={x}>
                          {t(`attendees.checkedIn.${x}`)}
                        </option>
                      ))}
                    </select>
                  </>
                ) : null}
              </>
            ) : null}
            <button type="submit" className={buttonClass('secondary')}>
              {t('actions.search')}
            </button>
          </form>
        </search>

        {labelCounts.length > 0 ? (
          <nav aria-label={t('labels.filter')}>
            <ul className="flex list-none flex-wrap gap-1.5 p-0">
              {labelCounts.map((l) => {
                const on = labels.includes(l.label);
                return (
                  <li key={l.label}>
                    <Link
                      href={href({
                        label: on ? labels.filter((x) => x !== l.label) : [...labels, l.label],
                        page: undefined,
                        a: undefined,
                      })}
                      aria-current={on ? 'true' : undefined}
                      className={`inline-flex min-h-8 items-center gap-2 rounded-pill border px-3 text-[13px] ${on ? 'border-ink bg-ink text-white' : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50'}`}
                    >
                      {l.label}
                      <span className={`font-mono text-[11px] ${on ? 'text-white/70' : 'text-zinc-500'}`}>
                        {formatNumber(l.count, locale)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        ) : null}

        {op && opKind ? (
          <section
            aria-labelledby="bulk-status-heading"
            className="flex flex-col gap-2 rounded-panel border border-zinc-200 bg-white px-5 py-4"
          >
            {opActive ? <AutoRefresh seconds={2} /> : null}
            <h2 id="bulk-status-heading" className="text-section">
              {t(`bulk.title.${opKind}`)}
            </h2>
            <progress
              value={op.status === 'undone' ? op.total : op.processed}
              max={Math.max(1, op.total)}
              aria-label={t('bulk.progress', {
                processed: formatNumber(op.processed, locale),
                total: formatNumber(op.total, locale),
              })}
              className="h-2 w-full accent-ink"
            />
            <p className="text-body" role="status">
              {opKind === 'export' && op.status === 'done'
                ? t('bulk.exportDone', { succeeded: formatNumber(op.succeeded, locale) })
                : opKind === 'email' && op.status === 'done'
                  ? t('bulk.emailDone', { succeeded: formatNumber(op.succeeded, locale) })
                  : opKind === 'import' && op.status === 'done'
                    ? t('bulk.importDone', { succeeded: formatNumber(op.succeeded, locale) })
                    : (opKind === 'seats' || opKind === 'resend' || opKind === 'cancel') &&
                        op.status === 'done'
                      ? t(`bulk.${opKind}Done`, { count: op.succeeded, total: op.total })
                      : t(`bulk.status.${op.status}`, {
                          processed: formatNumber(op.processed, locale),
                          total: formatNumber(op.total, locale),
                          succeeded: formatNumber(op.succeeded, locale),
                          failed: formatNumber(op.failed, locale),
                          undone: formatNumber(op.undone, locale),
                        })}
            </p>
            {failureCodes.length ? (
              <ul className="flex list-none flex-col gap-1 p-0 text-caption text-pink-700">
                {failureCodes.map(([code, n]) => (
                  <li key={code}>
                    {t('bulk.failure', {
                      count: n,
                      reason: t(`bulk.code.${KNOWN_CODES.has(code) ? code : 'other'}`),
                    })}
                  </li>
                ))}
              </ul>
            ) : null}
            {warningCodes.length ? (
              <ul className="flex list-none flex-col gap-1 p-0 text-caption text-zinc-700">
                {warningCodes.map(([code, n]) => (
                  <li key={code}>
                    {t(`bulk.warning.${code === 'ada_kept_back' ? code : 'other'}`, { count: n })}
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {opKind === 'export' && op.status === 'done' && op.hasFile ? (
                <a
                  href={`${locale === 'en' ? '' : `/${locale}`}${base}/exports/${op.id}`}
                  className={buttonClass('primary', 'sm')}
                  download
                >
                  {t('bulk.download')}
                </a>
              ) : null}
              {opKind !== 'export' && op.undoUntil && (opKind === 'seats' ? canSeat : canWrite) ? (
                <form action={undoBulkAction.bind(null, org, event, opKind, op.id)}>
                  <Button type="submit" variant="secondary" size="sm">
                    {t('bulk.undo')}
                  </Button>
                </form>
              ) : null}
            </div>
          </section>
        ) : null}
        {sp.bulkError ? (
          <p
            role="alert"
            className="rounded-card border border-pink-700 bg-pink-50 px-4 py-3 text-body text-pink-700"
          >
            {t(errorMessageKey(sp.bulkError))}
          </p>
        ) : null}
        {canBulk && rows.length > 0 ? (
          <StepUpForm
            id="bulk-form"
            action={bulkAction.bind(null, org, event)}
            aria-label={t('bulk.formLabel')}
            className="flex flex-wrap items-end gap-3 rounded-card border border-zinc-200 bg-white px-4 py-3"
          >
            <input type="hidden" name="f_q" value={q} />
            {labels.map((l) => (
              <input key={l} type="hidden" name="f_label" value={l} />
            ))}
            <input type="hidden" name="f_source" value={source ?? ''} />
            <input type="hidden" name="f_status" value={status ?? ''} />
            <input type="hidden" name="f_type" value={ticketTypeId ?? ''} />
            <input type="hidden" name="f_checkin" value={checkedIn ?? ''} />
            <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <legend className="sr-only">{t('bulk.applyTo')}</legend>
              <label className="flex min-h-6 items-center gap-2 text-body">
                <input
                  type="radio"
                  name="scope"
                  value="selected"
                  defaultChecked
                  className="size-5 accent-ink"
                />
                {t('bulk.selected')}
              </label>
              <label className="flex min-h-6 items-center gap-2 text-body">
                <input type="radio" name="scope" value="all" className="size-5 accent-ink" />
                {t('bulk.allMatching', { count: live.total, formatted: formatNumber(live.total, locale) })}
              </label>
            </fieldset>
            <BulkFields
              canWrite={canWrite}
              canExport={canExport}
              canSeat={canSeat}
              canResend={canResend}
              canCancel={canCancel}
              labelSuggestions={labelCounts.map((l) => l.label)}
              seatTargets={seatTargets}
              seatDates={seatDates}
              adaEnforced={adaEnforced}
              matching={live.total}
            />
          </StepUpForm>
        ) : null}

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
              ...(canBulk
                ? [
                    {
                      key: 'select',
                      header: t('bulk.select'),
                      cell: (r: DemoAttendee) => (
                        <input
                          type="checkbox"
                          form="bulk-form"
                          name="ids"
                          value={r.id}
                          aria-label={t('bulk.selectOne', { name: r.name })}
                          className="size-5 accent-ink"
                        />
                      ),
                    },
                  ]
                : []),
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
                      {liveById.get(r.id)?.labels.length ? (
                        <span className="mt-1 flex flex-wrap gap-1">
                          {liveById.get(r.id)?.labels.map((l) => (
                            <Chip key={l}>{l}</Chip>
                          ))}
                        </span>
                      ) : null}
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
        {hasReal && live.total > 0 ? (
          <nav aria-label={t('attendees.pages')} className="flex flex-wrap items-center gap-3">
            <p className="text-caption text-zinc-500">
              {t('attendees.showing', {
                from: formatNumber(from, locale),
                to: formatNumber(to, locale),
                total: formatNumber(live.total, locale),
              })}
              {filtered ? ` · ${t('attendees.filtered')}` : ''}
            </p>
            {page > 1 ? (
              <Link
                href={href({ page: page > 2 ? String(page - 1) : undefined, a: undefined })}
                className={buttonClass('secondary', 'sm')}
              >
                {t('attendees.previous')}
              </Link>
            ) : null}
            {to < live.total ? (
              <Link
                href={href({ page: String(page + 1), a: undefined })}
                className={buttonClass('secondary', 'sm')}
              >
                {t('attendees.next')}
              </Link>
            ) : null}
          </nav>
        ) : null}
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
            {hasReal ? (
              <section aria-labelledby="labels-heading" className="flex flex-col gap-2">
                <h2 id="labels-heading" className="text-caption text-zinc-500">
                  {t('labels.title')}
                </h2>
                {selectedLabels.length ? (
                  <ul className="flex list-none flex-wrap gap-1.5 p-0">
                    {selectedLabels.map((l) => (
                      <li
                        key={l}
                        className="inline-flex items-center gap-1 rounded-pill border border-zinc-200 bg-zinc-50 ps-3 text-[13px]"
                      >
                        {l}
                        {canWrite ? (
                          <form action={removeLabelAction.bind(null, org, event, selected.id, l)}>
                            <button
                              type="submit"
                              aria-label={t('labels.remove', { label: l })}
                              className="flex size-7 items-center justify-center rounded-pill hover:bg-zinc-200"
                            >
                              <X aria-hidden="true" className="size-3.5" strokeWidth={1.6} />
                            </button>
                          </form>
                        ) : (
                          <span className="pe-3" />
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-caption text-zinc-500">{t('labels.none')}</p>
                )}
                {canWrite ? (
                  <LabelForm
                    action={addLabelAction.bind(null, org, event, selected.id)}
                    suggestions={labelCounts.map((l) => l.label).filter((l) => !selectedLabels.includes(l))}
                  />
                ) : null}
              </section>
            ) : null}
            {hasReal && selectedTicketId && canWrite ? (
              <section aria-labelledby="send-ticket-heading" className="flex flex-col gap-2">
                <h2 id="send-ticket-heading" className="text-caption text-zinc-500">
                  {t('distribution.title')}
                </h2>
                <p className="text-caption text-zinc-500">{t('distribution.hint')}</p>
                {openClaim ? (
                  <div className="flex flex-wrap items-center gap-2 text-caption">
                    <span>
                      {openClaim.recipientEmail
                        ? t('distribution.openTo', { email: openClaim.recipientEmail })
                        : t('distribution.open')}
                    </span>
                    <form action={revokeClaimAction.bind(null, org, event, openClaim.id)}>
                      <Button type="submit" variant="ghost" size="sm">
                        {t('distribution.revoke')}
                      </Button>
                    </form>
                  </div>
                ) : null}
                <ClaimLinkForm
                  action={sendTicketAction.bind(null, org, event, selectedTicketId)}
                  idPrefix="send-ticket"
                  submitLabel={t('distribution.create')}
                />
              </section>
            ) : null}
            {timeline && timeline.items.length > 0 ? (
              <section aria-labelledby="history-heading" className="flex flex-col gap-2">
                <h2 id="history-heading" className="text-caption text-zinc-500">
                  {t('timeline.title', { count: timeline.events })}
                </h2>
                <ol className="flex list-none flex-col gap-1.5 p-0 text-caption">
                  {timeline.items.slice(0, 12).map((i, n) => (
                    <li key={`${i.kind}-${i.at.toISOString()}-${n}`} className="flex flex-col">
                      <span className="text-zinc-900">
                        {t(`timeline.kind.${i.kind}`)}
                        {i.kind === 'order' && i.amountMinor !== null && i.currency
                          ? ` · ${formatMoney(money(i.amountMinor, i.currency), locale)}`
                          : ''}
                      </span>
                      <span className="text-zinc-500">
                        {i.eventName} · {when.format(i.at)}
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}
            {canWrite && selectedRecord && !selectedRecord.ticketId && selectedRecord.status === 'active' ? (
              <form action={removeGuestAction.bind(null, org, event, selectedRecord.id)}>
                <Button type="submit" variant="ghost" size="sm">
                  {t('guests.remove')}
                </Button>
              </form>
            ) : null}
            <div className="flex flex-wrap gap-2">
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
