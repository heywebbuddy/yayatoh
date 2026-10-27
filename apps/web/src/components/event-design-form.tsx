'use client';

import { cx } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { SettingsState } from '@/app/[locale]/o/[org]/(org)/settings/actions.ts';
import { SettingsForm } from './settings-form.tsx';

type Design = {
  theme: 'classic' | 'showcase';
  headingFont: 'modern' | 'extended' | 'classic';
  heroLayout: 'full' | 'circle' | 'video';
  heroVideoUrl: string | null;
};

const THEMES = ['classic', 'showcase'] as const;
const FONTS = ['modern', 'extended', 'classic'] as const;
const LAYOUTS = ['full', 'circle', 'video'] as const;

/** One choice among several: a card-like radio, labelled with a one-line hint. */
function Choice({
  name,
  value,
  checked,
  onSelect,
  title,
  hint,
}: {
  name: string;
  value: string;
  checked: boolean;
  onSelect: () => void;
  title: string;
  hint: string;
}) {
  return (
    <label
      className={cx(
        'flex cursor-pointer flex-col gap-1 rounded-tile border p-3.5 has-focus-visible:outline-2 has-focus-visible:outline-focus',
        checked ? 'border-primary bg-primary-soft' : 'border-line bg-surface hover:border-line-strong',
      )}
    >
      <span className="flex items-center gap-2">
        <input type="radio" name={name} value={value} checked={checked} onChange={onSelect} />
        <span className="text-body font-extrabold">{title}</span>
      </span>
      <span className="ps-8 text-caption text-ink-2">{hint}</span>
    </label>
  );
}

/**
 * The organizer's design options for the public event page (event branding): theme, heading
 * font, hero layout and the hero background video link.
 */
export function EventDesignForm({
  action,
  initial,
}: {
  action: (prev: SettingsState, form: FormData) => Promise<SettingsState>;
  initial: Design;
}) {
  const t = useTranslations('eventDesign');
  const ts = useTranslations('settings');
  const [theme, setTheme] = useState(initial.theme);
  const [font, setFont] = useState(initial.headingFont);
  const [layout, setLayout] = useState(initial.heroLayout);
  const group = 'grid gap-2 sm:grid-cols-2 lg:grid-cols-3';
  return (
    <SettingsForm action={action} submitLabel={ts('save')} savedLabel={ts('saved')}>
      <fieldset className="flex flex-col gap-2 border-0 p-0">
        <legend className="mb-1 text-[13px] font-bold text-ink">{t('themeLabel')}</legend>
        <div className={group}>
          {THEMES.map((v) => (
            <Choice
              key={v}
              name="theme"
              value={v}
              checked={theme === v}
              onSelect={() => setTheme(v)}
              title={t(`theme.${v}.title`)}
              hint={t(`theme.${v}.hint`)}
            />
          ))}
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-2 border-0 p-0">
        <legend className="mb-1 text-[13px] font-bold text-ink">{t('fontLabel')}</legend>
        <div className={group}>
          {FONTS.map((v) => (
            <Choice
              key={v}
              name="headingFont"
              value={v}
              checked={font === v}
              onSelect={() => setFont(v)}
              title={t(`font.${v}.title`)}
              hint={t(`font.${v}.hint`)}
            />
          ))}
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-2 border-0 p-0">
        <legend className="mb-1 text-[13px] font-bold text-ink">{t('layoutLabel')}</legend>
        <div className={group}>
          {LAYOUTS.map((v) => (
            <Choice
              key={v}
              name="heroLayout"
              value={v}
              checked={layout === v}
              onSelect={() => setLayout(v)}
              title={t(`layout.${v}.title`)}
              hint={t(`layout.${v}.hint`)}
            />
          ))}
        </div>
      </fieldset>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="hero-video-url" className="text-[13px] font-bold text-ink">
          {t('videoLabel')}
        </label>
        <input
          id="hero-video-url"
          name="heroVideoUrl"
          type="url"
          inputMode="url"
          maxLength={300}
          defaultValue={initial.heroVideoUrl ?? ''}
          placeholder={t('videoPlaceholder')}
          aria-describedby="hero-video-hint"
          className="field w-full"
        />
        <p id="hero-video-hint" className="m-0 text-caption text-ink-2">
          {layout === 'video' ? t('videoHint') : t('videoHintOff')}
        </p>
      </div>
    </SettingsForm>
  );
}
