'use client';

import { Select } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';

/** One profile as the picker shows it: the sections it includes (already translated). */
export interface PickerProfile {
  readonly key: string;
  readonly sections: readonly string[];
}

/**
 * U8 (UX-2): "What kind of event?". The profile Select (each option with its one-line
 * description) and, below it, what the chosen kind includes: its description and the sections it
 * switches on. Profiles stay fixed product modes; categories and tags are the org's own labels.
 */
export function ProfilePicker({
  id,
  name = 'profile',
  label,
  profiles,
  value: controlled,
  defaultValue,
  onValueChange,
  className,
}: {
  id: string;
  name?: string;
  /** The field label (the legend asks the question). */
  label: string;
  profiles: readonly PickerProfile[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  className?: string;
}) {
  const t = useTranslations();
  const [inner, setInner] = useState(defaultValue ?? profiles[0]?.key ?? 'other');
  const value = controlled ?? inner;
  const chosen = profiles.find((p) => p.key === value);
  const summaryId = useId();
  const profileLabel = (key: string) => t(`profiles.${key}` as 'profiles.other');
  return (
    <fieldset className="flex min-w-0 flex-col gap-3">
      <legend className="pb-1 text-card">{t('profilePicker.question')}</legend>
      <Select
        id={id}
        name={name}
        label={label}
        value={value}
        onValueChange={(v) => {
          setInner(v);
          onValueChange?.(v);
        }}
        aria-describedby={summaryId}
        className={className}
        options={profiles.map((p) => ({
          value: p.key,
          label: profileLabel(p.key),
          text: profileLabel(p.key),
          hint: t(`profilePicker.descriptions.${p.key}` as 'profilePicker.descriptions.other'),
        }))}
      />
      {chosen ? (
        <section
          id={summaryId}
          aria-live="polite"
          aria-label={t('profilePicker.summaryLabel', { kind: profileLabel(chosen.key) })}
          className="flex flex-col gap-2 rounded-tile border border-line bg-surface-2 p-4"
        >
          <p className="m-0 text-body">
            <strong className="font-bold">{profileLabel(chosen.key)}</strong>
            {' · '}
            {t(`profilePicker.descriptions.${chosen.key}` as 'profilePicker.descriptions.other')}
          </p>
          {chosen.sections.length ? (
            <>
              <p className="m-0 text-caption font-bold text-ink-2">{t('profilePicker.includes')}</p>
              <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                {chosen.sections.map((s) => (
                  <li key={s} className="rounded-pill bg-surface-3 px-2.5 py-0.5 text-caption text-ink-2">
                    {s}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          <p className="m-0 text-caption text-ink-2">{t('profilePicker.labelsHint')}</p>
        </section>
      ) : null}
    </fieldset>
  );
}
