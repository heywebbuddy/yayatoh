'use client';

import { buttonClass, cx, DatePicker } from '@yayatoh/ui';
import { CalendarDays, LocateFixed, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import {
  type LocateProblem,
  locateBlocker,
  locateProblem,
  NEAREST_MAX_KM,
  nearestPlace,
  type Place,
  placeLabel,
  roundCoord,
} from '@/lib/places.ts';
import { NOWHERE, type Where, WherePicker } from './where-picker.tsx';

type When = 'any' | 'today' | 'weekend' | 'month' | 'custom';

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The day range of a preset, in the visitor's own calendar. */
export function whenRange(when: When, now = new Date()): { from: string; to: string } | null {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (when === 'today') return { from: iso(day), to: iso(day) };
  if (when === 'weekend') {
    const dow = day.getDay(); // 0 = Sunday
    const sat = new Date(day);
    sat.setDate(day.getDate() + (dow === 0 ? -1 : 6 - dow));
    const sun = new Date(sat);
    sun.setDate(sat.getDate() + 1);
    return { from: iso(dow === 0 || dow === 6 ? day : sat), to: iso(sun) };
  }
  if (when === 'month')
    return { from: iso(day), to: iso(new Date(day.getFullYear(), day.getMonth() + 1, 0)) };
  return null;
}

/**
 * The home page's finder: free text, a place (any city or country, or the visitor's own position,
 * asked only when pressed), and a date (presets or a calendar). It is a plain GET form to the events
 * list, so the filters are in the address.
 */
export function HeroSearch({
  action,
  locale,
  places,
}: {
  action: string;
  locale: string;
  places: readonly Place[];
}) {
  const t = useTranslations('homeFinder');
  const id = useId();
  const [where, setWhere] = useState<Where>(NOWHERE);
  const [when, setWhen] = useState<When>('any');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [note, setNote] = useState<{ text: string; problem: boolean } | null>(null);
  const [locating, setLocating] = useState(false);
  const range = when === 'custom' ? { from, to: to || from } : whenRange(when);

  const fail = (problem: LocateProblem) => {
    setLocating(false);
    setNote({ text: t(`locate.${problem}`), problem: true });
  };
  const locate = () => {
    if (locating) return;
    const blocked = locateBlocker({
      isSecureContext: window.isSecureContext,
      hasGeolocation: 'geolocation' in navigator,
    });
    if (blocked) return fail(blocked);
    setLocating(true);
    setNote({ text: t('locating'), problem: false });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const { latitude, longitude } = pos.coords;
        const near = nearestPlace(latitude, longitude, places);
        const text =
          near && near.km <= NEAREST_MAX_KM
            ? t('nearPlace', { place: placeLabel(near.place, locale) })
            : t('yourLocation');
        setWhere({
          city: '',
          country: '',
          lat: roundCoord(latitude),
          lng: roundCoord(longitude),
          text,
        });
        setNote({
          text: near && near.km <= NEAREST_MAX_KM ? t('nearest', { city: near.place.city }) : text,
          problem: false,
        });
      },
      (err) => fail(locateProblem(err.code)),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 600_000 },
    );
  };

  const chip = (on: boolean) =>
    cx(
      'inline-flex min-h-10 items-center rounded-pill border px-3.5 text-[13px] font-bold',
      on ? 'border-ink bg-ink text-canvas' : 'border-line bg-surface text-ink-2 hover:border-line-strong',
    );
  const whens: readonly When[] = ['any', 'today', 'weekend', 'month', 'custom'];
  return (
    <search aria-label={t('searchLabel')}>
      <form
        action={action}
        method="get"
        className="relative z-10 mx-3 -mt-24 flex flex-col gap-4 rounded-[28px] border border-line bg-surface/95 p-4 elevation-pop backdrop-blur-xl sm:-mt-20 md:mx-8 md:-mt-24 md:p-6 lg:-mt-28"
      >
        <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_auto]">
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor={`${id}-q`} className="text-[13px] font-bold text-ink">
              {t('what')}
            </label>
            <div className="relative">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-2"
              />
              <input
                id={`${id}-q`}
                name="q"
                type="search"
                maxLength={100}
                placeholder={t('placeholder')}
                className="field w-full ps-10"
              />
            </div>
          </div>
          <WherePicker id={`${id}-where`} locale={locale} places={places} value={where} onChange={setWhere} />
          <div className="flex items-end">
            <button type="submit" className={cx(buttonClass('ember', 'lg'), 'w-full md:w-auto')}>
              {t('submit')}
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-[13px] font-bold text-ink">
            <CalendarDays aria-hidden="true" className="size-4" />
            {t('when')}
          </span>
          {whens.map((w) => (
            <button
              key={w}
              type="button"
              aria-pressed={when === w}
              onClick={() => setWhen(w)}
              className={chip(when === w)}
            >
              {t(`whenOptions.${w}`)}
            </button>
          ))}
          <button
            type="button"
            onClick={locate}
            aria-disabled={locating}
            aria-busy={locating}
            className={cx(chip(false), 'ms-auto gap-1.5', locating && 'opacity-70')}
          >
            <LocateFixed aria-hidden="true" className={cx('size-4', locating && 'animate-pulse')} />
            {locating ? t('locating') : t('useLocation')}
          </button>
        </div>
        {when === 'custom' ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <DatePicker
              id={`${id}-from`}
              label={t('from')}
              value={from}
              {...(to ? { max: to } : {})}
              onValueChange={setFrom}
            />
            <DatePicker
              id={`${id}-to`}
              label={t('to')}
              value={to}
              {...(from ? { min: from } : {})}
              onValueChange={setTo}
            />
          </div>
        ) : null}
        {range?.from ? <input type="hidden" name="from" value={range.from} /> : null}
        {range?.from ? <input type="hidden" name="to" value={range.to} /> : null}
        <p
          role="status"
          aria-live="polite"
          className={cx('m-0 min-h-5 text-caption', note?.problem ? 'text-danger' : 'text-ink-2')}
        >
          {note?.text}
        </p>
      </form>
    </search>
  );
}
