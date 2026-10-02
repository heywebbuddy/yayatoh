'use client';

import type { FloorplanDoc } from '@yayatoh/floorplan';
import { activeAdaRule, evaluateSeatRules, type RuleHit, type SeatingRule } from '@yayatoh/seating/client';
import { Button } from '@yayatoh/ui';
import dynamic from 'next/dynamic';
import { useFormatter, useTranslations } from 'next-intl';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from '@/i18n/navigation.ts';
import { useSeatStream } from '@/lib/use-seat-stream.ts';

const SeatMapCanvas = dynamic(() => import('./seat-map-canvas.tsx'), { ssr: false });

/** Above this many seats the list shows rows and tables closed, each opening on request. */
const LARGE_LIST = 400;

export interface SeatMapView {
  readonly doc: FloorplanDoc;
  /** The event's start and the organizer's seating rules (M1.7f); absent on older callers. */
  readonly startsAt?: Date;
  readonly rules?: readonly SeatingRule[];
  readonly seats: readonly {
    readonly seatUuid: string;
    readonly label: string;
    readonly ticketTypeId: string;
    readonly available: boolean;
    readonly accessible: boolean;
  }[];
}

/** Where the live availability comes from: the public stream, or the organizer's (box office). */
export interface SeatStreamSource {
  readonly url: string;
  readonly kind: 'public' | 'staff';
}

export interface SeatChoice {
  readonly seats: readonly string[];
  readonly hits: readonly RuleHit[];
}

type Group = { id: string; kind: 'row' | 'table'; label: string; seats: string[] };

/** Live messages → seat availability entries. */
function entriesOf(kind: SeatStreamSource['kind'], data: unknown): [string, boolean][] {
  if (!data || typeof data !== 'object') return [];
  if (kind === 'public') {
    const d = data as { on?: unknown; off?: unknown };
    const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
    return [
      ...ids(d.on).map((k) => [k, true] as [string, boolean]),
      ...ids(d.off).map((k) => [k, false] as [string, boolean]),
    ];
  }
  const seats = (data as { seats?: unknown }).seats;
  if (!seats || typeof seats !== 'object') return [];
  return Object.entries(seats as Record<string, unknown>).map(([k, v]) => [k, v === 'available']);
}

/**
 * Choose seats: a list grouped by row and table (every seat a checkbox, so it works by keyboard
 * and screen reader) and, on request, the map. Both share one selection; chosen seats post as
 * `seat` fields, and the server prices them from the seat map.
 *
 * Live (M1.7f): availability follows the event's seat stream, so a seat someone else takes goes
 * grey without a reload; a chosen seat that is taken is dropped from the choice and the buyer is
 * told (polite live region). The organizer's seating rules are shown, and the choice is checked
 * against them as it is made (the server checks again).
 */
