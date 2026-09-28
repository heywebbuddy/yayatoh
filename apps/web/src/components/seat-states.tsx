'use client';

import { LIVE_SEAT_STATES, type LiveSeatState, type SeatCounts } from '@yayatoh/seating/client';
import { useTranslations } from 'next-intl';
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';
import { useRouter } from '@/i18n/navigation.ts';
import { type StreamState, useSeatStream } from '@/lib/use-seat-stream.ts';

interface SeatStates {
  readonly states: Readonly<Record<string, LiveSeatState>>;
  readonly counts: SeatCounts;
  readonly live: StreamState;
}

const SeatStatesContext = createContext<SeatStates | null>(null);

/** The organizer's live seat states (M1.7f), if a provider is above; null otherwise. */
export const useSeatStates = () => useContext(SeatStatesContext);

const isStates = (v: unknown): v is Record<string, LiveSeatState> =>
  Boolean(v) &&
  typeof v === 'object' &&
  Object.values(v as object).every((s) => (LIVE_SEAT_STATES as readonly unknown[]).includes(s));

/**
 * Follows the organizer's seat stream (M1.7f): every seat's state and the counts, as buyers hold
 * and buy seats, the box office sells and guests are seated — without reloading the page.
 */
export function SeatStatesProvider({
  url,
  initialStates,
  initialCounts,
  children,
}: {
  url: string;
  initialStates: Readonly<Record<string, LiveSeatState>>;
  initialCounts: SeatCounts;
  children: ReactNode;
}) {
  const router = useRouter();
  const [states, setStates] = useState(initialStates);
  const [counts, setCounts] = useState(initialCounts);
  // A server render (after an edit) is the truth again.
  useEffect(() => {
    setStates(initialStates);
    setCounts(initialCounts);
  }, [initialStates, initialCounts]);
  const take = (data: unknown, replace: boolean) => {
    const d = data as { counts?: SeatCounts; seats?: unknown } | null;
    if (!d || !isStates(d.seats)) return;
    const seats = d.seats;
    setStates((prev) => (replace ? seats : { ...prev, ...seats }));
    if (d.counts) setCounts(d.counts);
  };
  const live = useSeatStream(url, {
    onSnapshot: (data) => take(data, true),
    onDelta: (data) => take(data, false),
    onRefresh: () => router.refresh(),
  });
  return <SeatStatesContext.Provider value={{ states, counts, live }}>{children}</SeatStatesContext.Provider>;
}

/** "120 seats · 80 available · 3 held · 30 sold · 5 assigned to guests · 2 blocked", live. */
export function LiveSeatCounts() {
  const t = useTranslations('seating');
  const s = useSeatStates();
  if (!s) return null;
  const total = LIVE_SEAT_STATES.reduce((n, k) => n + s.counts[k], 0);
  return (
    <span className="text-body" data-testid="seat-counts" data-live={s.live}>
      {t('counts', { ...s.counts, total })}
    </span>
  );
}

const SWATCH: Record<LiveSeatState, string> = {
  available: 'bg-white',
  held: 'bg-accent-700',
  sold: 'bg-zinc-700',
  assigned: 'bg-accent-900',
  blocked: 'bg-pink-700',
};

/** What the plan's seat colours mean (a guest's seat apart from a blocked one). */
export function SeatLegend({ children }: { children?: ReactNode }) {
  const t = useTranslations('seating.legend');
  return (
    <ul
      aria-label={t('label')}
      className="flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-caption text-zinc-600"
    >
      {LIVE_SEAT_STATES.map((s) => (
        <li key={s} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className={`inline-block size-3 rounded-pill border border-zinc-500 ${SWATCH[s]}`}
          />
          {t(s)}
        </li>
      ))}
      {children}
    </ul>
  );
}
