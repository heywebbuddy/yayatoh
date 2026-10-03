'use client';

import type { FloorplanDoc } from '@yayatoh/floorplan';
import { Alert, Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { type FormEvent, startTransition, useActionState, useState } from 'react';
import type { PinState } from '@/app/[locale]/events/[slug]/seat-finder/actions.ts';
import { GuestPlaces } from './guest-places.tsx';
import { HumanCheckField, type HumanCheckWidget } from './human-check-field.tsx';
import { VenueGuide } from './venue-guide.tsx';
import { VenueMap } from './venue-map.tsx';

type Action = (prev: PinState, form: FormData) => Promise<PinState>;

/**
 * The seat finder in PIN mode (M4.4a): a guest's exact full name and the PIN printed on their
 * party's invitation. The answer is their tables, highlighted on the map, with how many of the
 * party sit at each: never a name. Every miss reads the same.
 */
export function GuestSeatFinder(props: Omit<Parameters<typeof PinBody>[0], 'onReset'>) {
  // "Look up someone else" remounts the form, clearing the answer and what was typed.
  const [round, setRound] = useState(0);
  return <PinBody key={round} {...props} onReset={() => setRound((r) => r + 1)} />;
}

function PinBody({
  doc,
  challenge,
  byPin,
  onReset,
}: {
  /** The venue map before a lookup (the event plan). */
  doc: FloorplanDoc;
  challenge: HumanCheckWidget | null;
  byPin: Action;
  onReset: () => void;
}) {
  const t = useTranslations('seatFinder');
  const tg = useTranslations('guestSeats');
  const [state, action, pending] = useActionState(byPin, {});
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => action(data));
  };
  const result = state.result ?? null;
  const charts = result?.charts.filter((c) => c.places.length > 0) ?? [];
  const unseated = result?.charts.reduce((n, c) => n + c.unseated, 0) ?? 0;
  const error = state.error ? (
    <Alert
      title={
        state.error === 'rateLimited'
          ? t('errors.pinRateLimited', { minutes: state.retryMinutes ?? 1 })
          : t(`errors.${state.error}`)
      }
    />
  ) : null;

  return (
    <div className="flex flex-col gap-8">
      {result ? (
        <section aria-labelledby="pin-result" className="flex flex-col gap-4" data-testid="pin-result">
          <h2 id="pin-result" className="text-section">
            {charts.length
              ? tg('resultTitle', { count: charts.reduce((n, c) => n + c.places.length, 0) })
              : tg('noTableTitle')}
          </h2>
          {charts.length === 0 ? <p className="m-0 text-body text-ink-2">{tg('noTable')}</p> : null}
          {charts.map((c, i) => {
            const id = `pin-chart-${i}`;
            const name = c.name ?? tg('wholeEvent');
            const items = c.places.map((p) => p.itemId);
            return (
              <div key={c.subEventId ?? 'plan'} className="flex flex-col gap-3">
                <h3 id={id} className="m-0 text-card text-ink">
                  {name}
                </h3>
                <GuestPlaces
                  doc={c.doc}
                  places={c.places}
                  labelledBy={id}
                  detail={(p) => {
                    const n = c.places.find((x) => x.itemId === p.itemId)?.count ?? 0;
                    return <span className="text-caption text-ink-2">{tg('partyCount', { count: n })}</span>;
                  }}
                />
                <VenueMap doc={c.doc} highlightItems={items} />
                <VenueGuide doc={c.doc} highlightItems={items} headingId={`${id}-guide`} />
              </div>
            );
          })}
          {charts.length > 0 && unseated > 0 ? (
            <p className="m-0 text-body text-ink-2">{tg('unseatedCount', { count: unseated })}</p>
          ) : null}
          <Button type="button" variant="ghost" size="sm" className="self-start" onClick={onReset}>
            {tg('again')}
          </Button>
        </section>
      ) : (
        <section aria-labelledby="finder-lookup" className="flex flex-col gap-3">
          <h2 id="finder-lookup" className="text-section">
            {t('lookupTitle')}
          </h2>
          <p className="text-body text-ink-2">{t('pinIntro')}</p>
          <form onSubmit={onSubmit} action={action} noValidate className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="finder-name" className="text-[13px] font-bold text-ink">
                {t('name')}
              </label>
              <input
                id="finder-name"
                name="name"
                autoComplete="name"
                maxLength={170}
                defaultValue={state.name ?? ''}
                aria-invalid={state.error === 'invalidName' || undefined}
                className="field"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="finder-pin" className="text-[13px] font-bold text-ink">
                {t('pin')}
              </label>
              <input
                id="finder-pin"
                name="pin"
                inputMode="numeric"
                autoComplete="off"
                maxLength={9}
                aria-invalid={state.error === 'invalidPin' || undefined}
                className="field max-w-48 font-mono tracking-[0.3em]"
              />
            </div>
            {state.challenge && challenge ? (
              <fieldset className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4">
                <legend className="px-1 text-[13px] font-bold text-ink">{t('challengeTitle')}</legend>
                <p className="text-caption text-ink-2">{t('challengeHint')}</p>
                <HumanCheckField widget={challenge} />
              </fieldset>
            ) : null}
            <Button type="submit" disabled={pending} className="self-start">
              {pending ? t('checking') : t('findByPin')}
            </Button>
          </form>
          <div aria-live="polite">{error}</div>
        </section>
      )}

      {result ? null : (
        <section aria-labelledby="finder-map" className="flex flex-col gap-3">
          <h2 id="finder-map" className="text-section">
            {t('mapTitle')}
          </h2>
          <VenueMap doc={doc} />
          <VenueGuide doc={doc} />
        </section>
      )}
    </div>
  );
}
