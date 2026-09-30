'use client';

import { brandPalette } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useCssomStyle } from '@/lib/cssom-style.ts';

/** Brand colour with a live preview and the WCAG contrast check (ADR 0018 brand kit). */
export function BrandColorField({ initial, fallback }: { initial: string | null; fallback: string }) {
  const t = useTranslations('settings.brand');
  const [value, setValue] = useState(initial ?? '');
  const valid = /^#[0-9a-fA-F]{6}$/.test(value);
  const p = brandPalette(valid ? value.toLowerCase() : fallback);
  const preview = useCssomStyle<HTMLSpanElement>({ background: p.background, color: p.text });
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="brand-color" className="text-caption text-zinc-600">
            {t('color')}
          </label>
          <input
            id="brand-color"
            name="brandColor"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={t('placeholder')}
            pattern="#[0-9a-fA-F]{6}"
            aria-describedby="brand-color-hint"
            className="min-h-10 w-40 rounded-pill border border-zinc-200 bg-white px-4 font-mono text-body"
          />
        </div>
        <input
          type="color"
          aria-label={t('picker')}
          value={valid ? value.toLowerCase() : fallback}
          onChange={(e) => setValue(e.target.value)}
          className="size-10 cursor-pointer rounded-pill border border-zinc-200 bg-white"
        />
        <span
          ref={preview}
          data-testid="brand-preview"
          className="inline-flex min-h-10 items-center rounded-pill px-5 text-body"
        >
          {t('preview')}
        </span>
      </div>
      <p id="brand-color-hint" className="text-caption text-zinc-500" aria-live="polite">
        {t('ratio', { ratio: p.textRatio.toFixed(1) })}
        {p.uiOk ? '' : ` ${t('tooLight', { ratio: p.onPage.toFixed(1) })}`}
      </p>
    </div>
  );
}
