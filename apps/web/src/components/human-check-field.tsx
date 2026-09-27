'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';

export interface HumanCheckWidget {
  readonly provider: 'fake' | 'turnstile';
  readonly siteKey: string | null;
  /** The fake adapter's answer (dev, preview and CI only). */
  readonly fakeToken: string;
}

declare global {
  interface Window {
    turnstile?: { render: (el: HTMLElement, opts: { sitekey: string }) => string };
  }
}

const TURNSTILE_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/**
 * The "are you a person?" check shown past a lookup limit (roadmap §6.1). Turnstile renders its
 * widget into the form (it adds `cf-turnstile-response`); the fake adapter is a checkbox.
 */
export function HumanCheckField({ widget }: { widget: HumanCheckWidget }) {
  const t = useTranslations('seatFinder');
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (widget.provider !== 'turnstile' || !widget.siteKey || !box.current) return;
    const el = box.current;
    const sitekey = widget.siteKey;
    const render = () => {
      if (window.turnstile && !el.childElementCount) window.turnstile.render(el, { sitekey });
    };
    if (window.turnstile) return render();
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${TURNSTILE_SRC}"]`);
    const script =
      existing ?? Object.assign(document.createElement('script'), { src: TURNSTILE_SRC, async: true });
    script.addEventListener('load', render);
    if (!existing) document.head.appendChild(script);
    return () => script.removeEventListener('load', render);
  }, [widget]);
  if (widget.provider === 'turnstile') return <div ref={box} />;
  return (
    <label className="flex min-h-6 items-center gap-2 text-body">
      <input type="checkbox" name="human" value={widget.fakeToken} className="size-5" />
      {t('fakeChallenge')}
    </label>
  );
}
