'use client';

import { Combobox, type ListOption } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';

/** A new series typed in the field travels as `new:{name}` and is created with the event. */
export const NEW_SERIES = 'new:';
/** "No series" once a series was picked (empty means none too, and shows the placeholder). */
export const NO_SERIES = 'none';
/**
 * Passed explicitly: the Combobox's default (a new `[]` each render) is in the deps of its option
 * sync effect, so every render scheduled another (React #185 after a server action re-render).
 */
const NO_SELECTED: readonly ListOption[] = [];

/**
 * U7: the Series field of create-event (quick and guided). Pick one of the org's series, keep
 * "No series", or type a new name and choose "Create “…”" to create it with the event.
 */
export function SeriesField({
  id,
  series,
  value,
  defaultValue,
  onValueChange,
  error,
}: {
  id: string;
  series: readonly { id: string; name: string }[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  error?: string;
}) {
  const t = useTranslations('seriesField');
  const current = value ?? defaultValue ?? '';
  const typed = current.startsWith(NEW_SERIES) ? current.slice(NEW_SERIES.length) : null;
  const newOption = useMemo(
    () =>
      (name: string): ListOption => ({
        value: `${NEW_SERIES}${name}`,
        text: name,
        label: t('newOption', { name }),
      }),
    [t],
  );
  // Stable between renders: the Combobox re-reads its options whenever the array changes.
  const options = useMemo<ListOption[]>(
    () => [
      { value: NO_SERIES, text: t('none'), label: t('none') },
      ...series.map((s) => ({ value: s.id, text: s.name, label: s.name })),
      ...(typed ? [newOption(typed)] : []),
    ],
    [t, series, typed, newOption],
  );
  return (
    <Combobox
      id={id}
      name="series"
      label={t('label')}
      hint={t('hint')}
      error={error}
      placeholder={t('none')}
      options={options}
      selectedOptions={NO_SELECTED}
      {...(value === undefined ? { defaultValue: current } : { value })}
      onValueChange={(v) => onValueChange?.(v[0] ?? '')}
      onCreate={(name) => newOption(name.trim())}
    />
  );
}
