'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useId, useRef, useState } from 'react';
import { BestAvailablePanel, type BestSeatsActions } from '@/components/best-available.tsx';
import {
  type SeatChoice,
  type SeatMapView,
  SeatPicker,
  type SeatStreamSource,
} from '@/components/seat-picker.tsx';

/**
 * How seats are chosen (M6.11a): "best available" (how many, at which price) or the seat list and
 * map, when the organizer offers both; and, when the plan has accessible seats, the buyer's
 * statement that someone in the party needs one (it lets them take seats kept back for those who
 * need them, and asks best available for an accessible seat with companion seats).
 */
export function SeatSelection({
  map,
  prices,
  levels,
  max = 20,
  stream = null,
  context = 'checkout',
  timeZone,
  best = null,
  ada = false,
  occurrenceId,
  onChoice,
}: {
  map: SeatMapView;
  prices: Readonly<Record<string, string>>;
  /** The prices sold by seat, for best available. */
  levels: readonly { readonly id: string; readonly label: string }[];
  max?: number;
  stream?: SeatStreamSource | null;
  context?: 'checkout' | 'box_office';
  timeZone?: string;
  /** Best available's server actions; null = only choosing seats. */
  best?: BestSeatsActions | null;
  /** The org has the ADA engine (advanced seating): the accessible-seat statement is offered. */
  ada?: boolean;
  occurrenceId?: () => string | null;
  onChoice?: (choice: SeatChoice) => void;
}) {
  const t = useTranslations('checkout.best');
  const id = useId();
  const offered = Boolean(map.bestAvailable && best && levels.length);
  const [mode, setMode] = useState<'best' | 'pick'>(offered ? 'best' : 'pick');
  const [need, setNeed] = useState(false);
  const hasAccessible = ada && map.seats.some((s) => s.accessible);
  // The hold best available shows: given back when the buyer switches to choosing seats.
  const held = useRef<string | null>(null);
  const onHold = useCallback((token: string | null) => {
    held.current = token;
  }, []);
  const choose = (m: 'best' | 'pick') => {
    setMode(m);
    // Best available chooses no seats from the list.
    if (m === 'best') onChoice?.({ seats: [], hits: [] });
    else if (held.current && best) {
      void best.release(held.current);
      held.current = null;
    }
  };
  return (
    <div className="flex flex-col gap-4">
      {hasAccessible ? (
        <div className="flex flex-col gap-1">
          <label className="flex min-h-11 items-start gap-2.5 text-body">
            <input
              type="checkbox"
              name="accessibleNeed"
              value="1"
              checked={need}
              onChange={(e) => setNeed(e.currentTarget.checked)}
              aria-describedby={`${id}-need-hint`}
              className="mt-0.5 size-5 shrink-0"
            />
            <span>{t(context === 'box_office' ? 'needStaff' : 'need')}</span>
          </label>
          <p id={`${id}-need-hint`} className="ps-7.5 text-caption text-zinc-600">
            {t('needHint')}
          </p>
        </div>
      ) : null}
      {offered ? (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-section">{t('modeLegend')}</legend>
          <input type="hidden" name="seatMode" value={mode} />
          {(['best', 'pick'] as const).map((m) => (
            <label key={m} className="flex min-h-11 items-center gap-2.5 text-body">
              <input
                type="radio"
                name={`${id}-mode`}
                value={m}
                checked={mode === m}
                onChange={() => choose(m)}
                className="size-5"
              />
              {t(`mode.${m}`)}
            </label>
          ))}
        </fieldset>
      ) : null}
      {offered && best && mode === 'best' ? (
        <section aria-label={t('title')} className="flex flex-col gap-3">
          <BestAvailablePanel
            levels={levels}
            max={Math.min(max, 20)}
            accessible={need}
            actions={best}
            onHold={onHold}
            {...(occurrenceId ? { occurrenceId } : {})}
          />
        </section>
      ) : (
        <SeatPicker
          map={map}
          prices={prices}
          max={max}
          stream={stream}
          context={context}
          accessibleNeed={need}
          {...(timeZone ? { timeZone } : {})}
          {...(onChoice ? { onChoice } : {})}
        />
      )}
    </div>
  );
}
