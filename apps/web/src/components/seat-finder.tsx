'use client';

import { type FloorplanDoc, mapArea, nearestObject, placedSeats } from '@yayatoh/floorplan';
import { Alert, Button, Card } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { type FormEvent, startTransition, useActionState, useMemo, useState, useTransition } from 'react';
import type { FinderState } from '@/app/[locale]/events/[slug]/seat-finder/actions.ts';
import { HumanCheckField, type HumanCheckWidget } from './human-check-field.tsx';
import { VenueGuide } from './venue-guide.tsx';
import { VenueMap } from './venue-map.tsx';

type Action = (prev: FinderState, form: FormData) => Promise<FinderState>;

export interface FinderResult {
  readonly found: boolean;
  readonly seats: readonly {
    readonly seatUuid: string;
    readonly itemId: string;
    readonly itemKind: 'row' | 'table';
    readonly itemLabel: string;
    readonly seatLabel: string;
  }[];
  readonly unseated: number;
}

const field = 'min-h-10 rounded-pill border border-zinc-200 bg-white px-4 text-body';

/** Submit without React's form reset, so a challenge or an error keeps what the guest typed. */
function useSubmit(formAction: (form: FormData) => void) {
  return (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => formAction(data));
  };
}

/**
 * The public seat finder (M1.7e): look yourself up (a code by email, or — when the organizer
 * chose it — your exact full name), then see your seats listed, described and highlighted on
 * the venue map.
 */
/**
 * Starting over (another email, someone else) clears the forms' state: the body is remounted
 * once the server has forgotten the code and the seats shown.
 */
export function SeatFinder(props: Omit<Parameters<typeof FinderBody>[0], 'onReset'>) {
  const [round, setRound] = useState(0);
  // The seats shown when the guest started over stay hidden (the server has forgotten them too).
  const [hidden, setHidden] = useState<FinderResult | null>(null);
  return (
    <FinderBody
      key={round}
      {...props}
      initialStep={round ? 'email' : props.initialStep}
      verified={props.verified && props.verified !== hidden ? props.verified : null}
      onReset={() => {
        setHidden(props.verified);
        setRound((r) => r + 1);
      }}
    />
  );
}

