'use client';

import {
  contrastIssues,
  DEFAULT_PAGE_STYLE,
  type PageSection,
  type PageStyle,
  pageStyleVars,
  REQUIRED_SECTIONS,
  sectionOrder,
  TEXT_SCALES,
} from '@yayatoh/events/ui';
import { Alert, Button, constant, cx, light } from '@yayatoh/ui';
import { ArrowDown, ArrowUp, Minus, Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { type CSSProperties, useState } from 'react';
import type { SettingsState } from '@/app/[locale]/o/[org]/(org)/settings/actions.ts';
import { SettingsForm } from './settings-form.tsx';

type ColorKey = 'accent' | 'accent2' | 'band' | 'sectionBg' | 'text';
const COLORS: readonly ColorKey[] = ['accent', 'accent2', 'band', 'sectionBg', 'text'];
/** What the preview and the colour pickers start from when a colour is unset. */
const FALLBACK: Record<ColorKey, string> = {
  accent: light.primary.toLowerCase(),
  accent2: light.brand.toLowerCase(),
  band: light.primary.toLowerCase(),
  sectionBg: constant.white.toLowerCase(),
  text: light.ink.toLowerCase(),
};

/**
 * Page design (event branding): brand colours, text and section colours, text size, and section
 * visibility and order, with a live preview and a reset. Colour pairs below WCAG AA are flagged;
 * the public page also auto-corrects them, so a saved choice can never make text unreadable.
 */
export function PageStyleForm({
  action,
  initial,
}: {
  action: (prev: SettingsState, form: FormData) => Promise<SettingsState>;
  initial: PageStyle | null;
}) {
  const t = useTranslations('pageStyle');
  const tp = useTranslations('publicEvent');
  const te = useTranslations('eventPage');
  const ts = useTranslations('settings');
  const [style, setStyle] = useState<PageStyle>(initial ?? DEFAULT_PAGE_STYLE);
  // Sample times for the preview, in the organizer's locale.
  const hm = new Intl.DateTimeFormat(useLocale(), { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' });
  const at = (h: number, m: number) => hm.format(Date.UTC(2026, 0, 1, h, m));
  const order = sectionOrder(style);
  const name: Record<PageSection, string> = {
    announcements: tp('announcements'),
    about: te('about'),
    agenda: tp('agenda'),
    speakers: tp('speakers'),
    passes: tp('passes'),
    venue: te('venue'),
    faq: te('faq'),
    gallery: tp('gallery'),
    exhibitors: tp('exhibitors'),
    sponsors: tp('sponsors'),
    reviews: te('reviews'),
  };
  const issues = contrastIssues(style, { sectionBg: FALLBACK.sectionBg, text: FALLBACK.text });
  const vars = pageStyleVars(style) as CSSProperties;
  const move = (k: PageSection, dir: -1 | 1) => {
    const list = [...order];
    const i = list.indexOf(k);
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j] as PageSection, list[i] as PageSection];
    setStyle({ ...style, order: list });
  };
  const toggle = (k: PageSection) =>
    setStyle({
      ...style,
      hidden: style.hidden.includes(k) ? style.hidden.filter((x) => x !== k) : [...style.hidden, k],
    });
  const legend = 'mb-1 text-[13px] font-bold text-ink';
  return (
    <SettingsForm action={action} submitLabel={ts('save')} savedLabel={ts('saved')}>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
        <div className="flex min-w-0 flex-col gap-5">
          <fieldset className="flex flex-col gap-2 border-0 p-0">
            <legend className={legend}>{t('colorsLegend')}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {COLORS.map((k) => {
                const id = `page-style-${k}`;
                return (
                  <div
                    key={k}
                    className="flex items-center gap-3 rounded-tile border border-line bg-surface p-2.5"
                  >
                    <input
                      id={id}
                      type="color"
                      value={style[k] ?? FALLBACK[k]}
                      onChange={(e) => setStyle({ ...style, [k]: e.target.value.toLowerCase() })}
                      className="h-10 w-12 shrink-0 cursor-pointer rounded-[8px] border border-line bg-transparent"
                    />
                    <input type="hidden" name={k} value={style[k] ?? ''} />
                    <span className="flex min-w-0 grow flex-col">
                      <label htmlFor={id} className="text-body font-bold">
                        {t(k)}
                      </label>
                      <span className="font-mono text-caption text-ink-2">{style[k] ?? t('useDefault')}</span>
                    </span>
                    {style[k] ? (
                      <button
                        type="button"
                        onClick={() => setStyle({ ...style, [k]: null })}
                        className="min-h-10 shrink-0 rounded-[10px] px-2 text-caption font-bold text-ink-2 underline hover:text-ink"
                      >
                        {t('useDefault')}
                        <span className="sr-only">: {t(k)}</span>
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <div aria-live="polite">
              {issues.length > 0 ? (
                <Alert
                  tone="warning"
                  title={t('contrastWarn', { pair: issues.map((i) => t(`pair.${i}`)).join(', ') })}
                />
              ) : null}
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-2 border-0 p-0">
            <legend className={legend}>{t('textSizeLegend')}</legend>
            <div className="flex flex-wrap gap-2">
              {TEXT_SCALES.map((v) => (
                <label
                  key={v}
                  className={cx(
                    'flex min-h-11 cursor-pointer items-center gap-2 rounded-tile border px-3.5 has-focus-visible:outline-2 has-focus-visible:outline-focus',
                    style.scale === v ? 'border-primary bg-primary-soft' : 'border-line bg-surface',
                  )}
                >
                  <input
                    type="radio"
                    name="scale"
                    value={v}
                    checked={style.scale === v}
                    onChange={() => setStyle({ ...style, scale: v })}
                  />
                  <span className="text-body font-bold">{t(`scale.${v}`)}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-2 border-0 p-0">
            <legend className={legend}>{t('sectionsLegend')}</legend>
            <p className="m-0 text-caption text-ink-2">{t('sectionsHint')}</p>
            <input type="hidden" name="order" value={style.order.length > 0 ? order.join(',') : ''} />
            <input type="hidden" name="hidden" value={style.hidden.join(',')} />
            <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
              {order.map((k, i) => {
                const required = REQUIRED_SECTIONS.includes(k);
                return (
                  <li
                    key={k}
                    className="flex items-center gap-2 rounded-tile border border-line bg-surface px-3 py-1.5"
                  >
                    <label className="flex min-h-10 grow items-center gap-2.5">
                      <input
                        type="checkbox"
                        checked={required || !style.hidden.includes(k)}
                        disabled={required}
                        onChange={() => toggle(k)}
                        aria-label={t('visible', { name: name[k] })}
                      />
                      <span className="text-body font-bold">{name[k]}</span>
                      {required ? (
                        <span className="text-caption text-ink-2">· {t('alwaysShown')}</span>
                      ) : null}
                    </label>
                    <button
                      type="button"
                      onClick={() => move(k, -1)}
                      disabled={i === 0}
                      aria-label={t('moveUp', { name: name[k] })}
                      className="flex size-10 items-center justify-center rounded-[10px] text-ink-2 hover:bg-surface-3 disabled:opacity-35"
                    >
                      <ArrowUp aria-hidden="true" className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(k, 1)}
                      disabled={i === order.length - 1}
                      aria-label={t('moveDown', { name: name[k] })}
                      className="flex size-10 items-center justify-center rounded-[10px] text-ink-2 hover:bg-surface-3 disabled:opacity-35"
                    >
                      <ArrowDown aria-hidden="true" className="size-4" />
                    </button>
                  </li>
                );
              })}
            </ol>
          </fieldset>
          <Button
            type="button"
            variant="secondary"
            className="self-start"
            onClick={() => setStyle(DEFAULT_PAGE_STYLE)}
          >
            {t('reset')}
          </Button>
        </div>

        <section aria-labelledby="page-style-preview" className="flex min-w-0 flex-col gap-2">
          <h3 id="page-style-preview" className="m-0 text-[13px] font-bold text-ink">
            {t('preview')}
          </h3>
          {/* The same classes and variables as the public page, so the preview matches it. */}
          <div
            data-ev-page
            data-theme="light"
            style={vars}
            className="flex flex-col gap-3 rounded-card border border-line bg-canvas p-3 lg:sticky lg:top-4"
          >
            <div className="ev-card flex flex-col gap-3 rounded-[20px] p-4">
              <div className="flex flex-col items-center gap-2">
                <span aria-hidden="true" className="ev-accent-bar h-1 w-8 rounded-full" />
                <span className="text-[length:calc(22px*var(--ev-scale,1))] font-extrabold">
                  {tp('agenda')}
                </span>
              </div>
              <div className="ev-agenda-row flex items-center justify-between gap-3 px-3.5 py-3">
                <span className="flex flex-col gap-0.5">
                  <span className="ev-time font-mono text-[12px] font-bold">{`${at(9, 0)}–${at(9, 45)}`}</span>
                  <span className="text-[length:calc(15px*var(--ev-scale,1))] font-extrabold text-ink">
                    {t('previewSession')}
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  className="ev-accent-fill flex size-7 items-center justify-center rounded-full"
                >
                  <Plus className="size-3.5" strokeWidth={2.6} />
                </span>
              </div>
              <div className="ev-agenda-row flex items-center justify-between gap-3 px-3.5 py-3">
                <span className="flex flex-col gap-0.5">
                  <span className="ev-time font-mono text-[12px] font-bold">{`${at(9, 45)}–${at(10, 0)}`}</span>
                  <span className="text-[length:calc(15px*var(--ev-scale,1))] font-extrabold text-ink">
                    {t('previewBody')}
                  </span>
                </span>
                <Minus aria-hidden="true" className="size-3.5 opacity-0" />
              </div>
            </div>
            <div className="ev-band relative isolate flex flex-col items-center gap-3 overflow-hidden rounded-[20px] px-4 py-6">
              <span
                aria-hidden="true"
                className="absolute -end-8 -top-10 -z-10 size-28 rounded-full bg-white/15"
              />
              <span className="text-[length:calc(22px*var(--ev-scale,1))] font-extrabold">
                {tp('speakers')}
              </span>
              <span className="flex gap-2">
                {(['ev-tone-1', 'ev-tone-2', 'ev-tone-3'] as const).map((tone) => (
                  <span key={tone} className="relative flex h-16 w-16 rounded-[12px] bg-white p-1.5">
                    <span aria-hidden="true" className={`size-full rounded-full ${tone} ev-tone-fill`} />
                  </span>
                ))}
              </span>
            </div>
            <span className="ev-cta self-center rounded-pill px-4 py-2 text-body font-extrabold ev-accent-fill">
              {tp('getTickets')}
            </span>
          </div>
        </section>
      </div>
    </SettingsForm>
  );
}
