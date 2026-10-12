'use client';

import { brandPalette } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useCssomStyle } from '@/lib/cssom-style.ts';

/** Brand colour with a live preview and the WCAG contrast check on both themes (ADR 0022). */
export function BrandColorField({
  initial,
  fallback,
  id = 'brand-color',
  label,
}: {
  initial: string | null;
  fallback: string;
  /** Distinct per field when a page has two (the org's colour and an event's). */
  id?: string;
  label?: string;
}) {
  const t = useTranslations('settings.brand');
  const [value, setValue] = useState(initial ?? '');
  const valid = /^#[0-9a-fA-F]{6}$/.test(value);
  const p = brandPalette(valid ? value.toLowerCase() : fallback);
  const preview = useCssomStyle<HTMLSpanElement>({ background: p.background, color: p.text });
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={id} className="text-[13px] font-bold text-ink">
            {label ?? t('color')}
          </label>
          <input
            id={id}
            name="brandColor"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={t('placeholder')}
            pattern="#[0-9a-fA-F]{6}"
            aria-describedby={`${id}-hint`}
            className="field w-40 font-mono"
          />
        </div>
        <input
          type="color"
          aria-label={t('picker')}
          value={valid ? value.toLowerCase() : fallback}
          onChange={(e) => setValue(e.target.value)}
          className="size-11 cursor-pointer rounded-control border border-line-strong bg-surface-solid p-1"
        />
        <span
          ref={preview}
          data-testid="brand-preview"
          className="inline-flex min-h-11 items-center rounded-control px-5 text-body font-bold"
        >
          {t('preview')}
        </span>
      </div>
      <p id={`${id}-hint`} className="text-caption text-ink-2" aria-live="polite">
        {t('ratio', { ratio: p.textRatio.toFixed(1) })}
        {p.onPage < 3 ? ` ${t('tooLight', { ratio: p.onPage.toFixed(1) })}` : ''}
        {p.onDarkPage < 3 ? ` ${t('tooDark', { ratio: p.onDarkPage.toFixed(1) })}` : ''}
      </p>
    </div>
  );
}
