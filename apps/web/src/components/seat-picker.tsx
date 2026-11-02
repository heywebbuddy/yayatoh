'use client';

import type { FloorplanDoc } from '@yayatoh/floorplan';
import { bareItemLabel, seatRegions } from '@yayatoh/floorplan';
import {
  activeAdaRule,
  activeCompanionRule,
  evaluateSeatRules,
  type RuleHit,
  type SeatingRule,
} from '@yayatoh/seating/client';
import { Button, paper, paperDark, seatPrices, seatPricesDark } from '@yayatoh/ui';
import { X } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useFormatter, useTranslations } from 'next-intl';
import { memo, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from '@/i18n/navigation.ts';
import { useCssomStyle } from '@/lib/cssom-style.ts';
import { priceLevels, type SectionStats, sectionStats } from '@/lib/seat-map-model.ts';
import { useSeatStream } from '@/lib/use-seat-stream.ts';

const SeatMapCanvas = dynamic(() => import('./seat-map-canvas.tsx'), {
  ssr: false,
  loading: () => <div className="h-80 w-full rounded-card border border-line bg-surface-2" />,
});

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
    /** M6.11a: a companion seat (sold with an accessible seat when the organizer says so). */
    readonly companion?: boolean;
    /** M6.11b: kept for another sales channel: never choosable here, whatever the live feed says. */
    readonly otherChannel?: boolean;
  }[];
  /** M6.11a: buyers may ask for the best available seats instead. */
  readonly bestAvailable?: boolean;
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

type Group = { id: string; kind: 'row' | 'table'; label: string; sectionId: string | null; seats: string[] };

/** The map's palette follows the resolved theme of the showcase surface; elsewhere it is paper. */
function useShowcaseDark(box: RefObject<HTMLElement | null>): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const showcase = box.current?.closest('[data-surface="showcase"]');
    if (!showcase) return setDark(false);
    // Light or dark follows the showcase's resolved colour scheme, also when the visitor switches.
    const read = () => setDark(getComputedStyle(showcase).colorScheme.includes('dark'));
    read();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', read);
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      mq.removeEventListener('change', read);
      mo.disconnect();
    };
  }, [box]);
  return dark;
}

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
 * Choose seats: the map, coloured by price, and beside it the buyer's seats, the sections and a
 * list grouped by row and table (every seat a checkbox, so it works by keyboard and screen
 * reader). All share one selection, the price filter and the section being shown; chosen seats
 * post as `seat` fields, and the server prices them from the seat map.
 *
 * Live (M1.7f): availability follows the event's seat stream, so a seat someone else takes goes
 * grey without a reload; a chosen seat that is taken is dropped from the choice and the buyer is
 * told (polite live region). The organizer's seating rules are shown, and the choice is checked
 * against them as it is made (the server checks again).
 */