export function SeatPicker({
  map,
  prices,
  max = 20,
  stream = null,
  context = 'checkout',
  timeZone,
  onChoice,
}: {
  map: SeatMapView;
  /** Ticket type id → its all-in price label. */
  prices: Readonly<Record<string, string>>;
  max?: number;
  stream?: SeatStreamSource | null;
  context?: 'checkout' | 'box_office';
  /** The event's timezone (rule dates are shown in it). */
  timeZone?: string;
  onChoice?: (choice: SeatChoice) => void;
}) {
  const t = useTranslations('checkout.seats');
  const format = useFormatter();
  const router = useRouter();
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [live, setLive] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [notice, setNotice] = useState<string | null>(null);
  const [showMap, setShowMap] = useState(false);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const large = map.seats.length > LARGE_LIST;
  const bySeat = useMemo(() => new Map(map.seats.map((s) => [s.seatUuid, s])), [map.seats]);
  // A freshly loaded map is the truth again; live changes apply on top of it.
  useEffect(() => setLive(new Map()), [map]);
  const available = useMemo(
    () => new Set(map.seats.filter((s) => live.get(s.seatUuid) ?? s.available).map((s) => s.seatUuid)),
    [map.seats, live],
  );
  // A seat taken meanwhile (a live change, or a refreshed map) drops out of the selection.
  const selected = useMemo(() => new Set([...picked].filter((id) => available.has(id))), [picked, available]);
  const labelOf = useCallback((id: string) => bySeat.get(id)?.label ?? '', [bySeat]);
  const pickedRef = useRef(picked);
  pickedRef.current = picked;

  const rules = map.rules ?? [];
  const startsAt = map.startsAt ? new Date(map.startsAt) : null;
  const now = new Date();
  const ada = startsAt ? activeAdaRule(rules, startsAt, now) : null;
  const cap = rules.find((r) => r.kind === 'max_per_order_seats');
  const capMax = cap?.kind === 'max_per_order_seats' ? cap.params.max : null;
  const hardMax =
    context === 'checkout' && cap?.severity === 'enforce' && capMax ? Math.min(max, capMax) : max;
  const hits = useMemo(
    () =>
      startsAt
        ? evaluateSeatRules(rules, {
            context,
            seats: [...selected].map((id) => ({
              seatUuid: id,
              accessible: bySeat.get(id)?.accessible ?? false,
            })),
            startsAt,
            now: new Date(),
          })
        : [],
    [selected, map, context, bySeat],
  );
  const choiceKey = `${[...selected].join(',')}|${hits.map((h) => `${h.rule}:${h.severity}`).join(',')}`;
  useEffect(() => onChoice?.({ seats: [...selected], hits }), [choiceKey]);

  const apply = useCallback(
    (entries: [string, boolean][]) => {
      if (!entries.length) return;
      setLive((prev) => {
        const next = new Map(prev);
        for (const [k, v] of entries) next.set(k, v);
        return next;
      });
      const lost = entries.filter(([k, v]) => !v && pickedRef.current.has(k)).map(([k]) => k);
      if (lost.length) {
        setPicked((p) => new Set([...p].filter((id) => !lost.includes(id))));
        setNotice(t('dropped', { count: lost.length, seats: lost.map(labelOf).join(', ') }));
      }
    },
    [labelOf, t],
  );
  const kind = stream?.kind ?? 'public';
  const liveState = useSeatStream(stream?.url ?? null, {
    onSnapshot: (data) => apply(entriesOf(kind, data)),
    onDelta: (data) => apply(entriesOf(kind, data)),
    onRefresh: () => router.refresh(),
  });

  const toggle = useCallback(
    (id: string) => {
      if (!available.has(id)) return;
      const next = new Set(selected);
      if (next.has(id)) next.delete(id);
      else if (next.size < hardMax) next.add(id);
      else
        return setNotice(
          hardMax < max && capMax
            ? t('rules.capReached', { max: capMax })
            : t('maxReached', { max: hardMax }),
        );
      setNotice(null);
      setPicked(next);
    },
    [available, selected, hardMax, max, capMax, t],
  );
  // One stable callback for the list groups and the map (the groups re-render only on change).
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;
  const onToggle = useCallback((id: string) => toggleRef.current(id), []);
  const groups: Group[] = useMemo(
    () =>
      map.doc.items.flatMap((i) =>
        i.kind === 'object'
          ? []
          : [
              {
                id: i.id,
                kind: i.kind,
                label: i.label,
                seats: i.seats.filter((s) => bySeat.has(s.id)).map((s) => s.id),
              },
            ],
      ),
    [map.doc, bySeat],
  );
  const date = (d: Date) =>
    format.dateTime(d, { dateStyle: 'medium', timeStyle: 'short', ...(timeZone ? { timeZone } : {}) });
  const keptNote = ada?.severity === 'enforce' ? t('rules.keptUntil', { date: date(ada.releaseAt) }) : null;
  const warnings = hits.flatMap((h) => {
    if (h.rule === 'ada_reserved')
      return h.severity === 'warn' || context !== 'checkout'
        ? [t('rules.adaChosen', { count: h.seats.length, seats: h.seats.map(labelOf).join(', ') })]
        : [];
    return h.severity === 'warn' || context !== 'checkout'
      ? [t('rules.overCap', { max: h.max, count: h.count })]
      : [];
  });

  return (
    <section
      aria-labelledby="seats-heading"
      className="flex flex-col gap-3"
      data-live={stream ? liveState : undefined}
    >
      <div className="flex flex-wrap items-center gap-3">
        <h3 id="seats-heading" className="text-section">
          {t('title')}
        </h3>
        <p role="status" className="text-caption text-ink-2">
          {t('selected', { count: selected.size })}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setShowMap(!showMap)}
          aria-expanded={showMap}
        >
          {showMap ? t('hideMap') : t('showMap')}
        </Button>
      </div>
      {ada || capMax ? (
        <ul className="flex list-none flex-col gap-1 p-0 text-caption text-ink-2">
          {ada ? (
            <li>
              {ada.severity === 'enforce'
                ? t('rules.adaEnforced', { date: date(ada.releaseAt) })
                : t('rules.adaWarn', { date: date(ada.releaseAt) })}
            </li>
          ) : null}
          {capMax ? (
            <li>
              {cap?.severity === 'enforce'
                ? t('rules.capEnforced', { max: capMax })
                : t('rules.capWarn', { max: capMax })}
            </li>
          ) : null}
        </ul>
      ) : null}
      {/* Live changes, limits and rule warnings are announced politely. */}
      <div aria-live="polite" className="flex flex-col gap-1">
        {notice ? (
          <p
            className="rounded-card border border-line bg-surface-2 px-3 py-2 text-body"
            data-testid="seat-notice"
          >
            {notice}
          </p>
        ) : null}
        {warnings.map((w) => (
          <p
            key={w}
            className="rounded-card border border-primary/40 bg-primary-soft px-3 py-2 text-body text-primary-ink"
          >
            {w}
          </p>
        ))}
      </div>
      {showMap ? (
        // The list below offers the same choices by keyboard and screen reader.
        <SeatMapCanvas doc={map.doc} available={available} selected={selected} onToggle={onToggle} />
      ) : null}
      <div className="flex max-h-96 flex-col gap-3 overflow-y-auto">
        {groups.map((g) => {
          const group = (
            <SeatGroup
              key={g.id}
              group={g}
              sig={g.seats
                .map((id) => `${available.has(id) ? 'a' : ''}${selected.has(id) ? 's' : ''}`)
                .join('|')}
              map={bySeat}
              prices={prices}
              keptNote={keptNote}
              available={available}
              selected={selected}
              onToggle={onToggle}
            />
          );
          if (!large) return group;
          // Large rooms: each row or table opens on request (thousands of boxes at once help no
          // one); chosen seats in a closed one still post.
          const isOpen = open.has(g.id);
          return (
            <details
              key={g.id}
              open={isOpen}
              onToggle={(e) => {
                const now = e.currentTarget.open;
                setOpen((prev) => {
                  if (prev.has(g.id) === now) return prev;
                  const next = new Set(prev);
                  if (now) next.add(g.id);
                  else next.delete(g.id);
                  return next;
                });
              }}
              className="flex flex-col gap-1.5"
            >
              <summary className="min-h-6 cursor-pointer text-body">
                {t('groupSummary', {
                  group: t(`group.${g.kind}`, { label: g.label }),
                  free: g.seats.filter((id) => available.has(id)).length,
                  total: g.seats.length,
                  chosen: g.seats.filter((id) => selected.has(id)).length,
                })}
              </summary>
              {isOpen
                ? group
                : g.seats
                    .filter((id) => selected.has(id))
                    .map((id) => <input key={id} type="hidden" name="seat" value={id} />)}
            </details>
          );
        })}
      </div>
    </section>
  );
}

