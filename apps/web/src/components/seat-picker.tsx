'use client';

import type { FloorplanDoc } from '@yayatoh/floorplan';
import { Button } from '@yayatoh/ui';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

const SeatMapCanvas = dynamic(() => import('./seat-map-canvas.tsx'), { ssr: false });

export interface SeatMapView {
  readonly doc: FloorplanDoc;
  readonly seats: readonly {
    readonly seatUuid: string;
    readonly label: string;
    readonly ticketTypeId: string;
    readonly available: boolean;
    readonly accessible: boolean;
  }[];
}

/**
 * Choose seats: a list grouped by row and table (every seat a checkbox, so it works by keyboard
 * and screen reader) and, on request, the map. Both share one selection; chosen seats post as
 * `seat` fields, and the server prices them from the seat map.
 */
export function SeatPicker({
  map,
  prices,
  max = 20,
}: {
  map: SeatMapView;
  /** Ticket type id → its all-in price label. */
  prices: Readonly<Record<string, string>>;
  max?: number;
}) {
  const t = useTranslations('checkout.seats');
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [showMap, setShowMap] = useState(false);
  const bySeat = useMemo(() => new Map(map.seats.map((s) => [s.seatUuid, s])), [map.seats]);
  const available = useMemo(
    () => new Set(map.seats.filter((s) => s.available).map((s) => s.seatUuid)),
    [map.seats],
  );
  // A refreshed map (a seat just taken) drops that seat from the selection.
  const selected = useMemo(() => new Set([...picked].filter((id) => available.has(id))), [picked, available]);
  const toggle = (id: string) => {
    if (!available.has(id)) return;
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else if (next.size < max) next.add(id);
    setPicked(next);
  };
  const groups = map.doc.items.flatMap((i) =>
    i.kind === 'object'
      ? []
      : [{ id: i.id, kind: i.kind, label: i.label, seats: i.seats.filter((s) => bySeat.has(s.id)) }],
  );
  return (
    <section aria-labelledby="seats-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <h3 id="seats-heading" className="text-section">
          {t('title')}
        </h3>
        <p role="status" className="text-caption text-zinc-600">
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
      {showMap ? (
        // The list below offers the same choices by keyboard and screen reader.
        <div aria-hidden="true">
          <SeatMapCanvas doc={map.doc} available={available} selected={selected} onToggle={toggle} />
        </div>
      ) : null}
      <div className="flex max-h-96 flex-col gap-3 overflow-y-auto">
        {groups.map((g) => (
          <fieldset key={g.id} className="flex flex-col gap-1.5">
            <legend className="text-caption text-zinc-600">{t(`group.${g.kind}`, { label: g.label })}</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {g.seats.map((s) => {
                const seat = bySeat.get(s.id);
                if (!seat) return null;
                return (
                  <label
                    key={s.id}
                    className={`flex min-h-6 items-center gap-2 text-body ${seat.available ? '' : 'text-zinc-400'}`}
                  >
                    <input
                      type="checkbox"
                      name="seat"
                      value={s.id}
                      className="size-5"
                      disabled={!seat.available}
                      checked={selected.has(s.id)}
                      onChange={() => toggle(s.id)}
                    />
                    {t('seat', { label: seat.label, price: prices[seat.ticketTypeId] ?? '' })}
                    {seat.accessible ? <span className="text-caption">{t('accessible')}</span> : null}
                    {seat.available ? null : <span className="sr-only">{t('taken')}</span>}
                  </label>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>
    </section>
  );
}
