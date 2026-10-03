'use client';

import {
  type GuestSnapshot,
  type SnapshotGuest,
  type SnapshotPlace,
  searchGuests,
  snapshotLabels,
} from '@yayatoh/checkin-engine';
import { Button, EmptyState, filterChipClass, StatusPill } from '@yayatoh/ui';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useId, useMemo, useRef, useState } from 'react';
import type { ScanClient } from '@/scan/client.ts';

/** "Table 3", "Row A", "Reception: Table 3" (the board, the kiosk and staff alike). */
export function usePlaceText() {
  const t = useTranslations('scanGuests');
  return (p: SnapshotPlace) => {
    const place = t(p.kind === 'row' ? 'placeRow' : 'placeTable', { label: p.label });
    return p.chart ? t('placeOnChart', { chart: p.chart, place }) : place;
  };
}

/** A guest's name, or "Guest of …" for an unnamed plus-one. */
export function useGuestName() {
  const t = useTranslations('scanGuests');
  return (g: Pick<SnapshotGuest, 'name' | 'guestOf'>) => g.name ?? t('guestOf', { name: g.guestOf ?? '?' });
}

/**
 * Guest check-in in the Scan PWA (M4.4b): staff find a guest by their name or their party's, or
 * narrow the list by the host's labels, and check them (or the whole party) in. Works offline from
 * the device's guest snapshot; check-ins queue and sync like ticket scans.
 */
