'use client';

import { buttonClass, cx } from '@yayatoh/ui';
import { CalendarDays, LocateFixed, MapPin, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';

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

const distanceKm = (aLat: number, aLng: number, bLat: number, bLng: number) => {
  const r = (n: number) => (n * Math.PI) / 180;
  const h =
    Math.sin(r(bLat - aLat) / 2) ** 2 +
    Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(r(bLng - aLng) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};

/**
 * The home page's finder: free text, a city (from our events and venues, or the nearest one to
 * "Use my location", asked only when pressed), and a date (presets or a calendar). It is a plain
 * GET form to the events list, so the filters are in the address.
 */
export function HeroSearch({
  action,
  cities,
  centers,
}: {
  action: string;
  cities: readonly string[];
  centers: readonly { city: string; lat: number; lng: number }[];
}) {
  const t = useTranslations('homeFinder');
  const id = useId();
  const [city, setCity] = useState('');
  const [when, setWhen] = useState<When>('any');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const range = when === 'custom' ? { from, to: to || from } : whenRange(when);

  const locate = () => {
    if (!navigator.geolocation) return setNote(t('locationFailed'));
    setLocating(true);
    setNote(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const near = [...centers].sort(
          (a, b) =>
            distanceKm(pos.coords.latitude, pos.coords.longitude, a.lat, a.lng) -
            distanceKm(pos.coords.latitude, pos.coords.longitude, b.lat, b.lng),
        )[0];
        if (near) {
          setCity(near.city);
          setNote(t('nearest', { city: near.city }));
        } else setNote(t('locationFailed'));
      },
      () => {
        setLocating(false);
        setNote(t('locationFailed'));
      },
      { maximumAge: 600_000, timeout: 10_000 },
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
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor={`${id}-city`} className="text-[13px] font-bold text-ink">
              {t('where')}
            </label>
            <div className="relative">
              <MapPin
                aria-hidden="true"
                className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-2"
              />
              <select
                id={`${id}-city`}
                name="city"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="field w-full ps-10"
              >
                <option value="">{t('anywhere')}</option>
                {cities.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>
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
          {centers.length > 0 ? (
            <button
              type="button"
              onClick={locate}
              disabled={locating}
              className={cx(chip(false), 'ms-auto gap-1.5')}
            >
              <LocateFixed aria-hidden="true" className="size-4" />
              {locating ? t('locating') : t('useLocation')}
            </button>
          ) : null}
        </div>
        {when === 'custom' ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${id}-from`} className="text-[13px] font-bold text-ink">
                {t('from')}
              </label>
              <input
                id={`${id}-from`}
                type="date"
                value={from}
                max={to || undefined}
                onChange={(e) => setFrom(e.target.value)}
                className="field w-full"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${id}-to`} className="text-[13px] font-bold text-ink">
                {t('to')}
              </label>
              <input
                id={`${id}-to`}
                type="date"
                value={to}
                min={from || undefined}
                onChange={(e) => setTo(e.target.value)}
                className="field w-full"
              />
            </div>
          </div>
        ) : null}
        {range?.from ? <input type="hidden" name="from" value={range.from} /> : null}
        {range?.from ? <input type="hidden" name="to" value={range.to} /> : null}
        <p role="status" aria-live="polite" className="m-0 min-h-5 text-caption text-ink-2">
          {note}
        </p>
      </form>
    </search>
  );
}