function FinderBody({
  mode,
  initialStep,
  verified,
  doc,
  challenge,
  codeFlow,
  byName,
  reset,
  onReset,
}: {
  mode: 'code' | 'name';
  initialStep: 'email' | 'code';
  /** Seats behind a code verified earlier (code mode, from the page's cookie). */
  verified: FinderResult | null;
  doc: FloorplanDoc;
  challenge: HumanCheckWidget | null;
  codeFlow: Action;
  byName: Action;
  reset: () => Promise<void>;
  onReset: () => void;
}) {
  const t = useTranslations('seatFinder');
  const tm = useTranslations('venueMap');
  const [code, codeAction, coding] = useActionState(codeFlow, { step: initialStep });
  const [named, nameAction, naming] = useActionState(byName, { step: 'email' });
  const onCode = useSubmit(codeAction);
  const onName = useSubmit(nameAction);

  const result: FinderResult | null = verified ?? (mode === 'name' ? (named.result ?? null) : null);
  const highlight = useMemo(() => result?.seats.map((s) => s.seatUuid) ?? [], [result]);
  const where = useMemo(() => {
    const at = new Map(placedSeats(doc).map((s) => [s.seatId, s]));
    return (seatUuid: string) => {
      const s = at.get(seatUuid);
      if (!s) return null;
      const door = nearestObject(doc, s, ['entrance']);
      return {
        area: tm(`area.${mapArea(doc, s)}`),
        entrance: door ? door.label || tm('object.entrance') : null,
      };
    };
  }, [doc, tm]);

  const error = (s: FinderState) =>
    s.error ? (
      <Alert
        title={
          s.error === 'wrong' ? t('errors.wrong', { left: s.attemptsLeft ?? 0 }) : t(`errors.${s.error}`)
        }
      />
    ) : null;
  const challengeBox = (s: FinderState) =>
    s.challenge && challenge ? (
      <fieldset className="flex flex-col gap-2 rounded-card border border-zinc-200 bg-white p-4">
        <legend className="px-1 text-body font-medium">{t('challengeTitle')}</legend>
        <p className="text-caption text-zinc-600">{t('challengeHint')}</p>
        <HumanCheckField widget={challenge} />
      </fieldset>
    ) : null;
  const [resetting, startReset] = useTransition();
  const startOver = (label: string) => (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="self-start"
      disabled={resetting}
      onClick={() =>
        startReset(async () => {
          await reset();
          onReset();
        })
      }
    >
      {label}
    </Button>
  );

  return (
    <div className="flex flex-col gap-8">
      {result ? (
        <section aria-labelledby="finder-result" className="flex flex-col gap-3">
          <h2 id="finder-result" className="text-section">
            {result.seats.length
              ? t('resultTitle', { count: result.seats.length })
              : result.found
                ? t('noSeatTitle')
                : t('notFoundTitle')}
          </h2>
          {result.seats.length ? (
            <ul aria-labelledby="finder-result" className="flex list-none flex-col gap-2 p-0">
              {result.seats.map((s) => {
                const w = where(s.seatUuid);
                return (
                  <li key={s.seatUuid}>
                    <Card className="flex flex-col gap-0.5">
                      <span className="text-[22px] font-light tracking-[-0.03em]">
                        {t(`seatAt.${s.itemKind}`, { item: s.itemLabel, seat: s.seatLabel })}
                      </span>
                      {w ? <span className="text-caption text-zinc-600">{w.area}</span> : null}
                      {w?.entrance ? (
                        <span className="text-caption text-zinc-600">
                          {t('nearest', { name: w.entrance })}
                        </span>
                      ) : null}
                    </Card>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-body text-zinc-600">{result.found ? t('noSeat') : t('notFound')}</p>
          )}
          {result.seats.length > 0 && result.unseated > 0 ? (
            <p className="text-body text-zinc-600">{t('someUnseated', { count: result.unseated })}</p>
          ) : null}
          {verified ? startOver(t('again')) : null}
        </section>
      ) : null}

      {mode === 'name' ? (
        <section aria-labelledby="finder-lookup" className="flex flex-col gap-3">
          <h2 id="finder-lookup" className="text-section">
            {t('lookupTitle')}
          </h2>
          <p className="text-body text-zinc-600">{t('nameIntro')}</p>
          <form onSubmit={onName} action={nameAction} noValidate className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="finder-name" className="text-caption text-zinc-600">
                {t('name')}
              </label>
              <input
                id="finder-name"
                name="name"
                autoComplete="name"
                maxLength={120}
                defaultValue={named.name ?? ''}
                className={field}
              />
            </div>
            {challengeBox(named)}
            <Button type="submit" disabled={naming} className="self-start">
              {naming ? t('checking') : t('findByName')}
            </Button>
          </form>
          <div aria-live="polite">{error(named)}</div>
        </section>
      ) : verified ? null : code.step === 'code' ? (
        <section aria-labelledby="finder-lookup" className="flex flex-col gap-3">
          <h2 id="finder-lookup" className="text-section">
            {t('codeTitle')}
          </h2>
          <div aria-live="polite">
            {code.sent ? (
              <p role="status" className="text-body">
                {t('sent')}
              </p>
            ) : (
              <p className="text-body text-zinc-600">{t('codeHint')}</p>
            )}
          </div>
          <form onSubmit={onCode} action={codeAction} noValidate className="flex flex-col gap-3">
            <input type="hidden" name="intent" value="verify" />
            <div className="flex flex-col gap-1.5">
              <label htmlFor="finder-code" className="text-caption text-zinc-600">
                {t('code')}
              </label>
              <input
                id="finder-code"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={9}
                className={`${field} max-w-48 font-mono tracking-[0.3em]`}
              />
            </div>
            {challengeBox(code)}
            <Button type="submit" disabled={coding} className="self-start">
              {coding ? t('checking') : t('verify')}
            </Button>
          </form>
          <div aria-live="polite">{error(code)}</div>
          {startOver(t('otherEmail'))}
        </section>
      ) : (
        <section aria-labelledby="finder-lookup" className="flex flex-col gap-3">
          <h2 id="finder-lookup" className="text-section">
            {t('lookupTitle')}
          </h2>
          <p className="text-body text-zinc-600">{t('codeIntro')}</p>
          <form onSubmit={onCode} action={codeAction} noValidate className="flex flex-col gap-3">
            <input type="hidden" name="intent" value="request" />
            <div className="flex flex-col gap-1.5">
              <label htmlFor="finder-email" className="text-caption text-zinc-600">
                {t('email')}
              </label>
              <input
                id="finder-email"
                name="email"
                type="email"
                autoComplete="email"
                maxLength={254}
                defaultValue={code.email ?? ''}
                className={field}
              />
            </div>
            {challengeBox(code)}
            <Button type="submit" disabled={coding} className="self-start">
              {coding ? t('sending') : t('sendCode')}
            </Button>
          </form>
          <div aria-live="polite">{error(code)}</div>
        </section>
      )}

      <section aria-labelledby="finder-map" className="flex flex-col gap-3">
        <h2 id="finder-map" className="text-section">
          {t('mapTitle')}
        </h2>
        <VenueMap key={highlight.join()} doc={doc} highlight={highlight} />
        <VenueGuide doc={doc} highlight={highlight} />
      </section>
    </div>
  );
}