export function GuestCheckinPanel({
  client,
  version,
  afterChange,
}: {
  client: ScanClient;
  /** Bumped when the snapshot or the local arrivals change: re-read. */
  version: number;
  afterChange: () => void;
}) {
  const t = useTranslations('scanGuests');
  const locale = useLocale();
  const format = useFormatter();
  const placeText = usePlaceText();
  const nameOf = useGuestName();
  const id = useId();
  const field = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [labels, setLabels] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const snap: GuestSnapshot | null = useMemo(() => client.guests.view(), [client, version, tick]);
  const allLabels = useMemo(() => (snap ? snapshotLabels(snap, locale) : []), [snap, locale]);
  const results = useMemo(() => (snap ? searchGuests(snap, query, labels) : []), [snap, query, labels]);
  const totals = useMemo(() => {
    const all = snap?.parties.flatMap((p) => p.guests).filter((g) => g.status !== 'declined') ?? [];
    return { expected: all.length, arrived: all.filter((g) => g.arrivedAt).length };
  }, [snap]);

  async function checkIn(guests: readonly SnapshotGuest[]) {
    const done: SnapshotGuest[] = [];
    for (const g of guests)
      if (await client.guests.checkIn(g.id, 'scanner', client.clockOffsetMs)) done.push(g);
    setTick((n) => n + 1);
    const first = done[0];
    if (done.length === 1 && first)
      setMessage(
        first.places.length
          ? t('checkedInAt', { name: nameOf(first), place: first.places.map(placeText).join(', ') })
          : t('checkedInNoPlace', { name: nameOf(first) }),
      );
    else if (done.length > 1) setMessage(t('checkedInMany', { count: done.length }));
    afterChange();
  }

  if (!snap || snap.parties.length === 0)
    return <EmptyState title={t('noListTitle')} description={t('noListDescription')} />;

  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-4" data-guest-checkin>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={`${id}-title`} className="text-section">
          {t('title')}
        </h2>
        <p className="text-body text-ink-2" data-testid="guest-totals">
          {t('arrivedOf', { arrived: totals.arrived, expected: totals.expected })}
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-q`} className="text-[13px] font-bold text-ink">
          {t('searchLabel')}
        </label>
        <input
          ref={field}
          id={`${id}-q`}
          type="search"
          value={query}
          autoComplete="off"
          spellCheck={false}
          aria-describedby={`${id}-q-hint`}
          onChange={(e) => {
            setQuery(e.target.value);
            setMessage(null);
          }}
          className="field field-lg w-full"
        />
        <p id={`${id}-q-hint`} className="text-caption text-ink-2">
          {t('searchHint')}
        </p>
      </div>
      {allLabels.length ? (
        <fieldset className="m-0 flex flex-wrap gap-2 border-0 p-0">
          <legend className="sr-only">{t('labels')}</legend>
          {allLabels.map((l) => {
            const on = labels.includes(l);
            return (
              <button
                key={l}
                type="button"
                aria-pressed={on}
                onClick={() => setLabels((ls) => (on ? ls.filter((x) => x !== l) : [...ls, l]))}
                className={`${filterChipClass(on)} min-h-11`}
              >
                {l}
              </button>
            );
          })}
        </fieldset>
      ) : null}
      <div role="status" aria-live="polite" data-testid="guest-message">
        {message ? <p className="text-body font-semibold text-success">{message}</p> : null}
        {message && snap.card ? <CardSavingEntry card={snap.card} /> : null}
      </div>
      {!query.trim() && labels.length === 0 ? (
        <p className="text-body text-ink-2">{t('startHint')}</p>
      ) : results.length === 0 ? (
        <EmptyState title={t('noMatchTitle')} description={t('noMatchDescription')} />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0" aria-label={t('results')}>
          {results.map((p) => {
            const waiting = p.guests.filter((g) => !g.arrivedAt && g.status !== 'declined');
            return (
              <li
                key={p.id}
                className="flex flex-col gap-2 rounded-card border border-line px-4 py-3"
                data-party={p.name}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-body font-bold">
                    {p.name}
                    {p.tags.length ? (
                      <span className="ms-2 text-caption font-normal text-ink-2">{p.tags.join(' · ')}</span>
                    ) : null}
                  </h3>
                  {waiting.length > 1 ? (
                    <Button
                      type="button"
                      variant="secondary"
                      className="min-h-11"
                      onClick={() => void checkIn(waiting)}
                    >
                      {t('checkInParty', { count: waiting.length, party: p.name })}
                    </Button>
                  ) : null}
                </div>
                <ul className="m-0 flex list-none flex-col gap-2 p-0">
                  {p.guests.map((g) => (
                    <li
                      key={g.id}
                      className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2"
                      data-guest={nameOf(g)}
                    >
                      <div className="flex flex-col">
                        <span className="text-body font-medium">{nameOf(g)}</span>
                        <span className="text-caption text-ink-2">
                          {g.places.length ? g.places.map(placeText).join(' · ') : t('noPlace')}
                        </span>
                      </div>
                      {g.arrivedAt ? (
                        <StatusPill
                          tone="success"
                          label={t('arrivedAt', {
                            time: format.dateTime(new Date(g.arrivedAt), { timeStyle: 'short' }),
                          })}
                        />
                      ) : g.status === 'declined' ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusPill tone="danger" label={t('declined')} />
                          <Button
                            type="button"
                            variant="secondary"
                            className="min-h-11"
                            aria-label={t('checkInGuest', { name: nameOf(g) })}
                            onClick={() => void checkIn([g])}
                          >
                            {t('checkIn')}
                          </Button>
                        </div>
                      ) : (
                        <Button
                          type="button"
                          className="min-h-11"
                          aria-label={t('checkInGuest', { name: nameOf(g) })}
                          onClick={() => void checkIn([g])}
                        >
                          {t('checkIn')}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * M4.8e on M4.4b's check-in (batch 3j merge): right after a guest arrives, while the event takes
 * gifts, the card-saving code for them to scan with their own phone (works offline: it came with
 * the snapshot). Saving a card stays opt-in on the guest's device (P4-14).
 */
function CardSavingEntry({ card }: { card: { url: string; size: number; d: string } }) {
  const t = useTranslations('scanGuests');
  return (
    <div
      className="flex flex-wrap items-center gap-4 rounded-card border border-line bg-surface px-4 py-3"
      data-testid="checkin-card-qr"
      data-url={card.url}
    >
      <svg
        role="img"
        aria-label={t('cardQrLabel')}
        viewBox={`0 0 ${card.size} ${card.size}`}
        shapeRendering="crispEdges"
        className="size-32 shrink-0 rounded-tile border border-line text-black"
      >
        <rect width={card.size} height={card.size} className="fill-white" />
        <path d={card.d} fill="currentColor" />
      </svg>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="m-0 text-body font-semibold">{t('cardTitle')}</p>
        <p className="m-0 text-caption text-ink-2">{t('cardBody')}</p>
      </div>
    </div>
  );
}