export function SeatPicker({
  map,
  prices,
  priceAmounts,
  max = 20,
  stream = null,
  context = 'checkout',
  timeZone,
  accessibleNeed = false,
  onChoice,
  fieldName = 'seat',
}: {
  /** The form field chosen seats post as (one per date when booking several dates at once). */
  fieldName?: string;
  map: SeatMapView;
  /** Ticket type id → its all-in price label. */
  prices: Readonly<Record<string, string>>;
  /** Ticket type id → its all-in amount: it sorts the prices, cheapest first. */
  priceAmounts?: Readonly<Record<string, number>>;
  max?: number;
  stream?: SeatStreamSource | null;
  context?: 'checkout' | 'box_office';
  /** The event's timezone (rule dates are shown in it). */
  timeZone?: string;
  /** M6.11a: the buyer said someone in the party needs an accessible seat. */
  accessibleNeed?: boolean;
  onChoice?: (choice: SeatChoice) => void;
}) {
  const t = useTranslations('checkout.seats');
  const format = useFormatter();
  const router = useRouter();
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [live, setLive] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [notice, setNotice] = useState<string | null>(null);
  const [showMap, setShowMap] = useState(true);
  const [shownPrices, setShownPrices] = useState<ReadonlySet<string>>(new Set());
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const root = useRef<HTMLElement>(null);
  const dark = useShowcaseDark(root);
  const palette = dark ? seatPricesDark : seatPrices;
  const paper_ = dark ? paperDark : paper;
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const large = map.seats.length > LARGE_LIST;
  const bySeat = useMemo(() => new Map(map.seats.map((s) => [s.seatUuid, s])), [map.seats]);
  // A freshly loaded map is the truth again; live changes apply on top of it.
  useEffect(() => setLive(new Map()), [map]);
  const available = useMemo(
    () =>
      new Set(
        map.seats
          .filter((s) => !s.otherChannel && (live.get(s.seatUuid) ?? s.available))
          .map((s) => s.seatUuid),
      ),
    [map.seats, live],
  );
  const levels = useMemo(
    () => priceLevels(map.seats, prices, priceAmounts),
    [map.seats, prices, priceAmounts],
  );
  const levelByLabel = useMemo(() => new Map(levels.map((l) => [l.label, l])), [levels]);
  const levelOf = useCallback(
    (id: string) => levelByLabel.get(prices[bySeat.get(id)?.ticketTypeId ?? ''] ?? '') ?? null,
    [levelByLabel, prices, bySeat],
  );
  const colorOf = useCallback(
    (index: number) => palette[index % palette.length] ?? { fill: paper_.outline, ink: paper_.label },
    [palette, paper_],
  );
  const fills = useMemo(
    () =>
      new Map(
        map.seats.flatMap((s) => {
          const level = levelOf(s.seatUuid);
          return level ? [[s.seatUuid, colorOf(level.index).fill] as const] : [];
        }),
      ),
    [map.seats, levelOf, colorOf],
  );
  // Filtered out by price: free seats the buyer asked not to see.
  const muted = useMemo(
    () =>
      new Set(
        shownPrices.size === 0
          ? []
          : map.seats
              .filter((s) => {
                const level = levelOf(s.seatUuid);
                return level && !shownPrices.has(level.label);
              })
              .map((s) => s.seatUuid),
      ),
    [map.seats, shownPrices, levelOf],
  );
  const regions = useMemo(() => {
    // Only seats on sale count: a section with none has nothing to offer.
    const onSale = map.doc.items.map((i) =>
      i.kind === 'object' ? i : { ...i, seats: i.seats.filter((s) => bySeat.has(s.id)) },
    );
    return seatRegions({ ...map.doc, items: onSale });
  }, [map.doc, bySeat]);
  const stats = useMemo(
    () => sectionStats(regions, available, levelOf, shownPrices),
    [regions, available, levelOf, shownPrices],
  );
  const sectionFill = useCallback(
    (s: SectionStats | undefined) =>
      s?.from ? colorOf(s.from.index) : { fill: paper_.taken, ink: paper_.label },
    [colorOf, paper_],
  );
  // The section opened on the map comes into view in the panel's list (never scrolling the page).
  const sectionList = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const list = sectionList.current;
    const on = list?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (list && on) list.scrollTop = on.offsetTop - list.offsetTop;
  }, [activeSection]);
  const togglePrice = (label: string) =>
    setShownPrices((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      // Every price picked is the same as no filter.
      return next.size === levels.length ? new Set() : next;
    });
  // A seat taken meanwhile (a live change, or a refreshed map) drops out of the selection.
  const selected = useMemo(() => new Set([...picked].filter((id) => available.has(id))), [picked, available]);
  const labelOf = useCallback((id: string) => bySeat.get(id)?.label ?? '', [bySeat]);
  const pickedRef = useRef(picked);
  pickedRef.current = picked;

  const rules = map.rules ?? [];
  const startsAt = map.startsAt ? new Date(map.startsAt) : null;
  const now = new Date();
  const ada = startsAt ? activeAdaRule(rules, startsAt, now) : null;
  const companionRule = startsAt ? activeCompanionRule(rules, startsAt, now) : null;
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
              companion: bySeat.get(id)?.companion ?? false,
            })),
            startsAt,
            now: new Date(),
            accessibleNeed,
          })
        : [],
    [selected, map, context, bySeat, accessibleNeed],
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
  const tipOf = useCallback(
    (id: string) => {
      const seat = bySeat.get(id);
      if (!seat) return null;
      return {
        title: seat.label,
        detail: available.has(id)
          ? seat.accessible
            ? `${prices[seat.ticketTypeId] ?? ''} · ${t('accessible')}`
            : (prices[seat.ticketTypeId] ?? '')
          : t('taken'),
      };
    },
    [bySeat, available, prices, t],
  );
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
                sectionId: i.sectionId,
                seats: i.seats.filter((s) => bySeat.has(s.id)).map((s) => s.id),
              },
            ],
      ),
    [map.doc, bySeat],
  );
  // "Select whole table": every free seat of the table in one tap (or all of them off again). A
  // table bigger than what one order may hold selects nothing and says why.
  const toggleTable = useCallback(
    (groupId: string) => {
      const g = groups.find((x) => x.id === groupId);
      if (!g) return;
      const free = g.seats.filter((id) => available.has(id));
      if (free.length === 0) return setNotice(t('tableNoFree', { label: bareItemLabel(g.label) }));
      const next = new Set(selected);
      if (free.every((id) => next.has(id))) {
        for (const id of free) next.delete(id);
      } else {
        const add = free.filter((id) => !next.has(id));
        if (next.size + add.length > hardMax)
          return setNotice(
            t('tableTooBig', { label: bareItemLabel(g.label), free: free.length, max: hardMax }),
          );
        for (const id of add) next.add(id);
      }
      setNotice(null);
      setPicked(next);
    },
    [groups, available, selected, hardMax, t],
  );
  const toggleTableRef = useRef(toggleTable);
  toggleTableRef.current = toggleTable;
  const onToggleTable = useCallback((id: string) => toggleTableRef.current(id), []);
  const date = (d: Date) =>
    format.dateTime(d, { dateStyle: 'medium', timeStyle: 'short', ...(timeZone ? { timeZone } : {}) });
  const keptNote = ada?.severity === 'enforce' ? t('rules.keptUntil', { date: date(ada.releaseAt) }) : null;
  const warnings = hits.flatMap((h) => {
    if (h.rule === 'ada_reserved')
      return h.severity === 'warn' || context !== 'checkout'
        ? [t('rules.adaChosen', { count: h.seats.length, seats: h.seats.map(labelOf).join(', ') })]
        : [];
    // M6.11a: companion seats chosen without (enough) accessible seats; enforced ones are said
    // even online, since the order would be refused.
    if (h.rule === 'ada_companion')
      return [
        t(
          h.severity === 'enforce' && context === 'checkout'
            ? 'rules.companionRefused'
            : 'rules.companionChosen',
          {
            count: h.seats.length,
            seats: h.seats.map(labelOf).join(', '),
            max: h.maxPerAccessible,
          },
        ),
      ];
    return h.severity === 'warn' || context !== 'checkout'
      ? [t('rules.overCap', { max: h.max, count: h.count })]
      : [];
  });

  return (
    <section
      ref={root}
      aria-labelledby="seats-heading"
      className="@container flex flex-col gap-3 text-ink"
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
      {ada || capMax || companionRule ? (
        <ul className="flex list-none flex-col gap-1 p-0 text-caption text-ink-2">
          {ada ? (
            <li>
              {ada.severity === 'enforce'
                ? // M6.11a: with best available, a buyer who needs one can still get one online.
                  t(
                    map.bestAvailable && context === 'checkout'
                      ? 'rules.adaEnforcedBest'
                      : 'rules.adaEnforced',
                    {
                      date: date(ada.releaseAt),
                    },
                  )
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
          {companionRule ? (
            <li>
              {t(companionRule.severity === 'enforce' ? 'rules.companionEnforced' : 'rules.companionWarn', {
                max: companionRule.maxPerAccessible,
              })}
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
      {levels.length > 1 ? (
        <fieldset className="flex flex-wrap items-center gap-1.5">
          <legend className="float-start me-1.5 text-caption text-ink-2">{t('priceFilter')}</legend>
          {levels.map((level) => (
            <Button
              key={level.label}
              type="button"
              size="sm"
              variant={shownPrices.has(level.label) ? 'secondary' : 'ghost'}
              aria-pressed={shownPrices.has(level.label)}
              onClick={() => togglePrice(level.label)}
            >
              <Swatch fill={colorOf(level.index).fill} />
              {level.label}
            </Button>
          ))}
        </fieldset>
      ) : null}
      <div className={`grid gap-4 ${showMap ? '@3xl:grid-cols-[minmax(0,1.7fr)_minmax(17rem,1fr)]' : ''}`}>
        {showMap ? (
          <div className="flex min-w-0 flex-col gap-2">
            {/* The list beside it offers the same choices by keyboard and screen reader. */}
            <SeatMapCanvas
              doc={map.doc}
              dark={dark}
              regions={regions}
              stats={stats}
              sectionFill={sectionFill}
              activeSection={activeSection}
              available={available}
              selected={selected}
              muted={muted}
              fills={fills}
              tipOf={tipOf}
              onToggle={onToggle}
              onToggleTable={onToggleTable}
              onSection={setActiveSection}
            />
            <ul
              aria-label={t('mapKey')}
              className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-caption text-ink-2"
            >
              {levels.length === 1 && levels[0] ? (
                <KeyItem fill={colorOf(levels[0].index).fill} label={levels[0].label} />
              ) : null}
              <KeyItem fill={paper_.selected} stroke={paper_.label} label={t('keySelected')} />
              <KeyItem fill={paper_.taken} label={t('taken')} />
              {map.seats.some((s) => s.accessible) ? (
                <KeyItem
                  fill={colorOf(levels[0]?.index ?? 0).fill}
                  stroke={paper_.label}
                  label={t('accessible')}
                />
              ) : null}
            </ul>
          </div>
        ) : null}
        <div className="flex min-w-0 flex-col gap-3">
          {selected.size > 0 ? (
            <section aria-labelledby="your-seats" className="flex flex-col gap-1.5">
              <h4 id="your-seats" className="m-0 text-[13px] font-bold text-ink">
                {t('yourSeats')}
              </h4>
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {[...selected].map((id) => (
                  <li
                    key={id}
                    className="flex items-center justify-between gap-2 rounded-card border border-line bg-surface px-2.5 py-1 text-body"
                  >
                    <span className="min-w-0">{labelOf(id)}</span>
                    <span className="ms-auto shrink-0 text-ink-2">
                      {prices[bySeat.get(id)?.ticketTypeId ?? '']}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => onToggle(id)}
                      aria-label={t('removeSeat', { label: labelOf(id) })}
                    >
                      <X aria-hidden="true" className="size-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {regions.length > 0 ? (
            <section aria-labelledby="seat-sections" className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 id="seat-sections" className="m-0 text-[13px] font-bold text-ink">
                  {t('sections')}
                </h4>
                {activeSection ? (
                  <Button type="button" size="sm" variant="ghost" onClick={() => setActiveSection(null)}>
                    {t('allSections')}
                  </Button>
                ) : null}
              </div>
              <ul
                ref={sectionList}
                className="m-0 flex max-h-48 list-none flex-col gap-1 overflow-y-auto p-0"
              >
                {regions.map((r) => {
                  const s = stats.get(r.id);
                  const on = r.id === activeSection;
                  return (
                    <li key={r.id}>
                      <button
                        type="button"
                        aria-pressed={on}
                        onClick={() => setActiveSection(on ? null : r.id)}
                        className={`flex min-h-11 w-full items-center gap-2 rounded-card border px-2.5 py-1 text-start text-body ${on ? 'border-primary bg-primary-soft' : 'border-line bg-surface'}`}
                      >
                        <Swatch fill={sectionFill(s).fill} />
                        <span className="min-w-0 flex-1 font-bold">
                          {r.vip ? `${r.label} · ${t('vip')}` : r.label}
                        </span>
                        <span className="shrink-0 text-caption text-ink-2">
                          {s && s.left > 0
                            ? `${t('sectionFrom', { price: s.from?.label ?? '' })} · ${t('sectionLeft', { count: s.left })}`
                            : t(s?.free ? 'sectionOtherPrices' : 'sectionNone')}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
          <div className="flex max-h-96 flex-col gap-3 overflow-y-auto">
            {groups.map((g) => {
              // Filtered out: chosen seats still post, and still show where their group shows.
              const inSection = !activeSection || g.sectionId === activeSection;
              const visibleSeats = inSection
                ? g.seats.filter((id) => selected.has(id) || !muted.has(id))
                : [];
              if (visibleSeats.length === 0)
                return g.seats
                  .filter((id) => selected.has(id))
                  .map((id) => <input key={id} type="hidden" name={fieldName} value={id} />);
              const group = (
                <SeatGroup
                  key={g.id}
                  group={g}
                  sig={g.seats
                    .map(
                      (id) =>
                        `${available.has(id) ? 'a' : ''}${selected.has(id) ? 's' : ''}${visibleSeats.includes(id) ? '' : 'h'}`,
                    )
                    .join('|')}
                  visible={visibleSeats}
                  map={bySeat}
                  prices={prices}
                  keptNote={keptNote}
                  fieldName={fieldName}
                  available={available}
                  selected={selected}
                  onToggle={onToggle}
                  onToggleTable={onToggleTable}
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
                      group: t(`group.${g.kind}`, { label: bareItemLabel(g.label) }),
                      free: g.seats.filter((id) => available.has(id)).length,
                      total: g.seats.length,
                      chosen: g.seats.filter((id) => selected.has(id)).length,
                    })}
                  </summary>
                  {isOpen
                    ? group
                    : g.seats
                        .filter((id) => selected.has(id))
                        .map((id) => <input key={id} type="hidden" name={fieldName} value={id} />)}
                </details>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

/** A colour dot. Set through the CSSOM: the strict CSP refuses style attributes in server HTML. */
function Swatch({ fill, stroke }: { fill: string; stroke?: string }) {
  const ref = useCssomStyle<HTMLSpanElement>({
    background: fill,
    ...(stroke ? { borderColor: stroke } : {}),
  });
  return (
    <span
      ref={ref}
      aria-hidden="true"
      className={`size-3 shrink-0 rounded-full ${stroke ? 'border-2 border-solid' : ''}`}
    />
  );
}

/** One line of the map's key. */
function KeyItem({ fill, stroke, label }: { fill: string; stroke?: string; label: string }) {
  return (
    <li className="flex items-center gap-1.5">
      <Swatch fill={fill} {...(stroke ? { stroke } : {})} />
      {label}
    </li>
  );
}

/** One row or table of the list. Re-renders only when one of its seats changes (large rooms). */
const SeatGroup = memo(
  function SeatGroup({
    group,
    visible,
    map,
    prices,
    keptNote,
    fieldName,
    available,
    selected,
    onToggle,
    onToggleTable,
  }: {
    fieldName: string;
    group: Group;
    /** The seats of the group the filters leave shown. */
    visible: readonly string[];
    sig: string;
    map: ReadonlyMap<string, SeatMapView['seats'][number]>;
    prices: Readonly<Record<string, string>>;
    keptNote: string | null;
    available: ReadonlySet<string>;
    selected: ReadonlySet<string>;
    onToggle: (id: string) => void;
    onToggleTable: (groupId: string) => void;
  }) {
    const t = useTranslations('checkout.seats');
    const free = group.seats.filter((id) => available.has(id));
    const all = free.length > 0 && free.every((id) => selected.has(id));
    return (
      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-[13px] font-bold text-ink">
          {t(`group.${group.kind}`, { label: bareItemLabel(group.label) })}
        </legend>
        {group.kind === 'table' && free.length > 0 ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="self-start"
            aria-pressed={all}
            onClick={() => onToggleTable(group.id)}
          >
            {all ? t('unselectTable', { count: free.length }) : t('selectTable', { count: free.length })}
            <span className="sr-only">
              {' '}
              — {t(`group.${group.kind}`, { label: bareItemLabel(group.label) })}
            </span>
          </Button>
        ) : null}
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {visible.map((id) => {
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
                  name={fieldName}
                  value={id}
                  className="size-5"
                  disabled={!free}
                  checked={selected.has(id)}
                  onChange={() => onToggle(id)}
                />
                {t('seat', { label: seat.label, price: prices[seat.ticketTypeId] ?? '' })}
                {seat.accessible ? <span className="text-caption">{t('accessible')}</span> : null}
                {seat.companion && !seat.accessible ? (
                  <span className="text-caption">{t('companion')}</span>
                ) : null}
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
    a.onToggle === b.onToggle &&
    a.onToggleTable === b.onToggleTable,
);