/** One row or table of the list. Re-renders only when one of its seats changes (large rooms). */
const SeatGroup = memo(
  function SeatGroup({
    group,
    map,
    prices,
    keptNote,
    available,
    selected,
    onToggle,
  }: {
    group: Group;
    sig: string;
    map: ReadonlyMap<string, SeatMapView['seats'][number]>;
    prices: Readonly<Record<string, string>>;
    keptNote: string | null;
    available: ReadonlySet<string>;
    selected: ReadonlySet<string>;
    onToggle: (id: string) => void;
  }) {
    const t = useTranslations('checkout.seats');
    return (
      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-[13px] font-bold text-ink">
          {t(`group.${group.kind}`, { label: group.label })}
        </legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {group.seats.map((id) => {
            const seat = map.get(id);
            if (!seat) return null;
            const free = available.has(id);
            return (
              <label
                key={id}
                className={`flex min-h-6 items-center gap-2 text-body ${free ? '' : 'text-ink-3'}`}
              >
                <input
                  type="checkbox"
                  name="seat"
                  value={id}
                  className="size-5"
                  disabled={!free}
                  checked={selected.has(id)}
                  onChange={() => onToggle(id)}
                />
                {t('seat', { label: seat.label, price: prices[seat.ticketTypeId] ?? '' })}
                {seat.accessible ? <span className="text-caption">{t('accessible')}</span> : null}
                {seat.accessible && !free && keptNote ? (
                  <span className="text-caption">{keptNote}</span>
                ) : null}
                {free ? null : <span className="sr-only">{t('taken')}</span>}
              </label>
            );
          })}
        </div>
      </fieldset>
    );
  },
  (a, b) =>
    a.sig === b.sig &&
    a.group === b.group &&
    a.prices === b.prices &&
    a.keptNote === b.keptNote &&
    a.onToggle === b.onToggle,
);
