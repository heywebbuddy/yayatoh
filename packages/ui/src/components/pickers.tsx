'use client';

import { useMemo } from 'react';
import { formatOffset, offsetMinutes } from './dates.ts';
import type { ListOption } from './listbox.ts';
import { Select, type SelectProps } from './select.tsx';
import { useUiLocale } from './ui-locale.tsx';

const FALLBACK_ZONES = [
  'UTC',
  'Africa/Cairo',
  'Africa/Johannesburg',
  'Africa/Lagos',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Mexico_City',
  'America/New_York',
  'America/Sao_Paulo',
  'America/Toronto',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Shanghai',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Europe/Amsterdam',
  'Europe/Berlin',
  'Europe/London',
  'Europe/Madrid',
  'Europe/Paris',
  'Europe/Rome',
  'Pacific/Auckland',
];

const supported = (key: 'timeZone' | 'currency'): string[] => {
  try {
    return (
      (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.(key) ?? []
    );
  } catch {
    return [];
  }
};

/** ICU still lists some zones under their old names; show the current IANA ones. */
const MODERN: Record<string, string> = {
  'America/Buenos_Aires': 'America/Argentina/Buenos_Aires',
  'America/Godthab': 'America/Nuuk',
  'America/Indianapolis': 'America/Indiana/Indianapolis',
  'America/Louisville': 'America/Kentucky/Louisville',
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Rangoon': 'Asia/Yangon',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Atlantic/Faeroe': 'Atlantic/Faroe',
  'Europe/Kiev': 'Europe/Kyiv',
  'Pacific/Enderbury': 'Pacific/Kanton',
  'Pacific/Ponape': 'Pacific/Pohnpei',
  'Pacific/Truk': 'Pacific/Chuuk',
};

/** IANA zones grouped by region, each with its current offset (e.g. "Kolkata · UTC+05:30"). */
export function timeZoneOptions(
  locale: string,
  at: Date = new Date(),
  extra: readonly string[] = [],
): ListOption[] {
  const base = supported('timeZone').length ? supported('timeZone') : FALLBACK_ZONES;
  const ids = [...new Set([...base.map((z) => MODERN[z] ?? z), 'UTC', ...extra])];
  const rows = ids.flatMap((tz) => {
    let off: number;
    try {
      off = offsetMinutes(at, tz);
    } catch {
      return [];
    }
    const parts = tz.split('/');
    const region = parts.length > 1 ? (parts[0] as string) : 'UTC';
    const city = (parts.slice(1).join(' / ') || tz).replace(/_/g, ' ');
    const offset = formatOffset(off);
    return [
      {
        value: tz,
        label: `${city} · ${offset}`,
        text: `${city} ${offset}`,
        hint: tz,
        group: region,
        keywords: `${tz} ${offset.replace('−', '-')} ${tz.replace(/_/g, ' ')}`,
        off,
      },
    ];
  });
  rows.sort((a, b) =>
    a.group === b.group ? a.text.localeCompare(b.text, locale) : a.group.localeCompare(b.group),
  );
  return rows.map(({ off: _off, ...o }) => o);
}

export interface TimeZonePickerProps extends Omit<SelectProps, 'options' | 'children' | 'searchable'> {}

/** TimeZonePicker (U1): searchable IANA zones, grouped by region, with the current offset. */
export function TimeZonePicker(props: TimeZonePickerProps) {
  const { locale } = useUiLocale();
  const raw = props.value ?? props.defaultValue;
  const current = raw === undefined ? undefined : String(raw);
  const options = useMemo(
    () => timeZoneOptions(locale, new Date(), current ? [current] : []),
    [locale, current],
  );
  return <Select {...props} options={options} searchable />;
}

const CORE_CURRENCIES = [
  'USD',
  'EUR',
  'GBP',
  'CAD',
  'AUD',
  'NZD',
  'JPY',
  'CNY',
  'INR',
  'BRL',
  'MXN',
  'ZAR',
  'NGN',
  'GHS',
  'KES',
  'AED',
  'SAR',
  'CHF',
  'SEK',
  'NOK',
  'DKK',
  'PLN',
  'SGD',
  'HKD',
];

/** ISO 4217 currencies with their name and symbol in the reader's language (Intl). */
export function currencyOptions(locale: string, extra: readonly string[] = []): ListOption[] {
  const codes = [
    ...new Set([...(supported('currency').length ? supported('currency') : CORE_CURRENCIES), ...extra]),
  ]
    .map((c) => c.toUpperCase())
    .filter((c) => /^[A-Z]{3}$/.test(c));
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames([locale], { type: 'currency' });
  } catch {
    names = null;
  }
  return [...new Set(codes)]
    .map((code) => {
      let symbol = code;
      try {
        symbol =
          new Intl.NumberFormat(locale, {
            style: 'currency',
            currency: code,
            currencyDisplay: 'narrowSymbol',
          })
            .formatToParts(0)
            .find((p) => p.type === 'currency')?.value ?? code;
      } catch {
        symbol = code;
      }
      const name = names?.of(code) ?? code;
      const label = symbol && symbol !== code ? `${code} · ${name} (${symbol})` : `${code} · ${name}`;
      return { value: code, label, text: `${code} ${name}`, keywords: symbol };
    })
    .sort((a, b) => a.value.localeCompare(b.value));
}

export interface CurrencyPickerProps extends Omit<SelectProps, 'options' | 'children' | 'searchable'> {
  /** Limit the list (e.g. the currencies the payment provider supports). */
  currencies?: readonly string[];
}

/** CurrencyPicker (U1): searchable ISO 4217 list with symbol and localized name. */
export function CurrencyPicker({ currencies, ...props }: CurrencyPickerProps) {
  const { locale } = useUiLocale();
  const raw = props.value ?? props.defaultValue;
  const current = raw === undefined ? undefined : String(raw);
  const options = useMemo(() => {
    const all = currencyOptions(locale, current ? [current] : []);
    if (!currencies) return all;
    const allow = new Set([
      ...currencies.map((c) => c.toUpperCase()),
      ...(current ? [current.toUpperCase()] : []),
    ]);
    return all.filter((o) => allow.has(o.value));
  }, [locale, current, currencies]);
  return (
    <Select
      {...props}
      value={props.value === undefined ? undefined : String(props.value).toUpperCase()}
      defaultValue={props.defaultValue === undefined ? undefined : String(props.defaultValue).toUpperCase()}
      options={options}
      searchable
    />
  );
}
