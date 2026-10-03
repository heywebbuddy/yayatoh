'use client';

import { Combobox, type ListOption } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';

/** A new series typed in the field travels as `new:{name}` and is created with the event. */
export const NEW_SERIES = 'new:';

/**
 * U7: the Series field of create-event (quick and guided). Pick one of the org's series, keep
 * "No series", or type a new name and choose "New series: …" to create it with the event.
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
  const newOption = (name: string): ListOption => ({
    value: `${NEW_SERIES}${name}`,
    text: name,
    label: t('newOption', { name }),
  });
  const options: ListOption[] = [
    { value: '', text: t('none'), label: t('none') },
    ...series.map((s) => ({ value: s.id, text: s.name, label: s.name })),
    ...(typed ? [newOption(typed)] : []),
  ];
  return (
    <Combobox
      id={id}
      name="series"
      label={t('label')}
      hint={t('hint')}
      error={error}
      placeholder={t('none')}
      options={options}
      {...(value === undefined ? { defaultValue: current } : { value })}
      onValueChange={(v) => onValueChange?.(v[0] ?? '')}
      onCreate={(name) => newOption(name.trim())}
    />
  );
}
