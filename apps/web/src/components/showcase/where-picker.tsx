'use client';

import { cx } from '@yayatoh/ui';
import { ChevronDown, MapPin, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useRef, useState } from 'react';
import { filterGroups, fold, groupPlaces, type Place, placeLabel } from '@/lib/places.ts';

/** What the "Where" field has chosen: a city, a whole country, the visitor's coordinates, or nothing. */
export interface Where {
  readonly city: string;
  readonly country: string;
  readonly lat: string;
  readonly lng: string;
  /** What the field shows. */
  readonly text: string;
}

export const NOWHERE: Where = { city: '', country: '', lat: '', lng: '', text: '' };

type Option =
  | { id: string; kind: 'any' }
  | { id: string; kind: 'country'; country: string; name: string }
  | { id: string; kind: 'city'; place: Place };

/**
 * The finder's "Where" field: a combobox (ARIA 1.2) over every city and country, grouped by country
 * with the cities underneath, narrowed as you type. Arrow keys move, Enter picks, Escape closes.
 */
export function WherePicker({
  id,
  locale,
  places,
  value,
  onChange,
}: {
  id: string;
  locale: string;
  places: readonly Place[];
  value: Where;
  onChange: (next: Where) => void;
}) {
  const t = useTranslations('homeFinder');
  const listId = `${id}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const typing = open && query !== '';

  const groups = useMemo(() => groupPlaces(places, locale), [places, locale]);
  const shown = useMemo(() => filterGroups(groups, typing ? query : ''), [groups, typing, query]);
  const options = useMemo(() => {
    const out: Option[] = [];
    if (!typing) out.push({ id: `${id}-o-any`, kind: 'any' });
    for (const g of shown) {
      if (g.country)
        out.push({ id: `${id}-o-c-${g.country}`, kind: 'country', country: g.country, name: g.name });
      for (const place of g.cities)
        out.push({
          id: `${id}-o-${g.country || 'x'}-${fold(place.city).replace(/\W+/g, '-')}`,
          kind: 'city',
          place,
        });
    }
    return out;
  }, [shown, typing, id]);
  const cityCount = options.filter((o) => o.kind === 'city').length;
  const current = options[Math.min(active, options.length - 1)];

  const close = () => {
    setOpen(false);
    setQuery('');
  };
  const pick = (o: Option) => {
    if (o.kind === 'any') onChange(NOWHERE);
    else if (o.kind === 'country') onChange({ city: '', country: o.country, lat: '', lng: '', text: o.name });
    else
      onChange({
        city: o.place.city,
        country: o.place.country,
        lat: '',
        lng: '',
        text: placeLabel(o.place, locale),
      });
    close();
  };
  const show = () => {
    if (!open) {
      setOpen(true);
      setActive(0);
    }
  };
  const move = (to: number) => {
    const next = (to + options.length) % Math.max(options.length, 1);
    setActive(next);
    // Keep the highlighted option in view inside the scrolling list.
    queueMicrotask(() =>
      document.getElementById(options[next]?.id ?? '')?.scrollIntoView({ block: 'nearest' }),
    );
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) show();
      else move(active + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) show();
      else move(active - 1);
    } else if (e.key === 'Home' && open) {
      e.preventDefault();
      move(0);
    } else if (e.key === 'End' && open) {
      e.preventDefault();
      move(options.length - 1);
    } else if (e.key === 'Enter' && open && current) {
      e.preventDefault();
      pick(current);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') close();
  };

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={`${id}-input`} className="text-[13px] font-bold text-ink">
        {t('where')}
      </label>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: closes the list when focus leaves the field. */}
      <div
        className="relative"
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) close();
        }}
      >
        <MapPin
          aria-hidden="true"
          className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-2"
        />
        <input
          ref={inputRef}
          id={`${id}-input`}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-haspopup="listbox"
          {...(open && current ? { 'aria-activedescendant': current.id } : {})}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder={t('wherePlaceholder')}
          value={open ? query : value.text}
          onFocus={show}
          onClick={show}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          className="field w-full ps-10 pe-16"
        />
        <div className="absolute end-1.5 top-1/2 flex -translate-y-1/2 items-center">
          {value.text && !open ? (
            <button
              type="button"
              aria-label={t('clearWhere')}
              onClick={() => {
                onChange(NOWHERE);
                inputRef.current?.focus();
              }}
              className="inline-flex size-8 items-center justify-center rounded-pill text-ink-2 hover:text-ink"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          ) : null}
          <ChevronDown aria-hidden="true" className="pointer-events-none me-2 size-4 text-ink-2" />
        </div>
        <div
          id={listId}
          role="listbox"
          aria-label={t('listLabel')}
          hidden={!open}
          // Keep focus in the input while a row is pressed, so blur does not close the list first.
          onMouseDown={(e) => e.preventDefault()}
          className="absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-card border border-line bg-surface p-1 elevation-pop"
        >
          {options.length === 0 ? (
            <p className="m-0 px-3 py-2 text-caption text-ink-2">{t('noPlaces')}</p>
          ) : (
            <>
              {options[0]?.kind === 'any' ? (
                <Row
                  option={options[0]}
                  on={current?.id === options[0].id}
                  onPick={pick}
                  setActive={() => setActive(0)}
                >
                  {t('anywhere')}
                </Row>
              ) : null}
              {shown.map((g) => (
                // biome-ignore lint/a11y/useSemanticElements: a listbox group has no native element.
                <div key={g.country || 'other'} role="group" aria-label={g.name || t('otherPlaces')}>
                  {g.country ? (
                    (() => {
                      const o = options.find((x) => x.kind === 'country' && x.country === g.country);
                      return o ? (
                        <Row
                          option={o}
                          on={current?.id === o.id}
                          onPick={pick}
                          setActive={() => setActive(options.indexOf(o))}
                          heading
                        >
                          {g.name}
                        </Row>
                      ) : null;
                    })()
                  ) : (
                    <p
                      aria-hidden="true"
                      className="m-0 px-3 pt-2 text-[12px] font-bold tracking-wide text-ink-2 uppercase"
                    >
                      {t('otherPlaces')}
                    </p>
                  )}
                  {g.cities.map((place) => {
                    const o = options.find((x) => x.kind === 'city' && x.place === place);
                    return o ? (
                      <Row
                        key={o.id}
                        option={o}
                        on={current?.id === o.id}
                        onPick={pick}
                        setActive={() => setActive(options.indexOf(o))}
                      >
                        <span className="ps-4">{place.city}</span>
                        {place.live ? (
                          <span className="ms-2 text-[11px] font-bold text-ember">{t('hasEvents')}</span>
                        ) : null}
                      </Row>
                    ) : null;
                  })}
                </div>
              ))}
            </>
          )}
        </div>
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {open ? t('placeResults', { count: cityCount }) : ''}
      </p>
      <input type="hidden" name="city" value={value.city} disabled={value.city === ''} />
      <input
        type="hidden"
        name="country"
        value={value.country}
        disabled={value.city !== '' || value.country === ''}
      />
      <input type="hidden" name="lat" value={value.lat} disabled={value.lat === ''} />
      <input type="hidden" name="lng" value={value.lng} disabled={value.lng === ''} />
    </div>
  );
}

function Row({
  option,
  on,
  onPick,
  setActive,
  heading,
  children,
}: {
  option: Option;
  on: boolean;
  onPick: (o: Option) => void;
  setActive: () => void;
  heading?: boolean;
  children: React.ReactNode;
}) {
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the combobox input owns the keyboard (aria-activedescendant).
    // biome-ignore lint/a11y/useFocusableInteractive: options are reached through aria-activedescendant, not focus.
    <div
      id={option.id}
      role="option"
      aria-selected={on}
      onClick={() => onPick(option)}
      onMouseMove={setActive}
      className={cx(
        'flex min-h-10 cursor-pointer items-center rounded-card px-3 text-body',
        heading ? 'font-bold text-ink' : 'text-ink-2',
        on && 'bg-ember-soft text-ink',
      )}
    >
      {children}
    </div>
  );
}
