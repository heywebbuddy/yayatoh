'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';

export interface HumanCheckWidget {
  readonly provider: 'fake' | 'turnstile';
  readonly siteKey: string | null;
  /** The fake adapter's answer (dev, preview and CI only). */
  readonly fakeToken: string;
}

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: {
          sitekey: string;
          language?: string;
          callback?: (token: string) => void;
          'error-callback'?: () => void;
          'expired-callback'?: () => void;
        },
      ) => string;
      reset?: (id?: string) => void;
    };
  }
}

const TURNSTILE_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/**
 * The "are you a person?" check (roadmap §6.1; M1.2f on sign-in, codes, resets and quotes).
 * Turnstile renders its widget into the form (it adds `cf-turnstile-response`); the fake adapter
 * is a checkbox. If Turnstile can't load (blocked script, network), a text alternative says what
 * to do instead of leaving an empty box. `onToken` reports the answer for forms sent by script.
 */
export function HumanCheckField({
  widget,
  label,
  onToken,
  locale,
}: {
  widget: HumanCheckWidget;
  /** The fake checkbox's label (defaults to the seat finder's wording). */
  label?: string;
  onToken?: (token: string) => void;
  locale?: string;
}) {
  const t = useTranslations('seatFinder');
  const th = useTranslations('humanCheck');
  const box = useRef<HTMLDivElement>(null);
  const [broken, setBroken] = useState(false);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;
  useEffect(() => {
    if (widget.provider !== 'turnstile' || !widget.siteKey || !box.current) return;
    const el = box.current;
    const sitekey = widget.siteKey;
    const render = () => {
      if (window.turnstile && !el.childElementCount)
        window.turnstile.render(el, {
          sitekey,
          ...(locale ? { language: locale } : {}),
          callback: (token) => onTokenRef.current?.(token),
          'error-callback': () => setBroken(true),
          'expired-callback': () => onTokenRef.current?.(''),
        });
    };
    if (window.turnstile) return render();
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${TURNSTILE_SRC}"]`);
    const script =
      existing ?? Object.assign(document.createElement('script'), { src: TURNSTILE_SRC, async: true });
    const fail = () => setBroken(true);
    script.addEventListener('load', render);
    script.addEventListener('error', fail);
    if (!existing) document.head.appendChild(script);
    // No widget after 10 seconds: say so (accessible fallback).
    const timer = window.setTimeout(() => {
      if (!el.childElementCount) setBroken(true);
    }, 10_000);
    return () => {
      script.removeEventListener('load', render);
      script.removeEventListener('error', fail);
      window.clearTimeout(timer);
    };
  }, [widget, locale]);
  if (widget.provider === 'turnstile')
    return (
      <div className="flex flex-col gap-2">
        <div ref={box} />
        <p role="status" className="text-caption text-zinc-600">
          {broken ? th('unavailable') : ''}
        </p>
      </div>
    );
  return (
    <label className="flex min-h-6 items-center gap-2 text-body">
      <input
        type="checkbox"
        name="human"
        value={widget.fakeToken}
        className="size-5"
        onChange={(e) => onToken?.(e.currentTarget.checked ? e.currentTarget.value : '')}
      />
      {label ?? t('fakeChallenge')}
    </label>
  );
}

/**
 * The check as a labelled group for account forms: "Security check", a short explanation, and
 * the widget. The explanation is the group's description, so screen readers hear why it's there.
 */
export function HumanCheckGroup({
  widget,
  onToken,
  locale,
}: {
  widget: HumanCheckWidget;
  onToken?: (token: string) => void;
  locale?: string;
}) {
  const t = useTranslations('humanCheck');
  const descId = useId();
  return (
    <fieldset
      aria-describedby={descId}
      className="flex flex-col gap-2 rounded-card border border-zinc-200 p-4"
    >
      <legend className="px-1 text-caption text-zinc-600">{t('legend')}</legend>
      <p id={descId} className="text-caption text-zinc-600">
        {t('explain')}
      </p>
      <HumanCheckField widget={widget} label={t('fakeLabel')} onToken={onToken} locale={locale} />
    </fieldset>
  );
}
