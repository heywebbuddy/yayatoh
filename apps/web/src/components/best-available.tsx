'use client';

import { Alert, Button, Select } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState, useTransition } from 'react';
import { errorMessageKey } from '@/lib/errors.ts';

const field = 'min-h-11 rounded-pill border border-line bg-surface-solid px-4 text-body text-ink';

/** What best available found and is holding, as the page shows it. */
export interface BestSeatsHold {
  readonly token: string;
  readonly expiresAt: number;
  readonly pieces: number;
  readonly seats: readonly {
    readonly label: string;
    readonly accessible: boolean;
    readonly companion: boolean;
  }[];
}

export interface BestSeatsState {
  readonly ok: boolean;
  readonly code: string | null;
  readonly reason?: string;
  readonly retryMinutes?: number;
  readonly hold?: BestSeatsHold;
}

export interface BestSeatsRequest {
  readonly ticketTypeId: string;
  readonly quantity: number;
  readonly accessible: boolean;
  readonly occurrenceId?: string | null;
  readonly replaceToken?: string | null;
}

export interface BestSeatsActions {
  readonly find: (input: BestSeatsRequest) => Promise<BestSeatsState>;
  readonly release: (token: string) => Promise<void>;
}

/**
 * Best available (M6.11a): the buyer (or the box office) says how many seats at which price and
 * gets the best seats that sit together, held for them; the order takes the hold over (the
 * `seatHold` field). When no block fits, the party is split and the page says so plainly. Plain
 * form controls only: no map needed, every step works by keyboard.
 */
export function BestAvailablePanel({
  levels,
  max,
  accessible,
  actions,
  occurrenceId = () => null,
  onHold,
}: {
  /** The prices sold by seat: ticket type id and "Name · $50" label. */
  levels: readonly { readonly id: string; readonly label: string }[];
  max: number;
  /** Someone in the party needs a wheelchair-accessible seat (the statement above). */
  accessible: boolean;
  actions: BestSeatsActions;
  /** The date being bought, read when the buyer asks (multi-date events). */
  occurrenceId?: () => string | null;
  /** The token of the hold shown now (null when none). */
  onHold?: (token: string | null) => void;
}) {
  const t = useTranslations('checkout.best');
  const te = useTranslations();
  const id = useId();
  const [level, setLevel] = useState(levels[0]?.id ?? '');
  const [quantity, setQuantity] = useState(Math.min(2, max));
  const [hold, setHold] = useState<BestSeatsHold | null>(null);
  const [error, setError] = useState<BestSeatsState | null>(null);
  const [pending, start] = useTransition();
  // The page that switches to choosing seats gives a hold left behind back (`onHold`).
  useEffect(() => onHold?.(hold?.token ?? null), [hold, onHold]);

  const find = () =>
    start(async () => {
      const r = await actions.find({
        ticketTypeId: level,
        quantity,
        accessible,
        occurrenceId: occurrenceId(),
        replaceToken: hold?.token ?? null,
      });
      if (r.ok && r.hold) {
        setHold(r.hold);
        setError(null);
      } else {
        // A refused request gave nothing back: the previous hold was released with it only when
        // the server got that far, so keep showing nothing rather than stale seats.
        setHold(null);
        setError(r);
      }
    });
  const clear = () =>
    start(async () => {
      if (hold) await actions.release(hold.token);
      setHold(null);
      setError(null);
    });

  const errorText = !error
    ? null
    : error.code === 'rate_limited'
      ? te('errors.rateLimitedRetry', { minutes: error.retryMinutes ?? 1 })
      : error.reason === 'not_enough_seats'
        ? t('notEnough', { count: quantity })
        : error.reason === 'no_accessible_seat'
          ? t('noAccessible')
          : error.reason === 'seats_taken'
            ? t('taken')
            : error.reason === 'seat_rule'
              ? t('ruleRefused')
              : error.reason === 'best_available_off'
                ? t('off')
                : te(errorMessageKey(error.code ?? 'internal'));
  const labels = hold?.seats.map((s) =>
    s.accessible
      ? t('seatAccessible', { seat: s.label })
      : s.companion
        ? t('seatCompanion', { seat: s.label })
        : s.label,
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        {levels.length > 1 ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-level`} className="text-caption text-ink-2">
              {t('price')}
            </label>
            <Select id={`${id}-level`} value={level} onValueChange={(v) => setLevel(v)} className={field}>
              {levels.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </Select>
          </div>
        ) : levels[0] ? (
          <p className="text-body">{t('onePrice', { price: levels[0].label })}</p>
        ) : null}
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-qty`} className="text-caption text-ink-2">
            {t('quantity')}
          </label>
          <Select
            id={`${id}-qty`}
            value={quantity}
            onValueChange={(v) => setQuantity(Number(v))}
            className={`${field} w-24`}
          >
            {Array.from({ length: max }, (_, n) => (
              <option key={n + 1} value={n + 1}>
                {n + 1}
              </option>
            ))}
          </Select>
        </div>
        <Button type="button" variant="secondary" onClick={find} disabled={pending || !level}>
          {hold ? t('findAgain') : t('find')}
        </Button>
      </div>
      {accessible ? <p className="text-caption text-ink-2">{t('accessibleHint')}</p> : null}
      <div aria-live="polite" className="flex flex-col gap-2">
        {hold && labels ? (
          <div
            data-testid="best-result"
            className={`flex flex-col gap-2 rounded-card border px-4 py-3 ${hold.pieces > 1 ? 'border-primary/40 bg-primary-soft text-primary-ink' : 'border-line bg-surface-2'}`}
          >
            <p className="text-body font-medium">
              {hold.pieces > 1
                ? t('split', { count: hold.seats.length, pieces: hold.pieces })
                : t('together', { count: hold.seats.length })}
            </p>
            <ul
              aria-label={t('seatsLabel')}
              className="flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-body"
            >
              {labels.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            <p className="text-caption">{t('heldFor', { minutes: 10 })}</p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={clear}
              disabled={pending}
              className="self-start"
            >
              {t('clear')}
            </Button>
          </div>
        ) : null}
        {errorText ? <Alert title={errorText} /> : null}
      </div>
      {hold ? (
        <>
          <input type="hidden" name="seatHold" value={hold.token} />
          <input type="hidden" name="seatHoldCount" value={hold.seats.length} />
        </>
      ) : null}
    </div>
  );
}
